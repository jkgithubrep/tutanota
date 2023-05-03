import { px, size } from "../../../gui/size.js"
import { DatePicker } from "../../../gui/date/DatePicker.js"
import { Dialog } from "../../../gui/base/Dialog.js"
import m, { Children } from "mithril"
import { TextField, TextFieldAttrs } from "../../../gui/base/TextField.js"
import { lang } from "../../../misc/LanguageViewModel.js"
import type { DropDownSelectorAttrs, SelectorItemList } from "../../../gui/base/DropDownSelector.js"
import { DropDownSelector } from "../../../gui/base/DropDownSelector.js"
import { Icons } from "../../../gui/base/icons/Icons.js"
import { ButtonType } from "../../../gui/base/Button.js"
import { AlarmInterval, CalendarAttendeeStatus, defaultCalendarColor, EndType, Keys, RepeatPeriod } from "../../../api/common/TutanotaConstants.js"
import {
	createAlarmIntervalItems,
	createAttendingItems,
	createIntervalValues,
	createRepeatRuleEndTypeValues,
	createRepeatRuleFrequencyValues,
	getStartOfTheWeekOffsetForUser,
	getTimeFormatForUser,
	iconForAttendeeStatus,
} from "../../date/CalendarUtils.js"
import { Icon } from "../../../gui/base/Icon.js"
import { BootIcons } from "../../../gui/base/icons/BootIcons.js"
import { ExpanderButton, ExpanderPanel } from "../../../gui/base/Expander.js"
import { client } from "../../../misc/ClientDetector.js"
import type { Guest } from "../../date/CalendarInvites.js"
import { CalendarEventViewModel } from "../../date/CalendarEventViewModel.js"
import { UserError } from "../../../api/main/UserError.js"
import { theme } from "../../../gui/theme.js"
import { showBusinessFeatureRequiredDialog } from "../../../misc/SubscriptionDialogs.js"
import { BusinessFeatureRequiredError } from "../../../api/main/BusinessFeatureRequiredError.js"
import type { MailboxDetail } from "../../../mail/model/MailModel.js"
import { showProgressDialog } from "../../../gui/dialogs/ProgressDialog.js"
import { getSharedGroupName } from "../../../sharing/GroupUtils.js"
import type { DialogHeaderBarAttrs } from "../../../gui/base/DialogHeaderBar.js"
import { askIfShouldSendCalendarUpdatesToAttendees } from "../CalendarGuiUtils.js"
import type { CalendarInfo } from "../../model/CalendarModel.js"
import { showUserError } from "../../../misc/ErrorHandlerImpl.js"
import { assertNotNull, defer, getFirstOrThrow, noOp, ofClass } from "@tutao/tutanota-utils"
import { createDropdown, Dropdown, PosRect } from "../../../gui/base/Dropdown.js"
import { CalendarEvent, createEncryptedMailAddress, EncryptedMailAddress, Mail } from "../../../api/entities/tutanota/TypeRefs.js"
import type { HtmlEditor } from "../../../gui/editor/HtmlEditor.js"
import { IconButton } from "../../../gui/base/IconButton.js"
import { ButtonSize } from "../../../gui/base/ButtonSize.js"
import { locator } from "../../../api/main/MainLocator.js"
import { findAttendeeInAddresses } from "../../../api/common/utils/CommonCalendarUtils.js"
import { modal } from "../../../gui/base/Modal.js"
import { CalendarEventEditModel } from "../../date/CalendarEventEditModel.js"
import { EventTimeEditor } from "./EventTimeEditor.js"
import { AttendeeListEditor } from "./AttendeeListEditor.js"

/**
 * show a dialog that allows to edit a calendar event
 * @param date the date/time that should initially selected. ignored if existingEvent exists.
 * @param calendars list of calendars that we can select for this event
 * @param mailboxDetail
 * @param existingEvent optionally, event that may exist already and is edited
 * @param responseMail a mail containing an invite and/or update for this event?
 */
