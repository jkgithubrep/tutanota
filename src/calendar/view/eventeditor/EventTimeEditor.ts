import m, { Component, Vnode } from "mithril"
import { DatePicker } from "../../../gui/date/DatePicker.js"
import { TimePicker } from "../../../gui/TimePicker.js"
import { renderTwoColumnsIfFits } from "./CalendarEventEditDialog.js"
import { CalendarEventEditModel } from "../../date/CalendarEventEditModel.js"
import { TimeFormat } from "../../../api/common/TutanotaConstants.js"
import { Checkbox } from "../../../gui/base/Checkbox.js"
import { lang } from "../../../misc/LanguageViewModel.js"

export type EventTimeEditorAttrs = {
	disabled: boolean
	startOfTheWeekOffset: number
	timeFormat: TimeFormat
	editModel: CalendarEventEditModel
}

/**
 * an editor component to edit the start date and end date of a calendar event.
 * also allows to edit start time and end time for events where that makes sense (ie not all-day)
 */
export class EventTimeEditor implements Component<EventTimeEditorAttrs> {
	view(vnode: Vnode<EventTimeEditorAttrs>) {
		const { attrs } = vnode
		const { startOfTheWeekOffset, editModel, disabled, timeFormat } = attrs

		return [
			renderTwoColumnsIfFits(
				[
					m(
						".flex-grow",
						m(DatePicker, {
							date: editModel?.startDate,
							onDateSelected: (date) => date && (editModel.startDate = date),
							startOfTheWeekOffset,
							label: "dateFrom_label",
							nullSelectionText: "emptyString_msg",
							disabled,
						}),
					),
					!editModel.isAllDay
						? m(
								".ml-s.time-field",
								m(TimePicker, {
									time: editModel.startTime,
									onTimeSelected: (time) => (editModel.startTime = time),
									timeFormat,
									disabled,
								}),
						  )
						: null,
				],
				[
					m(
						".flex-grow",
						m(DatePicker, {
							date: editModel.endDate,
							onDateSelected: (date) => date && (editModel.endDate = date),
							startOfTheWeekOffset,
							label: "dateTo_label",
							nullSelectionText: "emptyString_msg",
							disabled,
						}),
					),
					!editModel.isAllDay
						? m(
								".ml-s.time-field",
								m(TimePicker, {
									time: editModel.endTime,
									onTimeSelected: (time) => (editModel.endTime = time),
									timeFormat,
									disabled,
								}),
						  )
						: null,
				],
			),
			m(".flex.items-center.mt-s", [
				m(Checkbox, {
					checked: editModel.isAllDay,
					onChecked: (value) => (editModel.isAllDay = value),
					disabled,
					label: () => lang.get("allDay_label"),
				}),
				m(".flex-grow"),
			]),
		]
	}
}
