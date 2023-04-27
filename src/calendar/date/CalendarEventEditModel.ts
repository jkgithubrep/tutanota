import {
	CalendarEvent,
	CalendarEventAttendee,
	createCalendarEvent,
	createCalendarEventAttendee,
	createEncryptedMailAddress,
	EncryptedMailAddress,
} from "../../api/entities/tutanota/TypeRefs.js"
import m from "mithril"
import { clone, findAllAndRemove, findAndRemove, incrementDate } from "@tutao/tutanota-utils"
import {
	cleanMailAddress,
	findAttendeeInAddresses,
	findRecipientWithAddress,
	generateEventElementId,
	isAllDayEvent,
} from "../../api/common/utils/CommonCalendarUtils.js"
import { AlarmInterval, CalendarAttendeeStatus, EndType, RepeatPeriod } from "../../api/common/TutanotaConstants.js"
import { ContactNames, getContactDisplayName } from "../../contacts/model/ContactUtils.js"

import { getEventWithDefaultTimes } from "./CalendarEventViewModel.js"
import { Time } from "../../api/common/utils/Time.js"
import { DateTime } from "luxon"
import {
	getDiffInDays,
	getEventEnd,
	getEventStart,
	getStartOfDayWithZone,
	getTimeZone,
	incrementByRepeatPeriod,
	prepareCalendarDescription,
} from "./CalendarUtils.js"
import { TIMESTAMP_ZERO_YEAR } from "@tutao/tutanota-utils/dist/DateUtils.js"
import { AlarmInfo, createAlarmInfo, createRepeatRule } from "../../api/entities/sys/TypeRefs.js"
import { ProgrammingError } from "../../api/common/error/ProgrammingError.js"
import { htmlSanitizer } from "../../misc/HtmlSanitizer.js"

export const enum EventType {
	OWN = "own",
	// event in our own calendar and we are organizer
	SHARED_RO = "shared_ro",
	// event in shared calendar with read permission
	SHARED_RW = "shared_rw",
	// event in shared calendar with write permission
	INVITE = "invite", // invite from calendar invitation which is not stored in calendar yet, or event stored and we are not organizer
}

export class CalendarEventEditModel {
	private readonly _result: CalendarEvent
	private _isAllDay: boolean

	/**
	 * keeps track of all changes to a calendar events fields. Meant to maintain the invariants through multiple edit operations and to
	 * provide getters that can be used to display the current state.
	 *
	 * the passed initialization event will be cloned and sanitized on construction.
	 *
	 * get CalendarEventEditDialogViewModel.result for a finished event with the selected properties that can be updated/created on the server,
	 * do not use the getters on individual fields for modifying something else.
	 *
	 * @param initialValues partial calendar event to prepopulate the editor / use as a starting point
	 * @param calendars only the calendars the current user is allowed to write to, no others. MUST contain at least one item.
	 * @param selectedCalendar the Id of the pre-selected calendar, since this is not explicitly tracked on the event
	 * @param ownMailAddresses list of all mail addresses for this user. MUST contain at least one item.
	 * @param eventType how did this event end up in our calendar? do not set this to "shared_ro" because
	 * that's not editable. influences what parts can be changed and how.
	 * @param _alarms the list of alarms associated with the event (already resolved)
	 * @param uiUpdateCallback callback for redrawing the display if necessary
	 * @param timeZone the time zone to consider local for updating the times.
	 */
	constructor(
		initialValues: Partial<CalendarEvent>,
		private readonly calendars: ReadonlyArray<Id>,
		private selectedCalendar: Id,
		private readonly ownMailAddresses: ReadonlyArray<EncryptedMailAddress>,
		private readonly eventType: EventType = EventType.OWN,
		private _alarms: Array<AlarmInfo> = [],
		private readonly uiUpdateCallback: () => void = m.redraw,
		private readonly timeZone: string = getTimeZone(),
	) {
		this._result = createCalendarEvent(clone(initialValues))
		this.cleanupTimes()
		// the description might be from an invite we never saw before
		// FIXME: when are summary and other strings sanitized?
		// FIXME: how to decide which content to block? existing event / invite
		const initialDescription = prepareCalendarDescription(this._result.description)
		this._result.description = htmlSanitizer.sanitizeHTML(initialDescription, { blockExternalContent: false }).html
		this._isAllDay = isAllDayEvent(this._result)
	}

