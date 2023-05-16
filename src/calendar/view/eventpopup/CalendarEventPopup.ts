import type { Shortcut } from "../../../misc/KeyManager.js"
import m, { Children } from "mithril"
import { px } from "../../../gui/size.js"
import { Button, ButtonColor, ButtonType } from "../../../gui/base/Button.js"
import { Icons } from "../../../gui/base/icons/Icons.js"
import type { ModalComponent } from "../../../gui/base/Modal.js"
import { modal } from "../../../gui/base/Modal.js"
import { EventPreviewView } from "../EventPreviewView.js"
import { Dialog } from "../../../gui/base/Dialog.js"
import { createAsyncDropdown, DROPDOWN_MARGIN, PosRect, showDropdown } from "../../../gui/base/Dropdown.js"
import { Keys } from "../../../api/common/TutanotaConstants.js"
import type { HtmlSanitizer } from "../../../misc/HtmlSanitizer.js"
import { prepareCalendarDescription } from "../../date/CalendarUtils.js"
import { BootIcons } from "../../../gui/base/icons/BootIcons.js"
import { IconButton } from "../../../gui/base/IconButton.js"
import { CalendarEventPopupViewModel } from "./CalendarEventPopupViewModel.js"
import { CalendarEvent, CalendarEventAttendee } from "../../../api/entities/tutanota/TypeRefs.js"
import { cleanMailAddress } from "../../../api/common/utils/CommonCalendarUtils.js"

export class CalendarEventPopup implements ModalComponent {
	private readonly _shortcuts: Shortcut[] = []
	private readonly sanitizedDescription: string
	private dom: HTMLElement | null = null

	/**
	 * @param model
	 * @param eventBubbleRect the rect where the event bubble was displayed that was clicked (if any)
	 * @param htmlSanitizer
	 */
	constructor(private readonly model: CalendarEventPopupViewModel, private readonly eventBubbleRect: PosRect, htmlSanitizer: HtmlSanitizer) {
		// We receive the HtmlSanitizer from outside and do the sanitization inside, so that we don't have to just assume it was already done
		this.sanitizedDescription = prepareCalendarDescription(
			model.calendarEvent.description,
			(s) =>
				htmlSanitizer.sanitizeHTML(s, {
					blockExternalContent: true,
				}).html,
		)

		this.setupShortcuts()
		this.view = this.view.bind(this)
	}

	private readonly handleDeleteButtonClick: (ev: MouseEvent, receiver: HTMLElement) => void = (ev: MouseEvent, receiver: HTMLElement) => {
		if (this.model.isRepeatingForDeleting) {
			createAsyncDropdown({
				lazyButtons: () =>
					Promise.resolve([
						{
							label: "deleteSingleEventRecurrence_action",
							click: async () => {
								await this.model.deleteSingle()
								this.close()
							},
						},
						{
							label: "deleteAllEventRecurrence_action",
							click: () => this.confirmDeleteClose(),
						},
					]),
				width: 300,
			})(ev, receiver)
		} else {
			// noinspection JSIgnoredPromiseFromCall
			this.confirmDeleteClose()
		}
	}

	private readonly handleEditButtonClick: (ev: MouseEvent, receiver: HTMLElement) => void = (ev: MouseEvent, receiver: HTMLElement) => {
		if (this.model.isRepeatingForEditing) {
			createAsyncDropdown({
				lazyButtons: () =>
					Promise.resolve([
						{
							label: "updateOneCalendarEvent_action",
							click: () => {
								this.model.editSingle()
								this.close()
							},
						},
						{
							label: "updateAllCalendarEvents_action",
							click: () => {
								this.model.editAll()
								this.close()
							},
						},
					]),
				width: 300,
			})(ev, receiver)
		} else {
			// noinspection JSIgnoredPromiseFromCall
			this.model.editAll()
			this.close()
		}
	}
	// we handle askForUpdates here to avoid making a request if not necessary
	private readonly handleSendUpdatesClick: () => void = () =>
		Dialog.confirm("sendUpdates_msg")
			.then(() => this.model.sendUpdates())
			.then(this.close)

