import { CalendarEventTimes, getEventWithDefaultTimes, isAllDayEventByTimes } from "../../../api/common/utils/CommonCalendarUtils.js"
import { Time } from "../../../api/common/utils/Time.js"
import { DateTime } from "luxon"
import {
	getAllDayDateUTCFromZone,
	getDiffInDays,
	getEventEnd,
	getEventStart,
	getRepeatEndTime,
	getStartOfDayWithZone,
	getStartOfNextDayWithZone,
	incrementByRepeatPeriod,
} from "../../date/CalendarUtils.js"
import { TIMESTAMP_ZERO_YEAR } from "@tutao/tutanota-utils/dist/DateUtils.js"
import { CalendarEvent, CalendarRepeatRule } from "../../../api/entities/tutanota/TypeRefs.js"
import { Stripped } from "../../../api/common/utils/EntityUtils.js"
import { EndType, RepeatPeriod } from "../../../api/common/TutanotaConstants.js"
import { createDateWrapper, createRepeatRule } from "../../../api/entities/sys/TypeRefs.js"
import { UserError } from "../../../api/main/UserError.js"
import { noOp } from "@tutao/tutanota-utils"

export type CalendarEventWhenModelResult = CalendarEventTimes & {
	repeatRule: CalendarRepeatRule | null
}

/*
 * start, end, repeat, exclusions, reschedulings
 */
export class CalendarEventWhenModel {
	private repeatRule: CalendarRepeatRule | null = null
	private _isAllDay: boolean
	private _startTime: Date
	private _endTime: Date

	constructor(initialValues: Partial<Stripped<CalendarEvent>>, private readonly zone: string, private readonly uiUpdateCallback: () => void = noOp) {
		let initialTimes: CalendarEventTimes
		if (initialValues.startTime == null || initialValues.endTime == null) {
			const defaultTimes = getEventWithDefaultTimes(initialValues.startTime)
			initialTimes = {
				startTime: initialValues.startTime ?? defaultTimes.startTime,
				endTime: initialValues.endTime ?? defaultTimes.endTime,
			}
		} else {
			initialTimes = {
				startTime: initialValues.startTime,
				endTime: initialValues.endTime,
			}
		}

		// zero out the second and millisecond part of start/end time. can't use the getters for startTime and endTime
		// because they depend on all-day status.
		const startTime = DateTime.fromJSDate(initialTimes.startTime, { zone }).set({ second: 0, millisecond: 0 }).toJSDate()
		const endTime = DateTime.fromJSDate(initialTimes.endTime, { zone }).set({ second: 0, millisecond: 0 }).toJSDate()

		this._isAllDay = isAllDayEventByTimes(startTime, endTime)
		this._startTime = startTime
		this._endTime = endTime
		this.repeatRule = initialValues.repeatRule ?? null
	}

	set isAllDay(value: boolean) {
		if (this._isAllDay === value) return

		// if we got an all-day event and uncheck for the first time, we need to set default times on the result.
		// they will be zeroed out on the result if the checkbox is set again before finishing.
		if (isAllDayEventByTimes(this._startTime, this._endTime)) {
			const { startTime, endTime } = getEventWithDefaultTimes()
			this._endTime = endTime!
			this._startTime = startTime!
		}

		const previousEndDate = this.repeatEndDate
		this._isAllDay = value
		this.repeatEndDate = previousEndDate
		this.uiUpdateCallback()
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
		const { zone, _endTime: endTime, _startTime: startTime } = this
		const startDate = DateTime.fromJSDate(getEventStart({ startTime, endTime }, zone), { zone })
		return Time.fromDateTime(startDate)
	}

	/**
	 * set the time portion of the events start time. the date portion will not be modified.
	 * will also adjust the end time accordingly to keep the event length the same.
	 *  */
	set startTime(v: Time | null) {
		if (v == null) return

		const { zone, _endTime: endTime, _startTime: startTime } = this
		const oldStart = DateTime.fromJSDate(getEventStart({ startTime, endTime }, zone), { zone })

		this._startTime = oldStart
			.set({
				hour: v.hours,
				minute: v.minutes,
				second: 0,
				millisecond: 0,
			})
			.toJSDate()

		this.adjustEndTime(Time.fromDateTime(oldStart))
		this.uiUpdateCallback()
	}

