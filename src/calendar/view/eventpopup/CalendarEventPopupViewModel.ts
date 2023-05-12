import { CalendarEvent } from "../../../api/entities/tutanota/TypeRefs.js"
import { CalendarEventEditModels, EventType } from "../../model/eventeditor/CalendarEventEditModel.js"
import { getNonOrganizerAttendees } from "./CalendarEventPopup.js"
import { calendarEventHasMoreThanOneOccurrencesLeft } from "../../date/CalendarUtils.js"
import { EventSaveResult } from "../../model/eventeditor/CalendarEventSaveModel.js"
import { NotFoundError } from "../../../api/common/error/RestError.js"
import { CalendarModel } from "../../model/CalendarModel.js"
import { CalendarEventEditMode, showExistingCalendarEventEditDialog } from "../eventeditor/CalendarEventEditDialog.js"
import { resolveCalendarEventProgenitor } from "../CalendarView.js"

/**
 * makes decisions about which operations are available from the popup and knows how to implement them depending on the event's type.
 */
export class CalendarEventPopupViewModel {
	readonly canEdit: boolean
	readonly canDelete: boolean
	readonly canSendUpdates: boolean
	/** for editing, an event that has only one non-deleted instance is still considered repeating. */
	readonly isRepeatingForEditing: boolean
	/** for deleting, an event that has only one non-deleted instance behaves as if it wasn't repeating */
	readonly isRepeatingForDeleting: boolean

	constructor(
		readonly calendarEvent: Readonly<CalendarEvent>,
		private readonly calendarModel: CalendarModel,
		private readonly eventType: EventType,
		private readonly hasBusinessFeature: boolean,
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

		this.isRepeatingForEditing = calendarEvent.repeatRule != null
		this.isRepeatingForDeleting = calendarEventHasMoreThanOneOccurrencesLeft(calendarEvent)
	}

	/**
	 * add an exclusion for this event instance start time on the original event.
	 *  if this is a rescheduled instance, we just delete the event because the progenitor already
	 *  has an exclusion for this time.
	 * */
	async deleteSingle() {
		console.log("deletesingle")
	}

	async deleteAll(): Promise<void> {
		try {
			// FIXME: send cancellations.
			return await this.calendarModel.deleteEvent(await resolveCalendarEventProgenitor(this.calendarEvent))
		} catch (e) {
			if (!(e instanceof NotFoundError)) {
				throw e
			}
		}
	}

	async editSingle() {
		console.log("editsingle")
	}

	async editAll() {
		const editModels = await this.editModelsFactory(CalendarEventEditMode.All)
		try {
			return await showExistingCalendarEventEditDialog(editModels)
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
}
