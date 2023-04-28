import m, { Component, Vnode } from "mithril"
import { DatePicker } from "../../../gui/date/DatePicker.js"
import { TimePicker } from "../../../gui/TimePicker.js"
import { renderTwoColumnsIfFits } from "./CalendarEventEditDialog.js"
import { CalendarEventEditModel } from "../../date/CalendarEventEditModel.js"
import { Time } from "../../../api/common/utils/Time.js"

export type EventTimeEditorAttrs = {
	startOfTheWeekOffset: number
	onStartDateSelected: (date: Date) => unknown
	onEndDateSelected: (date: Date) => unknown
	onStartTimeSelected: (time: Time | null) => unknown
	onEndTimeSelected: (time: Time | null) => unknown
	isAllDay: boolean
}

export class EventTimeEditor implements Component<EventTimeEditorAttrs> {
	view(vnode: Vnode<EventTimeEditorAttrs>) {
		const { attrs } = vnode
		const { startOfTheWeekOffset, onStartDateSelected, onEndDateSelected } = attrs

		return renderTwoColumnsIfFits(
			[
				m(
					".flex-grow",
					m(DatePicker, {
						date: editModel?.startDate /** some start date passed in? */,
						onDateSelected: onStartDateSelected,
						startOfTheWeekOffset,
						label: "dateFrom_label",
						nullSelectionText: "emptyString_msg",
						disabled: editModel != null,
					}),
				),
				!editModel.allDay
					? m(
							".ml-s.time-field",
							m(TimePicker, {
								time: viewModel.startTime,
								onTimeSelected: (time) => viewModel.setStartTime(time),
								amPmFormat: viewModel.amPmFormat,
								disabled: viewModel.isReadOnlyEvent(),
							}),
					  )
					: null,
			],
			[
				m(
					".flex-grow",
					m(DatePicker, {
						date: viewModel.endDate,
						onDateSelected: (date) => {
							if (date) {
								// viewModel.setEndDate(date)
							}
						},
						startOfTheWeekOffset,
						label: "dateTo_label",
						nullSelectionText: "emptyString_msg",
						disabled: viewModel.isReadOnlyEvent(),
					}),
				),
				!viewModel.allDay
					? m(
							".ml-s.time-field",
							m(TimePicker, {
								time: viewModel.endTime,
								onTimeSelected: (time) => viewModel.setEndTime(time),
								amPmFormat: viewModel.amPmFormat,
								disabled: viewModel.isReadOnlyEvent(),
							}),
					  )
					: null,
			],
		)
	}
}
