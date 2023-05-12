import { htmlSanitizer } from "../../../misc/HtmlSanitizer.js"
import { noOp } from "@tutao/tutanota-utils"

export class SanitizedTextViewModel {
	private sanitizedText: string | null = null

	constructor(private text: string, private readonly uiUpdateCallback: () => void = noOp) {}

	set content(v: string) {
		this.sanitizedText = null
		this.text = v
		this.uiUpdateCallback()
	}

	get content(): string {
		if (this.sanitizedText == null) {
			this.sanitizedText = sanitizeText(this.text)
		}
		return this.sanitizedText
	}
}

function sanitizeText(value: string): string {
	// FIXME: how to decide which content to block? existing event / invite
	return htmlSanitizer.sanitizeHTML(value, { blockExternalContent: false }).html
}
