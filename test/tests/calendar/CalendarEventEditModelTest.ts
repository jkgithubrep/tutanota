import o from "ospec"

import { CalendarEventEditModel, EventType, getDefaultEndCountValue, getDefaultEndDateEndValue } from "../../../src/calendar/date/CalendarEventEditModel.js"
import { CalendarEvent, createCalendarEventAttendee, createEncryptedMailAddress, EncryptedMailAddress } from "../../../src/api/entities/tutanota/TypeRefs.js"
import { noOp } from "@tutao/tutanota-utils"
import { isAllDayEvent } from "../../../src/api/common/utils/CommonCalendarUtils.js"
import { getEventWithDefaultTimes } from "../../../src/calendar/date/CalendarEventViewModel.js"
import { Time } from "../../../src/api/common/utils/Time.js"
import { AlarmInterval, CalendarAttendeeStatus, EndType, RepeatPeriod } from "../../../src/api/common/TutanotaConstants.js"
import { createRepeatRule } from "../../../src/api/entities/sys/TypeRefs.js"

o.spec("CalendarEventEditModel", function () {
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
		new CalendarEventEditModel(initialValues, "calendarId", ownAddresses, EventType.OWN, [], noOp, "Europe/Berlin")

	const getModelKrasnoyarsk = (initialValues: Partial<CalendarEvent>) =>
		new CalendarEventEditModel(initialValues, "calendarId", ownAddresses, EventType.OWN, [], noOp, "Asia/Krasnoyarsk")

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
			const result = model.result.event
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
			const allDayResult = model.result.event
			o(allDayResult.startTime.toISOString()).equals("2023-04-27T00:00:00.000Z")
			model.isAllDay = false
			o(model.startTime.to24HourString()).equals("13:30")
			const result = model.result.event
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
			const allDayResult = model.result.event
			o(allDayResult.endTime.toISOString()).equals("2023-04-28T00:00:00.000Z")
			model.isAllDay = false
			o(model.endTime.to24HourString()).equals("13:30")
			const result = model.result.event
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
			const result = model.result.event
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
			const result = model.result.event
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
			const result = model.result.event
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
			const result = model.result.event
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
			const result = model.result.event
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
			const berlinResult = berlinModel.result.event
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
			const berlinResult = berlinModel.result.event
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
			o(model.attendees).deepEquals([
				createCalendarEventAttendee({
					address: ownerAddress,
					status: CalendarAttendeeStatus.ACCEPTED,
				}),
			])
			const resultBefore = model.result.event
			// no other people -> no need for an attendee list or organizer
			o(resultBefore.attendees.map((a) => a.address)).deepEquals([])
			o(resultBefore.organizer).deepEquals(null)
			model.addAttendee(ownerAlias.address, { nickname: ownerAlias.name, firstName: "", lastName: "" })
			o(model.attendees).deepEquals([
				createCalendarEventAttendee({
					address: ownerAlias,
					status: CalendarAttendeeStatus.ACCEPTED,
				}),
			])
			const result = model.result.event

			// no other people -> no need for an attendee list or organizer
			o(result.attendees.map((a) => a.address)).deepEquals([])
			o(result.organizer).deepEquals(null)
		})

		o("add attendee that is not the user while without organizer -> organizer is now the first of the current users' mail addresses", function () {
			const model = getModelBerlin({
				startTime: new Date("2023-04-27T01:00:00.000Z"),
				endTime: new Date("2023-04-27T00:02:00.000Z"),
			})
			model.addAttendee(otherAddress.address, { nickname: otherAddress.name, firstName: "", lastName: "" })
			const result = model.result.event
			o(result.attendees.map((a) => a.address)).deepEquals([ownerAddress, otherAddress])
			o(result.organizer).deepEquals(ownerAddress)
		})

		o("remove last attendee that is not the organizer also removes the organizer on the result, but not on the attendees getter", function () {
			const model = getModelBerlin({
				startTime: new Date("2023-04-27T01:00:00.000Z"),
				endTime: new Date("2023-04-27T00:02:00.000Z"),
			})
			model.addAttendee(otherAddress.address, { nickname: otherAddress.name, firstName: "", lastName: "" })
			model.removeAttendee(otherAddress.address)
			const result = model.result.event
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
			const result = model.result.event
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
			const resultBeforeRemove = model.result.event
			o(resultBeforeRemove.attendees).deepEquals([
				createCalendarEventAttendee({ address: ownerAddress, status: CalendarAttendeeStatus.ACCEPTED }),
				createCalendarEventAttendee({ address: otherAddress, status: CalendarAttendeeStatus.ADDED }),
				createCalendarEventAttendee({ address: otherAddress2, status: CalendarAttendeeStatus.ADDED }),
			])
			o(resultBeforeRemove.organizer).deepEquals(ownerAddress)
			model.removeAttendee(otherAddress.address)
			const result = model.result.event
			o(result.attendees).deepEquals([
				createCalendarEventAttendee({ address: ownerAddress, status: CalendarAttendeeStatus.ACCEPTED }),
				createCalendarEventAttendee({ address: otherAddress2, status: CalendarAttendeeStatus.ADDED }),
			])
			o(result.organizer).deepEquals(ownerAddress)
		})
	})

	o.spec("repeat rules", function () {
		o("the repeat interval is reflected on the result and for display, no repeat", function () {
			const model = getModelBerlin({
				startTime: new Date("2023-04-27T00:00:00.000Z"),
				endTime: new Date("2023-04-28T00:00:00.000Z"),
				repeatRule: null,
			})
			o(model.repeatPeriod).equals(null)
			o(model.result.event.repeatRule).equals(null)
		})

		o("repeat interval is set to daily", function () {
			const model = getModelBerlin({
				startTime: new Date("2023-04-27T00:00:00.000Z"),
				endTime: new Date("2023-04-28T00:00:00.000Z"),
				repeatRule: null,
			})

			model.repeatPeriod = RepeatPeriod.DAILY
			o(model.repeatPeriod).equals(RepeatPeriod.DAILY)
			o(model.result.event.repeatRule).deepEquals(
				createRepeatRule({
					interval: "1",
					endType: EndType.Never,
					endValue: "1",
					frequency: RepeatPeriod.DAILY,
					excludedDates: [],
				}),
			)
		})

		o("setting repeat end type after count works", function () {
			const model = getModelBerlin({
				startTime: new Date("2023-04-27T00:00:00.000Z"),
				endTime: new Date("2023-04-28T00:00:00.000Z"),
				repeatRule: createRepeatRule({
					interval: "1",
					endType: EndType.Never,
					endValue: "1",
					frequency: RepeatPeriod.DAILY,
					excludedDates: [],
				}),
			})
			const { event } = model.result

			model.repeatEndType = EndType.Count
			model.repeatEndOccurrences = 13
			o(model.repeatEndOccurrences).equals(13)

			o(model.result.event.repeatRule?.endType).equals(EndType.Count)
			o(model.result.event.repeatRule?.endValue).equals("13")
			model.repeatEndDate = new Date("2022-04-03T13:00:00.000Z")
			o(String(model.repeatEndDate.getTime())).equals(getDefaultEndDateEndValue(event, "Europe/Berlin"))
			o(model.repeatEndType).equals(EndType.Count)
		})

		o("setting repeat end type after date works", function () {
			const model = getModelBerlin({
				startTime: new Date("2023-04-27T00:00:00.000Z"),
				endTime: new Date("2023-04-28T00:00:00.000Z"),
				repeatRule: createRepeatRule({
					interval: "1",
					endType: EndType.Never,
					endValue: "1",
					frequency: RepeatPeriod.DAILY,
					excludedDates: [],
				}),
			})

			const endDate = new Date("2023-05-27T13:00:00.000Z")
			model.repeatEndType = EndType.UntilDate
			model.repeatEndDate = endDate
			o(model.repeatEndType).equals(EndType.UntilDate)
			o(model.repeatEndDate.toISOString()).equals(endDate.toISOString())
			const { event } = model.result
			o(event.repeatRule?.endType).equals(EndType.UntilDate)
			o(event.repeatRule?.endValue).equals(String(endDate.getTime()))

			o(model.repeatEndOccurrences).equals(Number(getDefaultEndCountValue()))

			model.repeatPeriod = null
			o(model.repeatPeriod).equals(null)
			o(model.result.event.repeatRule).equals(null)
		})

		o("changing end date if event is not repeating or ends after count (or vice versa) is a no-op", function () {
			const model = getModelBerlin({
				startTime: new Date("2023-04-27T00:00:00.000Z"),
				endTime: new Date("2023-04-28T00:00:00.000Z"),
				repeatRule: createRepeatRule({
					interval: "1",
					endType: EndType.Count,
					endValue: "10",
					frequency: RepeatPeriod.DAILY,
					excludedDates: [],
				}),
			})

			const endOnCountResult = model.result.event
			model.repeatEndDate = new Date("2023-04-27T13:00:00.000Z")
			o(model.repeatEndDate.toISOString()).equals("2023-05-27T00:00:00.000Z")
			const changedEndOnCountResult = model.result.event
			o(changedEndOnCountResult).deepEquals(endOnCountResult)

			model.repeatEndType = EndType.UntilDate
			const endOnDateResult = model.result.event
			model.repeatEndOccurrences = 5
			o(model.repeatEndOccurrences).equals(10)
			const changedEndOnDateResult = model.result.event
			o(changedEndOnDateResult).deepEquals(endOnDateResult)
		})

		o("changing the repeat interval to something less than 1 sets it to 1", function () {
			const model = getModelBerlin({
				startTime: new Date("2023-04-27T00:00:00.000Z"),
				endTime: new Date("2023-04-28T00:00:00.000Z"),
				repeatRule: createRepeatRule({
					interval: "10",
					endType: EndType.Count,
					endValue: "10",
					frequency: RepeatPeriod.DAILY,
					excludedDates: [],
				}),
			})

			model.repeatInterval = -1
			o(model.repeatInterval).equals(1)
			o(model.result.event.repeatRule?.interval).equals("1")
		})

		o("repeat interval changes are reflected in the result and display", function () {
			const model = getModelBerlin({
				startTime: new Date("2023-04-27T00:00:00.000Z"),
				endTime: new Date("2023-04-28T00:00:00.000Z"),
				repeatRule: createRepeatRule({
					interval: "10",
					endType: EndType.Count,
					endValue: "10",
					frequency: RepeatPeriod.DAILY,
					excludedDates: [],
				}),
			})
			o(model.repeatInterval).equals(10)
			o(model.result.event.repeatRule?.interval).equals("10")
			model.repeatInterval = 5
			o(model.repeatInterval).equals(5)
			o(model.result.event.repeatRule?.interval).equals("5")
		})
	})

	o.spec("alarm triggers", function () {
		o("alarm initialization works", function () {
			const model = new CalendarEventEditModel(
				{
					startTime: new Date("2023-04-27T00:00:00.000Z"),
					endTime: new Date("2023-04-28T00:00:00.000Z"),
					alarmInfos: [["someListId", "someElementId"]],
				},
				"calendarId",
				ownAddresses,
				EventType.OWN,
				[AlarmInterval.ONE_HOUR],
				noOp,
				"Europe/Berlin",
			)
			o(model.alarms).deepEquals([AlarmInterval.ONE_HOUR])
			o(model.result.event.alarmInfos).deepEquals([])
			o(model.result.alarms).deepEquals([AlarmInterval.ONE_HOUR])
		})

		o("setting an alarm with the same trigger multiple times does not change the result", function () {
			const model = new CalendarEventEditModel(
				{
					startTime: new Date("2023-04-27T00:00:00.000Z"),
					endTime: new Date("2023-04-28T00:00:00.000Z"),
				},
				"calendarId",
				ownAddresses,
				EventType.OWN,
				[],
				noOp,
				"Europe/Berlin",
			)

			model.addAlarm(AlarmInterval.ONE_HOUR)
			model.addAlarm(AlarmInterval.ONE_HOUR)
			o(model.alarms).deepEquals([AlarmInterval.ONE_HOUR])
			o(model.result.alarms).deepEquals([AlarmInterval.ONE_HOUR])
		})

		o("adding alarms works", function () {
			const model = new CalendarEventEditModel(
				{
					startTime: new Date("2023-04-27T00:00:00.000Z"),
					endTime: new Date("2023-04-28T00:00:00.000Z"),
					alarmInfos: [["someListId", "someElementId"]],
				},
				"calendarId",
				ownAddresses,
				EventType.OWN,
				[AlarmInterval.ONE_HOUR],
				noOp,
				"Europe/Berlin",
			)

			model.addAlarm(AlarmInterval.ONE_DAY)
			o(model.alarms).deepEquals([AlarmInterval.ONE_HOUR, AlarmInterval.ONE_DAY])
			const { alarms, event } = model.result
			o(alarms).deepEquals([AlarmInterval.ONE_HOUR, AlarmInterval.ONE_DAY])
			o(event.alarmInfos).deepEquals([])
		})

		o("removing an alarm works", function () {
			const model = new CalendarEventEditModel(
				{
					startTime: new Date("2023-04-27T00:00:00.000Z"),
					endTime: new Date("2023-04-28T00:00:00.000Z"),
					alarmInfos: [["someListId", "someElementId"]],
				},
				"calendarId",
				ownAddresses,
				EventType.OWN,
				[AlarmInterval.ONE_HOUR],
				noOp,
				"Europe/Berlin",
			)
			model.removeAlarm(AlarmInterval.ONE_HOUR)
			model.removeAlarm(AlarmInterval.ONE_DAY)
			o(model.alarms).deepEquals([])
			const { alarms, event } = model.result
			o(alarms).deepEquals([])
			o(event.alarmInfos).deepEquals([])
		})
	})

	o.spec("calendar", function () {
		o("setting the calendar has an effect", function () {
			const model = getModelBerlin({
				startTime: new Date("2023-04-27T01:00:00.000Z"),
				endTime: new Date("2023-04-27T00:02:00.000Z"),
			})

			o(model.selectedCalendar).equals("calendarId")
			o(model.result.calendar).equals("calendarId")
			model.selectedCalendar = "calendarId2"
			o(model.selectedCalendar).equals("calendarId2")
			o(model.result.calendar).equals("calendarId2")
		})
	})

	o.spec("free-form text fields", function () {
		o("setting the location has an effect and is sanitized", function () {
			const model = new CalendarEventEditModel(
				{
					startTime: new Date("2023-04-27T01:00:00.000Z"),
					endTime: new Date("2023-04-27T00:02:00.000Z"),
					location: "north of the south",
				},
				"calendarId",
				ownAddresses,
				EventType.OWN,
				[],
				noOp,
				"Europe/Berlin",
			)

			o(model.location).equals("north of the south")
			o(model.result.event.location).equals("north of the south")

			model.location = "<script> const evil = 13 </script> some more location data"
			o(model.location).equals("some more location data")
			o(model.result.event.location).equals("some more location data")
		})

		o("setting the summary has an effect and is sanitized", function () {
			const model = new CalendarEventEditModel(
				{
					startTime: new Date("2023-04-27T01:00:00.000Z"),
					endTime: new Date("2023-04-27T00:02:00.000Z"),
					summary: "north of the south",
				},
				"calendarId",
				ownAddresses,
				EventType.OWN,
				[],
				noOp,
				"Europe/Berlin",
			)

			o(model.summary).equals("north of the south")
			o(model.result.event.summary).equals("north of the south")

			model.summary = "<script> const evil = 13 </script> some more summary data"
			o(model.summary).equals("some more summary data")
			o(model.result.event.summary).equals("some more summary data")
		})

		o("setting the description has an effect and is sanitized", function () {
			const model = new CalendarEventEditModel(
				{
					startTime: new Date("2023-04-27T01:00:00.000Z"),
					endTime: new Date("2023-04-27T00:02:00.000Z"),
					description: "north of the south",
				},
				"calendarId",
				ownAddresses,
				EventType.OWN,
				[],
				noOp,
				"Europe/Berlin",
			)

			o(model.description).equals("north of the south")
			o(model.result.event.description).equals("north of the south")

			model.description = "<script> const evil = 13 </script> some more description data"
			o(model.description).equals("some more description data")
			o(model.result.event.description).equals("some more description data")
		})
	})

	o.spec("exclusions", function () {
		// FIXME: add some tests.
	})

	o.spec("rescheduling single occurrence", function () {
		// FIXME: add some tests.
	})
})
