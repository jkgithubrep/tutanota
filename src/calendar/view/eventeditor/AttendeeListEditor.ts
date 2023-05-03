import m, { Children, Component, Vnode } from "mithril"
import { CalendarEventEditModel } from "../../date/CalendarEventEditModel.js"
import { MailRecipientsTextField } from "../../../gui/MailRecipientsTextField.js"
import { showBusinessFeatureRequiredDialog } from "../../../misc/SubscriptionDialogs.js"
import { RecipientType } from "../../../api/common/recipients/Recipient.js"
import { ToggleButton } from "../../../gui/base/ToggleButton.js"
import { Icons } from "../../../gui/base/icons/Icons.js"
import { ButtonSize } from "../../../gui/base/ButtonSize.js"
import { Checkbox } from "../../../gui/base/Checkbox.js"
import { lang } from "../../../misc/LanguageViewModel.js"
import { createEncryptedMailAddress } from "../../../api/entities/tutanota/TypeRefs.js"
import { findAttendeeInAddresses } from "../../../api/common/utils/CommonCalendarUtils.js"
import { CalendarAttendeeStatus } from "../../../api/common/TutanotaConstants.js"
import { Autocomplete, TextField, TextFieldType } from "../../../gui/base/TextField.js"
import { CompletenessIndicator } from "../../../gui/CompletenessIndicator.js"
import { RecipientsSearchModel } from "../../../misc/RecipientsSearchModel.js"
import { noOp } from "@tutao/tutanota-utils"
import { RecipientsModel, ResolveMode } from "../../../api/main/RecipientsModel.js"
import { Guest } from "../../date/CalendarInvites.js"

export type AttendeeListEditorAttrs = {
	/** the event that is currently being edited */
	editModel: CalendarEventEditModel

	/** these are needed to show suggestions and external passwords. */
	recipientsSearch: RecipientsSearchModel
	recipientsModel: RecipientsModel

	/** whether the editor is read-only */
	disabled: boolean

	/** whether this user had the business feature when the editor was created. needed to show the upgrade dialog and distinct from disabled. */
	hasBusinessFeature: boolean

	/** whether external recipients need to get a pre-shared password */
	isConfidential: boolean
	onConfidentialChanged: (isConfidential: boolean) => unknown

	/** whether attendees will get update mail when the event is saved */
	shouldSendUpdates: boolean
	onShouldSendUpdatesChanged: (shouldSendUpdates: boolean) => unknown
}

/**
 * an editor that can edit the attendees list of a calendar event.
 */
export class AttendeeListEditor implements Component<AttendeeListEditorAttrs> {
	private text: string = ""
	private orderedBusinessFeature: boolean = false
	/** we only show the send update checkbox if there are attendees that require updates. */
	private readonly initiallyHadNoOtherAttendees: boolean
	/** a map that stores which recipients are of which type */
	private resolvedRecipients: Map<string, RecipientType> = new Map()
	/** whether to reveal the password for an external attendee with an address */
	private readonly isPasswordRevealed: Map<string, boolean> = new Map()

	constructor(vnode: Vnode<AttendeeListEditorAttrs>) {
		// editModel.attendees does not include us or the organizer - these don't get updates from us anyway.
		this.initiallyHadNoOtherAttendees = vnode.attrs.editModel.attendees.length === 0
	}

	view({ attrs }: Vnode<AttendeeListEditorAttrs>): Children {
		return null //[m(".flex-grow", this.renderInvitationField(attrs)), m(".flex-grow", this.renderAttendees(attrs))]
	}