	private cleanupTimes() {
		// zero out the second and millisecond part of start/end time. can't use the getters for startTime and endTime
		// because they depend on all-day status.
		const startTime = DateTime.fromJSDate(this._result.startTime, { zone: this.timeZone }).set({ second: 0, millisecond: 0 })
		this._result.startTime = startTime.toJSDate()
		const endTime = DateTime.fromJSDate(this._result.endTime, { zone: this.timeZone }).set({ second: 0, millisecond: 0 })
		this._result.endTime = endTime.toJSDate()
	}

	set isAllDay(value: boolean) {
		if (this._isAllDay === value) return

		// if we got an all-day event and uncheck for the first time, we need to set default times on the result.
		// they will be zeroed out on the result if the checkbox is set again before finishing.
		if (isAllDayEvent(this._result)) {
			const { startTime, endTime } = getEventWithDefaultTimes()
			this._result.endTime = endTime!
			this._result.startTime = startTime!
		}
		this._isAllDay = value
	}

	get isAllDay() {
		return this._isAllDay
	}

	/**
	 * the current start time (hour:minutes) of the event in the local time zone.
	 * will return 00:00 for all-day events.
	 */
	get startTime(): Time {
		if (this._isAllDay) {
			return new Time(0, 0)
		}
		const startDate = DateTime.fromJSDate(getEventStart(this._result, this.timeZone), {
			zone: this.timeZone,
		})
		return Time.fromDateTime(startDate)
	}

	/**
	 * set the time portion of the events start time. the date portion will not be modified.
	 * will also adjust the end time accordingly to keep the event length the same.
	 *  */
	set startTime(v: Time | null) {
		if (v == null) return

		const oldStart = DateTime.fromJSDate(getEventStart(this._result, this.timeZone), {
			zone: this.timeZone,
		})

		this._result.startTime = oldStart
			.set({
				hour: v.hours,
				minute: v.minutes,
				second: 0,
				millisecond: 0,
			})
			.toJSDate()

		this.adjustEndTime(Time.fromDateTime(oldStart))
	}

	/**
	 * the current end time (hour:minutes) of the event in the local time zone.
	 * will return 00:00 for all-day events independently from the time zone.
	 */
	get endTime(): Time {
		if (this._isAllDay) {
			return new Time(0, 0)
		}
		const endDate = DateTime.fromJSDate(getEventEnd(this._result, this.timeZone), {
			zone: this.timeZone,
		})
		return Time.fromDateTime(endDate)
	}

	/**
	 * set the time portion of the events end time. the date portion will not be modified.
	 *
	 */
	set endTime(v: Time | null) {
		if (v == null) return

		this._result.endTime = DateTime.fromJSDate(getEventEnd(this._result, this.timeZone), {
			zone: this.timeZone,
		})
			.set({
				hour: v.hours,
				minute: v.minutes,
				second: 0,
				millisecond: 0,
			})
			.toJSDate()
	}

	/**
	 * get the start time of the day this event currently starts in UTC, in local time.
	 */
	get startDate(): Date {
		const eventStart = getEventStart(this._result, this.timeZone)
		const startDate = DateTime.fromJSDate(eventStart, { zone: this.timeZone })
		return getStartOfDayWithZone(startDate.toJSDate(), this.timeZone)
	}

	/**
	 * set the date portion of the events start time (value's time component is ignored)
	 * will also update the end date and move it the same amount of days as the start date was moved.
	 *
	 * setting a date before 1970 will result in the date being set to CURRENT_YEAR
	 * */
	set startDate(value: Date) {
		if (value.getTime() === this.startDate.getTime()) {
			return
		}

		// The custom ID for events is derived from the unix timestamp, and sorting
		// the negative ids is a challenge we decided not to
		// tackle because it is a rare case.
		if (value.getFullYear() < TIMESTAMP_ZERO_YEAR) {
			const thisYear = new Date().getFullYear()
			value.setFullYear(thisYear)
		}

		const oldStartDate = getEventStart(this._result, this.timeZone)
		const { hour, minute } = DateTime.fromJSDate(oldStartDate, { zone: this.timeZone })
		const newStartDate = DateTime.fromJSDate(value, { zone: this.timeZone }).set({ hour, minute })
		this._result.startTime = newStartDate.toJSDate()
		this.adjustEndDate(oldStartDate)
	}

