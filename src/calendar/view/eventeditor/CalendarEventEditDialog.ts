import { Dialog } from "../../../gui/base/Dialog.js"
import { lang } from "../../../misc/LanguageViewModel.js"
import { ButtonType } from "../../../gui/base/Button.js"
import { AccountType, Keys, ShareCapability } from "../../../api/common/TutanotaConstants.js"
import { getStartOfTheWeekOffsetForUser, getTimeFormatForUser } from "../../date/CalendarUtils.js"
import { client } from "../../../misc/ClientDetector.js"
import { showProgressDialog } from "../../../gui/dialogs/ProgressDialog.js"
import { hasCapabilityOnGroup } from "../../../sharing/GroupUtils.js"
import type { DialogHeaderBarAttrs } from "../../../gui/base/DialogHeaderBar.js"
import type { CalendarInfo } from "../../model/CalendarModel.js"
import { assertNotNull, defer, getFirstOrThrow, noOp, Thunk } from "@tutao/tutanota-utils"
import { Dropdown, PosRect } from "../../../gui/base/Dropdown.js"
import { CalendarEvent, Mail } from "../../../api/entities/tutanota/TypeRefs.js"
import type { HtmlEditor } from "../../../gui/editor/HtmlEditor.js"
import { locator } from "../../../api/main/MainLocator.js"
import { CalendarEventEditModels, CalendarEventIdentity, EventType } from "../../model/eventeditor/CalendarEventEditModel.js"
import { User } from "../../../api/entities/sys/TypeRefs.js"
import { cleanMailAddress } from "../../../api/common/utils/CommonCalendarUtils.js"
import { CalendarEventEditView } from "./CalendarEventEditView.js"
import { modal } from "../../../gui/base/Modal.js"
import { askIfShouldSendCalendarUpdatesToAttendees } from "../CalendarGuiUtils.js"
import { UserError } from "../../../api/main/UserError.js"
import { showUserError } from "../../../misc/ErrorHandlerImpl.js"
import { BusinessFeatureRequiredError } from "../../../api/main/BusinessFeatureRequiredError.js"
import { showBusinessFeatureRequiredDialog } from "../../../misc/SubscriptionDialogs.js"
import { EventSaveResult } from "../../model/eventeditor/CalendarEventSaveModel.js"
import { ProgrammingError } from "../../../api/common/error/ProgrammingError.js"

/**
 * which parts of a calendar event series to apply an edit operation to.
 * consumers must take care to only use appropriate values for the operation
 * in question (ie removing a repeat rule from a single event in a series is nonsensical)
 */
export const enum CalendarEventEditMode {
	/** only apply the edit to only one particular instance of the series */
	This,
	/** edit the whole series */
	All,
	/** apply the edit to every instance from the edited one out */
	ThisAndFuture,
	/** don't apply the edit at all */
	Cancel,
}

type EditDialogOkHandler = (posRect: PosRect, editModels: CalendarEventEditModels, finish: Thunk) => Promise<unknown>