	private renderInvitationField(attrs: AttendeeListEditorAttrs): Children {
		const { editModel, hasBusinessFeature, recipientsSearch } = attrs
		return m(".flex.flex-column.flex-grow", [
			m(MailRecipientsTextField, {
				label: "addGuest_label",
				text: this.text,
				onTextChanged: (v) => (this.text = v),
				// we don't show bubbles, we just want the search dropdown
				recipients: [],
				disabled: false,
				onRecipientAdded: async (address, name, contact) => {
					if (!this.canSendInvites(hasBusinessFeature)) {
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
		const { editModel, isConfidential, onConfidentialChanged } = attrs
		if (!editModel.attendees.some((a) => true /**a.type === RecipientType.EXTERNAL*/)) return null
		return m(ToggleButton, {
			title: isConfidential ? "confidential_action" : "nonConfidential_action",
			onToggled: (_, e) => {
				onConfidentialChanged(!isConfidential)
				e.stopPropagation()
			},
			icon: isConfidential ? Icons.Lock : Icons.Unlock,
			toggled: isConfidential,
			size: ButtonSize.Compact,
		})
	}

	private renderSendUpdateCheckbox({ shouldSendUpdates, onShouldSendUpdatesChanged }: AttendeeListEditorAttrs): Children {
		return this.initiallyHadNoOtherAttendees
			? null
			: m(
					".mt-negative-s",
					m(Checkbox, {
						label: () => lang.get("sendUpdates_label"),
						onChecked: onShouldSendUpdatesChanged,
						checked: shouldSendUpdates,
					}),
			  )
	}

	// private renderAttendees(attrs: AttendeeListEditorAttrs): Children {
	// 	const { editModel } = attrs
	// 	const ownAttendee = editModel.ownAttendee
	// 	const ownGuest: Guest | null = ownAttendee && { ...editModel.ownAttendee, type: RecipientType.INTERNAL }
	// 	const guests: Array<Guest> = editModel.attendees.slice()
	//
	//
	// 	const organizer = editModel.organizer
	//
	// 	if (organizer != null && guests.length > 0 && !findAttendeeInAddresses(guests, [organizer.address.address])) {
	// 		// FIXME: this should be an array of Guests.
	// 		guests.unshift({
	// 			address: createEncryptedMailAddress(organizer.address),
	// 			// Events created by Tutanota will always have the organizer in the attendee list
	// 			type: RecipientType.EXTERNAL,
	// 			// We don't know whether the organizer will be attending or not in this case - the ORGANIZER field in ical does not specify.
	// 			status: CalendarAttendeeStatus.ADDED,
	// 		})
	// 	}
	//
	// 	if (ownGuest) {
	// 		guests.unshift(ownGuest)
	// 	}
	//
	// 	const externalGuests = attrs.isConfidential
	// 		? guests
	// 				.filter((a) => a.type === RecipientType.EXTERNAL)
	// 				.map((guest) => {
	// 					if (!this.isPasswordRevealed.has(guest.address.address)) this.isPasswordRevealed.set(guest.address.address, false)
	//
	// 					attrs.recipientsModel.resolve(guest, ResolveMode.Eager)
	//
	// 					return m(TextField, {
	// 						value: editModel.getGuestPassword(guest),
	// 						autocompleteAs: Autocomplete.off,
	// 						type: guestShowConfidential.get(guest.address.address) ? TextFieldType.Text : TextFieldType.Password,
	// 						label: () =>
	// 							lang.get("passwordFor_label", {
	// 								"{1}": guest.address.address,
	// 							}),
	// 						helpLabel: () => m(".mt-s", m(CompletenessIndicator, { percentageCompleted: viewModel.getPasswordStrength(guest) })),
	// 						key: guest.address.address,
	// 						oninput: (newValue) => viewModel.updatePassword(guest, newValue),
	// 						injectionsRight: () => renderRevealIcon(guest.address.address),
	// 					})
	// 				})
	// 		: []
	// 	return m("", [guests.map((guest, index) => renderGuest(guest, index, viewModel, guest)), externalGuests])
	// }

	private canSendInvites(userHasFeature: boolean): boolean {
		return this.orderedBusinessFeature || userHasFeature
	}
}
