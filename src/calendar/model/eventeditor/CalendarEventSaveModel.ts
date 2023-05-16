import { AccountType, CalendarAttendeeStatus, FeatureType } from "../../../api/common/TutanotaConstants.js"
import type { CalendarEvent, CalendarRepeatRule, EncryptedMailAddress, Mail, MailboxProperties } from "../../../api/entities/tutanota/TypeRefs.js"
import { createEncryptedMailAddress } from "../../../api/entities/tutanota/TypeRefs.js"
import { AlarmInfo, DateWrapper } from "../../../api/entities/sys/TypeRefs.js"
import type { MailboxDetail } from "../../../mail/model/MailModel.js"
import { CalendarEventValidity, checkEventValidity, generateUid, incrementSequence } from "../../date/CalendarUtils.js"
import { isCustomizationEnabledForCustomer } from "../../../api/common/utils/Utils.js"
import { arrayEqualsWithPredicate, assertNotNull, clone, noOp } from "@tutao/tutanota-utils"
import { cleanMailAddress, findAttendeeInAddresses } from "../../../api/common/utils/CommonCalendarUtils.js"
import type { CalendarInfo } from "../CalendarModel.js"
import { CalendarModel } from "../CalendarModel.js"
import { PayloadTooLargeError, TooManyRequestsError } from "../../../api/common/error/RestError.js"
import type { CalendarUpdateDistributor } from "../../date/CalendarUpdateDistributor.js"
import type { UserController } from "../../../api/main/UserController.js"
import type { SendMailModel } from "../../../mail/editor/SendMailModel.js"
import { UserError } from "../../../api/main/UserError.js"
import { EntityClient } from "../../../api/common/EntityClient.js"
import { BusinessFeatureRequiredError } from "../../../api/main/BusinessFeatureRequiredError.js"
import { getSenderName } from "../../../misc/MailboxPropertiesUtils.js"
import { assembleCalendarEventEditResult, assignEventIdentity, CalendarEventEditModels, EventType } from "./CalendarEventEditModel.js"
import { ProgrammingError } from "../../../api/common/error/ProgrammingError.js"
import { getNonOrganizerAttendees } from "../../view/eventpopup/CalendarEventPopup.js"

// whether to close dialog
export const enum EventSaveResult {
	Saved,
	Failed,
}

type ShowProgressCallback = (arg0: Promise<unknown>) => unknown

/**
 * Determines the event type, the organizer of the event and possible organizers in accordance with the capabilities for events (see table).
 * Note that the only organizer that an event can have is the owner of the calendar the event is defined in.
 *
 * it is impossible to change the guest list on events in calendars you do not own,
 * which means that the event has no organizer (guest list is empty) or that
 * the event has guests and therefore also an organizer that's not us.
 *
 * If events are created by someone we share our personal calendar with, the organizer is overwritten and set to our own primary address.
 * Possible organizers are all email addresses of the user, allowed to modify the organizer. This is only the owner of the calendar ("real" organizer)
 * and only if there are no guests.
 *
 * Capability for events is fairly complicated:
 * Note: "shared" calendar means "not owner of the calendar". Calendar always looks like personal for the owner.
 *
 * | Calendar           | is organizer     | can edit details    | can modify own attendance | can modify guests | can modify organizer
 * |--------------------|------------------|---------------------|---------------------------|-------------------|----------
 * | Personal (own)     | yes              | yes                 | yes                       | yes               | yes
 * | Personal (invite)  | no               | yes (local)         | yes                       | no                | no
 * | Personal (own)     | no****           | yes                 | yes                       | yes               | yes
 * | Shared             | yes****          | yes***              | no                        | no*               | no*
 * | Shared             | no               | no                  | no**                      | no*               | no*
 *
 *
 * | calendar  | event origin | edit details  | edit own attendance | modify attendees |
 * |-----------|--------------|---------------|---------------------|------------------|
 * | own       | calendar     | yes           | yes                 | yes              |
 * | own       | invite       | yes (local)   | yes                 | no               |
 * | shared rw | calendar     | yes           | yes                 |                  |
 * | shared rw | invite       | yes (local)   |                     |                  |
 * | shared ro | calendar     | no            | no                  | no               |
 * | shared ro | invite       | no            | no                  | no               |
 *
 *   * we don't allow inviting guests in other people's calendar because later only organizer can modify event and
 *   we don't want to prevent calendar owner from editing events in their own calendar.
 *
 *   ** this is not "our" copy of the event, from the viewpoint of the organizer we saw it just accidentally.
 *   Later we might support proposing ourselves as attendee but currently organizer should be asked to
 *   send out the event.
 *
 *   *** depends on share capability and whether there are attendees.
 *
 *   **** The creator of the event. Will be overwritten with owner of the calendar by this function.
 *
 *   saving an event. takes care of sending updates and changes on the server.
 */