	/**
	 * get the current end date without a time component (midnight UTC)
	 */
	get endDate(): Date {
		const endDate = DateTime.fromJSDate(getEventEnd(this._result, this.timeZone), {
			zone: this.timeZone,
		})
		return getStartOfDayWithZone(endDate.toJSDate(), this.timeZone)
	}

	/**
	 * set the date portion of the events end time (value's time component is ignored)
	 *
	 * */
	set endDate(value: Date) {
		const { hour, minute } = DateTime.fromJSDate(getEventEnd(this._result, this.timeZone), { zone: this.timeZone })

		const newEndDate = DateTime.fromJSDate(value, {
			zone: this.timeZone,
		}).set({
			hour,
			minute,
		})
		this._result.endTime = newEndDate.toJSDate()
	}

	get repeatPeriod(): RepeatPeriod | null {
		return this._result.repeatRule ? (this._result.repeatRule.frequency as RepeatPeriod) : null
	}

	set repeatPeriod(repeatPeriod: RepeatPeriod | null) {
		if (this._result.repeatRule?.frequency === repeatPeriod) {
			// repeat null => we will return if repeatPeriod is null
			// repeat not null => we return if the repeat period is null or it did not change.
			return
		} else if (repeatPeriod == null) {
			this._result.repeatRule = null
		} else if (this._result.repeatRule != null) {
			this._result.repeatRule.frequency = repeatPeriod
		} else {
			// new repeat rule, populate with default values.
			this._result.repeatRule = createRepeatRule({
				interval: "1",
				endType: EndType.Never,
				endValue: "1",
				frequency: repeatPeriod,
				excludedDates: [],
			})
		}
	}

	get repeatInterval(): number {
		return Number(this._result.repeatRule?.interval ?? "1")
	}

	set repeatInterval(interval: number) {
		const stringInterval = String(interval)
		if (this._result.repeatRule && this._result.repeatRule?.interval !== stringInterval) {
			this._result.repeatRule.interval = stringInterval
		}
	}

	get repeatEndType(): EndType {
		return (this._result.repeatRule?.endType ?? EndType.Never) as EndType
	}

	set repeatEndType(endType: EndType) {
		if (this._result.repeatRule && this._result.repeatRule.endType !== endType) {
			this._result.repeatRule.endType = endType

			if (endType === EndType.UntilDate) {
				this._result.repeatRule.endValue = String(incrementByRepeatPeriod(new Date(), RepeatPeriod.MONTHLY, 1, this.timeZone).getTime())
			} else {
				this._result.repeatRule.endValue = "1"
			}
		}
	}

	get repeatEndOccurrences(): number {
		return Number(this._result.repeatRule?.endValue ?? "1")
	}

	set repeatEndOccurrences(endValue: number) {
		const stringEndValue = String(endValue)
		if (this._result.repeatRule && this._result.repeatRule.endType === EndType.Count && this._result.repeatRule.endValue !== stringEndValue) {
			this._result.repeatRule.endValue = stringEndValue
		}
	}

	get repeatEndDate(): Date {
		return this._result.repeatRule ? new Date(Number(this._result.repeatRule.endValue)) : new Date()
	}

	set repeatEndDate(endDate: Date) {
		const stringEndDate = String(endDate)
		if (this._result.repeatRule && this._result.repeatRule.endType === EndType.UntilDate && this._result.repeatRule.endValue !== stringEndDate) {
			this._result.repeatRule.endValue = stringEndDate
		}
	}

	set calendar(newCalendarId: Id) {
		if (!this.calendars.find((id) => newCalendarId)) {
			throw new ProgrammingError("Trying to set event to calendar that is not in the list of allowed calendars")
		}

		this.selectedCalendar = newCalendarId
	}

	get calendar(): Id {
		return this.selectedCalendar
	}

