import m, { Children, Component, Vnode } from "mithril"
import { IconButton } from "../gui/base/IconButton.js"
import { Icons } from "../gui/base/icons/Icons.js"

export class CollaborativeEditorView implements Component {
	view(): Children {
		return m(".flex.flex-column", [this._renderContent()])
	}

	_renderContent(): Children {
		return m(
			"",
			[
				m(
					".flex.mt-l.center-vertically.selectable",
					m(".h4.text-ellipsis"),
					m(".flex.flex-grow.justify-end", m(IconButton, {
						title: () => "Open",
						icon: Icons.Edit,
						click: () => import("../../src/webrtc-prototype/CollaborativeEditor.js").then(({showCollaborativeEditor}) => {
							showCollaborativeEditor()
						})
					}))
				)
			],
		)
	}
}