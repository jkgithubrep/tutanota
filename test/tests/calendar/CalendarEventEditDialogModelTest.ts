import o from "ospec"

import { CalendarEventEditDialogViewModel, EventType } from "../../../src/calendar/date/CalendarEventEditDialogViewModel.js"
import { CalendarEvent, createEncryptedMailAddress } from "../../../src/api/entities/tutanota/TypeRefs.js"
import { noOp } from "@tutao/tutanota-utils"
import { isAllDayEvent } from "../../../src/api/common/utils/CommonCalendarUtils.js"
import { getEventWithDefaultTimes } from "../../../src/calendar/date/CalendarEventViewModel.js"
import { Time } from "../../../src/api/common/utils/Time.js"

o.spec("CalendarEventEditModel", function () {
	const calendars: Array<Id> = ["calendarId"]

	o.spec("date modifications", function () {
		o("if the start date is set to before 1970, it will be set to this year", function () {
			const initialValues: Partial<CalendarEvent> = {
				startTime: new Date("2023-04-27T08:27:45.523Z"),
				endTime: new Date("2023-04-27T08:57:45.523Z"),
			}
			const model = new CalendarEventEditDialogViewModel(
				initialValues,
				calendars,
				"calendarId",
				[
					createEncryptedMailAddress({
						address: "calendarOwner@tutanota.de",
						name: "Calendar Owner",
					}),
				],
				EventType.OWN,
				[],
				"Europe/Berlin",
				noOp,
			)

			model.startDate = new Date("1969-04-27T08:27:45.523Z")

			o(model.startDate.getFullYear()).equals(new Date().getFullYear())
		})

		o("if the start time is changed, the end time changes by the same amount", function () {
			const initialValues: Partial<CalendarEvent> = {
				startTime: new Date("2023-04-27T08:27:45.523Z"),
				endTime: new Date("2023-04-27T08:57:45.523Z"),
			}
			const model = new CalendarEventEditDialogViewModel(
				initialValues,
				calendars,
				"calendarId",
				[
					createEncryptedMailAddress({
						address: "calendarOwner@tutanota.de",
						name: "Calendar Owner",
					}),
				],
				EventType.OWN,
				[],
				"Europe/Berlin",
				noOp,
			)
			const startTime = model.startTime
			o(startTime.to24HourString()).equals("10:27")
			model.startTime = new Time(startTime.hours, startTime.minutes + 3)

			o(model.startTime.to24HourString()).equals("10:30")
			o(model.endTime.to24HourString()).equals("11:00")
			const result = model.result
			o(result.startTime.toISOString()).equals("2023-04-27T08:30:45.523Z")
			o(result.endTime.toISOString()).equals("2023-04-27T09:00:45.523Z")
		})

		o("all day is set correctly for an event that is all-day by times", function () {
			const initialValues: Partial<CalendarEvent> = {
				startTime: new Date("2023-04-27T00:00:00.000Z"),
				endTime: new Date("2023-04-28T00:00:00.000Z"),
			}
			const model = new CalendarEventEditDialogViewModel(
				initialValues,
				calendars,
				"calendarId",
				[
					createEncryptedMailAddress({
						address: "calendarOwner@tutanota.de",
						name: "Calendar Owner",
					}),
				],
				EventType.OWN,
				[],
				"Europe/Berlin",
				noOp,
			)
			o(model.isAllDay).equals(true)
		})

		o("all day is set correctly for an event that is not all-day by times", function () {
			const initialValues: Partial<CalendarEvent> = {
				startTime: new Date("2023-04-27T01:00:00.000Z"),
				endTime: new Date("2023-04-28T00:02:00.000Z"),
			}
			const model = new CalendarEventEditDialogViewModel(
				initialValues,
				calendars,
				"calendarId",
				[
					createEncryptedMailAddress({
						address: "calendarOwner@tutanota.de",
						name: "Calendar Owner",
					}),
				],
				EventType.OWN,
				[],
				"Europe/Berlin",
				noOp,
			)
			o(model.isAllDay).equals(false)
		})

		o("setting all-day correctly sets utc times to midnight", function () {
			const initialValues: Partial<CalendarEvent> = {
				startTime: new Date("2023-04-27T01:00:00.000Z"),
				endTime: new Date("2023-04-28T00:02:00.000Z"),
			}
			const model = new CalendarEventEditDialogViewModel(
				initialValues,
				calendars,
				"calendarId",
				[
					createEncryptedMailAddress({
						address: "calendarOwner@tutanota.de",
						name: "Calendar Owner",
					}),
				],
				EventType.OWN,
				[],
				"Europe/Berlin",
				noOp,
			)
			model.isAllDay = true
			const result = model.result
			o(result.startTime.toISOString()).equals("2023-04-27T00:00:00.000Z")
			o(result.endTime.toISOString()).equals("2023-04-29T00:00:00.000Z")
			o(isAllDayEvent(result)).equals(true)
		})

		o("setting all-day correctly sets utc times to midnight on an event with same start and end date", function () {
			const initialValues: Partial<CalendarEvent> = {
				startTime: new Date("2023-04-27T01:00:00.000Z"),
				endTime: new Date("2023-04-27T00:02:00.000Z"),
			}
			const model = new CalendarEventEditDialogViewModel(
				initialValues,
				calendars,
				"calendarId",
				[
					createEncryptedMailAddress({
						address: "calendarOwner@tutanota.de",
						name: "Calendar Owner",
					}),
				],
				EventType.OWN,
				[],
				"Europe/Berlin",
				noOp,
			)
			model.isAllDay = true
			const result = model.result
			o(result.startTime.toISOString()).equals("2023-04-27T00:00:00.000Z")
			o(result.endTime.toISOString()).equals("2023-04-28T00:00:00.000Z")
			o(isAllDayEvent(result)).equals(true)
		})

		o("setting all day to false will cause result to not be considered all-day and the times to be set to the default", function () {
			// FIXME: this test might fail if run on exactly a full half hour
			const initialValues: Partial<CalendarEvent> = {
				startTime: new Date("2023-04-27T00:00:00.000Z"),
				endTime: new Date("2023-04-28T00:00:00.000Z"),
			}
			const model = new CalendarEventEditDialogViewModel(
				initialValues,
				calendars,
				"calendarId",
				[
					createEncryptedMailAddress({
						address: "calendarOwner@tutanota.de",
						name: "Calendar Owner",
					}),
				],
				EventType.OWN,
				[],
				"Europe/Berlin",
				noOp,
			)

			const eventWithDefaults = getEventWithDefaultTimes()

			model.isAllDay = false
			const result = model.result
			o(result.startTime.toISOString()).equals(eventWithDefaults.startTime?.toISOString())
			o(result.endTime.toISOString()).equals(eventWithDefaults.endTime?.toISOString())
			o(isAllDayEvent(result)).equals(false)
		})
	})
})
