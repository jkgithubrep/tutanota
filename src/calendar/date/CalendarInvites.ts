import { parseCalendarFile } from "../export/CalendarImporter"
import type { CalendarEvent, CalendarEventAttendee, File as TutanotaFile, Mail } from "../../api/entities/tutanota/TypeRefs.js"
import { locator } from "../../api/main/MainLocator"
import { CalendarAttendeeStatus, CalendarMethod, FeatureType, getAsEnumValue } from "../../api/common/TutanotaConstants"
import { assertNotNull, clone, filterInt, lazy, noOp, ofClass } from "@tutao/tutanota-utils"
import { findPrivateCalendar, getTimeZone } from "./CalendarUtils"
import { calendarUpdateDistributor } from "./CalendarUpdateDistributor"
import { Dialog } from "../../gui/base/Dialog"
import { UserError } from "../../api/main/UserError"
import { NoopProgressMonitor } from "../../api/common/utils/ProgressMonitor"
import { DataFile } from "../../api/common/DataFile"
import { findAttendeeInAddresses } from "../../api/common/utils/CommonCalendarUtils.js"
import { Recipient } from "../../api/common/recipients/Recipient.js"
import { getEventType } from "../view/eventeditor/CalendarEventEditDialog.js"
import { CalendarEventEditModels, EventType } from "../model/eventeditor/CalendarEventEditModel.js"
import { isCustomizationEnabledForCustomer } from "../../api/common/utils/Utils.js"

export type Guest = Pick<CalendarEventAttendee, "status"> & Recipient & { status: CalendarAttendeeStatus }

function getParsedEvent(fileData: DataFile):
	| {
			method: CalendarMethod
			event: CalendarEvent
			uid: string
	  }
	| null
	| undefined {
	try {
		const { contents, method } = parseCalendarFile(fileData)
		const verifiedMethod = getAsEnumValue(CalendarMethod, method) || CalendarMethod.PUBLISH
		const parsedEventWithAlarms = contents[0]

		if (parsedEventWithAlarms && parsedEventWithAlarms.event.uid) {
			return {
				event: parsedEventWithAlarms.event,
				uid: parsedEventWithAlarms.event.uid,
				method: verifiedMethod,
			}
		} else {
			return null
		}
	} catch (e) {
		console.log(e)
		return null
	}
}

export async function showEventDetails(event: CalendarEvent, eventBubbleRect: ClientRect, mail: Mail | null): Promise<void> {
	const [latestEvent, { CalendarEventPopup }, { CalendarEventPopupViewModel }, { htmlSanitizer }] = await Promise.all([
		getLatestEvent(event),
		import("../view/eventpopup/CalendarEventPopup.js"),
		import("../view/eventpopup/CalendarEventPopupViewModel.js"),
		import("../../misc/HtmlSanitizer"),
	])

	let eventType: EventType
	let editModelsFactory: lazy<Promise<CalendarEventEditModels>>
	let hasBusinessFeature: boolean
	let ownAttendance = null
	if (!locator.logins.getUserController().isInternalUser()) {
		// external users cannot delete/edit events as they have no calendar.
		eventType = EventType.EXTERNAL
		editModelsFactory = () => new Promise(noOp)
		hasBusinessFeature = false
	} else {
		const [calendarInfos, mailboxDetails, customer] = await Promise.all([
			locator.calendarModel.loadOrCreateCalendarInfo(new NoopProgressMonitor()),
			locator.mailModel.getUserMailboxDetails(),
			locator.logins.getUserController().loadCustomer(),
		])
		const mailboxProperties = await locator.mailModel.getMailboxProperties(mailboxDetails.mailboxGroupRoot)
		const ownMailAddresses = mailboxProperties.mailAddressProperties.map(({ mailAddress }) => mailAddress)
		ownAttendance = (findAttendeeInAddresses(latestEvent.attendees, ownMailAddresses)?.status as CalendarAttendeeStatus) ?? null
		eventType = getEventType(latestEvent, calendarInfos, ownMailAddresses, locator.logins.getUserController().user)
		editModelsFactory = () => locator.calendarEventEditModels(latestEvent, mailboxDetails, mailboxProperties)
		hasBusinessFeature = isCustomizationEnabledForCustomer(customer, FeatureType.BusinessFeatureEnabled)
	}

	const viewModel = new CalendarEventPopupViewModel(latestEvent, locator.calendarModel, eventType, hasBusinessFeature, ownAttendance, editModelsFactory)
	new CalendarEventPopup(viewModel, eventBubbleRect, htmlSanitizer).show()
}

export async function getEventFromFile(file: TutanotaFile): Promise<CalendarEvent | null> {
	const dataFile = await locator.fileController.getAsDataFile(file)
	const parsedEvent = getParsedEvent(dataFile)
	return parsedEvent?.event ?? null
}

/**
 * Returns the latest version for the given event by uid. If the event is not in
 * any calendar (because it has not been stored yet, e.g. in case of invite)
 * the given event is returned.
 */
export async function getLatestEvent(event: CalendarEvent): Promise<CalendarEvent> {
	const uid = event.uid
	if (uid == null) return event
	const existingEvent = await locator.calendarFacade.getEventByUid(uid)
	if (existingEvent == null) return event
	// If the file we are opening is newer than the one which we have on the server, update server version.
	// Should not happen normally but can happen when e.g. reply and update were sent one after another before we accepted
	// the invite. Then accepting first invite and then opening update should give us updated version.
	if (filterInt(existingEvent.sequence) < filterInt(event.sequence)) {
		return await locator.calendarModel.updateEventWithExternal(existingEvent, event)
	} else {
		return existingEvent
	}
}

/**
 * Sends a quick reply for the given event and saves the event to the first private calendar.
 */
export async function replyToEventInvitation(
	event: CalendarEvent,
	attendee: CalendarEventAttendee,
	decision: CalendarAttendeeStatus,
	previousMail: Mail,
): Promise<void> {
	const eventClone = clone(event)
	const foundAttendee = assertNotNull(findAttendeeInAddresses(eventClone.attendees, [attendee.address.address]), "attendee was not found in event clone")
	foundAttendee.status = decision
	return Promise.all([
		locator.calendarModel.loadOrCreateCalendarInfo(new NoopProgressMonitor()).then(findPrivateCalendar),
		locator.mailModel.getMailboxDetailsForMail(previousMail),
	]).then(async ([calendar, mailboxDetails]) => {
		if (mailboxDetails == null) {
			return
		}
		const mailboxProperties = await locator.mailModel.getMailboxProperties(mailboxDetails.mailboxGroupRoot)
		const responseModel = await locator.sendMailModel(mailboxDetails, mailboxProperties)
		return calendarUpdateDistributor
			.sendResponse(eventClone, responseModel, previousMail)
			.catch(ofClass(UserError, (e) => Dialog.message(() => e.message)))
			.then(() => {
				if (calendar) {
					// if the owner group is set there is an existing event already so just update
					if (event._ownerGroup) {
						return locator.calendarModel.loadAlarms(event.alarmInfos, locator.logins.getUserController().user).then((alarms) => {
							const alarmInfos = alarms.map((a) => a.alarmInfo)
							return locator.calendarModel.updateEvent(eventClone, alarmInfos, getTimeZone(), calendar.groupRoot, event).then(noOp)
						})
					} else {
						if (decision !== CalendarAttendeeStatus.DECLINED) {
							return locator.calendarModel.createEvent(eventClone, [], getTimeZone(), calendar.groupRoot)
						}
					}
				}
				return Promise.resolve()
			})
	})
}
