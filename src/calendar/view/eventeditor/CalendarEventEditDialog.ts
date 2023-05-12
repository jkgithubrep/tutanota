import { Dialog } from "../../../gui/base/Dialog.js"
import { lang } from "../../../misc/LanguageViewModel.js"
import { ButtonType } from "../../../gui/base/Button.js"
import { AccountType, Keys, ShareCapability } from "../../../api/common/TutanotaConstants.js"
import { generateUid, getStartOfTheWeekOffsetForUser, getTimeFormatForUser } from "../../date/CalendarUtils.js"
import { client } from "../../../misc/ClientDetector.js"
import type { MailboxDetail } from "../../../mail/model/MailModel.js"
import { showProgressDialog } from "../../../gui/dialogs/ProgressDialog.js"
import { hasCapabilityOnGroup } from "../../../sharing/GroupUtils.js"
import type { DialogHeaderBarAttrs } from "../../../gui/base/DialogHeaderBar.js"
import type { CalendarInfo } from "../../model/CalendarModel.js"
import { assertNotNull, defer, getFirstOrThrow, noOp, Thunk } from "@tutao/tutanota-utils"
import { Dropdown, PosRect } from "../../../gui/base/Dropdown.js"
import { CalendarEvent, Mail } from "../../../api/entities/tutanota/TypeRefs.js"
import type { HtmlEditor } from "../../../gui/editor/HtmlEditor.js"
import { locator } from "../../../api/main/MainLocator.js"
import { assembleCalendarEventEditResult, assignEventIdentity, CalendarEventEditModels, EventType } from "../../model/eventeditor/CalendarEventEditModel.js"
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
import { getEnabledMailAddressesWithUser } from "../../../mail/model/MailUtils.js"

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