	/**
	 * the current end time (hour:minutes) of the event in the local time zone.
	 * will return 00:00 for all-day events independently of the time zone.
	 */
	get endTime(): Time {
		if (this._isAllDay) {
			return new Time(0, 0)
		}

		const { zone, _endTime: endTime, _startTime: startTime } = this
		const endDate = DateTime.fromJSDate(getEventEnd({ startTime, endTime }, zone), { zone })
		return Time.fromDateTime(endDate)
	}

	/**
	 * set the time portion of the events end time. the date portion will not be modified.
	 *
	 */
	set endTime(v: Time | null) {
		if (v == null) return

		const { zone, _endTime: endTime, _startTime: startTime } = this
		this._endTime = DateTime.fromJSDate(getEventEnd({ startTime, endTime }, zone), { zone })
			.set({
				hour: v.hours,
				minute: v.minutes,
				second: 0,
				millisecond: 0,
			})
			.toJSDate()

		this.uiUpdateCallback()
	}

	/**
	 * get the start time of the day this event currently starts in UTC, in local time.
	 */
	get startDate(): Date {
		const { zone, _endTime: endTime, _startTime: startTime } = this
		const eventStart = getEventStart({ startTime, endTime }, zone)
		const startDate = DateTime.fromJSDate(eventStart, { zone })
		return getStartOfDayWithZone(startDate.toJSDate(), zone)
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

		const { zone, _endTime: endTime, _startTime: startTime } = this
		const oldStartDate = getEventStart({ startTime, endTime }, zone)
		const { hour, minute } = DateTime.fromJSDate(oldStartDate, { zone })
		const newStartDate = DateTime.fromJSDate(value, { zone }).set({ hour, minute })
		this._startTime = newStartDate.toJSDate()
		this.adjustEndDate(oldStartDate)
		this.uiUpdateCallback()
	}

	/**
	 * get the current end date without a time component (midnight UTC)
	 */
	get endDate(): Date {
		const { zone, _endTime: endTime, _startTime: startTime } = this
		const endDate = DateTime.fromJSDate(getEventEnd({ startTime, endTime }, zone), { zone })
		return getStartOfDayWithZone(endDate.toJSDate(), zone)
	}

	/**
	 * set the date portion of the events end time (value's time component is ignored)
	 *
	 * */
	set endDate(value: Date) {
		const { zone, _endTime: endTime, _startTime: startTime } = this
		const { hour, minute } = DateTime.fromJSDate(getEventEnd({ startTime, endTime }, zone), { zone })
		const newEndDate = DateTime.fromJSDate(value, { zone }).set({ hour, minute })
		this._endTime = newEndDate.toJSDate()
		this.uiUpdateCallback()
	}