	view(): Children {
		return m(
			".abs.elevated-bg.plr.border-radius.dropdown-shadow.flex.flex-column",
			{
				style: {
					// minus margin, need to apply it now to not overflow later
					width: px(Math.min(window.innerWidth - DROPDOWN_MARGIN * 2, 400)),
					// see hack description below
					opacity: "0",
					// because calendar event bubbles have 1px border, we want to align
					margin: "1px",
				},
				oncreate: (vnode) => {
					this.dom = vnode.dom as HTMLElement
					// This is a hack to get "natural" view size but render it without opacity first and then show dropdown with inferred
					// size.
					setTimeout(() => showDropdown(this.eventBubbleRect, this.dom!, this.dom!.offsetHeight, 400), 24)
				},
			},
			[
				m(".flex.flex-end", [this.renderSendUpdateButton(), this.renderEditButton(), this.renderDeleteButton(), this.renderCloseButton()]),
				m(".flex-grow.scroll.visible-scrollbar", [
					m(EventPreviewView, {
						event: this.model.calendarEvent,
						sanitizedDescription: this.sanitizedDescription,
						participation:
							this.model.ownAttendance != null
								? { status: this.model.ownAttendance, setParticipation: (status) => this.model.setOwnAttendance(status) }
								: null,
					}),
				]),
			],
		)
	}

	private renderEditButton(): Children {
		if (!this.model.canEdit) return null
		return m(IconButton, { title: "edit_action", icon: Icons.Edit, colors: ButtonColor.DrawerNav, click: this.handleEditButtonClick })
	}

	private renderDeleteButton(): Children {
		if (!this.model.canDelete) return null
		return m(IconButton, { title: "delete_action", icon: Icons.Trash, colors: ButtonColor.DrawerNav, click: this.handleDeleteButtonClick })
	}

	private renderSendUpdateButton(): Children {
		if (!this.model.canSendUpdates) return null
		return m(Button, {
			label: "sendUpdates_label",
			click: () => this.model.sendUpdates().then(this.close),
			type: ButtonType.ActionLarge,
			icon: () => BootIcons.Mail,
			colors: ButtonColor.DrawerNav,
		})
	}

	private renderCloseButton(): Children {
		return m(Button, {
			label: "close_alt",
			click: () => this.close(),
			type: ButtonType.ActionLarge,
			icon: () => Icons.Cancel,
			colors: ButtonColor.DrawerNav,
		})
	}

	show() {
		modal.display(this, false)
	}

	private close() {
		modal.remove(this)
	}

	backgroundClick(e: MouseEvent): void {
		modal.remove(this)
	}

	hideAnimation(): Promise<void> {
		return Promise.resolve()
	}

	onClose(): void {
		this.close()
	}

	shortcuts(): Shortcut[] {
		return this._shortcuts
	}

	popState(e: Event): boolean {
		modal.remove(this)
		return false
	}

	private setupShortcuts() {
		const close: Shortcut = {
			key: Keys.ESC,
			exec: () => this.close(),
			help: "close_alt",
		}
		const edit: Shortcut = {
			key: Keys.E,
			exec: () => this.handleEditButtonClick(new MouseEvent("click", {}), this.dom!),
			help: "edit_action",
		}
		const sendUpdates: Shortcut = {
			key: Keys.R,
			exec: this.handleSendUpdatesClick,
			help: "sendUpdates_label",
		}
		const remove: Shortcut = {
			key: Keys.DELETE,
			exec: () => this.handleDeleteButtonClick(new MouseEvent("click", {}), this.dom!),
			help: "delete_action",
		}

		this._shortcuts.push(close)

		if (this.model.canSendUpdates) {
			this._shortcuts.push(sendUpdates)
		}

		if (this.model.canEdit) {
			this._shortcuts.push(edit)
		}

		if (this.model.canDelete) {
			this._shortcuts.push(remove)
		}
	}

	private async confirmDeleteClose(): Promise<void> {
		if (!(await Dialog.confirm("deleteEventConfirmation_msg"))) return
		await this.model.deleteAll()
		this.close()
	}
}

export function getNonOrganizerAttendees({
	organizer,
	attendees,
}: Partial<Pick<Readonly<CalendarEvent>, "attendees" | "organizer">>): ReadonlyArray<CalendarEventAttendee> {
	if (attendees == null) return []
	if (organizer == null) return attendees
	const organizerAddress = cleanMailAddress(organizer.address)
	return attendees.filter((a) => cleanMailAddress(a.address.address) !== organizerAddress) ?? []
}
