import { assertMainOrNode } from "../api/common/Env.js"
import { UpdatableSettingsViewer } from "../settings/SettingsView.js"
import m, { Children } from "mithril"
import { EntityUpdateData } from "../api/main/EventController.js"
import { Button } from "../gui/base/Button.js"
import { CollaborativeEditorView } from "./CollaborativeEditorView.js"

assertMainOrNode()

export class CollaborativeEditorViewer implements UpdatableSettingsViewer {
	view(): Children {
		return m(CollaborativeEditorView)
	}

	entityEventsReceived(updates: ReadonlyArray<EntityUpdateData>): Promise<void> {
		return Promise.resolve()
	}
}