import m, { Children, Vnode } from "mithril"
import { TopLevelAttrs, TopLevelView } from "../TopLevelView.js"

export interface YayFrameAttrs extends TopLevelAttrs {
	msg: string
}

/**
 * This is a special view which is not used by the web client
 * directly but is loaded remotely by mobile client.
 * See AndroidWebauthnFacade and IosWebauthnFacade.
 */
export class YayFrameView implements TopLevelView<YayFrameAttrs> {
	oncreate({ attrs }: Vnode<YayFrameAttrs>) {
		console.log(attrs.args)
		const targetWindow = window.parent
		targetWindow.postMessage("hello from yayframeview", "https://localcustom.keemail.de:9000")
	}

	view({ attrs }: Vnode<YayFrameAttrs>): Children {
		return m(".backg", attrs.msg)
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