async function showCalendarEventEditDialog(editModels: CalendarEventEditModels, responseMail: Mail | null, handler: EditDialogOkHandler): Promise<void> {
	const recipientsSearch = await locator.recipientsSearchModel()
	const { HtmlEditor } = await import("../../../gui/editor/HtmlEditor.js")
	const groupColors: Map<Id, string> = locator.logins.getUserController().userSettingsGroupRoot.groupSettings.reduce((acc, gc) => {
		acc.set(gc.group, gc.color)
		return acc
	}, new Map())
	const descriptionEditor: HtmlEditor = new HtmlEditor("description_label")
		.setMinHeight(400)
		.showBorders()
		.setEnabled(true)
		// We only set it once, we don't viewModel on every change, that would be slow
		.setValue(editModels.description.content)
		.setToolbarOptions({
			alignmentEnabled: false,
			fontSizeEnabled: false,
		})
		.enableToolbar()

	const okAction = (dom: HTMLElement) => {
		editModels.description.content = descriptionEditor.getTrimmedValue()
		handler(dom.getBoundingClientRect(), editModels, () => dialog.close())
	}

	let headerDom: HTMLElement | null = null
	const dialogHeaderBarAttrs: DialogHeaderBarAttrs = {
		left: [
			{
				label: "cancel_action",
				click: () => dialog.close(),
				type: ButtonType.Secondary,
			},
		],
		middle: () => lang.get("createEvent_label"),
		right: [
			{
				label: "save_action",
				click: (event, dom) => okAction(dom),
				type: ButtonType.Primary,
			},
		],
		create: (dom) => {
			headerDom = dom
		},
	}

	const dialog: Dialog = Dialog.largeDialogN(dialogHeaderBarAttrs, CalendarEventEditView, {
		editModels,
		recipientsSearch,
		descriptionEditor,
		startOfTheWeekOffset: getStartOfTheWeekOffsetForUser(locator.logins.getUserController().userSettingsGroupRoot),
		timeFormat: getTimeFormatForUser(locator.logins.getUserController().userSettingsGroupRoot),
		groupColors,
	})
		.addShortcut({
			key: Keys.ESC,
			exec: () => dialog.close(),
			help: "close_alt",
		})
		.addShortcut({
			key: Keys.S,
			ctrl: true,
			exec: () => okAction(assertNotNull(headerDom, "headerDom was null")),
			help: "save_action",
		})

	if (client.isMobileDevice()) {
		// Prevent focusing text field automatically on mobile. It opens keyboard and you don't see all details.
		dialog.setFocusOnLoadFunction(noOp)
	}
	dialog.show()
}

export async function showNewCalendarEventEditDialog(models: CalendarEventEditModels): Promise<void> {
	let finished = false

	const okAction: EditDialogOkHandler = async (posRect, editModels, finish) => {
		if (finished) {
			console.log("already finished, will not be saving new event")
			return
		}

		if (editModels.whoModel.hasInsecurePasswords() && !(await Dialog.confirm("presharedPasswordNotStrongEnough_msg"))) {
			console.log("not saving event: insecure passwords.")
			return
		}
		try {
			const result = await editModels.saveModel.saveNewEvent(editModels)
			if (result === EventSaveResult.Saved) {
				finished = true
				finish()
			}
		} catch (e) {
			if (e instanceof UserError) {
				// noinspection ES6MissingAwait
				showUserError(e)
			} else if (e instanceof BusinessFeatureRequiredError) {
				editModels.saveModel.hasBusinessFeature = await showBusinessFeatureRequiredDialog(() => e.message)
			} else {
				throw e
			}
		}
	}
	return showCalendarEventEditDialog(models, null, okAction)
}

/**
 * show a dialog that allows to edit a calendar event
 * @param models
 * @param identity
 * @param responseMail a mail containing an invite and/or update for this event?
 */
export async function showExistingCalendarEventEditDialog(
	models: CalendarEventEditModels,
	identity: CalendarEventIdentity,
	responseMail: Mail | null = null,
): Promise<void> {
	let finished = false

	if (identity.uid == null) {
		throw new ProgrammingError("tried to edit existing event without uid, this is impossible for certain edit operations.")
	}

	const okAction: EditDialogOkHandler = async (posRect, editModels, finish) => {
		if (finished) {
			return
		}

		if (editModels.whoModel.initiallyHadOtherAttendees && !editModels.saveModel.shouldSendUpdates) {
			switch (await askIfShouldSendCalendarUpdatesToAttendees()) {
				case "yes":
					editModels.saveModel.shouldSendUpdates = true
					break
				case "no":
					break
				case "cancel":
					return
			}
		}

		if (editModels.whoModel.hasInsecurePasswords() && !(await Dialog.confirm("presharedPasswordNotStrongEnough_msg"))) {
			// no insecure passwords or the user confirmed that insecure passwords are OK
			return
		}

		try {
			const result = await editModels.saveModel.updateExistingEvent(editModels)
			if (result === EventSaveResult.Saved) {
				finished = true
				finish()
			}
		} catch (e) {
			if (e instanceof UserError) {
				// noinspection ES6MissingAwait
				showUserError(e)
			} else if (e instanceof BusinessFeatureRequiredError) {
				editModels.saveModel.hasBusinessFeature = await showBusinessFeatureRequiredDialog(() => e.message)
			} else {
				throw e
			}
		}
	}
	await showCalendarEventEditDialog(models, responseMail, okAction)
}

