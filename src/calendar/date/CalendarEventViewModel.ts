import {
	AccountType,
	AlarmInterval,
	CalendarAttendeeStatus,
	EndType,
	FeatureType,
	getAttendeeStatus,
	RepeatPeriod,
	ShareCapability,
	TimeFormat,
} from "../../api/common/TutanotaConstants"
import type { CalendarEvent, CalendarRepeatRule, EncryptedMailAddress, Mail, MailboxProperties } from "../../api/entities/tutanota/TypeRefs.js"
import { CalendarEventTypeRef, createCalendarEvent, createCalendarEventAttendee, createEncryptedMailAddress } from "../../api/entities/tutanota/TypeRefs.js"
import { AlarmInfo, createDateWrapper, DateWrapper, RepeatRule } from "../../api/entities/sys/TypeRefs.js"
import type { MailboxDetail } from "../../mail/model/MailModel"
import stream from "mithril/stream"
import { copyMailAddress, getEnabledMailAddressesWithUser, RecipientField } from "../../mail/model/MailUtils"
import {
	CalendarEventValidity,
	checkEventValidity,
	createRepeatRuleWithValues,
	generateUid,
	getAllDayDateUTCFromZone,
	getEventEnd,
	getEventStart,
	getNextHalfHour,
	getRepeatEndTime,
	getStartOfDayWithZone,
	getStartOfNextDayWithZone,
	getTimeZone,
	incrementSequence,
	prepareCalendarDescription,
} from "./CalendarUtils"
import { isCustomizationEnabledForCustomer } from "../../api/common/utils/Utils"
import { addMapEntry, arrayEqualsWithPredicate, assertNotNull, clone, downcast, incrementDate, neverNull, noOp, ofClass } from "@tutao/tutanota-utils"
import {
	cleanMailAddress,
	findAttendeeInAddresses,
	findRecipientWithAddress,
	getAllDayDateUTC,
	isAllDayEvent,
} from "../../api/common/utils/CommonCalendarUtils"
import type { CalendarInfo } from "../model/CalendarModel"
import { CalendarModel } from "../model/CalendarModel"
import { DateTime } from "luxon"
import { NotFoundError, PayloadTooLargeError, TooManyRequestsError } from "../../api/common/error/RestError"
import type { CalendarUpdateDistributor } from "./CalendarUpdateDistributor"
import type { UserController } from "../../api/main/UserController"
import type { SendMailModel } from "../../mail/editor/SendMailModel"
import { UserError } from "../../api/main/UserError"
import { EntityClient } from "../../api/common/EntityClient"
import { BusinessFeatureRequiredError } from "../../api/main/BusinessFeatureRequiredError"
import { hasCapabilityOnGroup } from "../../sharing/GroupUtils"
import { Time } from "../../api/common/utils/Time"
import { hasError } from "../../api/common/utils/ErrorCheckUtils"
import { RecipientType } from "../../api/common/recipients/Recipient"
import { ResolveMode } from "../../api/main/RecipientsModel.js"
import { getSenderName } from "../../misc/MailboxPropertiesUtils.js"
import { EventType } from "./CalendarEventEditModel.js"

// whether to close dialog
export type EventCreateResult = boolean

export type Guest = {
	address: EncryptedMailAddress
	type: RecipientType
	status: CalendarAttendeeStatus
}
type SendMailModelFactory = () => SendMailModel

export type RepeatData = {
	frequency: RepeatPeriod
	interval: number
	endType: EndType
	endValue: number
	excludedDates: Array<Date>
}
type ShowProgressCallback = (arg0: Promise<unknown>) => unknown
type InitEventTypeReturn = {
	eventType: EventType
	organizer: EncryptedMailAddress | null
	possibleOrganizers: Array<EncryptedMailAddress>
}

/**
 * ViewModel for viewing/editing the event. Takes care of sending out updates.
 */
export class CalendarEventViewModel {
	selectedCalendar: CalendarInfo | null
	startDate!: Date
	endDate!: Date
	// Null start or end time means the user input was invalid
	startTime: Time | null = null
	endTime: Time | null = null
	eventType: EventType = EventType.INVITE
	private _allDay: boolean = false
	get allDay(): boolean {
		return this._allDay
	}

	repeat: RepeatData | null = null
	attendees: ReadonlyArray<Guest> = []
	organizer: EncryptedMailAddress | null
	readonly possibleOrganizers: ReadonlyArray<EncryptedMailAddress>
	location: string = ""
	note: string = ""
	readonly amPmFormat: boolean
	private oldStartTime: Time | null = null
	// We keep alarms read-only so that view can diff just array and not all elements
	alarms: ReadonlyArray<AlarmInfo>
	private readonly existingEvent: CalendarEvent
	private readonly inviteModel: SendMailModel
	private readonly updateModel: SendMailModel
	private readonly cancelModel: SendMailModel
	private readonly responseModel: SendMailModel

	private readonly ownMailAddresses: Array<string>
	private _guestStatuses: ReadonlyMap<string, CalendarAttendeeStatus>
	private set guestStatuses(value: ReadonlyMap<string, CalendarAttendeeStatus>) {
		this._guestStatuses = value
		this.updateAttendees()
	}

	get guestStatuses(): ReadonlyMap<string, CalendarAttendeeStatus> {
		return this._guestStatuses
	}

