import m, { Children, Component, Vnode } from "mithril"
import { ExpanderButton, ExpanderPanel } from "../../../gui/base/Expander.js"
import { AttendeeListEditor, AttendeeListEditorAttrs } from "./AttendeeListEditor.js"
import { locator } from "../../../api/main/MainLocator.js"
import { CalendarEventEditModels, EventType } from "../../model/eventeditor/CalendarEventEditModel.js"
import { EventTimeEditor, EventTimeEditorAttrs } from "./EventTimeEditor.js"
import { RepeatRuleEditor, RepeatRuleEditorAttrs } from "./RepeatRuleEditor.js"
import { TextField, TextFieldAttrs } from "../../../gui/base/TextField.js"
import { defaultCalendarColor, TimeFormat } from "../../../api/common/TutanotaConstants.js"
import { lang } from "../../../misc/LanguageViewModel.js"
import { RecipientsSearchModel } from "../../../misc/RecipientsSearchModel.js"
import { DropDownSelector, DropDownSelectorAttrs } from "../../../gui/base/DropDownSelector.js"
import { getSharedGroupName } from "../../../sharing/GroupUtils.js"
import { BootIcons } from "../../../gui/base/icons/BootIcons.js"
import { CalendarInfo } from "../../model/CalendarModel.js"
import { createAlarmIntervalItems } from "../../date/CalendarUtils.js"
import { Icons } from "../../../gui/base/icons/Icons.js"
import { IconButton } from "../../../gui/base/IconButton.js"
import { ButtonSize } from "../../../gui/base/ButtonSize.js"
import { HtmlEditor } from "../../../gui/editor/HtmlEditor.js"
import { attachDropdown } from "../../../gui/base/Dropdown.js"
import { client } from "../../../misc/ClientDetector.js"

export type CalendarEventEditViewAttrs = {
	editModels: CalendarEventEditModels
	groupColors: Map<Id, string>
	recipientsSearch: RecipientsSearchModel
	descriptionEditor: HtmlEditor
	startOfTheWeekOffset: number
	timeFormat: TimeFormat
}

export class CalendarEventEditView implements Component<CalendarEventEditViewAttrs> {
	private attendeesExpanded: boolean = false

	private readonly recipientsSearch: RecipientsSearchModel
	private readonly timeFormat: TimeFormat
	private readonly startOfTheWeekOffset: number

	constructor(vnode: Vnode<CalendarEventEditViewAttrs>) {
		this.timeFormat = vnode.attrs.timeFormat
		this.startOfTheWeekOffset = vnode.attrs.startOfTheWeekOffset
		this.attendeesExpanded = vnode.attrs.editModels.whoModel.guests.length > 0
		this.recipientsSearch = vnode.attrs.recipientsSearch
	}

	view(vnode: Vnode<CalendarEventEditViewAttrs>): Children {
		return m(
			".calendar-edit-container.pb",
			{
				style: {
					// The date picker dialogs have position: fixed, and they are fixed relative to the most recent ancestor with
					// a transform. So doing a no-op transform will make the dropdowns scroll with the dialog
					// without this, then the date picker dialogs will show at the same place on the screen regardless of whether the
					// editor has scrolled or not.
					// Ideally we could do this inside DatePicker itself, but the rendering breaks and the dialog appears below it's siblings
					// We also don't want to do this for all dialogs because it could potentially cause other issues
					transform: "translate(0)",
				},
			},
			[
				this.renderHeading(vnode),
				this.renderChangesMessage(vnode),
				this.renderAttendees(vnode),
				m(EventTimeEditor, {
					editModel: vnode.attrs.editModels.whenModel,
					timeFormat: this.timeFormat,
					startOfTheWeekOffset: this.startOfTheWeekOffset,
				} satisfies EventTimeEditorAttrs),
				m(RepeatRuleEditor, {
					model: vnode.attrs.editModels.whenModel,
					startOfTheWeekOffset: this.startOfTheWeekOffset,
				} satisfies RepeatRuleEditorAttrs),
				m(".flex", [this.renderCalendarPicker(vnode), this.renderRemindersEditor(vnode)]),
				this.renderLocationField(vnode),
				m(vnode.attrs.descriptionEditor),
			],
		)
	}

	private renderHeading(vnode: Vnode<CalendarEventEditViewAttrs>): Children {
		const { editModels } = vnode.attrs
		return m(TextField, {
			label: "title_placeholder",
			value: editModels.summary.content,
			oninput: (v) => (editModels.summary.content = v),
			disabled: false,
			class: "big-input pt flex-grow",
			injectionsRight: () =>
				m(
					".mr-s",
					m(ExpanderButton, {
						label: "guests_label",
						expanded: this.attendeesExpanded,
						onExpandedChange: (v) => (this.attendeesExpanded = v),
						style: {
							paddingTop: 0,
						},
					}),
				),
		} satisfies TextFieldAttrs)
	}