async function showCalendarEventEditDialog(
	{ saveModel, ...editModels }: CalendarEventEditModels,
	eventType: EventType,
	mailboxDetail: MailboxDetail,
	responseMail: Mail | null,
	handler: EditDialogOkHandler,
): Promise<void> {
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
		handler(dom.getBoundingClientRect(), { saveModel, ...editModels }, () => dialog.close())
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
		saveModel,
		eventType,
		recipientsSearch,
		descriptionEditor,
		startOfTheWeekOffset: getStartOfTheWeekOffsetForUser(locator.logins.getUserController().userSettingsGroupRoot),
		timeFormat: getTimeFormatForUser(locator.logins.getUserController().userSettingsGroupRoot),
		groupColors,
		mailboxDetail,
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

export async function showNewCalendarEventEditDialog(models: CalendarEventEditModels, mailboxDetail: MailboxDetail): Promise<void> {
	let finished = false

	const okAction: EditDialogOkHandler = async (posRect, { saveModel, ...editModels }, finish) => {
		if (finished) {
			console.log("already finished, will not be saving new event")
			return
		}

		if (editModels.whoModel.hasInsecurePasswords() && !(await Dialog.confirm("presharedPasswordNotStrongEnough_msg"))) {
			console.log("not saving event: insecure passwords.")
			return
		}
		const uid = generateUid(assertNotNull(saveModel.selectedCalendar?.group._id, "selected calendar for new event was null."), Date.now())
		const { eventValues, alarms, sendModels } = assembleCalendarEventEditResult({ saveModel, ...editModels })
		const event = assignEventIdentity(eventValues, { uid })
		try {
			const result = await saveModel.saveNewEvent(event, alarms, sendModels.inviteModel)
			if (result === EventSaveResult.Saved) {
				finished = true
				finish()
			}
		} catch (e) {
			if (e instanceof UserError) {
				// noinspection ES6MissingAwait
				showUserError(e)
			} else if (e instanceof BusinessFeatureRequiredError) {
				saveModel.hasBusinessFeature = await showBusinessFeatureRequiredDialog(() => e.message)
			} else {
				throw e
			}
		}
	}
	return showCalendarEventEditDialog(models, EventType.OWN, mailboxDetail, null, okAction)
}

/**
 * show a dialog that allows to edit a calendar event
 * @param models
 * @param mailboxDetail
 * @param responseMail a mail containing an invite and/or update for this event?
 */
export async function showExistingCalendarEventEditDialog(
	models: CalendarEventEditModels,
	mailboxDetail: MailboxDetail,
	responseMail: Mail | null = null,
): Promise<void> {
	let finished = false
	const userController = locator.logins.getUserController()
	const ownMailAddresses = getEnabledMailAddressesWithUser(mailboxDetail, userController.userGroupInfo)
	const eventType = getEventType(existingEvent, calendars, ownMailAddresses, userController.user)
	const uid = existingEvent.uid

	if (uid == null) {
		throw new ProgrammingError("tried to edit existing event without uid, this is impossible for certain edit operations.")
	}

	if (isReadOnlyEvent(eventType, existingEvent)) {
		throw new ProgrammingError("tried to open editor for read-only event.")
	}

	const okAction: EditDialogOkHandler = async (posRect, { saveModel, ...editModels }, finish) => {
		if (finished) {
			return
		}

		if (!saveModel.shouldSendUpdates) {
			switch (await askIfShouldSendCalendarUpdatesToAttendees()) {
				case "yes":
					saveModel.shouldSendUpdates = true
					break
				case "no":
					break
				case "cancel":
					return
			}
		}

		if (!(editModels.whoModel.hasInsecurePasswords() && (await Dialog.confirm("presharedPasswordNotStrongEnough_msg")))) {
			return
		}

		const { eventValues, alarms, sendModels } = assembleCalendarEventEditResult({ saveModel, ...editModels })
		const newEvent = assignEventIdentity(eventValues, { uid, sequence: existingEvent.sequence })

		/** we need to ask this only if the event already exists and has a repeat rule which it had before */
		if (existingEvent.repeatRule != null && newEvent.repeatRule != null) {
			const editType = await promptForEditMode(posRect)
			if (editType === CalendarEventEditMode.This) {
				await editModels.whenModel.excludeThisOccurrence()
			} else if (editType === CalendarEventEditMode.Cancel) {
				return
			}
		}

		try {
			const result = await saveModel.updateExistingEvent(newEvent, alarms, sendModels)
			if (result === EventSaveResult.Saved) {
				finished = true
				finish()
			}
		} catch (e) {
			if (e instanceof UserError) {
				// noinspection ES6MissingAwait
				showUserError(e)
			} else if (e instanceof BusinessFeatureRequiredError) {
				saveModel.hasBusinessFeature = await showBusinessFeatureRequiredDialog(() => e.message)
			} else {
				throw e
			}
		}
	}
	await showCalendarEventEditDialog(models, eventType, mailboxDetail, responseMail, okAction)
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
 *  for shared events in calendar where we have read-write access, we can still only view events that have attendees (because we could not send updates)
 * @param existingEvent the event in question.
 * @param calendars a list of calendars that this user has access to.
 * @param ownMailAddresses the list of mail addresses this user might be using.
 * @param user the user accessing the event.
 */
export function getEventType(
	existingEvent: Partial<CalendarEvent> | null,
	calendars: ReadonlyMap<Id, CalendarInfo>,
	ownMailAddresses: ReadonlyArray<string>,
	user: User,
): EventType {
	if (existingEvent == null) {
		return EventType.OWN
	}

	if (user.accountType === AccountType.EXTERNAL) {
		return EventType.EXTERNAL
	}

	const calendarInfoForEvent = existingEvent._ownerGroup == null ? null : calendars.get(existingEvent._ownerGroup) ?? null
	// OwnerGroup is not set for events from file
	if (calendarInfoForEvent == null) {
		return EventType.INVITE
	}

	const existingOrganizer = existingEvent.organizer

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
	if (existingOrganizer == null || existingEvent.attendees?.length === 0 || ownMailAddresses.some((a) => cleanMailAddress(a) === existingOrganizer.address)) {
		// 1. we are the organizer of the event or the event does not have an organizer yet
		// 2. we are not the organizer and the event does not have guests. it was created by someone we shared our calendar with (also considered our own event)
		return EventType.OWN
	} else {
		// 3. the event is an invitation that has another organizer and/or attendees.
		return EventType.INVITE
	}
}

export function isReadOnlyEvent(eventType: EventType, event: Partial<CalendarEvent>): boolean {
	// For the RW calendar we have two similar cases:
	//
	// Case 1:
	// Owner of the calendar created the event and invited some people. We, user with whom calendar was shared as RW, are seeing this event.
	// We cannot modify that event even though we have RW permission because the update must be sent out and we cannot do that because
	// we are not the organizer.
	//
	// Case 2:
	// Owner of the calendar received an invite and saved the event to the calendar. We, user with whom the calendar was shared as RW, are seeing this event.
	// We can (theoretically) modify the event locally because we don't need to send any updates but we cannot change attendance because this would
	// require sending an email. But we don't want to allow editing the event to make it more understandable for everyone.
	const organizerAddress = cleanMailAddress(event?.organizer?.address ?? "")
	const requiresUpdates = (event?.attendees?.filter((a) => cleanMailAddress(a.address.address) !== organizerAddress).length ?? 0) > 0
	return eventType === EventType.SHARED_RO || (eventType === EventType.SHARED_RW && requiresUpdates)
}
