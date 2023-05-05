import m, { Children, Component, Vnode } from "mithril"
import { CollaborativeEditorModel } from "./CollaborativeEditorModel.js"
import { DOMOutputSpec, Schema } from "prosemirror-model"
import { EditorView } from "prosemirror-view"
import { pcBaseKeymap } from "prosemirror-commands"
import { EditorState } from "prosemirror-state"
import { TabIndex } from "../api/common/TutanotaConstants.js"
import { DialogHeaderBarAttrs } from "../gui/base/DialogHeaderBar.js"
import { Button, ButtonType } from "../gui/base/Button.js"
import { Dialog } from "../gui/base/Dialog.js"
import { keymap } from "prosemirror-keymap"
import { IconButton } from "../gui/base/IconButton.js"
import { Icons } from "../gui/base/icons/Icons.js"
import { SessionStatus, WebRTCSessionHandler } from "./WebRTCSessionHandler.js"
import { TextField, TextFieldAttrs, TextFieldType } from "../gui/base/TextField.js"
import { CRDTDocument } from "./types/CRDTDocument.js"

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
	doc: CRDTDocument | null
	schema: Schema
	sessionHandler: WebRTCSessionHandler | null

	constructor() {
		// Reduced this down to just text and paragraphs
		this.schema = new Schema({
			nodes: {
				doc: { content: "block+" },
				text: {},
				paragraph: {
					content: "text*",
					group: "block",
					parseDOM: [{ tag: "p" }],
					toDOM() {
						return pDOM
					}
				}
			}
		})
		this.editorView = null
		this.sessionHandler = null
		this.doc = new CRDTDocument(this.schema)
	}

	view(vnode: Vnode<CollaborativeEditorModel>): Children {
		const close = (dialog: Dialog) => {
			dialog.close()
		}

		const whenClosed = () => {
			this.sessionHandler?.setSessionStatus(SessionStatus.CLOSED)
			m.redraw()
		}

		return m("", [
			m(".flex.mt-s.justify-end", [
				this.sessionHandler?.isSessionOpen()
					? m(IconButton, {
						icon: Icons.Cancel,
						title: () => "Close current Session",
						click: () => {
							this.sessionHandler?.closeSession()
						}
					})
					: m(""),
				m(IconButton, {
					icon: Icons.Add,
					title: () => "Create Collaborative Session",
					click: () => {
						this.sessionHandler = new WebRTCSessionHandler()
						this.sessionHandler.createSession(whenClosed)
							.then(() => {
								this.showSessionCreationDialog(close)
							})
					}
				}),
				m(IconButton, {
					icon: Icons.People,
					title: () => "Join Collaborative Session",
					click: () => {
						this.sessionHandler = new WebRTCSessionHandler()
						this.showSessionJoinDialog(close, whenClosed)
					}
				})
			]),
			m(".editor-border.selectable.mt-s", {
				role: "textbox",
				"aria-multiline": "true",
				tabindex: TabIndex.Default,
				oncreate: (vnode) => this.initEditor(vnode.dom as HTMLElement),
				class: "flex-grow",
			})
		])
	}

	private showSessionJoinDialog(close: (dialog: Dialog) => void, whenClosed: () => void) {
		let pasteOfferTextFieldValue = ""

		const input = (value: string) => {
			pasteOfferTextFieldValue = value
		}

		const value = () => {
			return pasteOfferTextFieldValue
		}

		const whenConnected = () => {
			this.sessionHandler?.setSessionStatus(SessionStatus.OPEN)
			m.redraw()
		}

		Dialog.showActionDialog({
			title: () => "Join Session",
			allowCancel: true,
			okAction: close,
			child: () => m("", [
				this.sessionHandler?.isWaiting() || this.sessionHandler?.isSessionOpen()
					? this.sessionHandler?.isSessionOpen()
						? m(".flex.justify-center.mt-l.mb-l", "You have joined the Session!")
						: m(".flex.justify-center.mt-l.mb-l", "Waiting for Host to approve...")
					: this.renderOfferTextField(input, value, whenConnected, whenClosed),
				m(".mt-l.b", "Please paste the Offer you received above."),
			])
		})
	}

	private showSessionCreationDialog(close: (dialog: Dialog) => void) {
		let pasteAnswerTextFieldValue = ""

		const input = (value: string) => {
			pasteAnswerTextFieldValue = value
		}

		const value = () => {
			return pasteAnswerTextFieldValue
		}

		Dialog.showActionDialog({
			title: () => "Create Session",
			allowCancel: true,
			okAction: close,
			child: () => m("", [
				this.sessionHandler?.isSessionOpen() ? m(".flex.justify-center.mt-l.mb-l", "Session has been created!") : this.renderAnswerTextField(input, value),
				m(".mt-l.b", "Your Offer has been copied. Send it to the Remote Peer and paste their Answer above."),
			])
		})
	}

	private renderOfferTextField(input: ((value: string) => void), value: (() => string), whenConnected: () => void, whenClosed: () => void) {
		const attrs: TextFieldAttrs = {
			label: () => "Offer of Remote Peer",
			type: TextFieldType.Text,
			value: value(),
			oninput: input,
			injectionsRight: () => this.renderJoinSessionConfirmButton(value, whenConnected, whenClosed)
		}
		return m(TextField, attrs)
	}

	private renderJoinSessionConfirmButton(confirm: () => string, whenConnected: () => void, whenClosed: () => void) {
		return m(Button, {
			label: () => "Confirm",
			type: ButtonType.Primary,
			click: () => {
				if (this.sessionHandler) {
					this.sessionHandler.joinSession(confirm(), whenConnected, whenClosed)
						.then(() => {
							this.sessionHandler?.setSessionStatus(SessionStatus.WAITING)
							m.redraw()
						})
				}
			}
		})
	}

	private renderAnswerTextField(input: ((value: string) => void), value: (() => string)) {

		const attrs: TextFieldAttrs = {
			label: () => "Answer of Remote Peer",
			type: TextFieldType.Text,
			value: value(),
			oninput: input,
			injectionsRight: () => this.renderCreateSessionConfirmButton(value)
		}
		return m(TextField, attrs)
	}

	private renderCreateSessionConfirmButton(confirm: () => string) {
		return m(Button, {
			label: () => "Confirm",
			type: ButtonType.Primary,
			click: () => {
				if (this.sessionHandler) {
					this.sessionHandler.acceptCollaborator(confirm())
						.catch((reason) => {
							console.log(reason)
						})
						.then(() => {
							this.sessionHandler?.setSessionStatus(SessionStatus.OPEN)
							m.redraw()
						})
				}
			}
		})
	}

	initEditor(domElement: HTMLElement) {
		this.editorView = new EditorView(domElement, {
			state: EditorState.create({
				schema: this.schema,
				plugins: this.createKeymap(this.schema),
				// dispatchTransaction: (tr) => {
				//
				// }
			})
		})
	}

	createKeymap(schema: Schema) {
		return [
			keymap(pcBaseKeymap)
		]
	}
}