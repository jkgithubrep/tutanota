import m, { Children, Component, Vnode } from "mithril"
import { CollaborativeEditorModel } from "./CollaborativeEditorModel.js"
import { Schema } from "prosemirror-model"
import { EditorView } from "prosemirror-view"
import { EditorState } from "prosemirror-state"
import { TabIndex } from "../api/common/TutanotaConstants.js"
import { DialogHeaderBarAttrs } from "../gui/base/DialogHeaderBar.js"
import { ButtonType } from "../gui/base/Button.js"
import { Dialog } from "../gui/base/Dialog.js"

export function showCollaborativeEditor(): void  {
	const editorModel = new CollaborativeEditorModel()

	const closeDialog = () => {
		dialog.close()
	}

	const saveAction = () => {
		console.log("Whoop")
	}

	const headerBarAttrs: DialogHeaderBarAttrs = {
		left: [
			{
				label: "cancel_action",
				click: closeDialog,
				type: ButtonType.Secondary
			}
		],
		right: [
			{
				label: "save_action",
				click: saveAction,
				type: ButtonType.Primary
			}
		],
		middle: () => "Editor"
	}

	const dialog = Dialog.largeDialogN(headerBarAttrs, CollaborativeEditor, editorModel)
	dialog.show()
}

class CollaborativeEditor implements Component<CollaborativeEditorModel> {
	editorView: EditorView | null
	schema: Schema

	constructor() {
		this.schema = new Schema({
			nodes: {
				text: {},
				doc: {content: "text*"}
			}
		})
		this.editorView = null
	}

	view(vnode: Vnode<CollaborativeEditorModel>): Children {
		return m(".hide-outline.selectable", {
			role: "textbox",
			"aria-multiline": "true",
			tabindex: TabIndex.Default,
			oncreate: (vnode) => this.initEditor(vnode.dom as HTMLElement),
			class: "flex-grow",
		})
	}

	initEditor(domElement: HTMLElement) {
		this.editorView = new EditorView(domElement, {
			state: EditorState.create({
				schema: this.schema
			})
		})
	}
}