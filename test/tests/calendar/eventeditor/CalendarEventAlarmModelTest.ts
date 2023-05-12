import o from "ospec"
import { AlarmInterval } from "../../../../src/api/common/TutanotaConstants.js"
import { CalendarEventAlarmModel } from "../../../../src/calendar/model/eventeditor/CalendarEventAlarmModel.js"

o.spec("CalendarEventAlarmModel", function () {
	o.spec("alarm triggers", function () {
		o("alarm initialization works", function () {
			const model = new CalendarEventAlarmModel([AlarmInterval.ONE_HOUR])
			o(model.alarms).deepEquals([AlarmInterval.ONE_HOUR])
			o(model.result.alarms.map(({ trigger }) => trigger)).deepEquals([AlarmInterval.ONE_HOUR])
		})

		o("setting an alarm with the same trigger multiple times does not change the result", function () {
			const model = new CalendarEventAlarmModel([])

			model.addAlarm(AlarmInterval.ONE_HOUR)
			model.addAlarm(AlarmInterval.ONE_HOUR)
			o(model.alarms).deepEquals([AlarmInterval.ONE_HOUR])
			o(model.result.alarms.map(({ trigger }) => trigger)).deepEquals([AlarmInterval.ONE_HOUR])
		})

		o("adding alarms works", function () {
			const model = new CalendarEventAlarmModel([AlarmInterval.ONE_HOUR])

			model.addAlarm(AlarmInterval.ONE_DAY)
			o(model.alarms).deepEquals([AlarmInterval.ONE_HOUR, AlarmInterval.ONE_DAY])
			const { alarms } = model.result
			o(alarms.map(({ trigger }) => trigger)).deepEquals([AlarmInterval.ONE_HOUR, AlarmInterval.ONE_DAY])
		})

		o("removing an alarm works", function () {
			const model = new CalendarEventAlarmModel([AlarmInterval.ONE_HOUR])
			model.removeAlarm(AlarmInterval.ONE_HOUR)
			model.removeAlarm(AlarmInterval.ONE_DAY)
			o(model.alarms).deepEquals([])
			const { alarms } = model.result
			o(alarms).deepEquals([])
		})
	})
})
