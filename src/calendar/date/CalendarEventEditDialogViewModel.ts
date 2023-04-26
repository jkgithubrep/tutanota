import {
	CalendarEvent,
	CalendarEventAttendee,
	Contact,
	createCalendarEvent,
	createCalendarEventAttendee,
	createEncryptedMailAddress,
	EncryptedMailAddress,
} from "../../api/entities/tutanota/TypeRefs.js"
import m from "mithril"
import { clone, findAllAndRemove, findAndRemove, incrementDate } from "@tutao/tutanota-utils"
import { cleanMailAddress, findAttendeeInAddresses, generateEventElementId, isAllDayEvent } from "../../api/common/utils/CommonCalendarUtils.js"
import { AlarmInterval, CalendarAttendeeStatus, EndType, RepeatPeriod } from "../../api/common/TutanotaConstants.js"
import { getContactDisplayName } from "../../contacts/model/ContactUtils.js"

import { getEventWithDefaultTimes, Guest } from "./CalendarEventViewModel.js"
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

/**
 * keeps track of all changes to a calendar events fields. Meant to maintain the invariants through multiple edit operations.
 * get CalendarEventEditDialogViewModel.result for an event with the selected properties that can be updated/created on the server.
 */
export class CalendarEventEditDialogViewModel {
	private readonly _result: CalendarEvent
	private _isAllDay: boolean