export class CalendarEventSaveModel {
	processing: boolean = false

	/**
	 * whether this user can will send updates for this event.
	 * * this needs to be our event.
	 * * we need the business feature
	 * * there need to be changes that permit updates
	 */
	shouldSendUpdates: boolean = false
	hasBusinessFeature: boolean = false
	hasPremiumLegacy: boolean = false
	readonly initialized: Promise<CalendarEventSaveModel>
	private readonly sequence: string

	constructor(
		private readonly existingEvent: Readonly<CalendarEvent> | null,
		public readonly eventType: EventType,
		// UserController already keeps track of user updates, it is better to not have our own reference to the user, we might miss
		// important updates like premium upgrade
		private readonly userController: UserController,
		private readonly distributor: CalendarUpdateDistributor,
		private readonly calendarModel: CalendarModel,
		private readonly entityClient: EntityClient,
		mailboxDetail: MailboxDetail,
		mailboxProperties: MailboxProperties,
		private readonly calendars: ReadonlyMap<Id, CalendarInfo>,
		private readonly zone: string,
		private readonly responseTo: Mail | null,
		private readonly showProgress: ShowProgressCallback = noOp,
	) {
		this.calendars = calendars
		this.sequence = existingEvent?.sequence ?? "0"
		this.initialized = this.updateCustomerFeatures()
	}

	async updateCustomerFeatures(): Promise<CalendarEventSaveModel> {
		if (this.userController.isInternalUser()) {
			const customer = await this.userController.loadCustomer()
			this.hasBusinessFeature = isCustomizationEnabledForCustomer(customer, FeatureType.BusinessFeatureEnabled)
			this.hasPremiumLegacy = isCustomizationEnabledForCustomer(customer, FeatureType.PremiumLegacy)
		} else {
			this.hasBusinessFeature = false
			this.hasPremiumLegacy = false
		}

		return this
	}

	shouldShowSendInviteNotAvailable(): boolean {
		if (this.userController.user.accountType === AccountType.FREE) {
			return true
		}

		if (this.userController.user.accountType === AccountType.EXTERNAL) {
			return false
		}

		return !this.hasBusinessFeature && !this.hasPremiumLegacy
	}

	/**
	 * save a new event to the selected calendar, invite all attendees except for the organizer and set up alarms.
	 */
	async saveNewEvent(editModels: CalendarEventEditModels): Promise<EventSaveResult> {
		let result = EventSaveResult.Failed
		await this.initialized

		const { eventValues, newAlarms, sendModels, calendar } = assembleCalendarEventEditResult(editModels)
		const { inviteModel } = sendModels
		const uid = generateUid(calendar.group._id, Date.now())
		const newEvent = assignEventIdentity(eventValues, { uid })

		assertEventValidity(newEvent)
		if (this.processing) {
			return result
		}
		this.processing = true
		try {
			if (inviteModel != null) await this.sendInvites(newEvent, inviteModel)
			await this.saveEvent(newEvent, calendar, newAlarms)
			result = EventSaveResult.Saved
		} catch (e) {
			if (e instanceof PayloadTooLargeError) {
				throw new UserError("requestTooLarge_msg")
			} else {
				throw e
			}
		} finally {
			this.processing = false
		}

		return result
	}

