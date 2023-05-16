import { CalendarEvent, CalendarEventAttendee } from "../../../api/entities/tutanota/TypeRefs.js"
import { CalendarEventEditModels, EventType } from "../../model/eventeditor/CalendarEventEditModel.js"
import { getNonOrganizerAttendees } from "./CalendarEventPopup.js"
import { calendarEventHasMoreThanOneOccurrencesLeft } from "../../date/CalendarUtils.js"
import { EventSaveResult } from "../../model/eventeditor/CalendarEventSaveModel.js"
import { NotFoundError } from "../../../api/common/error/RestError.js"
import { CalendarModel } from "../../model/CalendarModel.js"
import { CalendarEventEditMode, showExistingCalendarEventEditDialog } from "../eventeditor/CalendarEventEditDialog.js"
import { ProgrammingError } from "../../../api/common/error/ProgrammingError.js"
import { CalendarAttendeeStatus } from "../../../api/common/TutanotaConstants.js"
import { sendResponse } from "../../../mail/view/EventBanner.js"

/**
 * makes decisions about which operations are available from the popup and knows how to implement them depending on the event's type.
 */
export class CalendarEventPopupViewModel {
	readonly canEdit: boolean
	readonly canDelete: boolean
	readonly canSendUpdates: boolean
	/** for deleting, an event that has only one non-deleted instance behaves as if it wasn't repeating
	 * because deleting the last instance is the same as deleting the whole event from the pov of the user.
	 */
	readonly isRepeatingForDeleting: boolean
	/** for editing, an event that has only one non-deleted instance is still considered repeating
	 * because we might reschedule that instance and then unexclude some deleted instances.
	 */
	readonly isRepeatingForEditing: boolean

	constructor(
		readonly calendarEvent: Readonly<CalendarEvent>,
		private readonly calendarModel: CalendarModel,
		private readonly eventType: EventType,
		private readonly hasBusinessFeature: boolean,
		readonly ownAttendance: CalendarAttendeeStatus | null,
		private readonly editModelsFactory: (mode: CalendarEventEditMode) => Promise<CalendarEventEditModels>,
	) {
		if (this.calendarEvent._ownerGroup == null) {
			this.canEdit = false
			this.canDelete = false
			this.canSendUpdates = false
		} else {
			this.canEdit = this.eventType === EventType.OWN || this.eventType === EventType.SHARED_RW
			this.canDelete = this.canEdit || this.eventType === EventType.INVITE
			this.canSendUpdates = hasBusinessFeature && this.eventType === EventType.OWN && getNonOrganizerAttendees(calendarEvent).length > 0
		}

		// we do not edit single instances yet
		this.isRepeatingForEditing = false // calendarEvent.repeatRule != null
		this.isRepeatingForDeleting = calendarEventHasMoreThanOneOccurrencesLeft(calendarEvent)
	}

	/**
	 * add an exclusion for this event instances start time on the original event.
	 * if this is a rescheduled instance, we will just delete the event because the progenitor already
	 * has an exclusion for this time.
	 * */
	async deleteSingle() {
		try {
			// passing "all" because this is actually an update to the progenitor
			const editModels = await this.editModelsFactory(CalendarEventEditMode.All)
			await editModels.whenModel.excludeDate(this.calendarEvent.startTime)
			await editModels.saveModel.updateExistingEvent(editModels)
		} catch (e) {
			if (!(e instanceof NotFoundError)) {
				throw e
			}
		}
	}

	async deleteAll(): Promise<void> {
		try {
			const editModels = await this.editModelsFactory(CalendarEventEditMode.All)
			await editModels.saveModel.deleteEvent(editModels)
		} catch (e) {
			if (!(e instanceof NotFoundError)) {
				throw e
			}
		}
	}

	async editSingle() {
		throw new ProgrammingError("not implemented")
	}

	async editAll() {
		const editModels = await this.editModelsFactory(CalendarEventEditMode.All)
		try {
			return await showExistingCalendarEventEditDialog(editModels, {
				uid: this.calendarEvent.uid,
				sequence: this.calendarEvent.sequence,
				recurrenceId: null,
			})
		} catch (err) {
			if (err instanceof NotFoundError) {
				console.log("calendar event not found when clicking on the event")
			} else {
				throw err
			}
		}
	}

	async sendUpdates(): Promise<EventSaveResult> {
		const { saveModel } = await this.editModelsFactory(CalendarEventEditMode.All)
		try {
			saveModel.shouldSendUpdates = true
			console.log("sending updates")
			return EventSaveResult.Saved
		} finally {
			saveModel.shouldSendUpdates = false
		}
	}

	async setOwnAttendance(status: CalendarAttendeeStatus): Promise<void> {
		sendResponse(this.calendarEvent, this.calendarEvent.organizer.address, status)
	}
}
