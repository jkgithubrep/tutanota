import type { Thunk } from "@tutao/tutanota-utils"
import { downcast, isSameDay } from "@tutao/tutanota-utils"
import { formatDateWithWeekdayAndTime, formatTime } from "../../misc/Formatter"
import { EndType } from "../../api/common/TutanotaConstants"
import type { AlarmInfo, RepeatRule } from "../../api/entities/sys/TypeRefs.js"
import type { ScheduledTimeoutId, Scheduler } from "../../api/common/utils/Scheduler.js"
import { calculateAlarmTime, findNextAlarmOccurrence, getEventStartByTimes, getValidTimeZone } from "./CalendarUtils"
import { DateProvider } from "../../api/common/DateProvider"

type NotificationSender = (title: string, message: string) => void
type EventInfo = {
	startTime: Date
	endTime: Date
	summary: string
}

export class AlarmScheduler {
	private readonly scheduledNotifications: Map<string, ScheduledTimeoutId> = new Map()

	constructor(private readonly dateProvider: DateProvider, private readonly scheduler: Scheduler) {}

	scheduleAlarm(event: EventInfo, alarmInfo: AlarmInfo, repeatRule: RepeatRule | null, notificationSender: NotificationSender): void {
		const localZone = this.dateProvider.timeZone()

		if (repeatRule) {
			let repeatTimeZone = getValidTimeZone(repeatRule.timeZone, localZone)
			let calculationLocalZone = getValidTimeZone(localZone)
			const nextOccurrence = findNextAlarmOccurrence(
				new Date(this.dateProvider.now()),
				repeatTimeZone,
				event.startTime,
				event.endTime,
				downcast(repeatRule.frequency),
				Number(repeatRule.interval),
				downcast(repeatRule.endType) || EndType.Never,
				Number(repeatRule.endValue),
				repeatRule.excludedDates.map(({ date }) => date),
				downcast(alarmInfo.trigger),
				calculationLocalZone,
			)

			if (nextOccurrence) {
				this.scheduleAction(alarmInfo.alarmIdentifier, nextOccurrence.alarmTime, () => {
					this.sendNotification(nextOccurrence.eventTime, event.summary, notificationSender)

					// Schedule next occurrence
					this.scheduleAlarm(event, alarmInfo, repeatRule, notificationSender)
				})
			}
		} else {
			const eventStart = getEventStartByTimes(event.startTime, event.endTime, localZone)

			if (eventStart.getTime() > this.dateProvider.now()) {
				this.scheduleAction(alarmInfo.alarmIdentifier, calculateAlarmTime(eventStart, downcast(alarmInfo.trigger)), () =>
					this.sendNotification(eventStart, event.summary, notificationSender),
				)
			}
		}
	}

	cancelAlarm(alarmIdentifier: string) {
		// try to cancel single first
		this.cancelOccurrence(alarmIdentifier)
	}

	private cancelOccurrence(alarmIdentifier: string) {
		const timeoutId = this.scheduledNotifications.get(alarmIdentifier)

		if (timeoutId != null) {
			this.scheduler.unscheduleTimeout(timeoutId)
		}
	}

	private scheduleAction(identifier: string, atTime: Date, action: Thunk) {
		const scheduledId = this.scheduler.scheduleAt(action, atTime)

		this.scheduledNotifications.set(identifier, scheduledId)
	}

	private sendNotification(eventTime: Date, summary: string, notificationSender: NotificationSender): void {
		let dateString: string

		if (isSameDay(eventTime, new Date(this.dateProvider.now()))) {
			dateString = formatTime(eventTime)
		} else {
			dateString = formatDateWithWeekdayAndTime(eventTime)
		}

		const body = `${dateString} ${summary}`
		notificationSender(body, body)
	}
}