	/** Our own attendee, it should not be included in any of the sendMailModels. */
	private ownAttendee: EncryptedMailAddress | null = null
	processing: boolean = false
	hasBusinessFeature: boolean = false
	hasPremiumLegacy: boolean = false
	isForceUpdates: boolean = false
	readonly initialized: Promise<CalendarEventViewModel>

	constructor(
		existingEvent: Partial<CalendarEvent>,
		// UserController already keeps track of user updates, it is better to not have our own reference to the user, we might miss
		// important updates like premium upgrade
		private readonly userController: UserController,
		private readonly distributor: CalendarUpdateDistributor,
		private readonly calendarModel: CalendarModel,
		private readonly entityClient: EntityClient,
		mailboxDetail: MailboxDetail,
		mailboxProperties: MailboxProperties,
		sendMailModelFactory: SendMailModelFactory,
		private readonly zone: string,
		private readonly calendars: ReadonlyMap<Id, CalendarInfo>,
		private readonly responseTo: Mail | null,
		resolveRecipientsLazily: boolean,
	) {
		this.existingEvent = createCalendarEvent(existingEvent)
		this.inviteModel = sendMailModelFactory()
		this.updateModel = sendMailModelFactory()
		this.cancelModel = sendMailModelFactory()
		this.responseModel = sendMailModelFactory()

		this.ownMailAddresses = getEnabledMailAddressesWithUser(mailboxDetail, userController.userGroupInfo)
		this.amPmFormat = userController.userSettingsGroupRoot.timeFormat === TimeFormat.TWELVE_HOURS
		this._guestStatuses = this.existingEvent ? this.initGuestStatus(this.existingEvent, resolveRecipientsLazily) : new Map()
		stream.merge([this.inviteModel.onMailChanged, this.updateModel.onMailChanged]).map(() => this.updateAttendees())
		this.updateAttendees()
		const { eventType, organizer, possibleOrganizers } = this.initEventTypeAndOrganizers(this.existingEvent, calendars, mailboxProperties, userController)
		this.organizer = organizer
		this.possibleOrganizers = possibleOrganizers
		this.alarms = []
		this.calendars = calendars
		this.selectedCalendar = this.getAvailableCalendars()[0] ?? null
		this.initialized = Promise.resolve().then(async () => {
			if (existingEvent?.invitedConfidentially) {
				this.setConfidential(existingEvent.invitedConfidentially)
			}

			if (existingEvent._id) {
				await this.applyValuesFromExistingEvent(this.existingEvent, calendars)
			} else {
				const date = getEventStart(this.existingEvent, getTimeZone())
				// We care about passed time here, use it for default time values.
				this.startDate = getStartOfDayWithZone(date, this.zone)
				this.endDate = getStartOfDayWithZone(date, this.zone)
			}

			await this.updateCustomerFeatures()
			return this
		})
	}

	private isNewEvent(): boolean {
		return this.existingEvent._id != null
	}

	// reschedule this event by moving the start and end time by delta milliseconds
	// also moves any exclusions by the same amount
	rescheduleEvent(delta: number) {
		const oldStartDate = new Date(this.startDate)
		const startTime = this.startTime

		if (startTime) {
			oldStartDate.setHours(startTime.hours)
			oldStartDate.setMinutes(startTime.minutes)
		}

		const newStartDate = new Date(oldStartDate.getTime() + delta)

		const oldEndDate = new Date(this.endDate)
		const endTime = this.endTime

		if (endTime) {
			oldEndDate.setHours(endTime.hours)
			oldEndDate.setMinutes(endTime.minutes)
		}
		const newEndDate = new Date(oldEndDate.getTime() + delta)
		this.startDate = getStartOfDayWithZone(newStartDate, this.zone)
		this.endDate = getStartOfDayWithZone(newEndDate, this.zone)
		this.startTime = Time.fromDate(newStartDate)
		this.endTime = Time.fromDate(newEndDate)
	}

	/**
	 * pre-populate the fields of the model from an existing event so it can be edited
	 * @param existingEvent
	 * @param calendars
	 * @private
	 */
	private async applyValuesFromExistingEvent(existingEvent: CalendarEvent, calendars: ReadonlyMap<Id, CalendarInfo>): Promise<void> {
		const calendarForGroup = calendars.get(neverNull(existingEvent._ownerGroup))

		if (calendarForGroup) {
			this.selectedCalendar = calendarForGroup
		}

		this._allDay = isAllDayEvent(existingEvent)
		this.startDate = getStartOfDayWithZone(getEventStart(existingEvent, this.zone), this.zone)

		if (this._allDay) {
			this.endDate = incrementDate(getEventEnd(existingEvent, this.zone), -1)

			// We don't care about passed time here, just use current one as default
		} else {
			const startDate = DateTime.fromJSDate(getEventStart(existingEvent, this.zone), {
				zone: this.zone,
			})
			const endDate = DateTime.fromJSDate(getEventEnd(existingEvent, this.zone), {
				zone: this.zone,
			})
			this.startTime = Time.fromDateTime(startDate)
			this.endTime = Time.fromDateTime(endDate)
			this.endDate = getStartOfDayWithZone(endDate.toJSDate(), this.zone)
		}

		if (existingEvent.repeatRule) {
			const existingRule = existingEvent.repeatRule
			const repeat: RepeatData = {
				frequency: downcast(existingRule.frequency),
				interval: Number(existingRule.interval),
				endType: downcast(existingRule.endType),
				endValue: existingRule.endType === EndType.Count ? Number(existingRule.endValue) : 1,
				excludedDates: existingRule.excludedDates.map(({ date }) => date),
			}

			if (existingRule.endType === EndType.UntilDate) {
				repeat.endValue = getRepeatEndTime(existingRule, this._allDay, this.zone).getTime()
			}

			this.repeat = repeat
		} else {
			this.repeat = null
		}

		this.location = existingEvent.location
		this.note = prepareCalendarDescription(existingEvent.description)
		const alarms = await this.calendarModel.loadAlarms(existingEvent.alarmInfos, this.userController.user)

		for (let alarm of alarms) {
			this.addAlarm(downcast(alarm.alarmInfo.trigger))
		}
	}