	/**
	 *
	 * @param initialValues partial calendar event to prepopulate the editor / use as a starting point
	 * @param calendars only the calendars the current user is allowed to write to
	 * @param selectedCalendar the Id of the selected calendar, since this is not explicitly tracked on the event
	 * @param ownMailAddresses list of all mail addresses for this user
	 * @param eventType how did this event end up in our calendar? do not set this to "shared_ro" because
	 * that's not editable. influences what parts can be changed and how.
	 * @param uiUpdateCallback callback for redrawing the display if necessary
	 */
	constructor(
		initialValues: Partial<CalendarEvent>,
		private readonly calendars: ReadonlyArray<Id>,
		private selectedCalendar: Id,
		private readonly ownMailAddresses: ReadonlyArray<EncryptedMailAddress>,
		private readonly eventType: EventType,
		private _alarms: Array<AlarmInfo>,
		private readonly timeZone: string = getTimeZone(),
		private readonly uiUpdateCallback: () => void = m.redraw,
	) {
		this._result = createCalendarEvent(initialValues)
		// the description might be from an invite we never saw before
		// FIXME: when are summary and other strings sanitized?
		// FIXME: how to decide which content to block? existing event / invite
		const initialDescription = prepareCalendarDescription(this._result.description)
		this._result.description = htmlSanitizer.sanitizeHTML(initialDescription, { blockExternalContent: false }).html
		this._isAllDay = isAllDayEvent(this._result)
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

	get startTime(): Time {
		const startDate = DateTime.fromJSDate(getEventStart(this._result, this.timeZone), {
			zone: this.timeZone,
		})
		return Time.fromDateTime(startDate)
	}

	/**
	 * set the time portion of the events start time. the date portion will not be modified.
	 * will also adjust the end time accordingly to keep the event length the same.
	 * while the event is allDay, this is a noOp.
	 *  */
	set startTime(v: Time | null) {
		if (v == null || this._isAllDay) return

		const oldStart = DateTime.fromJSDate(getEventStart(this._result, this.timeZone), {
			zone: this.timeZone,
		})

		this._result.startTime = oldStart
			.set({
				hour: v.hours,
				minute: v.minutes,
			})
			.toJSDate()

		this.adjustEndTime(Time.fromDateTime(oldStart))
	}

	get endTime(): Time {
		const endDate = DateTime.fromJSDate(getEventEnd(this._result, this.timeZone), {
			zone: this.timeZone,
		})
		return Time.fromDateTime(endDate)
	}

	/**
	 * set the time portion of the events end time. the date portion will not be modified.
	 * while the event is allDay, this is a noOp.
	 *  */
	set endTime(v: Time | null) {
		if (v == null || this._isAllDay) return

		this._result.endTime = DateTime.fromJSDate(getEventEnd(this._result, this.timeZone), {
			zone: this.timeZone,
		})
			.set({
				hour: v.hours,
				minute: v.minutes,
			})
			.toJSDate()
	}

	get startDate(): Date {
		const startDate = DateTime.fromJSDate(getEventStart(this._result, this.timeZone), {
			zone: this.timeZone,
		})
		return getStartOfDayWithZone(startDate.toJSDate(), this.timeZone)
	}

	/** set the date portion of the events start time (v's time component is ignored) */
	set startDate(v: Date) {
		if (v.getTime() === this.startDate.getTime()) {
			return
		}

		// The custom ID for events is derived from the unix timestamp, and sorting
		// the negative ids is a challenge we decided not to
		// tackle because it is a rare case.
		if (v.getFullYear() < TIMESTAMP_ZERO_YEAR) {
			const thisYear = new Date().getFullYear()
			v.setFullYear(thisYear)
		}

		const oldStartDate = getEventStart(this._result, this.timeZone)
		const { hour, minute } = DateTime.fromJSDate(oldStartDate, {
			zone: this.timeZone,
		})

		const newStartDate = DateTime.fromJSDate(v, {
			zone: this.timeZone,
		}).set({
			hour,
			minute,
		})

		this._result.startTime = newStartDate.toJSDate()
		this.adjustEndDate(oldStartDate)
	}

	get endDate(): Date {
		const endDate = DateTime.fromJSDate(getEventEnd(this._result, this.timeZone), {
			zone: this.timeZone,
		})
		return getStartOfDayWithZone(endDate.toJSDate(), this.timeZone)
	}

	/** set the date portion of the events end time (v's time component is ignored) */
	set endDate(v: Date) {
		const { hour, minute } = DateTime.fromJSDate(getEventEnd(this._result, this.timeZone), {
			zone: this.timeZone,
		})

		const newEndDate = DateTime.fromJSDate(v, {
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

	canModifyOrganizer(): boolean {
		// We can only modify the organizer if it is our own event and there are no guests besides us
		return this.eventType === EventType.OWN && !this.hasOtherAttendees()
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
			!(
				this._result.attendees.length === 1 &&
				findAttendeeInAddresses(
					[this._result.attendees[0]],
					this.ownMailAddresses.map((a) => a.address),
				) != null
			)
		)
	}

	addAttendee(address: string, contact: Contact | null): void {
		// 1: if the attendee already exists, do nothing
		// 3: if the attendee is yourself and you already exist as an attendee, remove yourself
		// 4: add the attendee
		// 5: add organizer if you are not already in the list
		// We don't add a guest if they are already an attendee
		// even though the SendMailModel handles deduplication, we need to check here because recipients shouldn't be duplicated across the 3 models either
		if (findAttendeeInAddresses(this._result.attendees, [address]) != null) {
			return
		}

		const existingOwnAttendee = this.findOwnAttendee()

		const status = existingOwnAttendee == null ? CalendarAttendeeStatus.ADDED : CalendarAttendeeStatus.ACCEPTED

		// If we exist as an attendee and the added guest is also an attendee, then remove the existing ownAttendee
		// and the new one will be added in the next step
		if (existingOwnAttendee != null) {
			const cleanOwnAttendeeAdress = cleanMailAddress(existingOwnAttendee.address.address)
			findAndRemove(this._result.attendees, (a) => cleanOwnAttendeeAdress === cleanMailAddress(a.address.address))

			// make sure that the organizer on the event is the same address as we added as an own attendee
			const newOrganizer = this.ownMailAddresses.find((a) => a.address === address)
			if (newOrganizer) this.setOrganizer(newOrganizer)
		}

		//  we now know that this address is not in the list and it's also not us under another address that's already added, so we can just add it.
		const name = contact != null ? getContactDisplayName(contact) : ""
		this._result.attendees.push(createCalendarEventAttendee({ address: createEncryptedMailAddress({ address, name }), status }))

		if (this._result.attendees.length === 1) {
			this.setOwnAttendance(CalendarAttendeeStatus.ACCEPTED)
		}
	}

	removeAttendee(guest: Guest) {
		const cleanGuestAddress = cleanMailAddress(guest.address.address)
		findAndRemove(this._result.attendees, (a) => cleanMailAddress(a.address.address) === cleanGuestAddress)
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

	canModifyOwnAttendance(): boolean {
		// We can always modify own attendance in own event. Also can modify if it's invite in our calendar and we are invited.
		return this.eventType === EventType.OWN || (this.eventType === EventType.INVITE && !!this.findOwnAttendee())
	}

	private setOrganizer(newOrganizer: EncryptedMailAddress): void {
		if (this.canModifyOrganizer()) {
			this._result.organizer = newOrganizer

			// we always add the organizer to the attendee list
			// this.ownAttendee = newOrganizer
		}
	}

	/**
	 * when moving the start date, we also want to move the end
	 * date by the same amount of days to keep the event length the same
	 * @private
	 */
	private adjustEndDate(oldStartDate: Date) {
		const diff = getDiffInDays(oldStartDate, this._result.startTime)

		this.endDate = DateTime.fromJSDate(this.endDate, {
			zone: this.timeZone,
		})
			.plus({
				days: diff,
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
