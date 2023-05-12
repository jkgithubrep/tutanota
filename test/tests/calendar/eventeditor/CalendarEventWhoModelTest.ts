import o from "ospec"
import {
	CalendarEvent,
	createCalendarEventAttendee,
	createContact,
	createContactAddress,
	createEncryptedMailAddress,
	EncryptedMailAddress,
} from "../../../../src/api/entities/tutanota/TypeRefs.js"
import { noOp } from "@tutao/tutanota-utils"
import { CalendarEventWhoModel } from "../../../../src/calendar/model/eventeditor/CalendarEventWhoModel.js"
import { matchers, object, when } from "testdouble"
import { RecipientsModel } from "../../../../src/api/main/RecipientsModel.js"
import { Recipient, RecipientType } from "../../../../src/api/common/recipients/Recipient.js"
import { CalendarAttendeeStatus, ContactAddressType } from "../../../../src/api/common/TutanotaConstants.js"

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

	const ownAddresses: ReadonlyArray<EncryptedMailAddress> = [ownerAddress, ownerAlias]

	let recipients: RecipientsModel

	o.beforeEach(() => {
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

	const getNewModel = (initialValues: Partial<CalendarEvent>) => new CalendarEventWhoModel(initialValues, true, ownAddresses, recipients, noOp)
	const getOldModel = (initialValues: Partial<CalendarEvent>) => new CalendarEventWhoModel(initialValues, false, ownAddresses, recipients, noOp)

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
		o(result.attendeesToInvite).deepEquals([
			createCalendarEventAttendee({
				address: otherAddress,
			}),
		])("on a new model, everyone but the organizer needs to be invited, even if added during initialization")
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
		o(model.getPresharedPassword(otherAddress.address)).equals("")
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
		o(model.getPresharedPassword(otherAddress.address)).equals("otherPassword")
		const { presharedPasswords, attendees } = model.result
		o(presharedPasswords?.get(otherAddress.address)).equals("otherPassword")
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