	/**
	 * Determines the event type, the organizer of the event and possible organizers in accordance with the capabilities for events (see table).
	 * Note that the only "real" organizer that an event can have is the owner of the calendar.
	 * If events are created by someone we share our personal calendar with, the organizer is overwritten and set to our own primary address.
	 * Possible organizers are all email addresses of the user, allowed to modify the organizer. This is only the owner of the calendar ("real" organizer)
	 * and only if there are no guests.
	 *
	 * Capability for events is fairly complicated:
	 * Note: share "shared" means "not owner of the calendar". Calendar always looks like personal for the owner.
	 *
	 * | Calendar           | is organizer     | can edit details    | can modify own attendance | can modify guests | can modify organizer
	 * |--------------------|------------------|---------------------|---------------------------|-------------------|----------
	 * | Personal (own)     | yes              | yes                 | yes                       | yes               | yes
	 * | Personal  (invite) | no               | yes (local)         | yes                       | no                | no
	 * | Personal  (own)    | no****           | yes                 | yes                       | yes               | yes
	 * | Shared             | yes****          | yes***              | no                        | no*               | no*
	 * | Shared             | no               | no                  | no**                      | no*               | no*
	 *
	 *   * we don't allow inviting guests in other people's calendar because later only organizer can modify event and
	 *   we don't want to prevent calendar owner from editing events in their own calendar.
	 *
	 *   ** this is not "our" copy of the event, from the point of organizer we saw it just accidentally.
	 *   Later we might support proposing ourselves as attendee but currently organizer should be asked to
	 *   send out the event.
	 *
	 *   *** depends on share capability and whether there are attendees.
	 *
	 *   **** The creator of the event. Will be overwritten with owner of the calendar by this function.
	 */
	private initEventTypeAndOrganizers(
		existingEvent: CalendarEvent | null,
		calendars: ReadonlyMap<Id, CalendarInfo>,
		mailboxProperties: MailboxProperties,
		userController: UserController,
	): InitEventTypeReturn {
		const ownDefaultSender = this.ownPossibleOrganizers(mailboxProperties)[0] //this.addressToMailAddress(mailboxProperties, getDefaultSenderFromUser(userController))

		if (!existingEvent) {
			return {
				eventType: EventType.OWN,
				organizer: ownDefaultSender,
				possibleOrganizers: this.ownPossibleOrganizers(mailboxProperties),
			}
		} else {
			// OwnerGroup is not set for events from file
			const calendarInfoForEvent = existingEvent._ownerGroup && calendars.get(existingEvent._ownerGroup)
			const existingOrganizer = existingEvent.organizer

			if (calendarInfoForEvent) {
				if (calendarInfoForEvent.shared) {
					return {
						eventType: hasCapabilityOnGroup(this.userController.user, calendarInfoForEvent.group, ShareCapability.Write)
							? EventType.SHARED_RW
							: EventType.SHARED_RO,
						organizer: existingOrganizer ? copyMailAddress(existingOrganizer) : null,
						possibleOrganizers: existingOrganizer ? [existingOrganizer] : [],
					}
				} else {
					//For an event in a personal calendar there are 3 options (see table)
					//1. We are the organizer of the event (or the event does not have an organizer yet and we become the organizer of the event)
					//2. If we are not the organizer and the event does not have guests, it was created by someone we shared our calendar with (also considered our own event)
					if (!existingOrganizer || this.ownMailAddresses.includes(existingOrganizer.address) || existingEvent.attendees.length === 0) {
						//we want to keep the existing organizer if it is one of our email addresses in all other cases we use our primary address
						const actualOrganizer =
							existingOrganizer && this.ownMailAddresses.includes(existingOrganizer.address) ? existingOrganizer : ownDefaultSender
						return {
							eventType: EventType.OWN,
							organizer: copyMailAddress(actualOrganizer),
							possibleOrganizers: this.hasGuests() ? [actualOrganizer] : this.ownPossibleOrganizers(mailboxProperties),
						}
					}
					//3. the event is an invitation
					else {
						return {
							eventType: EventType.INVITE,
							organizer: existingOrganizer,
							possibleOrganizers: [existingOrganizer],
						}
					}
				}
			} else {
				// We can edit new invites (from files)
				return {
					eventType: EventType.INVITE,
					organizer: existingOrganizer ? copyMailAddress(existingOrganizer) : null,
					possibleOrganizers: existingOrganizer ? [existingOrganizer] : [],
				}
			}
		}
	}

