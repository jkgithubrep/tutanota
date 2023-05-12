import type { CalendarEvent, CalendarEventAttendee, CalendarRepeatRule, EncryptedMailAddress } from "../../api/entities/tutanota/TypeRefs.js"
import { createCalendarEventAttendee, createEncryptedMailAddress } from "../../api/entities/tutanota/TypeRefs.js"
import m, { Children, Component, Vnode } from "mithril"
import { AllIcons, Icon } from "../../gui/base/Icon"
import { theme } from "../../gui/theme"
import { BootIcons } from "../../gui/base/icons/BootIcons"
import { Icons } from "../../gui/base/icons/Icons"
import { createRepeatRuleFrequencyValues, formatEventDuration, getRepeatEndTime, getTimeZone, iconForAttendeeStatus } from "../date/CalendarUtils"
import { CalendarAttendeeStatus, EndType, getAttendeeStatus, RepeatPeriod } from "../../api/common/TutanotaConstants"
import { downcast, memoized } from "@tutao/tutanota-utils"
import { lang } from "../../misc/LanguageViewModel"
import type { RepeatRule } from "../../api/entities/sys/TypeRefs.js"
import { findAttendeeInAddresses, isAllDayEvent } from "../../api/common/utils/CommonCalendarUtils"
import { formatDateWithMonth } from "../../misc/Formatter"
import { hasError } from "../../api/common/utils/ErrorCheckUtils"
import { renderReplyButtons } from "../../mail/view/EventBanner.js"

export type EventPreviewViewAttrs = {
	event: Omit<CalendarEvent, "description">
	sanitizedDescription: string | null
	setParticipation?: (status: CalendarAttendeeStatus) => void
}

export class EventPreviewView implements Component<EventPreviewViewAttrs> {
	// Cache the parsed URL so we don't parse the URL on every single view call
	private readonly getLocationUrl: typeof getLocationUrl

	constructor() {
		this.getLocationUrl = memoized(getLocationUrl)
	}

	view({ attrs: { event, sanitizedDescription, setParticipation } }: Vnode<EventPreviewViewAttrs>): Children {
		const attendees = prepareAttendees(event.attendees, event.organizer)

		return m(".flex.col", [
			m(".flex.col.smaller", [
				m(".flex.pb-s.items-center", [this.renderSectionIndicator(BootIcons.Calendar), m(".h3.selectable.text-break", event.summary)]),
				m(".flex.pb-s", [
					this.renderSectionIndicator(Icons.Time),
					m(".align-self-center.selectable.flex-column", [
						m("", formatEventDuration(event, getTimeZone(), false)),
						this.renderRepeatRule(event.repeatRule, isAllDayEvent(event)),
					]),
				]),
				this.renderLocation(event.location),
				this.renderAttendeesSection(attendees),
				this.renderAttendanceSection(attendees, setParticipation),
				this.renderDescription(sanitizedDescription),
			]),
		])
	}

	private renderSectionIndicator(icon: AllIcons, style: Record<string, any> = {}): Children {
		return m(
			".pr",
			m(Icon, {
				icon,
				large: true,
				style: Object.assign(
					{
						fill: theme.content_button,
						display: "block",
					},
					style,
				),
			}),
		)
	}

	private renderRepeatRule(rule: CalendarRepeatRule | null, isAllDay: boolean): Children {
		if (rule == null) return null

		const frequency = formatRepetitionFrequency(rule)

		if (frequency) {
			return m("", frequency + formatRepetitionEnd(rule, isAllDay))
		} else {
			// If we cannot properly process the frequency we just indicate that the event is part of a series.
			return m("", lang.get("unknownRepetition_msg"))
		}
	}

	private renderLocation(location: string | null): Children {
		if (location == null) return
		return m(".flex.pb-s.items-center", [
			this.renderSectionIndicator(Icons.Pin),
			m(
				".text-ellipsis.selectable",
				m(
					"a",
					{
						href: this.getLocationUrl(location.trim()).toString(),
						target: "_blank",
						rel: "noopener noreferrer",
					},
					location,
				),
			),
		])
	}

	private renderAttendeesSection(attendees: Array<CalendarEventAttendee>): Children {
		if (attendees.length === 0) return null
		return m(".flex.pb-s", [
			this.renderSectionIndicator(Icons.People),
			m(
				".flex-wrap",
				attendees.map((a) => this.renderAttendee(a)),
			),
		])
	}

