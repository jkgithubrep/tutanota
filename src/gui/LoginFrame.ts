import m, { Component, Params, Vnode, VnodeDOM } from "mithril"
import { IFrameWebauthn } from "../misc/2fa/webauthn/IFrameWebauthn.js"
import { Thunk } from "@tutao/tutanota-utils"

export type LoginFrameAttrs = {
	iframeWebauthn: IFrameWebauthn
	url: string
	args: Params
	doIt: Thunk
}

export class LoginFrame implements Component<LoginFrameAttrs> {
	private webauthn!: IFrameWebauthn

	oncreate(vnode: VnodeDOM<LoginFrameAttrs>) {
		console.log("oncreate loginframe")
		this.webauthn = vnode.attrs.iframeWebauthn
		this.webauthn.init(vnode.dom as HTMLIFrameElement, vnode.attrs.url).then(() => vnode.attrs.doIt())
	}

	onremove(vnode: VnodeDOM<LoginFrameAttrs>) {
		console.log("done with webauthn")
		this.webauthn.dispose()
	}

	view(vnode: Vnode<LoginFrameAttrs>) {
		const src = vnode.attrs.url + "?" + m.buildQueryString(vnode.attrs.args)
		// https://www.w3.org/TR/webauthn-2/#sctn-iframe-guidance
		// https://developer.mozilla.org/en-US/docs/Web/HTTP/Permissions_Policy#iframe_syntax
		return m("iframe", {
			src,
			allow: "publickey-credentials-get *; identity-credentials-get *",
			title: "view of your login domain to confirm your 2nd factor",
		})
	}
}
