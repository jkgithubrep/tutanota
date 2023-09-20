import m, { Component, Params, Vnode, VnodeDOM } from "mithril"

type LoginFrameAttrs = {
	url: string
	args: Params
}

export class LoginFrame implements Component<LoginFrameAttrs> {
	private dom!: HTMLIFrameElement

	private readonly handleMessage = (event: MessageEvent) => {
		console.log("origin", event.origin)
		console.log("message", event.data)
	}

	oncreate(vnode: VnodeDOM<LoginFrameAttrs>) {
		console.log("oncreate loginframe")
		this.dom = vnode.dom as HTMLIFrameElement
		window.addEventListener("message", this.handleMessage)
	}

	onremove(vnode: VnodeDOM<LoginFrameAttrs>) {
		window.removeEventListener("message", this.handleMessage)
	}

	view(vnode: Vnode<LoginFrameAttrs>) {
		const src = vnode.attrs.url + "?" + m.buildQueryString(vnode.attrs.args)
		return m("iframe", {
			src,
			sandbox: "allow-scripts",
			title: "view of your login domain to confirm your 2nd factor",
		})
	}
}