	async deleteEvent(editModels: CalendarEventEditModels): Promise<EventSaveResult> {
		const event = assertNotNull(this.existingEvent, "tried to delete non-existing event")
		const { sendModels } = assembleCalendarEventEditResult(editModels)
		const { updateModel } = sendModels
		if (updateModel) {
			await this.distributor.sendCancellation(event, updateModel)
		}
		await this.calendarModel.deleteEvent(event)
		return EventSaveResult.Saved
	}

	/**
	 * save an invite from a file to the selected calendar, set up alarms and notify the organizer.
	 */
	async saveInviteToCalendar(): Promise<EventSaveResult> {
		return EventSaveResult.Failed
	}

	/**
	 * update a single occurrence of an event by adding an exclusion to the original event if it does not exist,
	 * deleting the rescheduled occurrence if it already exists and uploading the new rescheduled occurrence.
	 * @param editModels
	 */
	async updateSingleExistingEvent(editModels: CalendarEventEditModels): Promise<EventSaveResult> {
		throw new ProgrammingError("not implemented yet.")
	}

	/**
	 * update the whole event by completely deleting the old event, writing the new one,
	 * updating/inviting/cancelling any attendees where that is necessary.
	 */
	async updateExistingEvent(editModels: CalendarEventEditModels): Promise<EventSaveResult> {
		let result = EventSaveResult.Failed
		await this.initialized

		const { eventValues, newAlarms, sendModels, calendar } = assembleCalendarEventEditResult(editModels)
		const { updateModel, cancelModel, responseModel, inviteModel } = sendModels

		const mayIncrement = editModels.saveModel.eventType === EventType.OWN || editModels.saveModel.eventType === EventType.SHARED_RW
		const { uid: oldUid, sequence: oldSequence } = assertNotNull(this.existingEvent, "called update existing event on nonexisting event")
		const newEvent = assignEventIdentity(eventValues, {
			uid: assertNotNull(oldUid, "called update existing event on event without uid"),
			sequence: incrementSequence(oldSequence, mayIncrement),
		})

		assertEventValidity(newEvent)

		if (this.processing) {
			return result
		}
		this.processing = true

		try {
			// We want to avoid asking whether to send out updates in case nothing has changed
			if (this.eventType === EventType.OWN && (this.shouldSendUpdates || eventHasChanged(newEvent, this.existingEvent))) {
				// It is our own event. We might need to send out invites/cancellations/updates
				await this.sendNotifications(newEvent, { inviteModel, updateModel, cancelModel })
				// fixme: we could just take existing event ids where it's required?
				newEvent._id = assertNotNull(this.existingEvent?._id, "no id to update existing event")
				newEvent._ownerGroup = assertNotNull(this.existingEvent?._ownerGroup, "no ownergroup to update existing event")
				newEvent._permissions = assertNotNull(this.existingEvent?._permissions, "no permissions to update existing event")
				return this.saveEvent(newEvent, calendar, newAlarms)
			} else if (this.eventType === EventType.INVITE && responseModel != null) {
				// We have been invited by another person (internal/ unsecure external)
				await this.respondToOrganizer(newEvent, responseModel)
				return await this.saveEvent(newEvent, calendar, newAlarms)
			} else {
				// Either this is an event in a shared calendar. We cannot send anything because it's not our event.
				// Or no changes were made that require sending updates and we just save other changes.
				await this.showProgress(this.saveEvent(newEvent, calendar, newAlarms))
				return EventSaveResult.Saved
			}
		} catch (e) {
			if (e instanceof PayloadTooLargeError) {
				throw new UserError("requestTooLarge_msg")
			}
			throw e
		} finally {
			this.processing = false
		}
	}

	private async sendCancellation(event: CalendarEvent, cancelModel: SendMailModel): Promise<any> {
		const updatedEvent = clone(event)

		// This is guaranteed to be our own event.
		updatedEvent.sequence = incrementSequence(this.sequence, true)

		try {
			await this.distributor.sendCancellation(updatedEvent, cancelModel)
		} catch (e) {
			if (e instanceof TooManyRequestsError) {
				throw new UserError("mailAddressDelay_msg") // This will be caught and open error dialog
			} else {
				throw e
			}
		}
	}

