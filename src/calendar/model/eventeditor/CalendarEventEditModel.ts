import { CalendarEvent, createCalendarEvent, createEncryptedMailAddress, MailboxProperties } from "../../../api/entities/tutanota/TypeRefs.js"
import { AlarmInterval } from "../../../api/common/TutanotaConstants.js"
import { getTimeZone } from "../../date/CalendarUtils.js"
import { getStrippedClone, Stripped } from "../../../api/common/utils/EntityUtils.js"
import { CalendarEventWhenModel } from "./CalendarEventWhenModel.js"
import { SanitizedTextViewModel } from "./SanitizedTextViewModel.js"
import { CalendarEventAlarmModel } from "./CalendarEventAlarmModel.js"
import { CalendarEventWhoModel } from "./CalendarEventWhoModel.js"
import { RecipientsModel } from "../../../api/main/RecipientsModel.js"
import { AlarmInfo, User } from "../../../api/entities/sys/TypeRefs.js"
import { CalendarInfo, CalendarModel } from "../CalendarModel.js"
import { getPasswordStrengthForUser } from "../../../misc/passwords/PasswordUtils.js"
import { PartialRecipient } from "../../../api/common/recipients/Recipient.js"
import { LoginController } from "../../../api/main/LoginController.js"
import { MailboxDetail } from "../../../mail/model/MailModel.js"
import { CalendarEventSaveModel } from "./CalendarEventSaveModel.js"
import { SendMailModel } from "../../../mail/editor/SendMailModel.js"
import { lazy, noOp } from "@tutao/tutanota-utils"
import { CalendarUpdateDistributor } from "../../date/CalendarUpdateDistributor.js"
import { EntityClient } from "../../../api/common/EntityClient.js"
import { NoopProgressMonitor } from "../../../api/common/utils/ProgressMonitor.js"
import m from "mithril"
import { getEventType } from "../../view/eventeditor/CalendarEventEditDialog.js"
import { Require } from "@tutao/tutanota-utils/dist/Utils.js"

export const enum EventType {
	/** event in our own calendar and we are organizer */
	OWN = "own",
	/** event in shared calendar with read permission */
	SHARED_RO = "shared_ro",
	/** event in shared calendar with write permission, that has no attendees */
	SHARED_RW = "shared_rw",
	/** shared with write permissions, but we can't edit it because it has attendees. */
	LOCKED = "locked",
	/** invite from calendar invitation which is not stored in calendar yet, or event stored and we are not organizer */
	INVITE = "invite",
	/** we are an external user and see an event in our mailbox */
	EXTERNAL = "external",
}

export type CalendarEventEditModels = {
	saveModel: CalendarEventSaveModel
	whenModel: CalendarEventWhenModel
	whoModel: CalendarEventWhoModel
	alarmModel: CalendarEventAlarmModel
	location: SanitizedTextViewModel
	summary: SanitizedTextViewModel
	description: SanitizedTextViewModel
}

type EventIdentityFieldNames = "recurrenceId" | "uid" | "sequence"

/**
 * complete calendar event except the parts that define the identity of the event instance (in ical terms) and the technical fields.
 * when the excluded fields are added, this type can be used to set up a series, update a series or reschedule an instance of a series
 */
export type CalendarEventValues = Omit<Stripped<CalendarEvent>, EventIdentityFieldNames | "hashedUid">

/**
 * the parts of a calendar event that define the identity of the event instance.
 */
export type CalendarEventIdentity = Pick<Stripped<CalendarEvent>, EventIdentityFieldNames>

export type CalendarEventUpdateNotificationModels = {
	inviteModel: SendMailModel | null
	updateModel: SendMailModel | null
	cancelModel: SendMailModel | null
	responseModel: SendMailModel | null
}

/**
 * get the models enabling consistent calendar event updates.
 *
 * Note: we could enforce the right access by having some fields in the return value be nullable, for example to
 * Note: not give non-business accounts access to the whoModel.
 * Note: or splitting the saveModel into a sendUpdatesModel and saveModel and only returning the latter for invites.
 */
