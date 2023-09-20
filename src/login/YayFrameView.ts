import m, { Children, Vnode } from "mithril"
import { TopLevelAttrs, TopLevelView } from "../TopLevelView.js"
import { YayFrameViewModel } from "./YayFrameViewModel.js"

export interface YayFrameAttrs extends TopLevelAttrs {
	viewModel: YayFrameViewModel
}

/**
 * This is a special view which is not used by the web client
 * directly but is loaded as an iframe to enable login with old second
 * factors on the new domain.
 */
export class YayFrameView implements TopLevelView<YayFrameAttrs> {
	view({ attrs }: Vnode<YayFrameAttrs>): Children {
		// probably want to show progress depending on viewmodel state or something
		return m(".elevated-bg.fill-absolute", {}, ["this is something."])
	}
}
