import o from "ospec"

import { CalendarEventEditModel, EventType } from "../../../src/calendar/date/CalendarEventEditModel.js"
import { CalendarEvent, createCalendarEventAttendee, createEncryptedMailAddress, EncryptedMailAddress } from "../../../src/api/entities/tutanota/TypeRefs.js"
import { noOp } from "@tutao/tutanota-utils"
import { isAllDayEvent } from "../../../src/api/common/utils/CommonCalendarUtils.js"
import { getEventWithDefaultTimes } from "../../../src/calendar/date/CalendarEventViewModel.js"
import { Time } from "../../../src/api/common/utils/Time.js"
import { CalendarAttendeeStatus } from "../../../src/api/common/TutanotaConstants.js"

o.spec("CalendarEventEditModel", function () {
	const calendars: Array<Id> = ["calendarId"]
	const ownerAddress = createEncryptedMailAddress({
		address: "calendarOwner@tutanota.de",
		name: "Calendar Owner",
	})
	const ownerAlias = createEncryptedMailAddress({
		address: "calendarOwnerAlias@tutanota.de",
		name: "Calendar Owner Alias",
	})
	const otherAddress = createEncryptedMailAddress({
		address: "someone@tutanota.de",
		name: "Some One",
	})
	const otherAddress2 = createEncryptedMailAddress({
		address: "someoneelse@tutanota.de",
		name: "Some One Else",
	})
	const ownAddresses: ReadonlyArray<EncryptedMailAddress> = [ownerAddress, ownerAlias]

	const getModelBerlin = (initialValues: Partial<CalendarEvent>) =>
		new CalendarEventEditModel(initialValues, calendars, "calendarId", ownAddresses, EventType.OWN, [], noOp, "Europe/Berlin")

	const getModelKrasnoyarsk = (initialValues: Partial<CalendarEvent>) =>
		new CalendarEventEditModel(initialValues, calendars, "calendarId", ownAddresses, EventType.OWN, [], noOp, "Asia/Krasnoyarsk")

	o.spec("date modifications", function () {
		o("if the start date is set to before 1970, it will be set to this year", function () {
			const model = getModelBerlin({
				startTime: new Date("2023-04-27T08:27:45.523Z"),
				endTime: new Date("2023-04-27T08:57:45.523Z"),
			})
			model.startDate = new Date("1969-04-27T08:27:00.000Z")
			o(model.startDate.getFullYear()).equals(new Date().getFullYear())
		})
		o("if the start time is changed, the end time changes by the same amount", function () {
			const model = getModelBerlin({
				startTime: new Date("2023-04-27T08:27:00.000Z"),
				endTime: new Date("2023-04-27T08:57:00.000Z"),
			})
			const startTime = model.startTime
			o(startTime.to24HourString()).equals("10:27")
			model.startTime = new Time(startTime.hours, startTime.minutes + 3)

			o(model.startTime.to24HourString()).equals("10:30")
			o(model.endTime.to24HourString()).equals("11:00")
			const result = model.result
			o(result.startTime.toISOString()).equals("2023-04-27T08:30:00.000Z")
			o(result.endTime.toISOString()).equals("2023-04-27T09:00:00.000Z")
		})
		o("modifying the start time while the event is all-day has an effect after unsetting all-day", function () {
			const model = getModelBerlin({
				startTime: new Date("2023-04-27T08:27:45.523Z"),
				endTime: new Date("2023-04-27T08:57:45.523Z"),
			})
			model.isAllDay = true
			model.startTime = new Time(13, 30)
			o(model.startTime.to24HourString()).equals("00:00")
			const allDayResult = model.result
			o(allDayResult.startTime.toISOString()).equals("2023-04-27T00:00:00.000Z")
			model.isAllDay = false
			o(model.startTime.to24HourString()).equals("13:30")
			const result = model.result
			o(result.startTime.toISOString()).equals("2023-04-27T11:30:00.000Z")
		})
		o("modifying the end time while the event is all-day has an effect after unsetting all-day", function () {
			const model = getModelBerlin({
				startTime: new Date("2023-04-27T08:27:45.523Z"),
				endTime: new Date("2023-04-27T08:57:45.523Z"),
			})
			model.isAllDay = true
			model.endTime = new Time(13, 30)
			o(model.endTime.to24HourString()).equals("00:00")
			const allDayResult = model.result
			o(allDayResult.endTime.toISOString()).equals("2023-04-28T00:00:00.000Z")
			model.isAllDay = false
			o(model.endTime.to24HourString()).equals("13:30")
			const result = model.result
			o(result.endTime.toISOString()).equals("2023-04-27T11:30:00.000Z")
		})
		o("setting the start date correctly updates the start date and end date", function () {
			const model = getModelBerlin({
				startTime: new Date("2023-04-27T08:27:45.523Z"),
				endTime: new Date("2023-04-28T08:57:45.523Z"),
			})

			model.startDate = new Date("2023-04-28T04:00:00.000Z")
			o(model.startTime.to24HourString()).equals("10:27")("start time did not change")
			o(model.endTime.to24HourString()).equals("10:57")("end time did not change")
			o(model.startDate.toISOString()).equals("2023-04-27T22:00:00.000Z")("the display start date is shifted by one day")
			o(model.endDate.toISOString()).equals("2023-04-28T22:00:00.000Z")("the display end date was also moved by one day")
			const result = model.result
			o(result.startTime.toISOString()).equals("2023-04-28T08:27:00.000Z")("result start time is correct")
			o(result.endTime.toISOString()).equals("2023-04-29T08:57:00.000Z")("result end time is correct")
		})
		o("setting the end date correctly updates the end date", function () {
			const model = getModelBerlin({
				startTime: new Date("2023-04-27T08:27:45.523Z"),
				endTime: new Date("2023-04-28T08:57:45.523Z"),
			})

			model.endDate = new Date("2023-05-27T04:00:00.000Z")
			o(model.startTime.to24HourString()).equals("10:27")("start time did not change")
			o(model.endTime.to24HourString()).equals("10:57")("end time did not change")
			o(model.startDate.toISOString()).equals("2023-04-26T22:00:00.000Z")("start date did not change")
			o(model.endDate.toISOString()).equals("2023-05-26T22:00:00.000Z")("end date is correctly shifted")
			const result = model.result
			o(result.startTime.toISOString()).equals("2023-04-27T08:27:00.000Z")("result start time is correct")
			o(result.endTime.toISOString()).equals("2023-05-27T08:57:00.000Z")("result end time is correct")
		})
	})

	o.spec("all day", function () {
		o("all day is set correctly for an event that is all-day by times", function () {
			const model = getModelBerlin({
				startTime: new Date("2023-04-27T00:00:00.000Z"),
				endTime: new Date("2023-04-28T00:00:00.000Z"),
			})
			o(model.isAllDay).equals(true)
		})
		o("all day is set correctly for an event that is not all-day by times", function () {
			const model = getModelBerlin({
				startTime: new Date("2023-04-27T01:00:00.000Z"),
				endTime: new Date("2023-04-28T00:02:00.000Z"),
			})
			o(model.isAllDay).equals(false)
		})
		o("setting all-day correctly sets utc times to midnight", function () {
			const model = getModelBerlin({
				startTime: new Date("2023-04-27T01:00:00.000Z"),
				endTime: new Date("2023-04-28T00:02:00.000Z"),
			})
			model.isAllDay = true
			const result = model.result
			o(result.startTime.toISOString()).equals("2023-04-27T00:00:00.000Z")
			o(result.endTime.toISOString()).equals("2023-04-29T00:00:00.000Z")
			o(isAllDayEvent(result)).equals(true)
		})
		o("setting all-day correctly sets utc times to midnight on an event with same start and end date", function () {
			const model = getModelBerlin({
				startTime: new Date("2023-04-27T01:00:00.000Z"),
				endTime: new Date("2023-04-27T00:02:00.000Z"),
			})
			model.isAllDay = true
			const result = model.result
			o(result.startTime.toISOString()).equals("2023-04-27T00:00:00.000Z")
			o(result.endTime.toISOString()).equals("2023-04-28T00:00:00.000Z")
			o(isAllDayEvent(result)).equals(true)
		})
		o("setting all-day to false will cause result to not be considered all-day and the times to be set to the default", function () {
			// FIXME: this test might fail if run on exactly a full half hour
			const model = getModelBerlin({
				startTime: new Date("2023-04-27T00:00:00.000Z"),
				endTime: new Date("2023-04-28T00:00:00.000Z"),
			})

			const eventWithDefaults = getEventWithDefaultTimes()

			o(model.isAllDay).equals(true)
			model.isAllDay = false
			const result = model.result
			o(result.startTime.toISOString()).equals(eventWithDefaults.startTime?.toISOString())
			o(result.endTime.toISOString()).equals(eventWithDefaults.endTime?.toISOString())
			o(isAllDayEvent(result)).equals(false)
		})
	})

	o.spec("timezones", function () {
		o("creating an all-day event in one time zone will be considered all-day in another time zone", function () {
			const berlinModel = getModelBerlin({
				startTime: new Date("2023-04-27T01:00:00.000Z"),
				endTime: new Date("2023-04-27T00:02:00.000Z"),
			})
			o(berlinModel.isAllDay).equals(false)
			berlinModel.isAllDay = true
			const berlinResult = berlinModel.result
			o(berlinResult.startTime.toISOString()).equals("2023-04-27T00:00:00.000Z")
			o(berlinResult.endTime.toISOString()).equals("2023-04-28T00:00:00.000Z")

			// now, around the planet...
			const krasnoyarskModel = getModelKrasnoyarsk(berlinResult)
			o(krasnoyarskModel.isAllDay).equals(true)
		})

		o("events from another timezone correctly translate the displayed start and end times", function () {
			const berlinModel = getModelBerlin({
				startTime: new Date("2023-04-27T01:00:00.000Z"),
				endTime: new Date("2023-04-27T00:02:00.000Z"),
			})
			o(berlinModel.isAllDay).equals(false)
			berlinModel.startTime = new Time(13, 0)
			berlinModel.endTime = new Time(13, 30)
			const berlinResult = berlinModel.result
			o(berlinResult.startTime.toISOString()).equals("2023-04-27T11:00:00.000Z")
			o(berlinResult.endTime.toISOString()).equals("2023-04-27T11:30:00.000Z")

			const krasnoyarskModel = getModelKrasnoyarsk(berlinResult)
			o(krasnoyarskModel.isAllDay).equals(false)
			o(krasnoyarskModel.startTime.to24HourString()).equals("18:00")
			o(krasnoyarskModel.endTime.to24HourString()).equals("18:30")
		})
	})

	o.spec("attendees", function () {
		o("adding another alias on your own event replaces the old attendee and updates the organizer", function () {
			const model = getModelBerlin({
				startTime: new Date("2023-04-27T01:00:00.000Z"),
				endTime: new Date("2023-04-27T00:02:00.000Z"),
			})
			model.addAttendee(ownerAddress.address, { nickname: ownerAddress.name, firstName: "", lastName: "" })
			const resultBefore = model.result
			o(resultBefore.attendees.map((a) => a.address)).deepEquals([ownerAddress])
			o(resultBefore.organizer).deepEquals(ownerAddress)
			model.addAttendee(ownerAlias.address, { nickname: ownerAlias.name, firstName: "", lastName: "" })
			const result = model.result
			o(result.attendees.map((a) => a.address)).deepEquals([ownerAlias])
			o(result.organizer).deepEquals(ownerAlias)
		})

		o("add attendee that is not the user while without organizer -> organizer is now the first of the current users' mail addresses", function () {
			const model = getModelBerlin({
				startTime: new Date("2023-04-27T01:00:00.000Z"),
				endTime: new Date("2023-04-27T00:02:00.000Z"),
			})
			model.addAttendee(otherAddress.address, { nickname: otherAddress.name, firstName: "", lastName: "" })
			const result = model.result
			o(result.attendees.map((a) => a.address)).deepEquals([ownerAddress, otherAddress])
			o(result.organizer).deepEquals(ownerAddress)
		})

		o("remove last attendee that is not the organizer also removes the organizer", function () {
			const model = getModelBerlin({
				startTime: new Date("2023-04-27T01:00:00.000Z"),
				endTime: new Date("2023-04-27T00:02:00.000Z"),
			})
			model.addAttendee(otherAddress.address, { nickname: otherAddress.name, firstName: "", lastName: "" })
			model.removeAttendee(otherAddress.address)
			const result = model.result
			o(result.attendees.length).equals(0)
			o(result.organizer).equals(null)
		})
		o("trying to remove the organizer while there are other attendees does nothing", function () {
			const model = getModelBerlin({
				startTime: new Date("2023-04-27T01:00:00.000Z"),
				endTime: new Date("2023-04-27T00:02:00.000Z"),
			})
			model.addAttendee(otherAddress.address, { nickname: otherAddress.name, firstName: "", lastName: "" })
			model.removeAttendee(ownerAddress.address)
			const result = model.result
			o(result.attendees.length).equals(2)
			o(result.organizer).deepEquals(ownerAddress)
		})

		o("removing an attendee while there are other attendees removes only that attendee", function () {
			const model = getModelBerlin({
				startTime: new Date("2023-04-27T01:00:00.000Z"),
				endTime: new Date("2023-04-27T00:02:00.000Z"),
			})
			model.addAttendee(otherAddress.address, { nickname: otherAddress.name, firstName: "", lastName: "" })
			model.addAttendee(otherAddress2.address, { nickname: otherAddress2.name, firstName: "", lastName: "" })
			const resultBeforeRemove = model.result
			o(resultBeforeRemove.attendees).deepEquals([
				createCalendarEventAttendee({ address: ownerAddress, status: CalendarAttendeeStatus.ACCEPTED }),
				createCalendarEventAttendee({ address: otherAddress, status: CalendarAttendeeStatus.ADDED }),
				createCalendarEventAttendee({ address: otherAddress2, status: CalendarAttendeeStatus.ADDED }),
			])
			o(resultBeforeRemove.organizer).deepEquals(ownerAddress)
			model.removeAttendee(otherAddress.address)
			const result = model.result
			o(result.attendees).deepEquals([
				createCalendarEventAttendee({ address: ownerAddress, status: CalendarAttendeeStatus.ACCEPTED }),
				createCalendarEventAttendee({ address: otherAddress2, status: CalendarAttendeeStatus.ADDED }),
			])
			o(result.organizer).deepEquals(ownerAddress)
		})
	})
})