	private initGuestStatus(existingEvent: CalendarEvent, resolveRecipientsLazily: boolean): ReadonlyMap<string, CalendarAttendeeStatus> {
		const newStatuses = new Map()
		existingEvent.attendees
			.filter((attendee) => !hasError(attendee.address))
			.forEach((attendee) => {
				if (findAttendeeInAddresses([attendee], this.ownMailAddresses) != null) {
					this.ownAttendee = copyMailAddress(attendee.address)
				} else {
					this.updateModel.addRecipient(
						RecipientField.BCC,
						{
							name: attendee.address.name,
							address: attendee.address.address,
						},
						resolveRecipientsLazily ? ResolveMode.Lazy : ResolveMode.Eager,
					)
				}

				newStatuses.set(attendee.address.address, getAttendeeStatus(attendee))
			})

		return newStatuses
	}

	async updateCustomerFeatures(): Promise<void> {
		if (this.userController.isInternalUser()) {
			const customer = await this.userController.loadCustomer()
			this.hasBusinessFeature = isCustomizationEnabledForCustomer(customer, FeatureType.BusinessFeatureEnabled)
			this.hasPremiumLegacy = isCustomizationEnabledForCustomer(customer, FeatureType.PremiumLegacy)
		} else {
			this.hasBusinessFeature = false
			this.hasPremiumLegacy = false
		}
	}

	private updateAttendees(): void {
		const makeGuestList = (model: SendMailModel) => {
			return model.bccRecipients().map((recipient) => {
				return {
					address: createEncryptedMailAddress({
						name: recipient.name,
						address: recipient.address,
					}),
					status: this.guestStatuses.get(recipient.address) || CalendarAttendeeStatus.NEEDS_ACTION,
					type: recipient.type,
				}
			})
		}

		const guests = makeGuestList(this.inviteModel).concat(makeGuestList(this.updateModel))

		const ownAttendee = this.ownAttendee

		if (ownAttendee) {
			guests.unshift({
				address: ownAttendee,
				status: this.guestStatuses.get(ownAttendee.address) || CalendarAttendeeStatus.ACCEPTED,
				type: RecipientType.INTERNAL,
			})
		}

		this.attendees = guests
	}

	private ownPossibleOrganizers(mailboxProperties: MailboxProperties): Array<EncryptedMailAddress> {
		return this.ownMailAddresses.map((address) => addressToMailAddress(mailboxProperties, address))
	}

	setStartTime(value: Time | null) {
		this.oldStartTime = this.startTime
		this.startTime = value

		if (this.startDate.getTime() === this.endDate.getTime()) {
			//this.adjustEndTime()
		}

		//this.deleteExcludedDates()
	}

	setEndTime(value: Time | null) {
		this.endTime = value
	}

	setAllDay(newAllDay: boolean): void {
		if (newAllDay === this._allDay) return
		this._allDay = newAllDay
		if (this.repeat == null) return
		if (newAllDay) {
			// we want to keep excluded dates if all we do is switching between all-day and normal event
			this.repeat.excludedDates = this.repeat.excludedDates.map((date) => getAllDayDateUTC(date))
		} else if (this.startTime) {
			const startTime = this.startTime
			this.repeat.excludedDates = this.repeat.excludedDates.map((date) => startTime.toDate(date))
		} else {
			// we have an invalid start time. to save, we need to change it, which means we're going to delete these anyway.
			// no point in keeping wrong data around or having the behaviour depend on the value of the time field
			//this.deleteExcludedDates()
		}
	}

	getGuestPassword(guest: Guest): string {
		return (
			this.inviteModel.getPassword(guest.address.address) ||
			this.updateModel.getPassword(guest.address.address) ||
			this.cancelModel.getPassword(guest.address.address)
		)
	}

	isReadOnlyEvent(): boolean {
		// For the RW calendar we have two similar cases:
		//
		// Case 1:
		// Owner of the calendar created the event and invited some people. We, user with whom calendar was shared as RW, are seeing this event.
		// We cannot modify that event even though we have RW permission because we are the not organizer.
		// If the event is changed, the update must be sent out and we cannot do that because we are not the organizer.
		//
		// Case 2:
		// Owner of the calendar received an invite and saved the event to the calendar. We, user with whom the calendar was shared as RW, are seeing this event.
		// We can (theoretically) modify the event locally because we don't need to send any updates but we cannot change attendance because this would require sending an email.
		// But we don't want to allow editing the event to make it more understandable for everyone.
		//return this.eventType === EventType.SHARED_RO || (this.eventType === EventType.SHARED_RW && this.attendees.length > 0)
		return true
	}

	addAlarm(trigger: AlarmInterval) {
		//const alarm = createCalendarAlarm(generateEventElementId(Date.now()), trigger)
		//this.alarms = this.alarms.concat(alarm)
	}

	changeAlarm(identifier: string, trigger: AlarmInterval | null) {
		const newAlarms = this.alarms.slice()

		for (let i = 0; i < newAlarms.length; i++) {
			if (newAlarms[i].alarmIdentifier === identifier) {
				if (trigger) {
					newAlarms[i].trigger = trigger
				} else {
					newAlarms.splice(i, 1)
				}

				this.alarms = newAlarms
				break
			}
		}
	}

	changeDescription(description: string) {
		this.note = description
	}