	/**
	 * if we're an attendee of this event, this renders a selector to be able to set our own attendance.
	 * @param attendees list of attendees (including the organizer)
	 * @param setParticipation function to send a participation reply for this event.
	 * @private
	 */
	private renderAttendanceSection(attendees: Array<CalendarEventAttendee>, setParticipation?: (status: CalendarAttendeeStatus) => void): Children {
		if (attendees.length === 0 || setParticipation == null) return null
		return m(".flex.pb-s", [this.renderSectionIndicator(BootIcons.Contacts), renderReplyButtons(setParticipation, CalendarAttendeeStatus.DECLINED)])
	}

	private renderAttendee(attendee: CalendarEventAttendee): Children {
		let attendeeField = attendee.address.address

		if (hasError(attendee.address)) {
			attendeeField = lang.get("corruptedValue_msg")
		}

		return m(".flex.items-center", [
			m(Icon, {
				icon: iconForAttendeeStatus[getAttendeeStatus(attendee)],
				style: {
					fill: theme.content_fg,
				},
				class: "mr-s",
			}),
			m(".span.line-break-anywhere.selectable", attendeeField),
		])
	}

	private renderDescription(sanitizedDescription: string | null) {
		return sanitizedDescription
			? m(".flex.pb-s.items-start", [
					this.renderSectionIndicator(Icons.AlignLeft, {
						marginTop: "2px",
					}),
					m(".full-width.selectable.text-break", m.trust(sanitizedDescription)),
			  ])
			: null
	}
}

/**
 * if text is a valid absolute url, then returns a URL with text as the href
 * otherwise passes text as the search parameter for open street map
 * @param text
 * @returns {*}
 */
function getLocationUrl(text: string): URL {
	const osmHref = `https://www.openstreetmap.org/search?query=${text}`
	let url

	try {
		// if not a valid _absolute_ url then we get an exception
		url = new URL(text)
	} catch {
		url = new URL(osmHref)
	}

	return url
}

function formatRepetitionFrequency(repeatRule: RepeatRule): string | null {
	if (repeatRule.interval === "1") {
		const frequency = createRepeatRuleFrequencyValues().find((frequency) => frequency.value === repeatRule.frequency)

		if (frequency) {
			return frequency.name
		}
	} else {
		return lang.get("repetition_msg", {
			"{interval}": repeatRule.interval,
			"{timeUnit}": getFrequencyTimeUnit(downcast(repeatRule.frequency)),
		})
	}

	return null
}

/**
 * @returns {string} The returned string includes a leading separator (", " or " ").
 */
function formatRepetitionEnd(repeatRule: RepeatRule, isAllDay: boolean): string {
	switch (repeatRule.endType) {
		case EndType.Count:
			if (!repeatRule.endValue) {
				return ""
			}

			return (
				", " +
				lang.get("times_msg", {
					"{amount}": repeatRule.endValue,
				})
			)

		case EndType.UntilDate:
			const repeatEndTime = getRepeatEndTime(repeatRule, isAllDay, getTimeZone())
			return " " + lang.get("until_label") + " " + formatDateWithMonth(repeatEndTime)

		default:
			return ""
	}
}

function getFrequencyTimeUnit(frequency: RepeatPeriod): string {
	switch (frequency) {
		case RepeatPeriod.DAILY:
			return lang.get("days_label")

		case RepeatPeriod.WEEKLY:
			return lang.get("weeks_label")

		case RepeatPeriod.MONTHLY:
			return lang.get("months_label")

		case RepeatPeriod.ANNUALLY:
			return lang.get("years_label")

		default:
			throw new Error("Unknown calendar event repeat rule frequency: " + frequency)
	}
}

function prepareAttendees(attendees: Array<CalendarEventAttendee>, organizer: EncryptedMailAddress | null): Array<CalendarEventAttendee> {
	// We copy the attendees array so that we can add the organizer, in the case that they are not already in attendees
	// This is just for display purposes. We need to copy because event.attendees is the source of truth for the event
	// so we can't modify it
	const attendeesCopy = attendees.slice()

	if (organizer != null && attendeesCopy.length > 0 && !findAttendeeInAddresses(attendeesCopy, [organizer.address])) {
		attendeesCopy.unshift(
			createCalendarEventAttendee({
				address: createEncryptedMailAddress({
					address: organizer.address,
				}),
				status: CalendarAttendeeStatus.ADDED, // We don't know whether the organizer will be attending or not in this case
			}),
		)
	}

	return attendeesCopy
}