export async function showCalendarEventEditDialog(
	date: Date,
	calendars: ReadonlyMap<Id, CalendarInfo>,
	mailboxDetail: MailboxDetail,
	existingEvent?: CalendarEvent,
	responseMail?: Mail,
) {
	const { HtmlEditor } = await import("../../../gui/editor/HtmlEditor.js")
	const recipientsSearch = await locator.recipientsSearchModel()
	const mailboxProperties = await locator.mailModel.getMailboxProperties(mailboxDetail.mailboxGroupRoot)
	const selectedCalendar = getPreselectedCalendar(calendars, existingEvent)
	const ownMailAddresses = mailboxProperties.mailAddressProperties.map(({ mailAddress, senderName }) =>
		createEncryptedMailAddress({
			address: mailAddress,
			name: senderName,
		}),
	)
	const editModel = new CalendarEventEditModel(existingEvent ?? {}, selectedCalendar.group._id, ownMailAddresses)

	const viewModel: CalendarEventViewModel = await locator.calendarEventViewModel(
		date,
		calendars,
		mailboxDetail,
		mailboxProperties,
		existingEvent ?? null,
		responseMail ?? null,
		false,
	)
	const startOfTheWeekOffset = getStartOfTheWeekOffsetForUser(locator.logins.getUserController().userSettingsGroupRoot)
	const timeFormat = getTimeFormatForUser(locator.logins.getUserController().userSettingsGroupRoot)
	const groupColors = locator.logins.getUserController().userSettingsGroupRoot.groupSettings.reduce((acc, gc) => {
		acc.set(gc.group, gc.color)
		return acc
	}, new Map())
	let finished = false

	const descriptionEditor: HtmlEditor = new HtmlEditor("description_label")
		.setMinHeight(400)
		.showBorders()
		.setEnabled(!viewModel.isReadOnlyEvent())
		// We only set it once, we don't viewModel on every change, that would be slow
		.setValue(viewModel.note)
		.setToolbarOptions({
			alignmentEnabled: false,
			fontSizeEnabled: false,
		})
		.enableToolbar()

	const okAction = (posRect: PosRect) => {
		if (finished) {
			return
		}

		const description = descriptionEditor.getValue()

		if (description === "<div><br></div>") {
			viewModel.changeDescription("")
		} else {
			viewModel.changeDescription(description)
		}

		function showProgress(p: Promise<unknown>) {
			// We get all errors in main promise, we don't need to handle them here
			return showProgressDialog("pleaseWait_msg", p).catch(noOp)
		}

		Promise.resolve().then(async () => {
			const shouldClose = await viewModel
				.saveAndSend({
					askForUpdates: askIfShouldSendCalendarUpdatesToAttendees,
					showProgress,
					askInsecurePassword: () => Dialog.confirm("presharedPasswordNotStrongEnough_msg"),
					askEditType: async () => {
						const deferred = defer<"single" | "all" | "cancel">()
						const dropdown = new Dropdown(
							() => [
								{
									label: "updateOneCalendarEvent_action",
									click: () => deferred.resolve("single"),
								},
								{
									label: "updateAllCalendarEvents_action",
									click: () => deferred.resolve("all"),
								},
							],
							300,
						)
							.setCloseHandler(() => {
								deferred.resolve("cancel")
								dropdown.close()
							})
							.setOrigin(posRect)
						modal.displayUnique(dropdown, false)
						return deferred.promise
					},
				})
				.catch(
					ofClass(UserError, (e) => {
						showUserError(e)
						return false
					}),
				)
				.catch(
					ofClass(BusinessFeatureRequiredError, async (e) => {
						// entity event updates are too slow to call updateBusinessFeature()
						viewModel.hasBusinessFeature = await showBusinessFeatureRequiredDialog(() => e.message)
						return false
					}),
				)

			if (shouldClose) {
				finish()
			}
		})
	}

	let attendeesExpanded: boolean = viewModel.attendees.length > 0

	// const renderRevealIcon = (address: string) => {
	// 	return m(IconButton, {
	// 		title: guestShowConfidential.get(address) ? "concealPassword_action" : "revealPassword_action",
	// 		click: () => {
	// 			guestShowConfidential.set(address, !guestShowConfidential.get(address))
	// 		},
	// 		icon: guestShowConfidential.get(address) ? Icons.NoEye : Icons.Eye,
	// 		size: ButtonSize.Compact,
	// 	})
	// }

	const renderLocationField = () =>
		m(TextField, {
			label: "location_label",
			value: viewModel.location,
			oninput: (v) => (viewModel.location = v),
			disabled: viewModel.isReadOnlyEvent(),
			class: "text pt-s", // override default pt with pt-s because calendar color indicator takes up some space
			injectionsRight: () => {
				let address = encodeURIComponent(viewModel.location)

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

	function renderCalendarColor() {
		const color = viewModel.selectedCalendar ? groupColors.get(viewModel.selectedCalendar.groupInfo.group) ?? defaultCalendarColor : null
		return m(".mt-xs", {
			style: {
				width: "100px",
				height: "10px",
				background: color ? "#" + color : "transparent",
			},
		})
	}

	function renderCalendarPicker() {
		const availableCalendars = viewModel.getAvailableCalendars()
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
						selectedValue: viewModel.selectedCalendar,
						selectionChangedHandler: (v) => (viewModel.selectedCalendar = v),
						icon: BootIcons.Expand,
						disabled: viewModel.isReadOnlyEvent(),
						helpLabel: () => renderCalendarColor(),
				  } as DropDownSelectorAttrs<CalendarInfo>)
				: null,
		)
	}

	function renderChangesMessage() {
		return viewModel.isInvite() ? m(".mt.mb-s", lang.get("eventCopy_msg")) : null
	}

	function renderDialogContent() {
		const alarmIntervalItems = createAlarmIntervalItems()
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
				renderHeading(),
				renderChangesMessage(),
				//m(".mb.rel", m(ExpanderPanel, { expanded: attendeesExpanded }, m(AttendeeListEditor, { editModel, recipientsSearch }))),
				m(EventTimeEditor, {
					editModel,
					// FIXME: isReadOnly?
					disabled: false,
					timeFormat,
					startOfTheWeekOffset,
				}),
				renderRepeatRulePicker(viewModel, startOfTheWeekOffset),
				m(".flex", [
					renderCalendarPicker(),
					viewModel.canModifyAlarms()
						? m(".flex.col.flex-half.pl-s", [
								viewModel.alarms.map((a) =>
									m(DropDownSelector, {
										label: "reminderBeforeEvent_label",
										items: alarmIntervalItems,
										selectedValue: a.trigger as AlarmInterval,
										icon: BootIcons.Expand,
										selectionChangedHandler: (value: AlarmInterval) => viewModel.changeAlarm(a.alarmIdentifier, value),
										key: a.alarmIdentifier,
									}),
								),
								m(DropDownSelector, {
									label: "reminderBeforeEvent_label",
									items: alarmIntervalItems,
									selectedValue: null,
									icon: BootIcons.Expand,
									selectionChangedHandler: (value: AlarmInterval) => value && viewModel.addAlarm(value),
								}),
						  ])
						: m(".flex.flex-half.pl-s"),
				]),
				renderLocationField(),
				m(descriptionEditor),
			],
		)
	}

	function finish() {
		finished = true
		viewModel.dispose()
		dialog.close()
	}

	function renderHeading() {
		const attrs: TextFieldAttrs = {
			label: "title_placeholder",
			value: "", // viewModel.summary,
			oninput: noOp, // (v) => (viewModel.summary = v),
			disabled: viewModel.isReadOnlyEvent(),
			class: "big-input pt flex-grow",
			injectionsRight: () =>
				m(
					".mr-s",
					m(ExpanderButton, {
						label: "guests_label",
						expanded: attendeesExpanded,
						onExpandedChange: (v) => (attendeesExpanded = v),
						style: {
							paddingTop: 0,
						},
					}),
				),
		}
		return m(TextField, attrs)
	}

	viewModel.attendees.map(m.redraw)
	let headerDom: HTMLElement | null = null
	const dialogHeaderBarAttrs: DialogHeaderBarAttrs = {
		left: [
			{
				label: "cancel_action",
				click: finish,
				type: ButtonType.Secondary,
			},
		],
		middle: () => lang.get("createEvent_label"), // right: save button is only added if the event is not read-only
		create: (dom) => {
			headerDom = dom
		},
	}
	const dialog = Dialog.largeDialog(dialogHeaderBarAttrs, {
		view: renderDialogContent,
	}).addShortcut({
		key: Keys.ESC,
		exec: finish,
		help: "close_alt",
	})

	if (!viewModel.isReadOnlyEvent()) {
		dialogHeaderBarAttrs.right = [
			{
				label: "save_action",
				click: (event, dom) => okAction(dom.getBoundingClientRect()),
				type: ButtonType.Primary,
			},
		]
		dialog.addShortcut({
			key: Keys.S,
			ctrl: true,
			exec: () => okAction(assertNotNull(headerDom).getBoundingClientRect()),
			help: "save_action",
		})
	}

	if (client.isMobileDevice()) {
		// Prevent focusing text field automatically on mobile. It opens keyboard and you don't see all details.
		dialog.setFocusOnLoadFunction(noOp)
	}

	dialog.show()
}

