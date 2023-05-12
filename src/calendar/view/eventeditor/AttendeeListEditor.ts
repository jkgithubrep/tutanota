import m, { Children, Component, Vnode } from "mithril"
import { EventType } from "../../model/eventeditor/CalendarEventEditModel.js"
import { MailRecipientsTextField } from "../../../gui/MailRecipientsTextField.js"
import { showBusinessFeatureRequiredDialog } from "../../../misc/SubscriptionDialogs.js"
import { RecipientType } from "../../../api/common/recipients/Recipient.js"
import { ToggleButton } from "../../../gui/base/ToggleButton.js"
import { Icons } from "../../../gui/base/icons/Icons.js"
import { ButtonSize } from "../../../gui/base/ButtonSize.js"
import { Checkbox } from "../../../gui/base/Checkbox.js"
import { lang } from "../../../misc/LanguageViewModel.js"
import { CalendarAttendeeStatus } from "../../../api/common/TutanotaConstants.js"
import { Autocomplete, TextField, TextFieldType } from "../../../gui/base/TextField.js"
import { CompletenessIndicator } from "../../../gui/CompletenessIndicator.js"
import { RecipientsSearchModel } from "../../../misc/RecipientsSearchModel.js"
import { noOp } from "@tutao/tutanota-utils"
import { Guest } from "../../date/CalendarInvites.js"
import { createAttendingItems, iconForAttendeeStatus } from "../../date/CalendarUtils.js"
import { Icon } from "../../../gui/base/Icon.js"
import { theme } from "../../../gui/theme.js"
import { IconButton } from "../../../gui/base/IconButton.js"
import { DropDownSelector } from "../../../gui/base/DropDownSelector.js"
import { BootIcons } from "../../../gui/base/icons/BootIcons.js"
import { px, size } from "../../../gui/size.js"
import { createDropdown } from "../../../gui/base/Dropdown.js"
import { CalendarEventWhoModel, canModifyGuests, canModifyOwnAttendance } from "../../model/eventeditor/CalendarEventWhoModel.js"
import { LoginController } from "../../../api/main/LoginController.js"
import { MailboxDetail } from "../../../mail/model/MailModel.js"
import { CalendarEventSaveModel } from "../../model/eventeditor/CalendarEventSaveModel.js"

export type AttendeeListEditorAttrs = {
	/** the event that is currently being edited */
	editModel: CalendarEventWhoModel

	/** stores settings that only become relevant once the event is saved, like sending updates. */
	saveModel: CalendarEventSaveModel

	/** these are needed to show suggestions and external passwords. */
	recipientsSearch: RecipientsSearchModel
	logins: LoginController
	mailboxDetail: MailboxDetail

	/** which parts of the editor are writable */
	disabled: boolean
	eventType: EventType
	isSharedCalendar: boolean
}

/**
 * an editor that can edit the attendees list of a calendar event with suggestions,
 * including the own attendance, the own organizer address and external passwords.
 */
export class AttendeeListEditor implements Component<AttendeeListEditorAttrs> {
	private text: string = ""
	private orderedBusinessFeature: boolean = false
	private externalPasswordVisibility: Map<string, boolean> = new Map()

	view({ attrs }: Vnode<AttendeeListEditorAttrs>): Children {
		return [m(".flex-grow", this.renderInvitationField(attrs)), m(".flex-grow", this.renderGuests(attrs))]
	}

	private renderInvitationField(attrs: AttendeeListEditorAttrs): Children {
		const { editModel, saveModel, recipientsSearch, disabled } = attrs
		if (disabled) {
			return "you can not manage the guest list because this event was not created in one of your personal calendars" //FIXME: translation key
		}
		return m(".flex.flex-column.flex-grow", [
			m(MailRecipientsTextField, {
				label: "addGuest_label",
				text: this.text,
				onTextChanged: (v) => (this.text = v),
				// we don't show bubbles, we just want the search dropdown
				recipients: [],
				disabled: false,
				onRecipientAdded: async (address, name, contact) => {
					if (!(this.orderedBusinessFeature || !saveModel.shouldShowSendInviteNotAvailable())) {
						//entity event updates are too slow to call updateBusinessFeature()
						this.orderedBusinessFeature = await showBusinessFeatureRequiredDialog("businessFeatureRequiredInvite_msg")
						if (!this.orderedBusinessFeature) return
					}
					editModel.addAttendee(address, contact)
				},
				// do nothing because we don't have any bubbles here
				onRecipientRemoved: noOp,
				injectionsRight: this.renderIsConfidentialToggle(attrs),
				search: recipientsSearch,
			}),
			this.renderSendUpdateCheckbox(attrs),
		])
	}

	private renderIsConfidentialToggle(attrs: AttendeeListEditorAttrs): Children {
		const { editModel } = attrs
		const guests = editModel.guests
		if (!guests.some((a) => a.type === RecipientType.EXTERNAL)) return null
		return m(ToggleButton, {
			title: editModel.isConfidential ? "confidential_action" : "nonConfidential_action",
			onToggled: (_, e) => {
				editModel.isConfidential = !editModel.isConfidential
				e.stopPropagation()
			},
			icon: editModel.isConfidential ? Icons.Lock : Icons.Unlock,
			toggled: editModel.isConfidential,
			size: ButtonSize.Compact,
		})
	}

