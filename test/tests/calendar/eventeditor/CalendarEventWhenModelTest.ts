import o from "ospec"
import { noOp } from "@tutao/tutanota-utils"
import { getEventWithDefaultTimes, isAllDayEvent } from "../../../../src/api/common/utils/CommonCalendarUtils.js"
import { Time } from "../../../../src/api/common/utils/Time.js"
import { CalendarEventWhenModel, getDefaultEndCountValue } from "../../../../src/calendar/model/eventeditor/CalendarEventWhenModel.js"
import { EndType, RepeatPeriod } from "../../../../src/api/common/TutanotaConstants.js"
import { createDateWrapper, createRepeatRule } from "../../../../src/api/entities/sys/TypeRefs.js"
import { CalendarEvent, createCalendarEvent } from "../../../../src/api/entities/tutanota/TypeRefs.js"
import { DateTime } from "luxon"

o.spec("CalendarEventWhenModel", function () {
	const getModelBerlin = (initialValues: Partial<CalendarEvent>) => new CalendarEventWhenModel(initialValues, "Europe/Berlin", noOp)

	const getModelKrasnoyarsk = (initialValues: Partial<CalendarEvent>) => new CalendarEventWhenModel(initialValues, "Asia/Krasnoyarsk", noOp)

	o.spec("date modifications", function () {
		o("if the start date is set to before 1970, it will be set to this year", function () {
			const model = getModelBerlin({
				startTime: new Date("2023-04-27T08:27:45.523Z"),
				endTime: new Date("2023-04-27T08:57:45.523Z"),
			})
			model.startDate = new Date("1969-04-27T08:27:00.000Z")
			o(model.startDate.getFullYear()).equals(new Date().getFullYear())
		})
		o("if the start time is changed while not all-day, the end time changes by the same amount", function () {
			const model = getModelBerlin({
				startTime: new Date("2023-04-27T08:27:00.000Z"),
				endTime: new Date("2023-04-27T08:57:00.000Z"),
			})
			const startTime = model.startTime
			o(startTime.to24HourString()).equals("10:27")
			model.startTime = new Time(startTime.hour, startTime.minute + 3)

			o(model.startTime.to24HourString()).equals("10:30")
			o(model.endTime.to24HourString()).equals("11:00")
			const result = model.result
			o(result.startTime.toISOString()).equals("2023-04-27T08:30:00.000Z")
			o(result.endTime.toISOString()).equals("2023-04-27T09:00:00.000Z")
		})
		o("if the start date is changed while not all-day, the end time changes by the same amount", function () {
			const model = getModelBerlin({
				startTime: new Date("2023-04-27T08:27:00.000Z"),
				endTime: new Date("2023-04-27T08:57:00.000Z"),
			})
			const startDate = model.startDate
			o(startDate.toISOString()).equals("2023-04-26T22:00:00.000Z")("start date is start of the day in utc")
			model.startDate = new Date("2023-04-30T05:15:00.000Z")

			o(model.startDate.toISOString()).equals("2023-04-29T22:00:00.000Z")("start date was moved by three days")
			o(model.endDate.toISOString()).equals("2023-04-29T22:00:00.000Z")("end date was moved by three days")
			const result = model.result
			o(result.startTime.toISOString()).equals("2023-04-30T08:27:00.000Z")("start time on result is correct and includes time")
			o(result.endTime.toISOString()).equals("2023-04-30T08:57:00.000Z")("end time on result is correct and includes time")
		})
		o("if the start date is changed while all-day, the end time changes by the same amount", function () {
			const model = getModelBerlin({
				startTime: new Date("2023-04-27T08:27:00.000Z"),
				endTime: new Date("2023-04-27T08:57:00.000Z"),
			})
			model.isAllDay = true
			o(model.startDate.toISOString()).equals("2023-04-26T22:00:00.000Z")("start date for display is start of day in local timezone, not UTC")
			o(model.endDate.toISOString()).equals("2023-04-26T22:00:00.000Z")("end date for display is start of day in local timezone, not UTC")
			// plus three days
			model.startDate = new Date("2023-04-30T08:27:00.000Z")

			o(model.startDate.toISOString()).equals("2023-04-29T22:00:00.000Z")("new start date is displayed as start of current day in local tz")
			o(model.endDate.toISOString()).equals("2023-04-29T22:00:00.000Z")("new end date has also been changed")
			const result = model.result
			o(result.startTime.toISOString()).equals("2023-04-30T00:00:00.000Z")("start date on result is correct")
			o(result.endTime.toISOString()).equals("2023-05-01T00:00:00.000Z")("end date on result is correct")
		})
		o("modifying the start time while the event is all-day has no effect after unsetting all-day", function () {
			const model = getModelBerlin({
				startTime: new Date("2023-04-27T08:27:45.523Z"),
				endTime: new Date("2023-04-27T08:57:45.523Z"),
			})
			o(model.isAllDay).equals(false)
			o(model.startTime.to24HourString()).equals("10:27")("still the start time we gave the model")
			model.isAllDay = true
			model.startTime = new Time(13, 30)
			const allDayResult = model.result
			o(allDayResult.startTime.toISOString()).equals("2023-04-27T00:00:00.000Z")
			model.isAllDay = false
			o(model.startTime.to24HourString()).equals("10:27")("still the start time we gave the model after change")
			const result = model.result
			o(result.startTime.toISOString()).equals("2023-04-27T08:27:00.000Z")
		})
		o("modifying the end time while the event is all-day has no effect after unsetting all-day", function () {
			const model = getModelBerlin({
				startTime: new Date("2023-04-27T08:27:45.523Z"),
				endTime: new Date("2023-04-27T08:57:45.523Z"),
			})
			o(model.endTime.to24HourString()).equals("10:57")("initialization correctly applied")
			model.isAllDay = true
			model.endTime = new Time(13, 30)
			o(model.endTime.to24HourString()).equals("00:00")("all-day causes zeroed time")
			const allDayResult = model.result
			o(allDayResult.endTime.toISOString()).equals("2023-04-28T00:00:00.000Z")("the result also comes without a time part")
			model.isAllDay = false
			o(model.endTime.to24HourString()).equals("10:57")("still has old time after unsetting all-day")
			const result = model.result
			o(result.endTime.toISOString()).equals("2023-04-27T08:57:00.000Z")("the not-all-day-result includes the time")
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
			o(model.endDate.toISOString()).equals("2023-04-27T22:00:00.000Z")("the initialization was correctly applied")
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
			// NOTE: this test might fail if run on exactly a full half hour. it's time dependent because the default
			// is created by the model by calling new Date()
			const now = new Date()
			const eventWithDefaults = getEventWithDefaultTimes()
			eventWithDefaults.startTime = DateTime.fromJSDate(eventWithDefaults.startTime).set({ millisecond: 0, second: 0 }).toJSDate()
			eventWithDefaults.endTime = DateTime.fromJSDate(eventWithDefaults.endTime).set({ millisecond: 0, second: 0 }).toJSDate()
			const model = getModelBerlin({
				startTime: DateTime.fromJSDate(now, { zone: "utc" }).set({ hour: 0, minute: 0, second: 0, millisecond: 0 }).toJSDate(),
				endTime: DateTime.fromJSDate(now, { zone: "utc" }).set({ hour: 0, minute: 0, second: 0, millisecond: 0 }).plus({ day: 1 }).toJSDate(),
			})

			o(model.isAllDay).equals(true)("correctly devised the all-day status")
			model.isAllDay = false
			const result = model.result
			o(result.startTime.toISOString()).equals(eventWithDefaults.startTime?.toISOString())("default start time was correctly applied")
			o(result.endTime.toISOString()).equals(eventWithDefaults.endTime?.toISOString())("default end time was correctly applied")
			o(isAllDayEvent(result)).equals(false)("the result is not considered all-day")
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

	o.spec("repeat rules", function () {
		o("the repeat interval is reflected on the result and for display, no repeat", function () {
			const model = getModelBerlin({
				startTime: new Date("2023-04-27T00:00:00.000Z"),
				endTime: new Date("2023-04-28T00:00:00.000Z"),
				repeatRule: null,
			})
			o(model.repeatPeriod).equals(null)
			o(model.result.repeatRule).equals(null)
		})

		o("repeat interval is set to daily", function () {
			const model = getModelBerlin({
				startTime: new Date("2023-04-27T00:00:00.000Z"),
				endTime: new Date("2023-04-28T00:00:00.000Z"),
				repeatRule: null,
			})

			model.repeatPeriod = RepeatPeriod.DAILY
			o(model.repeatPeriod).equals(RepeatPeriod.DAILY)
			o(model.result.repeatRule).deepEquals(
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
			const result = model.result

			model.repeatEndType = EndType.Count
			model.repeatEndOccurrences = 13
			o(model.repeatEndOccurrences).equals(13)

			o(model.result.repeatRule?.endType).equals(EndType.Count)
			o(model.result.repeatRule?.endValue).equals("13")
			const before = model.repeatEndDateForDisplay
			model.repeatEndDateForDisplay = new Date("2022-04-03T13:00:00.000Z")
			const after = model.repeatEndDateForDisplay
			o(before.toISOString()).equals(after.toISOString())
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
			const endDateForSaving = new Date("2023-05-28T00:00:00.000Z")
			const cleanEndDate = new Date("2023-05-26T22:00:00.000Z")
			model.repeatEndType = EndType.UntilDate
			model.repeatEndDateForDisplay = endDate
			o(model.repeatEndType).equals(EndType.UntilDate)
			o(model.repeatEndDateForDisplay.toISOString()).equals(cleanEndDate.toISOString())
			const result = model.result
			o(result.repeatRule?.endType).equals(EndType.UntilDate)
			o(new Date(parseInt(result.repeatRule?.endValue ?? "")).toISOString()).equals(endDateForSaving.toISOString())(
				"one day after the date we set through GUI",
			)

			o(model.repeatEndOccurrences).equals(Number(getDefaultEndCountValue()))

			model.repeatPeriod = null
			o(model.repeatPeriod).equals(null)
			o(model.result.repeatRule).equals(null)
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

			const endOnCountResult = model.result
			model.repeatEndDateForDisplay = new Date("2023-04-27T13:00:00.000Z")
			o(model.repeatEndDateForDisplay.toISOString()).equals("2023-05-26T22:00:00.000Z")(
				"nothing changed and we get the default value when asking for the end date.",
			)
			const changedEndOnCountResult = model.result
			o(changedEndOnCountResult).deepEquals(endOnCountResult)

			model.repeatEndType = EndType.UntilDate
			const endOnDateResult = model.result
			model.repeatEndOccurrences = 5
			model.repeatEndDateForDisplay = new Date("2023-04-27T13:00:00.000Z")
			o(model.repeatEndOccurrences).equals(10)
			const changedEndOnDateResult = model.result
			o(changedEndOnDateResult).deepEquals(endOnDateResult)
			o(new Date(parseInt(endOnDateResult.repeatRule?.endValue ?? "")).toISOString()).deepEquals("2023-04-28T00:00:00.000Z")
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
			o(model.result.repeatRule?.interval).equals("1")
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
			o(model.result.repeatRule?.interval).equals("10")
			model.repeatInterval = 5
			o(model.repeatInterval).equals(5)
			o(model.result.repeatRule?.interval).equals("5")
		})
	})

	o.spec("deleteExcludedDates", function () {
		o("clears the array of excluded dates", async function () {
			const model = await getModelBerlin(
				createCalendarEvent({
					repeatRule: createRepeatRule({
						excludedDates: [createDateWrapper({ date: new Date("2023-03-13T00:00:00Z") })],
					}),
				}),
			)

			model.deleteExcludedDates()
			o(model.excludedDates).deepEquals([])
			o(model.result.repeatRule?.excludedDates).deepEquals([])
		})
		// o("end occurrence changes delete exclusions", async function () {
		// 	const userController = makeUserController()
		// 	const excludedDates = [new Date("2023-03-13T00:00:00Z")]
		// 	const viewModel = await init({
		// 		userController,
		// 		calendars: makeCalendars("own"),
		// 		existingEvent: createCalendarEvent({
		// 			repeatRule: createRepeatRule({
		// 				frequency: "1",
		// 				interval: "1",
		// 				endType: EndType.Count,
		// 				endValue: "10",
		// 				excludedDates: excludedDates.map((date) => createDateWrapper({ date })),
		// 			}),
		// 		}),
		// 	})
		//
		// 	viewModel.onEndOccurencesSelected(10)
		// 	o(viewModel.repeat?.excludedDates).deepEquals(excludedDates)
		// 	viewModel.onEndOccurencesSelected(2)
		// 	o(viewModel.repeat?.excludedDates).deepEquals([])
		// })
		// o("interval changes delete exclusions", async function () {
		// 	const userController = makeUserController()
		// 	const excludedDates = [new Date("2023-03-13T00:00:00Z")]
		// 	const viewModel = await init({
		// 		userController,
		// 		calendars: makeCalendars("own"),
		// 		existingEvent: createCalendarEvent({
		// 			repeatRule: createRepeatRule({
		// 				frequency: "1",
		// 				interval: "1",
		// 				endType: EndType.Count,
		// 				endValue: "10",
		// 				excludedDates: excludedDates.map((date) => createDateWrapper({ date })),
		// 			}),
		// 		}),
		// 	})
		//
		// 	viewModel.onRepeatIntervalChanged(1)
		// 	o(viewModel.repeat?.excludedDates).deepEquals(excludedDates)
		// 	viewModel.onRepeatIntervalChanged(2)
		// 	o(viewModel.repeat?.excludedDates).deepEquals([])
		// })
		// o("frequency changes delete exclusions", async function () {
		// 	const userController = makeUserController()
		// 	const excludedDates = [new Date("2023-03-13T00:00:00Z")]
		// 	const viewModel = await init({
		// 		userController,
		// 		calendars: makeCalendars("own"),
		// 		existingEvent: createCalendarEvent({
		// 			repeatRule: createRepeatRule({
		// 				frequency: "1",
		// 				interval: "1",
		// 				endType: EndType.Count,
		// 				endValue: "10",
		// 				excludedDates: excludedDates.map((date) => createDateWrapper({ date })),
		// 			}),
		// 		}),
		// 	})
		//
		// 	viewModel.onRepeatPeriodSelected(RepeatPeriod.WEEKLY)
		// 	o(viewModel.repeat?.excludedDates).deepEquals(excludedDates)
		// 	viewModel.onRepeatPeriodSelected(RepeatPeriod.DAILY)
		// 	o(viewModel.repeat?.excludedDates).deepEquals([])
		// })
		// o("end date changes delete exclusions", async function () {
		// 	const userController = makeUserController()
		// 	const excludedDates = [new Date("2023-04-13T15:00:00Z")]
		// 	const originalUntilDate = new Date("2023-05-13T00:00:00Z")
		// 	let b = new Date(parseInt(originalUntilDate.getTime().toString()))
		// 	const viewModel = await init({
		// 		userController,
		// 		calendars: makeCalendars("own"),
		// 		existingEvent: createCalendarEvent({
		// 			startTime: new Date("2023-01-13T15:00:00Z"),
		// 			endTime: new Date("2023-01-13T20:00:00Z"),
		// 			repeatRule: createRepeatRule({
		// 				frequency: RepeatPeriod.DAILY,
		// 				interval: "1",
		// 				endType: EndType.UntilDate,
		// 				endValue: originalUntilDate.getTime().toString(),
		// 				excludedDates: excludedDates.map((date) => createDateWrapper({ date })),
		// 			}),
		// 		}),
		// 	})
		//
		// 	viewModel.onRepeatEndDateSelected(new Date(viewModel.repeat!.endValue))
		// 	o(viewModel.repeat?.excludedDates).deepEquals(excludedDates)
		// 	viewModel.onRepeatEndDateSelected(new Date("2023-06-13T00:00:00Z"))
		// 	o(viewModel.repeat?.excludedDates).deepEquals([])
		// })
	})
	// o.spec("excludeThisOccurence", function () {
	// 	o("no exclusion is added if event has no repeat rule", async function () {
	// 		const userController = makeUserController()
	// 		const viewModel = await init({
	// 			userController,
	// 			calendars: makeCalendars("own"),
	// 			existingEvent: createCalendarEvent({ startTime: new Date("2023-03-13T00:00:00Z") }),
	// 		})
	//
	// 		await viewModel.excludeThisOccurrence()
	// 		o(viewModel.repeat).equals(null)
	// 	})
	// 	o("adding two exclusions in reverse order sorts them", async function () {
	// 		const userController = makeUserController()
	// 		const calendars = new Map()
	// 		calendars.set("ownerGroup", {
	// 			groupRoot: null,
	// 			longEvents: new LazyLoaded(async () => []),
	// 			groupInfo: null,
	// 			group: null,
	// 			shared: false,
	// 		})
	// 		const viewModel = await init({
	// 			userController,
	// 			calendars,
	// 			existingEvent: createCalendarEvent({
	// 				_id: ["listId", "elementId"],
	// 				_ownerGroup: "ownerGroup",
	// 				startTime: new Date("2023-03-12T00:00:00Z"),
	// 				endTime: new Date("2023-03-12T01:00:00Z"),
	// 				repeatRule: createRepeatRule({
	// 					frequency: RepeatPeriod.DAILY,
	// 					endType: EndType.Never,
	// 					excludedDates: [createDateWrapper({ date: new Date("2023-03-13T00:00:00Z") })],
	// 				}),
	// 			}),
	// 		})
	// 		// @ts-ignore
	// 		const mock: EntityRestClientMock = viewModel.entityClient._target as EntityRestClientMock
	// 		// @ts-ignore
	// 		mock.addListInstances(viewModel.existingEvent!)
	//
	// 		await viewModel.excludeThisOccurrence()
	//
	// 		// @ts-ignore
	// 		o(viewModel.calendarModel.updateEvent.calls[0].args[0]?.repeatRule.excludedDates).deepEquals([
	// 			createDateWrapper({ date: new Date("2023-03-12T00:00:00Z") }),
	// 			createDateWrapper({ date: new Date("2023-03-13T00:00:00Z") }),
	// 		])
	// 	})
	// 	o("adding two exclusions in order sorts them", async function () {
	// 		const userController = makeUserController()
	// 		const calendars = new Map()
	// 		calendars.set("ownerGroup", {
	// 			groupRoot: null,
	// 			longEvents: new LazyLoaded(async () => []),
	// 			groupInfo: null,
	// 			group: null,
	// 			shared: false,
	// 		})
	// 		const viewModel = await init({
	// 			userController,
	// 			calendars,
	// 			existingEvent: createCalendarEvent({
	// 				_id: ["listId", "elementId"],
	// 				_ownerGroup: "ownerGroup",
	// 				startTime: new Date("2023-03-13T00:00:00Z"),
	// 				endTime: new Date("2023-03-13T01:00:00Z"),
	// 				repeatRule: createRepeatRule({
	// 					frequency: RepeatPeriod.DAILY,
	// 					endType: EndType.Never,
	// 					excludedDates: [createDateWrapper({ date: new Date("2023-03-12T00:00:00Z") })],
	// 				}),
	// 			}),
	// 		})
	// 		// @ts-ignore
	// 		const mock: EntityRestClientMock = viewModel.entityClient._target as EntityRestClientMock
	// 		// @ts-ignore
	// 		mock.addListInstances(viewModel.existingEvent!)
	//
	// 		await viewModel.excludeThisOccurrence()
	// 		// @ts-ignore
	// 		o(viewModel.calendarModel.updateEvent.calls[0].args[0]?.repeatRule.excludedDates).deepEquals([
	// 			createDateWrapper({ date: new Date("2023-03-12T00:00:00Z") }),
	// 			createDateWrapper({ date: new Date("2023-03-13T00:00:00Z") }),
	// 		])
	// 	})
	// })
})