	private renderChangesMessage(vnode: Vnode<CalendarEventEditViewAttrs>): Children {
		return vnode.attrs.editModels.saveModel.eventType === EventType.INVITE ? m(".mt.mb-s", lang.get("eventCopy_msg")) : null
	}

	private renderAttendees(vnode: Vnode<CalendarEventEditViewAttrs>): Children {
		return m(
			".mb.rel",
			m(
				ExpanderPanel,
				{ expanded: this.attendeesExpanded },
				m(AttendeeListEditor, {
					editModel: vnode.attrs.editModels.whoModel,
					saveModel: vnode.attrs.editModels.saveModel,
					recipientsSearch: this.recipientsSearch,
					logins: locator.logins,
					disabled: false,
					isSharedCalendar: false,
				} satisfies AttendeeListEditorAttrs),
			),
		)
	}

	private renderCalendarPicker(vnode: Vnode<CalendarEventEditViewAttrs>): Children {
		const { editModels } = vnode.attrs
		const availableCalendars = editModels.whoModel.getAvailableCalendars()
		return m(
			".flex-half.pr-s",
			availableCalendars.length
				? m(DropDownSelector, {
						label: "calendar_label",
						items: availableCalendars.map((calendarInfo) => {
							return {
								name: getSharedGroupName(calendarInfo.groupInfo, calendarInfo.shared),
								value: calendarInfo,
							}
						}),
						selectedValue: editModels.whoModel.selectedCalendar,
						selectionChangedHandler: (v) => (editModels.whoModel.selectedCalendar = v),
						icon: BootIcons.Expand,
						disabled: false,
						helpLabel: () => this.renderCalendarColor(editModels.whoModel.selectedCalendar, vnode.attrs.groupColors),
				  } as DropDownSelectorAttrs<CalendarInfo>)
				: null,
		)
	}

	private renderRemindersEditor(vnode: Vnode<CalendarEventEditViewAttrs>): Children {
		const { alarmModel } = vnode.attrs.editModels
		const { taken, available } = alarmModel.splitTriggers(createAlarmIntervalItems(), (i) => i.value)
		const textFieldAttrs: Array<TextFieldAttrs> = taken.map((a) => ({
			value: a.name,
			label: "emptyString_msg",
			disabled: true,
			injectionsRight: () =>
				m(IconButton, {
					title: "delete_action",
					icon: Icons.Cancel,
					click: () => alarmModel.removeAlarm(a.value),
				}),
		}))

		if (available.length > 0) {
			textFieldAttrs.push({
				value: lang.get("add_action"),
				label: "emptyString_msg",
				disabled: true,
				injectionsRight: () =>
					m(
						IconButton,
						attachDropdown({
							mainButtonAttrs: {
								title: "add_action",
								icon: Icons.Add,
							},
							childAttrs: () =>
								available.map((i) => ({
									label: () => i.name,
									click: () => alarmModel.addAlarm(i.value),
								})),
						}),
					),
			})
		}

		textFieldAttrs[0].label = "reminderBeforeEvent_label"

		return m(
			".flex.col.flex-half.pl-s",
			textFieldAttrs.map((a) => m(TextField, a)),
		)
	}

	private renderLocationField(vnode: Vnode<CalendarEventEditViewAttrs>): Children {
		const { editModels } = vnode.attrs
		return m(TextField, {
			label: "location_label",
			value: editModels.location.content,
			oninput: (v) => (editModels.location.content = v),
			disabled: false,
			class: "text pt-s", // override default pt with pt-s because calendar color indicator takes up some space
			injectionsRight: () => {
				let address = encodeURIComponent(editModels.location.content)

				if (address === "") {
					return null
				}

				return m(IconButton, {
					title: "showAddress_alt",
					icon: Icons.Pin,
					size: ButtonSize.Compact,
					click: () => {
						window.open(`https://www.openstreetmap.org/search?query=${address}`, "_blank")
					},
				})
			},
		})
	}

	private renderCalendarColor(selectedCalendar: CalendarInfo | null, groupColors: Map<Id, string>) {
		const color = selectedCalendar ? groupColors.get(selectedCalendar.groupInfo.group) ?? defaultCalendarColor : null
		return m(".mt-xs", {
			style: {
				width: "100px",
				height: "10px",
				background: color ? "#" + color : "transparent",
			},
		})
	}
}

export function renderTwoColumnsIfFits(left: Children, right: Children): Children {
	if (client.isMobileDevice()) {
		return m(".flex.col", [m(".flex", left), m(".flex", right)])
	} else {
		return m(".flex", [m(".flex.flex-half.pr-s", left), m(".flex.flex-half.pl-s", right)])
	}
}
