import o from "ospec"
import {
	CalendarEvent,
	createCalendarEventAttendee,
	createCalendarGroupRoot,
	createContact,
	createContactAddress,
	createEncryptedMailAddress,
	EncryptedMailAddress,
} from "../../../../src/api/entities/tutanota/TypeRefs.js"
import { LazyLoaded } from "@tutao/tutanota-utils"
import { CalendarEventWhoModel } from "../../../../src/calendar/model/eventeditor/CalendarEventWhoModel.js"
import { matchers, object, when } from "testdouble"
import { RecipientsModel } from "../../../../src/api/main/RecipientsModel.js"
import { Recipient, RecipientType } from "../../../../src/api/common/recipients/Recipient.js"
import { CalendarAttendeeStatus, ContactAddressType } from "../../../../src/api/common/TutanotaConstants.js"
import { EventType } from "../../../../src/calendar/model/eventeditor/CalendarEventEditModel.js"
import { CalendarInfo } from "../../../../src/calendar/model/CalendarModel.js"
import { createGroup, createGroupInfo } from "../../../../src/api/entities/sys/TypeRefs.js"
import { SendMailModel } from "../../../../src/mail/editor/SendMailModel.js"
import { UserController } from "../../../../src/api/main/UserController.js"

o.spec("CalendarEventWhoModel", function () {
	const ownerAddress = createEncryptedMailAddress({
		address: "calendarowner@tutanota.de",
		name: "Calendar Owner",
	})
	const ownerRecipient = {
		address: ownerAddress.address,
		name: ownerAddress.name,
		type: RecipientType.INTERNAL,
		contact: null,
	}
	const ownerAlias = createEncryptedMailAddress({
		address: "calendarowneralias@tutanota.de",
		name: "Calendar Owner Alias",
	})
	const ownerAliasRecipient = {
		address: ownerAlias.address,
		name: ownerAlias.name,
		type: RecipientType.INTERNAL,
		contact: null,
	}
	const otherAddress = createEncryptedMailAddress({
		address: "someone@tutanota.de",
		name: "Some One",
	})
	const otherRecipient = {
		address: otherAddress.address,
		name: otherAddress.name,
		type: RecipientType.EXTERNAL,
		contact: createContact({
			nickname: otherAddress.name,
			presharedPassword: "otherPassword",
			addresses: [
				createContactAddress({
					address: otherAddress.address,
					type: ContactAddressType.WORK,
				}),
			],
		}),
	}
	const otherAddress2 = createEncryptedMailAddress({
		address: "someoneelse@tutanota.de",
		name: "Some One Else",
	})
	const otherRecipient2 = {
		address: otherAddress2.address,
		name: otherAddress2.name,
		type: RecipientType.INTERNAL,
		contact: createContact({
			nickname: otherAddress2.name,
			presharedPassword: "otherPassword2",
			addresses: [
				createContactAddress({
					address: otherAddress2.address,
					type: ContactAddressType.WORK,
				}),
			],
		}),
	}

	const calendars: Map<Id, CalendarInfo> = new Map()

	calendars.set("ownCalendar", {
		groupRoot: createCalendarGroupRoot({}),
		shared: false,
		longEvents: new LazyLoaded(() => Promise.resolve([])),
		groupInfo: createGroupInfo({}),
		group: createGroup({
			_id: "ownCalendar",
		}),
	})

	calendars.set("sharedCalendar", {
		groupRoot: createCalendarGroupRoot({}),
		shared: true,
		longEvents: new LazyLoaded(() => Promise.resolve([])),
		groupInfo: createGroupInfo({}),
		group: createGroup({
			_id: "sharedCalendar",
		}),
	})

	const ownAddresses: ReadonlyArray<EncryptedMailAddress> = [ownerAddress, ownerAlias]
	const passwordStrengthModel = () => 1

	let recipients: RecipientsModel
	let sendMailModel: SendMailModel
	let userController: UserController

	o.beforeEach(() => {
		userController = object()
		sendMailModel = object()
		recipients = object()
		const setupRecipient = (recipient: Recipient) => {
			const sameAddressMatcher = matchers.argThat((p) => p.address === recipient.address)
			when(recipients.resolve(sameAddressMatcher, matchers.anything())).thenReturn({
				resolved: () => Promise.resolve(recipient),
			})
		}
		setupRecipient(ownerRecipient)
		setupRecipient(ownerAliasRecipient)
		setupRecipient(otherRecipient)
		setupRecipient(otherRecipient2)
	})

	const getNewModel = (initialValues: Partial<CalendarEvent>) =>
		new CalendarEventWhoModel(
			initialValues,
			EventType.OWN,
			calendars,
			userController,
			true,
			ownAddresses,
			recipients,
			passwordStrengthModel,
			() => sendMailModel,
		)
	const getOldModel = (initialValues: Partial<CalendarEvent>) =>
		new CalendarEventWhoModel(
			initialValues,
			EventType.OWN,
			calendars,
			userController,
			false,
			ownAddresses,
			recipients,
			passwordStrengthModel,
			() => sendMailModel,
		)

	o("adding another alias on your own event replaces the old attendee and updates the organizer", async function () {
		const model = getNewModel({
			attendees: [createCalendarEventAttendee({ address: ownAddresses[0] }), createCalendarEventAttendee({ address: otherAddress })],
			organizer: ownAddresses[0],
		})

		model.addAttendee(ownerAlias.address, null)
		await model.recipientsSettled
		o(model.guests).deepEquals([
			{
				address: otherAddress.address,
				name: otherAddress.name,
				type: RecipientType.EXTERNAL,
				contact: otherRecipient.contact,
				status: CalendarAttendeeStatus.ADDED,
			},
		])("the single non-organizer guest is in guests array")
		o(model.ownGuest).deepEquals(model.organizer)("the own guest is the organizer")
		const result = model.result
		o(result.inviteModel).notEquals(null)("on a new model, everyone but the organizer needs to be invited, even if added during initialization")
		o(result.updateModel).equals(null)
		o(result.cancelModel).equals(null)
		o(result.responseModel).equals(null)
		o(result.attendees).deepEquals([
			createCalendarEventAttendee({ address: ownerAlias, status: CalendarAttendeeStatus.ACCEPTED }),
			createCalendarEventAttendee({ address: otherAddress, status: CalendarAttendeeStatus.ADDED }),
		])("the result contains all attendees including the organizer")
		o(result.organizer).deepEquals(ownerAlias)
	})

	o("setting multiple ownAddresses correctly gives the possible organizers", function () {
		const model = getNewModel({
			attendees: [createCalendarEventAttendee({ address: ownAddresses[0] }), createCalendarEventAttendee({ address: otherAddress })],
			organizer: ownAddresses[0],
		})

		o(model.possibleOrganizers).deepEquals([ownerAddress, ownerAlias])
	})

	o("add attendee that is not the user while without organizer -> organizer is now the first of the current users' mail addresses", async function () {
		const model = getNewModel({
			attendees: [],
			organizer: null,
		})
		model.addAttendee(otherAddress.address, otherRecipient.contact)
		await model.recipientsSettled
		o(model.organizer).deepEquals({
			address: ownAddresses[0].address,
			name: ownAddresses[0].name,
			type: RecipientType.INTERNAL,
			status: CalendarAttendeeStatus.ACCEPTED,
			contact: null,
		})
		const result = model.result
		o(result.attendees.map((a) => a.address)).deepEquals([ownerAddress, otherAddress])
		o(result.organizer).deepEquals(ownerAddress)
	})

	o("remove last attendee that is not the organizer also removes the organizer on the result, but not on the attendees getter", function () {
		const model = getNewModel({
			attendees: [],
			organizer: null,
		})
		model.addAttendee(otherAddress.address, otherRecipient.contact)
		o(model.organizer).notEquals(null)
		model.removeAttendee(otherAddress.address)
		const result = model.result
		o(result.attendees.length).equals(0)
		o(result.organizer).equals(null)
	})
	o("trying to remove the organizer while there are other attendees does nothing", function () {
		const model = getNewModel({
			attendees: [createCalendarEventAttendee({ address: ownAddresses[0] }), createCalendarEventAttendee({ address: otherAddress })],
			organizer: ownerAddress,
		})
		model.removeAttendee(ownerAddress.address)
		const result = model.result
		o(result.attendees.length).equals(2)
		o(result.organizer).deepEquals(ownerAddress)
	})
	o("getting the result on an old model is idempotent", function () {
		const model = getOldModel({
			attendees: [
				createCalendarEventAttendee({ address: ownAddresses[0], status: CalendarAttendeeStatus.ACCEPTED }),
				createCalendarEventAttendee({ address: otherAddress, status: CalendarAttendeeStatus.ACCEPTED }),
			],
			organizer: ownerAddress,
		})
		model.removeAttendee(otherAddress.address)
		model.addAttendee(otherAddress2.address, otherRecipient2.contact)
		o(model.result).deepEquals(model.result)
	})
	o("removing an attendee while there are other attendees removes only that attendee", async function () {
		const model = getOldModel({
			attendees: [
				createCalendarEventAttendee({ address: ownAddresses[0], status: CalendarAttendeeStatus.ACCEPTED }),
				createCalendarEventAttendee({ address: otherAddress }),
			],
			organizer: ownerAddress,
		})
		model.addAttendee(otherAddress.address, otherRecipient.contact)
		model.addAttendee(otherAddress2.address, otherRecipient2.contact)
		await model.recipientsSettled
		const resultBeforeRemove = model.result
		o(resultBeforeRemove.attendees).deepEquals([
			createCalendarEventAttendee({ address: ownerAddress, status: CalendarAttendeeStatus.ACCEPTED }),
			createCalendarEventAttendee({ address: otherAddress, status: CalendarAttendeeStatus.ADDED }),
			createCalendarEventAttendee({ address: otherAddress2, status: CalendarAttendeeStatus.ADDED }),
		])("there are three attendees in the event")
		o(resultBeforeRemove.organizer).deepEquals(ownerAddress)
		model.removeAttendee(otherAddress.address)
		const result = model.result
		o(result.attendees).deepEquals([
			createCalendarEventAttendee({ address: ownerAddress, status: CalendarAttendeeStatus.ACCEPTED }),
			createCalendarEventAttendee({ address: otherAddress2, status: CalendarAttendeeStatus.ADDED }),
		])
		o(result.organizer).deepEquals(ownerAddress)
	})

	o("setting external passwords is reflected in the getters and result", async function () {
		const model = getNewModel({
			attendees: [
				createCalendarEventAttendee({ address: ownAddresses[0] }),
				createCalendarEventAttendee({ address: otherAddress, status: CalendarAttendeeStatus.NEEDS_ACTION }),
			],
			organizer: ownerAddress,
			invitedConfidentially: true,
		})

		o(model.guests).deepEquals([
			{
				address: "someone@tutanota.de",
				name: "Some One",
				status: CalendarAttendeeStatus.NEEDS_ACTION,
				type: RecipientType.UNKNOWN,
				contact: null,
			},
		])
		o(model.getPresharedPassword(otherAddress.address)).deepEquals({ password: "", strength: 0 })("password is not set")
		await model.recipientsSettled
		o(model.guests).deepEquals([
			{
				address: "someone@tutanota.de",
				name: "Some One",
				status: CalendarAttendeeStatus.NEEDS_ACTION,
				type: RecipientType.EXTERNAL,
				contact: otherRecipient.contact,
			},
		])
		o(model.getPresharedPassword(otherAddress.address)).deepEquals({ password: "otherPassword", strength: 1 })
		const { attendees } = model.result
		o(attendees).deepEquals([
			createCalendarEventAttendee({
				address: ownerAddress,
				status: CalendarAttendeeStatus.ADDED,
			}),
			createCalendarEventAttendee({
				address: otherAddress,
				status: CalendarAttendeeStatus.NEEDS_ACTION,
			}),
		])
	})
})