	private async saveEvent(eventToSave: CalendarEvent, calendar: CalendarInfo, newAlarms: ReadonlyArray<AlarmInfo>): Promise<EventSaveResult> {
		if (this.userController.user.accountType === AccountType.EXTERNAL) {
			return Promise.resolve(EventSaveResult.Failed)
		}
		const { groupRoot } = calendar

		if (eventToSave._id == null) {
			await this.calendarModel.createEvent(eventToSave, newAlarms, this.zone, groupRoot)
		} else {
			await this.calendarModel.updateEvent(
				eventToSave,
				newAlarms,
				this.zone,
				groupRoot,
				assertNotNull(this.existingEvent, "tried to update non-existing event."),
			)
		}
		return EventSaveResult.Saved
	}

	/**
	 * send all notifications required for the new event. will always send cancellations and invites, but will skip updates
	 * if this.shouldSendUpdates is false.
	 *
	 * will modify the attendee list of newEvent if invites/cancellations are sent.
	 */
	async sendNotifications(
		newEvent: CalendarEvent,
		models: {
			inviteModel: SendMailModel | null
			updateModel: SendMailModel | null
			cancelModel: SendMailModel | null
		},
	): Promise<void> {
		if (models.updateModel == null && models.cancelModel == null && models.inviteModel == null) {
			return
		}
		if (this.shouldShowSendInviteNotAvailable()) {
			throw new BusinessFeatureRequiredError("businessFeatureRequiredInvite_msg")
		}
		const invitePromise = models.inviteModel != null ? this.sendInvites(newEvent, models.inviteModel) : Promise.resolve()
		const cancelPromise = models.cancelModel != null ? this.sendCancellation(newEvent, models.cancelModel) : Promise.resolve()
		const updatePromise = models.updateModel != null && this.shouldSendUpdates ? this.sendUpdates(newEvent, models.updateModel) : Promise.resolve()
		return await Promise.all([invitePromise, cancelPromise, updatePromise]).then()
	}

	/**
	 * invite all new attendees for an event and set their status from "ADDED" to "NEEDS_ACTION"
	 * @param event will be modified if invites are sent.
	 * @param inviteModel
	 * @private
	 */
	private async sendInvites(event: CalendarEvent, inviteModel: SendMailModel): Promise<void> {
		if (event.organizer == null || inviteModel?.allRecipients().length === 0) {
			throw new ProgrammingError("event has no organizer or no invitable attendees, can't send invites.")
		}
		const newAttendees = getNonOrganizerAttendees(event).filter((a) => a.status === CalendarAttendeeStatus.ADDED)
		await inviteModel.waitForResolvedRecipients()
		await this.distributor.sendInvite(event, inviteModel)
		for (const attendee of newAttendees) {
			if (attendee.status === CalendarAttendeeStatus.ADDED) {
				attendee.status = CalendarAttendeeStatus.NEEDS_ACTION
			}
		}
	}

	private async sendUpdates(event: CalendarEvent, updateModel: SendMailModel): Promise<void> {
		await updateModel.waitForResolvedRecipients()
		await this.distributor.sendUpdate(event, updateModel)
	}