	private renderSendUpdateCheckbox({ editModel, saveModel }: AttendeeListEditorAttrs): Children {
		return editModel.initiallyHadOtherAttendees
			? null
			: m(
					".mt-negative-s",
					m(Checkbox, {
						label: () => lang.get("sendUpdates_label"),
						onChecked: (v) => (saveModel.shouldSendUpdates = v),
						checked: saveModel.shouldSendUpdates,
					}),
			  )
	}

	/**
	 * render the list of guests, always putting the organizer on top, the own attendee after that and the rest last,
	 * followed by the external passwords.
	 * @private
	 */
	private renderGuests(attrs: AttendeeListEditorAttrs): Children {
		const { editModel, mailboxDetail, logins } = attrs
		const organizer = editModel.organizer
		const ownAttendee = editModel.ownGuest
		const ownGuest: Guest | null = ownAttendee && { ...editModel.ownGuest, type: RecipientType.INTERNAL }
		const guests: Array<Guest> = editModel.guests.slice()

		if (ownGuest) {
			guests.unshift(ownGuest)
		}

		if (organizer != null && guests.length > 0 && organizer.address !== ownGuest?.address) {
			guests.unshift(organizer)
		}

		const externalGuestPasswords = editModel.isConfidential
			? guests
					.filter((a) => a.type === RecipientType.EXTERNAL)
					.map((guest) => {
						const { address } = guest
						if (!editModel.getPresharedPassword(address)) editModel.setPresharedPassword(address, "")
						const { password, strength } = editModel.getPresharedPassword(address)
						return m(TextField, {
							value: password,
							autocompleteAs: Autocomplete.off,
							type: this.externalPasswordVisibility.get(address) === true ? TextFieldType.Text : TextFieldType.Password,
							label: () =>
								lang.get("passwordFor_label", {
									"{1}": guest.address,
								}),
							helpLabel: () => m(".mt-s", m(CompletenessIndicator, { percentageCompleted: strength })),
							key: address,
							oninput: (newValue) => editModel.setPresharedPassword(address, newValue),
							injectionsRight: () => this.renderRevealIcon(guest.address),
						})
					})
			: []

		return m("", [guests.map((guest, index) => renderGuest(attrs, guest, index)), externalGuestPasswords])
	}

	private renderRevealIcon(address: string): Children {
		return m(IconButton, {
			title: this.externalPasswordVisibility.get(address) === true ? "concealPassword_action" : "revealPassword_action",
			click: () => {
				this.externalPasswordVisibility.set(address, !this.externalPasswordVisibility.get(address))
			},
			icon: this.externalPasswordVisibility.get(address) === true ? Icons.NoEye : Icons.Eye,
			size: ButtonSize.Compact,
		})
	}

	private canSendInvites(userHasFeature: boolean): boolean {
		return this.orderedBusinessFeature || userHasFeature
	}
}

/**
 *
 * @param editModel the event to set the organizer on when a button in the dropdown is clicked
 * @param e
 */
function showOrganizerDropdown(editModel: CalendarEventWhoModel, e: MouseEvent) {
	const lazyButtons = () =>
		editModel.possibleOrganizers.map((organizer) => {
			return {
				label: () => organizer.address,
				click: () => editModel.addAttendee(organizer.address, null),
			}
		})

	createDropdown({ lazyButtons, width: 300 })(e, e.target as HTMLElement)
}

function renderGuest({ editModel, eventType, isSharedCalendar }: AttendeeListEditorAttrs, guest: Guest, index: number): Children {
	const { address, name, status } = guest
	const { organizer } = editModel
	const isOrganizer = organizer != null && organizer.address === editModel.ownGuest?.address
	// we don't want to offer editing the organizer if there's only one address to pick.
	const editableOrganizer = isOrganizer && editModel.possibleOrganizers.length > 1

	const fullName = m("div.text-ellipsis", { style: { lineHeight: px(24) } }, name.length > 0 ? `${name} ${address}` : address)
	const spacer = m(".flex-grow")
	const nameAndAddress = editableOrganizer
		? m(".flex.flex-grow.items-center.click", { onclick: (e: MouseEvent) => showOrganizerDropdown(editModel, e) }, [
				fullName,
				m(Icon, {
					icon: BootIcons.Expand,
					style: {
						fill: theme.content_fg,
					},
				}),
		  ])
		: m(".flex.flex-grow.items-center", fullName)

	const statusLine = m(".small.flex.center-vertically", [
		renderStatusIcon(status),
		lang.get(isOrganizer ? "organizer_label" : "guest_label") + (guest === editModel.ownGuest ? ` | ${lang.get("you_label")}` : ""),
	])

	return m(
		".flex",
		{
			style: {
				height: px(size.button_height),
				borderBottom: "1px transparent",
				marginTop: index === 0 && !canModifyGuests(isSharedCalendar, eventType) ? 0 : px(size.vpad),
			},
		},
		[
			m(".flex.col.flex-grow.overflow-hidden.flex-no-grow-shrink-auto", [nameAndAddress, statusLine]),
			spacer,
			[
				editModel.ownGuest === guest && canModifyOwnAttendance(eventType)
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
									editModel.setOwnAttendance(value)
								},
							}),
					  )
					: canModifyGuests(isSharedCalendar, eventType)
					? m(IconButton, {
							title: "remove_action",
							icon: Icons.Cancel,
							click: () => editModel.removeAttendee(guest.address),
					  })
					: null,
			],
		],
	)
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