	addAlarm(trigger: AlarmInterval) {
		if (this._alarms.some((a) => a.trigger === trigger)) return
		const alarm = createAlarmInfo({
			alarmIdentifier: generateEventElementId(Date.now()),
			trigger,
		})
		this._alarms.push(alarm)
	}

	removeAlarm(trigger: AlarmInterval) {
		// FIXME: may need to delete from server at some point if it already exists?
		findAllAndRemove(this._alarms, (a) => a.trigger === trigger)
	}

	get alarms() {
		return this._alarms
	}

	get result(): Readonly<CalendarEvent> {
		// FIXME: we still need to adjust start/end depending on the all-day selection before returning this
		// FIXME: also this.deleteExcludedDates() when actually saving if start time changed or repeat rule was changed
		// FIXME: apply the correct list ID from the selected calendarInfo
		// what's with already existing alarm infos? currently they seem to be recreated every time the event is changed, new IDs and everything
		const returnedResult = clone(this._result)
		if (this._isAllDay) {
			returnedResult.startTime = getStartOfDayWithZone(returnedResult.startTime, "utc")
			returnedResult.endTime = incrementDate(getStartOfDayWithZone(returnedResult.endTime, "utc"), 1)
		}
		return returnedResult
	}

	get description(): string {
		return this._result.description
	}

	set description(v: string) {
		// sanitization?
		this._result.description = v
	}

	get location(): string {
		return this._result.location
	}

	set location(v: string) {
		this._result.location = v
	}

	set summary(v: string) {
		// sanitization?
		this._result.summary = v
		this.uiUpdateCallback()
	}

	/**
	 * figure out if there are other people that might need to be notified if this event is modified
	 * @private
	 */
	private hasOtherAttendees() {
		return (
			// if the result has no id, it's new and we can do what we want (no attendee was notified yet)
			this._result._id != null &&
			// if the attendee list is empty, there are no attendees at all
			this._result.attendees.length > 0 &&
			// if the only attendee has one of our mail addresses, there is no one else we have to worry about
			!(this._result.attendees.length === 1 && findRecipientWithAddress(this.ownMailAddresses, this._result.attendees[0].address.address) != null)
		)
	}

	/**
	 * add a mail address to the list of invitees.
	 * the organizer will always be set to the last of the current user's mail addresses that has been added.
	 *
	 * @param address the mail address to send the invite to
	 * @param contact a contact for a display name.
	 */
	addAttendee(address: string, contact: ContactNames | null = null): void {
		// 1: if the attendee already exists, do nothing
		// 3: if the attendee is yourself and you already exist as an attendee, remove yourself
		// 4: add the attendee
		// 5: add organizer if you are not already in the list
		// We don't add an attendee if they are already an attendee
		// even though the SendMailModel handles deduplication, we need to check here because recipients shouldn't be duplicated across the 3 models either
		if (findAttendeeInAddresses(this._result.attendees, [address]) != null) {
			return
		}

		const ownAttendee = findRecipientWithAddress(this.ownMailAddresses, address)
		if (ownAttendee != null) {
			this.addOwnAttendee(ownAttendee)
		} else {
			const name = contact != null ? getContactDisplayName(contact) : ""
			this.addOtherAttendee(createEncryptedMailAddress({ address, name }))
		}
	}

	/**
	 *
	 * @param address MUST be one of ours.
	 * @private
	 */
	private addOwnAttendee(address: EncryptedMailAddress): void {
		const existingOwnAttendee = this.findOwnAttendee()
		// If we existed as an attendee then remove the existing ownAttendee
		// and the new one will be added in the next step
		if (existingOwnAttendee != null) {
			const cleanOwnAttendeeAdress = cleanMailAddress(existingOwnAttendee.address.address)
			findAndRemove(this._result.attendees, (a) => cleanOwnAttendeeAdress === cleanMailAddress(a.address.address))
		}
		this._result.attendees.push(createCalendarEventAttendee({ address, status: CalendarAttendeeStatus.ACCEPTED }))

		// make sure that the organizer on the event is the same address as we added as an own attendee.
		this.organizer = address
	}