export async function showNewCalendarEventEditDialog(existingEvent: CalendarEvent | null, calendars: ReadonlyMap<Id, CalendarInfo>): Promise<void> {}

function getPreselectedCalendar(calendars: ReadonlyMap<Id, CalendarInfo>, event?: CalendarEvent): CalendarInfo {
	const ownerGroup: string = assertNotNull(event?._ownerGroup, "existing event without ownerGroup?")
	if (event == null || !calendars.has(ownerGroup)) {
		return getFirstOrThrow(Array.from(calendars.values()))
	} else {
		return calendars.get(ownerGroup)!
	}
}

function renderRepeatRulePicker(viewModel: CalendarEventViewModel, startOfTheWeekOffset: number): Children {
	const intervalValues = createIntervalValues()
	const endTypeValues = createRepeatRuleEndTypeValues()
	return [
		renderTwoColumnsIfFits(
			[
				m(".flex-grow.pr-s", renderRepeatPeriod(viewModel)), // Repeat type == Frequency: Never, daily, annually etc
				m(".flex-grow.pl-s" + (viewModel.repeat ? "" : ".hidden"), renderRepeatInterval(viewModel, intervalValues)), // Repeat interval: every day, every second day etc
			],
			viewModel.repeat
				? [
						m(".flex-grow.pr-s", renderEndType(viewModel, endTypeValues)),
						m(".flex-grow.pl-s", renderEndValue(viewModel, intervalValues, startOfTheWeekOffset)),
				  ]
				: null,
		),
		renderTwoColumnsIfFits(
			viewModel.repeat && viewModel.repeat.excludedDates.length > 0 ? [m(".flex-grow.pr-s", renderExclusionCount(viewModel))] : null,
			null,
		),
	]
}

