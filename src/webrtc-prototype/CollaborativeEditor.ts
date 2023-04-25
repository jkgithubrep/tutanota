import m, { Children, Component, Vnode } from "mithril"
import { CollaborativeEditorModel } from "./CollaborativeEditorModel.js"
import { DOMOutputSpec, Schema } from "prosemirror-model"
import { EditorView } from "prosemirror-view"
import { pcBaseKeymap } from "prosemirror-commands"
import { EditorState } from "prosemirror-state"
import { TabIndex } from "../api/common/TutanotaConstants.js"
import { DialogHeaderBarAttrs } from "../gui/base/DialogHeaderBar.js"
import { ButtonType } from "../gui/base/Button.js"
import { Dialog } from "../gui/base/Dialog.js"
import { keymap } from "prosemirror-keymap"

export function showCollaborativeEditor(): void {
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

const pDOM: DOMOutputSpec = ["p", 0], blockquoteDOM: DOMOutputSpec = ["blockquote", 0],
	hrDOM: DOMOutputSpec = ["hr"], preDOM: DOMOutputSpec = ["pre", ["code", 0]],
	brDOM: DOMOutputSpec = ["br"]

class CollaborativeEditor implements Component<CollaborativeEditorModel> {
	editorView: EditorView | null
	schema: Schema

	constructor() {
		this.schema = new Schema({
			nodes: {
				doc: { content: "block+" },
				text: { group: "inline" },
				paragraph: {
					content: "text*",
					group: "block",
					parseDOM: [{ tag: "p" }],
					toDOM() {
						return pDOM
					}
				},
				blockquote: {
					content: "block+",
					group: "block",
					defining: true,
					parseDOM: [{ tag: "blockquote" }],
					toDOM() {
						return blockquoteDOM
					}
				},
				hard_break: {
					inline: true,
					group: "inline",
					selectable: false,
					parseDOM: [{ tag: "br" }],
					toDOM() {
						return brDOM
					}
				}
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
				schema: this.schema,
				plugins: this.createKeymap(this.schema)
			})
		})
	}

	createKeymap(schema: Schema) {
		return [
			keymap(pcBaseKeymap)
		]
	}
}