	/**
	 *
	 * @param address must NOT be one of ours.
	 * @private
	 */
	private addOtherAttendee(address: EncryptedMailAddress) {
		if (!this.findOwnAttendee()) {
			// we're adding someone that's not us while we're not an attendee, so we add ourselves as an attendee and as organizer.
			this.addOwnAttendee(this.ownMailAddresses[0])
		}

		//  we now know that this address is not in the list and it's also not us under another address that's already added, so we can just add it.
		this._result.attendees.push(createCalendarEventAttendee({ address, status: CalendarAttendeeStatus.ADDED }))
	}

	/**
	 * remove a single attendee from the list.
	 * * if it's the organizer AND there are other attendees, this is a no-op
	 * * if it's the organizer AND there are no other attendees, this empties the attendee list and sets the organizer to null
	 * * if it's not the organizer, but the last non-organizer attendee, also removes the organizer from the attendee list and sets the organizer to null.
	 * * if it's not the organizer but not the last non-organizer attendee, just removes that attendee from the list.
	 * @param address the attendee to remove.
	 */
	removeAttendee(address: string) {
		if (this._result.attendees.length === 0) return
		const cleanGuestAddress = cleanMailAddress(address)
		if (this._result.organizer?.address === address) {
			if (this._result.attendees.length > 1) {
				console.log("tried to remove organizer while there are other attendees")
				return
			} else {
				this._result.attendees.length = 0
			}
		} else {
			findAndRemove(this._result.attendees, (a) => cleanMailAddress(a.address.address) === cleanGuestAddress)
		}

		if (this._result.attendees.length < 2) {
			this.organizer = null
			this._result.attendees.length = 0
		}
	}

	/**
	 * modify your own attendance to the selected value
	 * @param status
	 */
	setOwnAttendance(status: CalendarAttendeeStatus) {
		if (!this.canModifyOwnAttendance()) return
		const ownAttendee = this.findOwnAttendee()
		if (!ownAttendee) {
			console.log("tried to modify own attendance while not being an attendee")
			return
		}

		ownAttendee.status = status
	}

	findOwnAttendee(): CalendarEventAttendee | null {
		return findAttendeeInAddresses(
			this._result.attendees,
			this.ownMailAddresses.map((a) => a.address),
		)
	}

	private canModifyOwnAttendance(): boolean {
		// We can always modify own attendance in own event. Also can modify if it's invite in our calendar and we are invited.
		return this.eventType === EventType.OWN || (this.eventType === EventType.INVITE && !!this.findOwnAttendee())
	}

	private canModifyOrganizer(): boolean {
		// We can only modify the organizer if it is our own event and there are no guests besides us
		return this.eventType === EventType.OWN && !this.hasOtherAttendees()
	}

	private set organizer(newOrganizer: EncryptedMailAddress | null) {
		if (!this.canModifyOrganizer()) return
		this._result.organizer = newOrganizer
	}

	/**
	 * when moving the start date, we also want to move the end
	 * date by the same amount of days to keep the event length the same
	 * @private
	 */
	private adjustEndDate(oldStartDate: Date) {
		this._result.endTime = DateTime.fromJSDate(this._result.endTime, { zone: this.timeZone })
			.plus({
				days: getDiffInDays(oldStartDate, this._result.startTime),
			})
			.toJSDate()
	}

	/**
	 * when moving the start time, we also want to move the end
	 * time by the same amount to keep the event length the same
	 * @private
	 */
	private adjustEndTime(oldStartTime: Time) {
		const endTotalMinutes = this.endTime.hours * 60 + this.endTime.minutes
		const startTotalMinutes = this.startTime.hours * 60 + this.startTime.minutes
		const diff = Math.abs(endTotalMinutes - oldStartTime.hours * 60 - oldStartTime.minutes)
		const newEndTotalMinutes = startTotalMinutes + diff
		let newEndHours = Math.floor(newEndTotalMinutes / 60)

		if (newEndHours > 23) {
			newEndHours = 23
		}

		const newEndMinutes = newEndTotalMinutes % 60
		this.endTime = new Time(newEndHours, newEndMinutes)
	}

	/**
	 * completely delete all exclusions. will cause the event to be rendered and fire alarms on all
	 * occurrences as dictated by its repeat rule.
	 */
	deleteExcludedDates(): void {
		if (!this._result.repeatRule) return
		this._result.repeatRule.excludedDates.length = 0
	}
}