function renderExclusionCount(viewModel: CalendarEventViewModel): Children {
	return m(TextField, {
		label: "emptyString_msg",
		value: lang.get("someRepetitionsDeleted_msg"),
		injectionsRight: () => renderDeleteExclusionButton(viewModel),
		disabled: true,
	})
}

function renderDeleteExclusionButton(viewModel: CalendarEventViewModel): Children {
	return m(IconButton, {
		title: "restoreExcludedRecurrences_action",
		click: noOp, //() => viewModel.deleteExcludedDates(),
		icon: Icons.Cancel,
	})
}

function renderRepeatPeriod(viewModel: CalendarEventViewModel) {
	const repeatValues: SelectorItemList<RepeatPeriod | null> = createRepeatRuleFrequencyValues()
	return m(DropDownSelector, {
		label: "calendarRepeating_label",
		items: repeatValues,
		selectedValue: (viewModel.repeat && viewModel.repeat.frequency) || null,
		selectionChangedHandler: noOp, // (period) => viewModel.onRepeatPeriodSelected(period),
		icon: BootIcons.Expand,
		disabled: viewModel.isReadOnlyEvent(),
	} as DropDownSelectorAttrs<RepeatPeriod | null>)
}

function renderRepeatInterval(viewModel: CalendarEventViewModel, intervalValues: SelectorItemList<number>) {
	return m(DropDownSelector, {
		label: "interval_title",
		items: intervalValues,
		selectedValue: (viewModel.repeat && viewModel.repeat.interval) || 1,
		selectionChangedHandler: noOp, // (period: number) => viewModel.onRepeatIntervalChanged(period),
		icon: BootIcons.Expand,
		disabled: viewModel.isReadOnlyEvent(),
	})
}

function renderEndType(viewModel: CalendarEventViewModel, endTypeValues: SelectorItemList<EndType>) {
	return m(DropDownSelector, {
		label: () => lang.get("calendarRepeatStopCondition_label"),
		items: endTypeValues,
		selectedValue: viewModel.repeat?.endType ?? endTypeValues[0],
		selectionChangedHandler: noOp, // (period: EndType) => viewModel.onRepeatEndTypeChanged(period),
		icon: BootIcons.Expand,
		disabled: viewModel.isReadOnlyEvent(),
	})
}