	canModifyGuests(): boolean {
		// It is not allowed to modify guests in shared calendar or invite.
		const { selectedCalendar } = this
		return selectedCalendar != null //&& !selectedCalendar.shared && this.eventType !== EventType.INVITE
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

	canModifyOrganizer(): boolean {
		// We can only modify the organizer if it is our own event and there are no guests
		return true //this.eventType === EventType.OWN && !this.hasGuests()
	}

	private hasGuests() {
		return (
			this.existingEvent &&
			this.existingEvent.attendees.length > 0 &&
			!(this.existingEvent.attendees.length === 1 && findAttendeeInAddresses([this.existingEvent.attendees[0]], this.ownMailAddresses) != null)
		)
	}

	canModifyAlarms(): boolean {
		return true //this.eventType === EventType.OWN || this.eventType === EventType.INVITE || this.eventType === EventType.SHARED_RW
	}

	async deleteEvent(): Promise<void> {
		const event = this.existingEvent
		if (event) {
			try {
				// We must always be in attendees so we just check that there's more than one attendee
				if (true) {
					//this.eventType === EventType.OWN && event.attendees.length > 1) {
					await this.sendCancellation(event)
				}
				return this.calendarModel.deleteEvent(event).catch(ofClass(NotFoundError, noOp))
			} catch (e) {
				if (!(e instanceof NotFoundError)) {
					throw e
				}
			}
		}
	}

	/**
	 * calling this adds an exclusion for the event instance contained in this viewmodel to the repeat rule of the event,
	 * which will cause the instance to not be rendered or fire alarms.
	 * Exclusions are the start date/time of the event.
	 *
	 * the list of exclusions is maintained sorted from earliest to latest.
	 */
	async excludeThisOccurrence(): Promise<void> {
		const { existingEvent } = this
		if (existingEvent == null) return
		const { selectedCalendar } = this
		if (!selectedCalendar) return
		// original event -> first occurrence of the series, the one that was created by the user
		// existing event -> the event instance that's displayed in the calendar and was clicked, essentially a copy of original event but with different start time
		const originalEvent = existingEvent.repeatRule ? await this.entityClient.load(CalendarEventTypeRef, existingEvent._id) : existingEvent
		if (!originalEvent || originalEvent.repeatRule == null) return
		const event = clone(originalEvent)
		event.attendees = originalEvent.attendees.map((a) => createCalendarEventAttendee(a))
		const excludedDates = event.repeatRule!.excludedDates
		const timeToInsert = existingEvent.startTime.getTime()
		const insertionIndex = excludedDates.findIndex(({ date }) => date.getTime() >= timeToInsert)
		// as of now, our maximum repeat frequency is 1/day. this means that we could truncate this to the current day (no time)
		// but then we run into problems with time zones, since we'd like to delete the n-th occurrence of an event, but detect
		// if an event is excluded by the start of the utc day it falls on, which may depend on time zone if it's truncated to the local start of day
		// where the exclusion is created.
		const wrapperToInsert = createDateWrapper({ date: existingEvent.startTime })
		if (insertionIndex < 0) {
			excludedDates.push(wrapperToInsert)
		} else {
			excludedDates.splice(insertionIndex, 0, wrapperToInsert)
		}

		const calendarForEvent = this.calendars.get(assertNotNull(existingEvent._ownerGroup, "tried to add exclusion on event without ownerGroup"))
		if (calendarForEvent == null) {
			console.log("why does this event not have a calendar?")
			return
		}
		await this.calendarModel.updateEvent(event, this.alarms.slice(), this.zone, calendarForEvent.groupRoot, existingEvent)
	}

	async waitForResolvedRecipients(): Promise<void> {
		await Promise.all([
			this.inviteModel.waitForResolvedRecipients(),
			this.updateModel.waitForResolvedRecipients(),
			this.cancelModel.waitForResolvedRecipients(),
		])
	}

	isForceUpdateAvailable(): boolean {
		return true //this.eventType === EventType.OWN && !this.shouldShowSendInviteNotAvailable() && this.hasUpdatableAttendees()
	}

	/**
	 * @reject UserError
	 */
	async saveAndSend({
		askForUpdates,
		askInsecurePassword,
		showProgress,
		askEditType,
	}: {
		askForUpdates: () => Promise<"yes" | "no" | "cancel">
		askInsecurePassword: () => Promise<boolean>
		showProgress: ShowProgressCallback
		askEditType: () => Promise<"single" | "all" | "cancel">
	}): Promise<EventCreateResult> {
		await this.initialized

		if (this.processing) {
			return Promise.resolve(false)
		}

		this.processing = true
		return Promise.resolve()
			.then(async () => {
				await this.waitForResolvedRecipients()

				if (this.existingEvent?.repeatRule && this.repeat) {
					const editType = await askEditType()
					if (editType === "single") {
						await this.excludeThisOccurrence()
					} else if (editType === "cancel") {
						return false
					}
				}

				const newEvent = this.initializeNewEvent()

				const newAlarms = this.alarms.slice()

				// We want to avoid asking whether to send out updates in case nothing has changed
				if (this.eventType === EventType.OWN && (this.isForceUpdates || eventHasChanged(newEvent, this.existingEvent))) {
					// It is our own event. We might need to send out invites/cancellations/updates
					return this.sendNotificationAndSave(askInsecurePassword, askForUpdates, showProgress, newEvent, newAlarms)
				} else if (this.eventType === EventType.INVITE) {
					// We have been invited by another person (internal/ unsecure external)
					return this.respondToOrganizerAndSave(
						showProgress,
						assertNotNull(this.existingEvent, "existing event was null in invite"),
						newEvent,
						newAlarms,
					)
				} else {
					// Either this is an event in a shared calendar. We cannot send anything because it's not our event.
					// Or no changes were made that require sending updates and we just save other changes.
					const p = this.saveEvent(newEvent, newAlarms)

					showProgress(p)
					return p.then(() => true)
				}
			})
			.catch(
				ofClass(PayloadTooLargeError, () => {
					throw new UserError("requestTooLarge_msg")
				}),
			)
			.finally(() => {
				this.processing = false
			})
	}

	private async sendCancellation(event: CalendarEvent): Promise<any> {
		const updatedEvent = clone(event)

		// This is guaranteed to be our own event.
		updatedEvent.sequence = incrementSequence(updatedEvent.sequence, true)
		const cancelAddresses = event.attendees.filter((a) => findAttendeeInAddresses([a], this.ownMailAddresses) == null).map((a) => a.address)

		try {
			for (const address of cancelAddresses) {
				this.cancelModel.addRecipient(RecipientField.BCC, {
					name: address.name,
					address: address.address,
					contact: null,
				})

				const recipient = await this.cancelModel.getRecipient(RecipientField.BCC, address.address)!.resolved()

				// We cannot send a notification to external recipients without a password, so we exclude them
				if (this.cancelModel.isConfidential()) {
					if (recipient.type === RecipientType.EXTERNAL && !this.cancelModel.getPassword(recipient.address)) {
						this.cancelModel.removeRecipient(recipient, RecipientField.BCC, false)
					}
				}
			}
			if (this.cancelModel.allRecipients().length) {
				await this.distributor.sendCancellation(updatedEvent, this.cancelModel)
			}
		} catch (e) {
			if (e instanceof TooManyRequestsError) {
				throw new UserError("mailAddressDelay_msg") // This will be caught and open error dialog
			} else {
				throw e
			}
		}
	}

	private saveEvent(newEvent: CalendarEvent, newAlarms: Array<AlarmInfo>): Promise<void> {
		if (this.userController.user.accountType === AccountType.EXTERNAL) {
			return Promise.resolve()
		}

		const groupRoot = assertNotNull(this.selectedCalendar).groupRoot

		if (this.existingEvent == null || this.existingEvent._id == null) {
			return this.calendarModel.createEvent(newEvent, newAlarms, this.zone, groupRoot)
		} else {
			return this.calendarModel.updateEvent(newEvent, newAlarms, this.zone, groupRoot, this.existingEvent).then(noOp)
		}
	}

	private hasUpdatableAttendees(): boolean {
		return this.updateModel.bccRecipients().length > 0
	}

	private sendNotificationAndSave(
		askInsecurePassword: () => Promise<boolean>,
		askForUpdates: () => Promise<"yes" | "no" | "cancel">,
		showProgress: ShowProgressCallback,
		newEvent: CalendarEvent,
		newAlarms: Array<AlarmInfo>,
	): Promise<boolean> {
		// ask for update
		const askForUpdatesAwait = this.hasUpdatableAttendees()
			? this.isForceUpdates
				? Promise.resolve("yes") // we do not ask again because the user has already indicated that they want to send updates
				: askForUpdates()
			: Promise.resolve("no")

		// no updates possible
		const passwordCheck = () => (this.hasInsecurePasswords() && this.containsExternalRecipients() ? askInsecurePassword() : Promise.resolve(true))

		return askForUpdatesAwait.then((updateResponse) => {
			if (updateResponse === "cancel") {
				return false
			} else if (
				this.shouldShowSendInviteNotAvailable() && // we check again to prevent updates after cancelling business or updates for an imported event
				(updateResponse === "yes" || this.inviteModel.bccRecipients().length || this.cancelModel.bccRecipients().length)
			) {
				throw new BusinessFeatureRequiredError("businessFeatureRequiredInvite_msg")
			}

			// Do check passwords if there are new recipients. We already made decision for those who we invited before
			return Promise.resolve(this.inviteModel.bccRecipients().length ? passwordCheck() : true).then((passwordCheckPassed) => {
				if (!passwordCheckPassed) {
					// User said to not send despite insecure password, stop
					return false
				}

				// Invites are cancellations are sent out independent of the updates decision
				const p = this.sendInvite(newEvent)
					.then(() => (this.cancelModel.bccRecipients().length ? this.distributor.sendCancellation(newEvent, this.cancelModel) : Promise.resolve()))
					.then(() => this.saveEvent(newEvent, newAlarms))
					.then(() => (updateResponse === "yes" ? this.distributor.sendUpdate(newEvent, this.updateModel) : Promise.resolve()))
					.then(() => true)

				showProgress(p)
				return p
			})
		})
	}

	private sendInvite(event: CalendarEvent): Promise<void> {
		const newAttendees = event.attendees.filter((a) => a.status === CalendarAttendeeStatus.ADDED)

		if (newAttendees.length > 0) {
			return this.distributor.sendInvite(event, this.inviteModel).then(() => {
				newAttendees.forEach((a) => {
					if (a.status === CalendarAttendeeStatus.ADDED) {
						a.status = CalendarAttendeeStatus.NEEDS_ACTION
					}

					this.guestStatuses = addMapEntry(this.guestStatuses, a.address.address, CalendarAttendeeStatus.NEEDS_ACTION)
				})
			})
		} else {
			return Promise.resolve()
		}
	}

	private respondToOrganizerAndSave(
		showProgress: ShowProgressCallback,
		existingEvent: CalendarEvent,
		newEvent: CalendarEvent,
		newAlarms: Array<AlarmInfo>,
	): Promise<boolean> {
		// We are not using this._findAttendee() because we want to search it on the event, before our modifications
		const ownAttendee = findAttendeeInAddresses(existingEvent.attendees, this.ownMailAddresses)

		const selectedOwnAttendeeStatus = ownAttendee && this.guestStatuses.get(ownAttendee.address.address)

		let sendPromise = Promise.resolve()

		if (ownAttendee && selectedOwnAttendeeStatus !== CalendarAttendeeStatus.NEEDS_ACTION && ownAttendee.status !== selectedOwnAttendeeStatus) {
			ownAttendee.status = assertNotNull(selectedOwnAttendeeStatus)

			const sendResponseModel = this.responseModel

			const organizer = assertNotNull(existingEvent.organizer)
			sendResponseModel.addRecipient(RecipientField.TO, {
				name: organizer.name,
				address: organizer.address,
			})
			sendPromise = this.distributor
				.sendResponse(newEvent, sendResponseModel, ownAttendee.address.address, this.responseTo, assertNotNull(selectedOwnAttendeeStatus))
				.then(() => sendResponseModel.dispose())
		}

		const p = sendPromise.then(() => this.saveEvent(newEvent, newAlarms))
		showProgress(p)
		return p.then(() => true)
	}

	createRepeatRule(newEvent: CalendarEvent, repeat: RepeatData): RepeatRule {
		const interval = repeat.interval || 1
		const repeatRule = createRepeatRuleWithValues(repeat.frequency, interval)
		const stopType = repeat.endType
		repeatRule.endType = stopType
		repeatRule.excludedDates = repeat.excludedDates.map((date) => createDateWrapper({ date }))

		if (stopType === EndType.Count) {
			const count = repeat.endValue

			if (isNaN(count) || Number(count) < 1) {
				repeatRule.endType = EndType.Never
			} else {
				repeatRule.endValue = String(count)
			}
		} else if (stopType === EndType.UntilDate) {
			const repeatEndDate = getStartOfNextDayWithZone(new Date(repeat.endValue), this.zone)

			if (repeatEndDate < getEventStart(newEvent, this.zone)) {
				throw new UserError("startAfterEnd_label")
			} else {
				// We have to save repeatEndDate in the same way we save start/end times because if one is timzone
				// dependent and one is not then we have interesting bugs in edge cases (event created in -11 could
				// end on another date in +12). So for all day events end date is UTC-encoded all day event and for
				// regular events it is just a timestamp.
				repeatRule.endValue = String((this._allDay ? getAllDayDateUTCFromZone(repeatEndDate, this.zone) : repeatEndDate).getTime())
			}
		}

		return repeatRule
	}

	setConfidential(confidential: boolean): void {
		this.inviteModel.setConfidential(confidential)

		this.updateModel.setConfidential(confidential)

		this.cancelModel.setConfidential(confidential)
	}

	isConfidential(): boolean {
		return this.inviteModel.isConfidential() && this.updateModel.isConfidential() && this.cancelModel.isConfidential()
	}

	updatePassword(guest: Guest, password: string) {
		const guestAddress = guest.address.address
		const inInvite = findRecipientWithAddress(this.inviteModel.bccRecipients(), guestAddress)

		if (inInvite) {
			this.inviteModel.setPassword(inInvite.address, password)
		}

		const inUpdate = findRecipientWithAddress(this.updateModel.bccRecipients(), guestAddress)

		if (inUpdate) {
			this.updateModel.setPassword(inUpdate.address, password)
		}

		const inCancel = findRecipientWithAddress(this.cancelModel.bccRecipients(), guestAddress)

		if (inCancel) {
			this.updateModel.setPassword(inCancel.address, password)
		}
	}

	shouldShowPasswordFields(): boolean {
		return this.isConfidential() && this.eventType === EventType.OWN
	}

	getPasswordStrength(guest: Guest): number {
		const address = guest.address.address

		const getStrength = (model: SendMailModel) => {
			const recipient = findRecipientWithAddress(model.allRecipients(), address)
			return recipient ? model.getPasswordStrength(recipient) : null
		}

		const inviteStrength = getStrength(this.inviteModel)
		if (inviteStrength != null) return inviteStrength
		const updateStrength = getStrength(this.updateModel)
		return updateStrength != null ? updateStrength : 0
	}

	hasInsecurePasswords(): boolean {
		if (!this.isConfidential()) {
			return false
		}

		if (this.eventType === EventType.INVITE) {
			// We can't receive invites from secure external users, so we don't have to reply with password
			return false
		} else {
			return this.inviteModel.hasInsecurePasswords() || this.updateModel.hasInsecurePasswords() || this.cancelModel.hasInsecurePasswords()
		}
	}

	containsExternalRecipients(): boolean {
		return this.inviteModel.containsExternalRecipients() || this.updateModel.containsExternalRecipients() || this.cancelModel.containsExternalRecipients()
	}

	getAvailableCalendars(): Array<CalendarInfo> {
		// Prevent moving the calendar to another calendar if you only have read permission or if the event has attendees.
		const calendarArray = Array.from(this.calendars.values())

		if (this.isReadOnlyEvent()) {
			return calendarArray.filter((calendarInfo) => calendarInfo.group._id === assertNotNull(this.existingEvent)._ownerGroup)
		} else if (this.attendees.length || this.eventType === EventType.INVITE) {
			// We don't allow inviting in a shared calendar. If we have attendees, we cannot select a shared calendar
			// We also don't allow accepting invites into shared calendars.
			return calendarArray.filter((calendarInfo) => !calendarInfo.shared)
		} else {
			return calendarArray.filter((calendarInfo) => hasCapabilityOnGroup(this.userController.user, calendarInfo.group, ShareCapability.Write))
		}
	}

	dispose(): void {
		this.inviteModel.dispose()

		this.updateModel.dispose()

		this.cancelModel.dispose()
	}

	isInvite(): boolean {
		return this.eventType === EventType.INVITE
	}

	/**
	 * Keep in sync with eventHasChanged().
	 */
	private initializeNewEvent(): CalendarEvent {
		// We have to use existing instance to get all the final fields correctly
		// Using clone feels hacky but otherwise we need to save all attributes of the existing event somewhere and if dialog is
		// cancelled we also don't want to modify passed event
		const newEvent = this.existingEvent ? clone(this.existingEvent) : createCalendarEvent()
		newEvent.sequence = incrementSequence(newEvent.sequence, this.eventType === EventType.OWN)
		let startDate = new Date(this.startDate)
		let endDate = new Date(this.endDate)

		if (this._allDay) {
			startDate = getAllDayDateUTCFromZone(startDate, this.zone)
			endDate = getAllDayDateUTCFromZone(getStartOfNextDayWithZone(endDate, this.zone), this.zone)
		} else {
			const startTime = this.startTime
			const endTime = this.endTime

			if (!startTime || !endTime) {
				throw new UserError("timeFormatInvalid_msg")
			}

			startDate = DateTime.fromJSDate(startDate, {
				zone: this.zone,
			})
				.set({
					hour: startTime.hours,
					minute: startTime.minutes,
				})
				.toJSDate()
			// End date is never actually included in the event. For the whole day event the next day
			// is the boundary. For the timed one the end time is the boundary.
			endDate = DateTime.fromJSDate(endDate, {
				zone: this.zone,
			})
				.set({
					hour: endTime.hours,
					minute: endTime.minutes,
				})
				.toJSDate()
		}

		newEvent.startTime = startDate
		newEvent.description = this.note
		//newEvent.summary = this.summary
		newEvent.location = this.location
		newEvent.endTime = endDate
		newEvent.invitedConfidentially = this.isConfidential()
		newEvent.uid =
			this.existingEvent && this.existingEvent.uid ? this.existingEvent.uid : generateUid(assertNotNull(this.selectedCalendar).group._id, Date.now())
		const repeat = this.repeat

		if (repeat == null) {
			newEvent.repeatRule = null
		} else {
			newEvent.repeatRule = this.createRepeatRule(newEvent, repeat)
		}

		newEvent.attendees = this.attendees.map((a) =>
			createCalendarEventAttendee({
				address: a.address,
				status: a.status,
			}),
		)
		newEvent.organizer = this.organizer

		switch (checkEventValidity(newEvent)) {
			case CalendarEventValidity.InvalidContainsInvalidDate:
				throw new UserError("invalidDate_msg")
			case CalendarEventValidity.InvalidEndBeforeStart:
				throw new UserError("startAfterEnd_label")
			case CalendarEventValidity.InvalidPre1970:
				// shouldn't happen while the check in setStartDate is still there, resetting the date each time
				throw new UserError("pre1970Start_msg")
			case CalendarEventValidity.Valid:
				return newEvent
		}
	}
}

/**
 * Keep in sync with initializeNewEvent().
 * @param now the new event.
 * @param previous the event as it originally was
 * @returns {boolean} true if changes were made to the event that justify sending updates to attendees.
 */
function eventHasChanged(now: CalendarEvent, previous: CalendarEvent | null): boolean {
	if (!previous) return true
	// we do not check for the sequence number (as it should be changed with every update) or the default instace properties such as _id
	return (
		!previous ||
		now.startTime.getTime() !== previous.startTime.getTime() ||
		now.description !== previous.description ||
		now.summary !== previous.summary ||
		now.location !== previous.location ||
		now.endTime.getTime() !== previous.endTime.getTime() ||
		now.invitedConfidentially !== previous.invitedConfidentially ||
		now.uid !== previous.uid ||
		!areRepeatRulesEqual(now.repeatRule, previous.repeatRule) ||
		!arrayEqualsWithPredicate(
			now.attendees,
			previous.attendees,
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

function areRepeatRulesEqual(r1: CalendarRepeatRule | null, r2: CalendarRepeatRule | null): boolean {
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
 * get a partial calendar event with start time set to the passed value
 * (year, day, hours and minutes. seconds and milliseconds are zeroed.)
 * and an end time 30 minutes later than that.
 * @param startDate the start time to use for the event (defaults to the next full half hour)
 */
export function getEventWithDefaultTimes(startDate: Date = getNextHalfHour()): Pick<CalendarEvent, "startTime" | "endTime"> {
	return {
		startTime: new Date(startDate),
		endTime: new Date(startDate.setMinutes(startDate.getMinutes() + 30)),
	}
}

/**
 * compare two lists of dates that are sorted from earliest to latest. return true if they are equivalent.
 */
export function areExcludedDatesEqual(e1: ReadonlyArray<DateWrapper>, e2: ReadonlyArray<DateWrapper>): boolean {
	if (e1.length !== e2.length) return false
	return e1.every(({ date }, i) => e2[i].date.getTime() === date.getTime())
}