export async function makeCalendarEventEditModels(
	initialValues: Partial<CalendarEvent>,
	recipientsModel: RecipientsModel,
	calendarModel: CalendarModel,
	logins: LoginController,
	mailboxDetail: MailboxDetail,
	mailboxProperties: MailboxProperties,
	sendMailModelFactory: lazy<SendMailModel>,
	distributor: CalendarUpdateDistributor,
	entityClient: EntityClient,
	zone: string = getTimeZone(),
	showProgress: (p: Promise<unknown>) => unknown = noOp,
	uiUpdateCallback: () => void = m.redraw,
): Promise<CalendarEventEditModels> {
	const ownMailAddresses = mailboxProperties.mailAddressProperties.map(({ mailAddress, senderName }) =>
		createEncryptedMailAddress({
			address: mailAddress,
			name: senderName,
		}),
	)
	const isNew = initialValues._ownerGroup !== null
	const cleanInitialValues = cleanupInitialValuesForEditing(initialValues, zone)
	const user = logins.getUserController().user
	const [alarms, calendars] = await Promise.all([
		resolveAlarmsForEvent(initialValues.alarmInfos ?? [], calendarModel, user),
		calendarModel.loadCalendarInfos(new NoopProgressMonitor()),
	])
	const getPasswordStrength = (password: string, recipientInfo: PartialRecipient) =>
		getPasswordStrengthForUser(password, recipientInfo, mailboxDetail, logins)

	const eventType = getEventType(
		initialValues,
		calendars,
		ownMailAddresses.map(({ address }) => address),
		user,
	)

	return {
		saveModel: new CalendarEventSaveModel(
			/** in this case, we only want to give the existing event if it actually exists on the server. */
			initialValues._ownerGroup != null ? createCalendarEvent(initialValues) : null,
			eventType,
			logins.getUserController(),
			distributor,
			calendarModel,
			entityClient,
			mailboxDetail,
			mailboxProperties,
			calendars,
			zone,
			null /** responseTo */,
			showProgress,
		),
		whenModel: new CalendarEventWhenModel(cleanInitialValues, zone, uiUpdateCallback),
		whoModel: new CalendarEventWhoModel(
			cleanInitialValues,
			eventType,
			calendars,
			logins.getUserController(),
			isNew,
			ownMailAddresses,
			recipientsModel,
			getPasswordStrength,
			sendMailModelFactory,
			uiUpdateCallback,
		),
		alarmModel: new CalendarEventAlarmModel(alarms, uiUpdateCallback),
		location: new SanitizedTextViewModel(cleanInitialValues.location, uiUpdateCallback),
		summary: new SanitizedTextViewModel(cleanInitialValues.summary, uiUpdateCallback),
		description: new SanitizedTextViewModel(cleanInitialValues.description, uiUpdateCallback),
	}
}

/**
 * construct a usable calendar event from the result of one or more edit operations.
 * returns the new alarms separately so they can be set up
 * on the server before assigning the ids.
 * @param models
 */
export function assembleCalendarEventEditResult(models: CalendarEventEditModels): {
	eventValues: CalendarEventValues
	newAlarms: ReadonlyArray<AlarmInfo>
	sendModels: CalendarEventUpdateNotificationModels
	calendar: CalendarInfo
} {
	const whenResult = models.whenModel.result
	const whoResult = models.whoModel.result
	const alarmResult = models.alarmModel.result
	const summary = models.summary.content
	const description = models.description.content
	const location = models.location.content

	return {
		eventValues: {
			// when?
			startTime: whenResult.startTime,
			endTime: whenResult.endTime,
			repeatRule: whenResult.repeatRule,
			// what?
			summary,
			description,
			// where?
			location,
			// who?
			invitedConfidentially: whoResult.isConfidential,
			organizer: whoResult.organizer,
			attendees: whoResult.attendees,
			// fields related to the event instance's identity are excluded.
			// reminders
			alarmInfos: [],
		},
		newAlarms: alarmResult.alarms,
		sendModels: whoResult,
		calendar: whoResult.calendar,
	}
}

/**
 * combine event values with the fields required to identify a particular instance of the event.
 * @param values
 * @param identity sequence (default "0") and recurrenceId (default null) are optional, but the uid must be specified.
 */
export function assignEventIdentity(values: CalendarEventValues, identity: Require<"uid", Partial<CalendarEventIdentity>>): CalendarEvent {
	return createCalendarEvent({
		...values,
		sequence: "0",
		recurrenceId: null,
		...identity,
	})
}

export async function resolveAlarmsForEvent(alarms: CalendarEvent["alarmInfos"], calendarModel: CalendarModel, user: User): Promise<Array<AlarmInterval>> {
	const alarmInfos = await calendarModel.loadAlarms(alarms, user)
	return alarmInfos.map(({ alarmInfo }) => alarmInfo.trigger as AlarmInterval)
}

function cleanupInitialValuesForEditing(initialValues: Partial<CalendarEvent>, zone: string): CalendarEvent {
	// the event we got passed may already have some technical fields assigned, so we remove them.
	const stripped = getStrippedClone<CalendarEvent>(initialValues)
	const result = createCalendarEvent(stripped)

	// remove the alarm infos from the result, they don't contain any useful information for the editing operation.
	// selected alarms are returned in the edit result separate from the event.
	result.alarmInfos = []

	return result
}
