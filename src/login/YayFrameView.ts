import m, { Children, Vnode } from "mithril"
import { TopLevelAttrs, TopLevelView } from "../TopLevelView.js"

export interface YayFrameAttrs extends TopLevelAttrs {
	msg: string
}

/**
 * This is a special view which is not used by the web client
 * directly but is loaded as an iframe to enable login with old second
 * factors on the new domain.
 */
export class YayFrameView implements TopLevelView<YayFrameAttrs> {
	oncreate({ attrs }: Vnode<YayFrameAttrs>) {
		console.log(attrs.args)
		const targetWindow = window.parent
		// there's no safe, generic cross-origin way to detect the parents origin, so we need to hardcode it or put it into some build constant.
		targetWindow.postMessage("hello from yayframeview", "https://localcustom.keemail.de:9000")
	}

	view({ attrs }: Vnode<YayFrameAttrs>): Children {
		return m(".elevated-bg", attrs.msg)
	}

	private async sendSuccess(value: unknown, cbUrlTemplate: string) {
		// await this.sendResultObject({ type: "success", value }, cbUrlTemplate)
	}

	private async sendFailure(e: Error, cbUrlTemplate: string) {
		// await this.sendResultObject({ type: "error", name: e.name, stack: e.stack }, cbUrlTemplate)
	}

	private async sendResultObject(result: object, cbUrlTemplate: string) {
		//const { encodeValueForNative } = await import("../native/common/NativeLineProtocol.js")
		//const serializedResult = encodeValueForNative(result)
		//const base64Result = stringToBase64(serializedResult)
		//const cbUrl = cbUrlTemplate.replace("{result}", base64Result)
		//window.open(cbUrl, "_self")
	}

	async authenticate(attrs: YayFrameAttrs) {}
}