	/**
	 * send a response mail to the organizer as stated on the original event. calling this for an event that is not an invite or
	 * does not contain address as an attendee or that has no organizer is an error.
	 * @param newEvent the event to send the update for, this should be identical to existingEvent except for the own status.
	 * @param responseModel
	 * @private
	 */
	private async respondToOrganizer(newEvent: CalendarEvent, responseModel: SendMailModel): Promise<void> {
		if (this.existingEvent?.attendees == null || this.existingEvent.attendees.length === 0 || this.existingEvent.organizer == null) {
			throw new ProgrammingError("trying to send a response to an event that has no attendees or has no organizer")
		}
		if (this.eventType !== EventType.INVITE) {
			throw new ProgrammingError("trying to send a response to an event that is not an invite.")
		}

		const existingOwnAttendee = findAttendeeInAddresses(this.existingEvent.attendees, [responseModel.getSender()])
		const newOwnAttendee = findAttendeeInAddresses(newEvent.attendees, [responseModel.getSender()])
		if (existingOwnAttendee == null || newOwnAttendee == null) {
			throw new ProgrammingError("trying to send a response when the responding address is not in the event attendees")
		}

		if (!(existingOwnAttendee.status !== newOwnAttendee.status && newOwnAttendee.status !== CalendarAttendeeStatus.NEEDS_ACTION)) {
			/** in this case, there's nothing to do. */
			return
		}

		await this.showProgress(
			(async () => {
				await responseModel.waitForResolvedRecipients()
				await this.distributor.sendResponse(newEvent, responseModel, this.responseTo)
				responseModel.dispose()
			})(),
		)
	}
}

/**
 * Keep in sync with initializeNewEvent().
 * @param now the new event.
 * @param previous the event as it originally was
 * @returns {boolean} true if changes were made to the event that justify sending updates to attendees.
 */
function eventHasChanged(now: CalendarEvent, previous: Partial<CalendarEvent> | null): boolean {
	if (previous == null) return true
	// we do not check for the sequence number (as it should be changed with every update) or the default instance properties such as _id
	return (
		now.startTime.getTime() !== previous?.startTime?.getTime() ||
		now.description !== previous.description ||
		now.summary !== previous.summary ||
		now.location !== previous.location ||
		now.endTime.getTime() !== previous?.endTime?.getTime() ||
		now.invitedConfidentially !== previous.invitedConfidentially ||
		now.uid !== previous.uid ||
		!areRepeatRulesEqual(now.repeatRule, previous?.repeatRule ?? null) ||
		!arrayEqualsWithPredicate(
			now.attendees,
			previous?.attendees ?? [],
			(a1, a2) => a1.status === a2.status && cleanMailAddress(a1.address.address) === cleanMailAddress(a2.address.address),
		) || // we ignore the names
		(now.organizer !== previous.organizer && now.organizer?.address !== previous.organizer?.address)
	) // we ignore the names
}

export function addressToMailAddress(mailboxProperties: MailboxProperties, address: string): EncryptedMailAddress {
	return createEncryptedMailAddress({
		address,
		name: getSenderName(mailboxProperties, address) ?? "",
	})
}

export function areRepeatRulesEqual(r1: CalendarRepeatRule | null, r2: CalendarRepeatRule | null): boolean {
	return (
		r1 === r2 ||
		(r1?.endType === r2?.endType &&
			r1?.endValue === r2?.endValue &&
			r1?.frequency === r2?.frequency &&
			r1?.interval === r2?.interval &&
			r1?.timeZone === r2?.timeZone &&
			areExcludedDatesEqual(r1?.excludedDates ?? [], r2?.excludedDates ?? []))
	)
}

/**
 * compare two lists of dates that are sorted from earliest to latest. return true if they are equivalent.
 */
export function areExcludedDatesEqual(e1: ReadonlyArray<DateWrapper>, e2: ReadonlyArray<DateWrapper>): boolean {
	if (e1.length !== e2.length) return false
	return e1.every(({ date }, i) => e2[i].date.getTime() === date.getTime())
}

function assertEventValidity(event: CalendarEvent) {
	switch (checkEventValidity(event)) {
		case CalendarEventValidity.InvalidContainsInvalidDate:
			throw new UserError("invalidDate_msg")
		case CalendarEventValidity.InvalidEndBeforeStart:
			throw new UserError("startAfterEnd_label")
		case CalendarEventValidity.InvalidPre1970:
			// shouldn't happen while the check in setStartDate is still there, resetting the date each time
			throw new UserError("pre1970Start_msg")
		case CalendarEventValidity.Valid:
		default:
		// event is valid, nothing to do
	}
}
