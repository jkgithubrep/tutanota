import { AlarmInterval } from "../../../api/common/TutanotaConstants.js"
import { AlarmInfo, createAlarmInfo } from "../../../api/entities/sys/TypeRefs.js"
import { generateEventElementId } from "../../../api/common/utils/CommonCalendarUtils.js"
import { noOp } from "@tutao/tutanota-utils"

export type CalendarEventAlarmModelResult = {
	alarms: Array<AlarmInfo>
}

/**
 * edit the alarms set on a calendar event.
 */
export class CalendarEventAlarmModel {
	private _alarms: Set<AlarmInterval> = new Set()

	constructor(alarms: Array<AlarmInterval> = [], private readonly uiUpdateCallback: () => void = noOp) {
		for (const alarm of alarms) {
			this._alarms.add(alarm)
		}
	}

	/**
	 * idempotent: each event has at most one alarm of each alarm interval.
	 * @param trigger the interval to add.
	 */
	addAlarm(trigger: AlarmInterval | null) {
		if (trigger == null) return
		this._alarms.add(trigger)
		this.uiUpdateCallback()
	}

	/**
	 * deactivate the alarm for the given interval.
	 */
	removeAlarm(trigger: AlarmInterval) {
		this._alarms.delete(trigger)
		this.uiUpdateCallback()
	}

	/**
	 * get the alarm triggers that are currently set on the event.
	 */
	get alarms(): Array<AlarmInterval> {
		return Array.from(this._alarms.values())
	}

	/**
	 * split a collection of triggers into those that are already set and those that are not set.
	 * @param items
	 * @param unwrap
	 */
	splitTriggers<T>(items: ReadonlyArray<T>, unwrap: (item: T) => AlarmInterval): { taken: ReadonlyArray<T>; available: ReadonlyArray<T> } {
		const taken: Array<T> = []
		const available: Array<T> = []
		for (const item of items) {
			const interval = unwrap(item)
			if (this._alarms.has(interval)) {
				taken.push(item)
			} else {
				available.push(item)
			}
		}

		return { taken, available }
	}

	get result(): CalendarEventAlarmModelResult {
		return {
			alarms: Array.from(this._alarms.values()).map(newAlarm),
		}
	}
}

export function newAlarm(trigger: AlarmInterval): AlarmInfo {
	return createCalendarAlarm(generateEventElementId(Date.now()), trigger)
}

export function createCalendarAlarm(identifier: string, trigger: string): AlarmInfo {
	const calendarAlarmInfo = createAlarmInfo()
	calendarAlarmInfo.alarmIdentifier = identifier
	calendarAlarmInfo.trigger = trigger
	return calendarAlarmInfo
}