async function promptForEditMode(posRect: PosRect): Promise<CalendarEventEditMode> {
	const deferred = defer<CalendarEventEditMode>()
	const dropdown = new Dropdown(
		() => [
			{
				label: "updateOneCalendarEvent_action",
				click: () => deferred.resolve(CalendarEventEditMode.This),
			},
			{
				label: "updateAllCalendarEvents_action",
				click: () => deferred.resolve(CalendarEventEditMode.All),
			},
		],
		300,
	)
		.setCloseHandler(() => {
			deferred.resolve(CalendarEventEditMode.Cancel)
			dropdown.close()
		})
		.setOrigin(posRect)
	modal.displayUnique(dropdown, false)
	return deferred.promise
}

/**
 * return the calendar the given event belongs to, if any, otherwise get the first one from the given calendars.
 * @param calendars must contain at least one calendar
 * @param event
 */
export function getPreselectedCalendar(calendars: ReadonlyMap<Id, CalendarInfo>, event?: Partial<CalendarEvent> | null): CalendarInfo {
	const ownerGroup: string | null = event?._ownerGroup ?? null
	if (ownerGroup == null || !calendars.has(ownerGroup)) {
		return getFirstOrThrow(Array.from(calendars.values()))
	} else {
		return assertNotNull(calendars.get(ownerGroup), "invalid ownergroup for existing event?")
	}
}

function showProgress(p: Promise<unknown>) {
	// We get all errors in main promise, we don't need to handle them here
	return showProgressDialog("pleaseWait_msg", p).catch(noOp)
}

/**
 *  find out how we ended up with this event, which determines the capabilities we have with it.
 *  for shared events in calendar where we have read-write access, we can still only view events that have
 *  attendees, because we could not send updates after we edit something
 * @param existingEvent the event in question.
 * @param calendars a list of calendars that this user has access to.
 * @param ownMailAddresses the list of mail addresses this user might be using.
 * @param user the user accessing the event.
 */
export function getEventType(
	existingEvent: Partial<CalendarEvent>,
	calendars: ReadonlyMap<Id, CalendarInfo>,
	ownMailAddresses: ReadonlyArray<string>,
	user: User,
): EventType {
	if (user.accountType === AccountType.EXTERNAL) {
		return EventType.EXTERNAL
	}

	const existingOrganizer = existingEvent.organizer
	const isOrganizer = existingOrganizer != null && ownMailAddresses.some((a) => cleanMailAddress(a) === existingOrganizer.address)

	if (existingEvent._ownerGroup == null) {
		if (existingOrganizer != null && !isOrganizer) {
			// OwnerGroup is not set for events from file, but we also require an organizer to treat it as an invite.
			return EventType.INVITE
		} else {
			// either the organizer exists and it's us, or the organizer does not exist and we can treat this as our event,
			// like for newly created events.
			return EventType.OWN
		}
	}

	const calendarInfoForEvent = calendars.get(existingEvent._ownerGroup) ?? null

	if (calendarInfoForEvent == null) {
		// event has an ownergroup, but it's not in one of our calendars. this might actually be an error.
		return EventType.INVITE
	}

	if (calendarInfoForEvent.shared) {
		const canWrite = hasCapabilityOnGroup(user, calendarInfoForEvent.group, ShareCapability.Write)
		if (canWrite) {
			const organizerAddress = cleanMailAddress(existingOrganizer?.address ?? "")
			const wouldRequireUpdates: boolean =
				existingEvent.attendees != null && existingEvent.attendees.filter((a) => cleanMailAddress(a.address.address) !== organizerAddress).length > 0
			return wouldRequireUpdates ? EventType.LOCKED : EventType.SHARED_RW
		} else {
			return EventType.SHARED_RO
		}
	}

	//For an event in a personal calendar there are 3 options
	if (existingOrganizer == null || existingEvent.attendees?.length === 0 || isOrganizer) {
		// 1. we are the organizer of the event or the event does not have an organizer yet
		// 2. we are not the organizer and the event does not have guests. it was created by someone we shared our calendar with (also considered our own event)
		return EventType.OWN
	} else {
		// 3. the event is an invitation that has another organizer and/or attendees.
		return EventType.INVITE
	}
}