function renderEndValue(viewModel: CalendarEventViewModel, intervalValues: SelectorItemList<number>, startOfTheWeekOffset: number): Children {
	if (viewModel.repeat == null || viewModel.repeat.endType === EndType.Never) {
		return null
	} else if (viewModel.repeat.endType === EndType.Count) {
		return m(DropDownSelector, {
			label: "emptyString_msg",
			items: intervalValues,
			selectedValue: viewModel.repeat.endValue,
			selectionChangedHandler: noOp, // (endValue: number) => viewModel.onEndOccurencesSelected(endValue),
			icon: BootIcons.Expand,
		})
	} else if (viewModel.repeat.endType === EndType.UntilDate) {
		return m(DatePicker, {
			date: viewModel.repeat?.endValue != null ? new Date(viewModel.repeat?.endValue) : new Date(),
			onDateSelected: noOp, // (date) => viewModel.onRepeatEndDateSelected(date),
			startOfTheWeekOffset,
			label: "emptyString_msg",
			nullSelectionText: "emptyString_msg",
			// When the guests expander is expanded and the dialog has overflow, then the scrollbar will overlap the date picker popup
			// to fix this we could either:
			// * reorganize the layout so it doesn't go over the right edge
			// * change the alignment so that it goes to the left (this is what we do)
			rightAlignDropdown: true,
		})
	} else {
		return null
	}
}

function renderStatusIcon(status: CalendarAttendeeStatus): Children {
	const icon = iconForAttendeeStatus[status]
	return m(Icon, {
		icon,
		class: "mr-s",
		style: {
			fill: theme.content_fg,
		},
	})
}

export function renderTwoColumnsIfFits(left: Children, right: Children): Children {
	if (client.isMobileDevice()) {
		return m(".flex.col", [m(".flex", left), m(".flex", right)])
	} else {
		return m(".flex", [m(".flex.flex-half.pr-s", left), m(".flex.flex-half.pl-s", right)])
	}
}

function showOrganizerDropdown(viewModel: CalendarEventViewModel, e: MouseEvent) {
	const makeButtons = () =>
		viewModel.possibleOrganizers.map((organizer) => {
			return {
				label: () => organizer.address,
				click: noOp, // () => viewModel.setOrganizer(organizer),
			}
		})

	createDropdown({ lazyButtons: makeButtons, width: 300 })(e, e.target as any)
}

function renderGuest(
	guest: {
		address: EncryptedMailAddress
		status: CalendarAttendeeStatus
	},
	index: number,
	viewModel: CalendarEventViewModel,
	ownAttendee: Guest | null,
): Children {
	const { address, status } = guest
	const { organizer } = viewModel
	const isOrganizer = organizer && findAttendeeInAddresses([guest], [organizer.address])
	const editableOrganizer = isOrganizer && viewModel.canModifyOrganizer()
	return m(
		".flex",
		{
			style: {
				height: px(size.button_height),
				borderBottom: "1px transparent",
				marginTop: index === 0 && !viewModel.canModifyGuests() ? 0 : px(size.vpad),
			},
		},
		[
			m(".flex.col.flex-grow.overflow-hidden.flex-no-grow-shrink-auto", [
				m(
					".flex.flex-grow.items-center" + (editableOrganizer ? ".click" : ""),
					editableOrganizer
						? {
								onclick: (e: MouseEvent) => showOrganizerDropdown(viewModel, e),
						  }
						: {},
					[
						m(
							"div.text-ellipsis",
							{
								style: {
									lineHeight: px(24),
								},
							},
							address.name ? `${address.name} ${address.address}` : address.address,
						),
						editableOrganizer
							? m(Icon, {
									icon: BootIcons.Expand,
									style: {
										fill: theme.content_fg,
									},
							  })
							: null,
					],
				),
				m(".small.flex.center-vertically", [
					renderStatusIcon(status),
					lang.get(isOrganizer ? "organizer_label" : "guest_label") + (guest === ownAttendee ? ` | ${lang.get("you_label")}` : ""),
				]),
			]),
			m(".flex-grow"),
			[
				ownAttendee === guest //&& viewModel.canModifyOwnAttendance()
					? m(
							"",
							{
								style: {
									minWidth: "120px",
								},
							},
							m(DropDownSelector, {
								label: "attending_label",
								items: createAttendingItems(),
								selectedValue: status,
								class: "",
								selectionChangedHandler: (value: CalendarAttendeeStatus) => {
									if (value == null) return
									//viewModel.selectGoing(value)
								},
							}),
					  )
					: viewModel.canModifyGuests()
					? m(IconButton, {
							title: "remove_action",
							icon: Icons.Cancel,
							click: noOp, //() => viewModel.removeAttendee(guest),
					  })
					: null,
			],
		],
	)
}
