import { pad } from "@tutao/tutanota-utils"
import { DateTime } from "luxon"

/**
 * A wrapper around time handling for the calendar stuff, mostly for the CalendarEventWhenModel
 */
export class Time {
	readonly hour: number
	readonly minute: number

	constructor(hour: number, minute: number) {
		this.hour = Math.floor(hour) % 24
		this.minute = Math.floor(minute) % 60
	}

	static fromDate(date: Date): Time {
		return new Time(date.getHours(), date.getMinutes())
	}

	static fromDateTime({ hour, minute }: DateTime): Time {
		return new Time(hour, minute)
	}

	/**
	 * convert into a date
	 * if base date is set it will use the date values from that,
	 * otherwise it will use the current date
	 */
	toDate(baseDate?: Date): Date {
		const date = baseDate ? new Date(baseDate) : new Date()
		date.setHours(this.hour)
		date.setMinutes(this.minute)
		date.setSeconds(0)
		date.setMilliseconds(0)
		return date
	}

	toDateTime(baseDate: Date, zone: string): DateTime {
		return DateTime.fromJSDate(baseDate, { zone }).set(this)
	}

	equals(otherTime: Time): boolean {
		return this.hour === otherTime.hour && this.minute === otherTime.minute
	}

	toString(amPmFormat: boolean): string {
		return amPmFormat ? this.to12HourString() : this.to24HourString()
	}

	to12HourString(): string {
		const minutesString = pad(this.minute, 2)

		if (this.hour === 0) {
			return `12:${minutesString} am`
		} else if (this.hour === 12) {
			return `12:${minutesString} pm`
		} else if (this.hour > 12) {
			return `${this.hour - 12}:${minutesString} pm`
		} else {
			return `${this.hour}:${minutesString} am`
		}
	}

	to24HourString(): string {
		const hours = pad(this.hour, 2)
		const minutes = pad(this.minute, 2)
		return `${hours}:${minutes}`
	}

	toObject(): {
		hours: number
		minutes: number
	} {
		return {
			hours: this.hour,
			minutes: this.minute,
		}
	}
}