	/**
	 * when moving the start date, we also want to move the end
	 * date by the same amount of days to keep the event length the same
	 * @private
	 */
	private adjustEndDate(oldStartDate: Date) {
		const { zone, _endTime: endTime } = this
		this._endTime = DateTime.fromJSDate(endTime, { zone })
			.plus({
				days: getDiffInDays(oldStartDate, this._startTime),
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

	get repeatPeriod(): RepeatPeriod | null {
		return this.repeatRule ? (this.repeatRule.frequency as RepeatPeriod) : null
	}

	set repeatPeriod(repeatPeriod: RepeatPeriod | null) {
		if (this.repeatRule?.frequency === repeatPeriod) {
			// repeat null => we will return if repeatPeriod is null
			// repeat not null => we return if the repeat period is null or it did not change.
			return
		} else if (repeatPeriod == null) {
			this.repeatRule = null
		} else if (this.repeatRule != null) {
			this.repeatRule.frequency = repeatPeriod
		} else {
			// new repeat rule, populate with default values.
			this.repeatRule = createRepeatRule({
				interval: "1",
				endType: EndType.Never,
				endValue: "1",
				frequency: repeatPeriod,
				excludedDates: [],
			})
		}

		this.uiUpdateCallback()
	}

	/**
	 * get the current interval this series repeats in.
	 *
	 * if the event is not set to
	 */
	get repeatInterval(): number {
		if (!this.repeatRule?.interval) return 1
		return Number(this.repeatRule?.interval)
	}

	/**
	 * set the event to occur on every nth of its repeat period (ie every second, third, fourth day/month/year...).
	 * setting it to something less than 1 will set the interval to 1
	 * @param interval
	 */
	set repeatInterval(interval: number) {
		if (interval < 1) interval = 1
		const stringInterval = String(interval)
		if (this.repeatRule && this.repeatRule?.interval !== stringInterval) {
			this.repeatRule.interval = stringInterval
		}

		this.uiUpdateCallback()
	}

	/**
	 * get the current way for the event series to end.
	 */
	get repeatEndType(): EndType {
		return (this.repeatRule?.endType ?? EndType.Never) as EndType
	}

	/**
	 * set the way the event series will stop repeating. if this causes a change in the event,
	 * the endValue will be set to the default for the selected EndType.
	 *
	 * @param endType
	 */
	set repeatEndType(endType: EndType) {
		if (!this.repeatRule) {
			// event does not repeat, no changes necessary
			return
		}

		if (this.repeatRule.endType === endType) {
			// event series end is already set to the requested value
			return
		}

		this.repeatRule.endType = endType

		switch (endType) {
			case EndType.UntilDate:
				this.repeatRule.endValue = getDefaultEndDateEndValue({ startTime: this._startTime, endTime: this._endTime }, this.zone)
				return
			case EndType.Count:
			case EndType.Never:
				this.repeatRule.endValue = getDefaultEndCountValue()
		}

		this.uiUpdateCallback()
	}

	/**
	 * get the current maximum number of repeats. if the event is not set to repeat or
	 * end after number of occurrences, returns the default max repeat number.
	 */
	get repeatEndOccurrences(): number {
		if (this.repeatRule?.endType === EndType.Count && this.repeatRule?.endValue) {
			return Number(this.repeatRule?.endValue)
		} else {
			return Number(getDefaultEndCountValue())
		}
	}

	/**
	 * set the max number of repeats for the event series. if the event is not set to repeat or
	 * not set to repeat a maximum number of times, this is a no-op.
	 * @param endValue
	 */
	set repeatEndOccurrences(endValue: number) {
		const stringEndValue = String(endValue)
		if (this.repeatRule && this.repeatRule.endType === EndType.Count && this.repeatRule.endValue !== stringEndValue) {
			this.repeatRule.endValue = stringEndValue
		}
		this.uiUpdateCallback()
	}

	/**
	 * get the date after which the event series will stop repeating.
	 *
	 * returns the default value of a month after the start date if the event is not
	 * set to stop repeating after a certain date.
	 */
	get repeatEndDate(): Date {
		if (this.repeatRule?.endType === EndType.UntilDate) {
			return getRepeatEndTime(this.repeatRule, this.isAllDay, this.zone)
		} else {
			return new Date(Number(getDefaultEndDateEndValue({ startTime: this._startTime, endTime: this._endTime }, this.zone)))
		}
	}

	/**
	 * set the date after which the event series ends. if the event does not repeat or the series is
	 * not set to end after a date, this is a no-op.
	 *
	 * @param endDate
	 */
	set repeatEndDate(endDate: Date) {
		if (this.repeatRule == null || this.repeatRule.endType !== EndType.UntilDate) {
			return
		}

		const repeatEndDate = getStartOfNextDayWithZone(endDate, this.zone)

		if (repeatEndDate < getEventStart({ startTime: this._startTime, endTime: this._endTime }, this.zone)) {
			throw new UserError("startAfterEnd_label")
		}

		// We have to save repeatEndDate in the same way we save start/end times because if one is timzone
		// dependent and one is not then we have interesting bugs in edge cases (event created in -11 could
		// end on another date in +12). So for all day events end date is UTC-encoded all day event and for
		// regular events it is just a timestamp.
		const stringEndDate = (this.isAllDay ? getAllDayDateUTCFromZone(repeatEndDate, this.zone) : repeatEndDate).getTime()
		this.repeatRule.endValue = String(stringEndDate)
		this.uiUpdateCallback()
	}

	get excludedDates(): ReadonlyArray<Date> {
		return this.repeatRule?.excludedDates.map(({ date }) => date) ?? []
	}

	/**
	 * calling this adds an exclusion for the event instance contained in this viewmodel to the repeat rule of the event,
	 * which will cause the instance to not be rendered or fire alarms.
	 * Exclusions are the start date/time of the event.
	 *
	 * the list of exclusions is maintained sorted from earliest to latest.
	 */
	async excludeThisOccurrence(): Promise<void> {
		if (this.repeatRule == null) {
			console.log("tried to add an exclusion for an event without a repeat rule. should probably delete the event.")
			return
		}
		const timeToInsert = this._startTime.getTime()
		const insertionIndex = this.repeatRule.excludedDates.findIndex(({ date }) => date.getTime() >= timeToInsert)
		// as of now, our maximum repeat frequency is 1/day. this means that we could truncate this to the current day (no time)
		// but then we run into problems with time zones, since we'd like to delete the n-th occurrence of an event, but detect
		// if an event is excluded by the start of the utc day it falls on, which may depend on time zone if it's truncated to the local start of day
		// where the exclusion is created.
		const wrapperToInsert = createDateWrapper({ date: this._startTime })
		if (insertionIndex < 0) {
			this.repeatRule.excludedDates.push(wrapperToInsert)
		} else {
			this.repeatRule.excludedDates.splice(insertionIndex, 0, wrapperToInsert)
		}

		// FIXME: this seems important
		// original event -> first occurrence of the series, the one that was created by the user
		// existing event -> the event instance that's displayed in the calendar and was clicked, essentially a copy of original event but with different start time
		// const originalEvent = existingEvent.repeatRule ? await this.entityClient.load(CalendarEventTypeRef, existingEvent._id) : existingEvent

		// FIXME: needs to happen after getting the result.
		// const calendarForEvent = this.calendars.get(assertNotNull(existingEvent._ownerGroup, "tried to add exclusion on event without ownerGroup"))
		// if (calendarForEvent == null) {
		// 	console.log("why does this event not have a calendar?")
		// 	return
		// }
		// await this.calendarModel.updateEvent(event, this.alarms.slice(), this.zone, calendarForEvent.groupRoot, existingEvent)
	}

	/**
	 * completely delete all exclusions. will cause the event to be rendered and fire alarms on all
	 * occurrences as dictated by its repeat rule.
	 */
	deleteExcludedDates(): void {
		if (!this.repeatRule) return
		this.repeatRule.excludedDates.length = 0
	}

	rescheduleEvent(delta: number): void {
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
		this.deleteExcludedDates()
	}

	get result(): CalendarEventWhenModelResult {
		if (this._isAllDay) {
			const startTime = getStartOfDayWithZone(this._startTime, "utc")
			const endTime = getStartOfNextDayWithZone(this._endTime, "utc")
			return { startTime, endTime, repeatRule: this.repeatRule }
		} else {
			return {
				startTime: this._startTime,
				endTime: this._endTime,
				repeatRule: this.repeatRule,
			}
		}
	}
}

/**
 * create the default repeat end for an event series that ends on a date
 */
export function getDefaultEndDateEndValue({ startTime }: CalendarEventTimes, timeZone: string): string {
	// one month after the event's start time in the local time zone.
	return String(incrementByRepeatPeriod(startTime, RepeatPeriod.MONTHLY, 1, timeZone).getTime())
}

/**
 * get the default repeat end for an event series that ends after number of repeats
 */
export function getDefaultEndCountValue(): string {
	return "10"
}
