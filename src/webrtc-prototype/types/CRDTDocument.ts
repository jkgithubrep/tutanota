import { Content, ID, TextContent } from "./Algorithm.js"
import { EditorState, Transaction } from "prosemirror-state"

/**
 * Transaction containing all changes to be applied to a given CRDTDocument.
 */
export class CRDTTransaction {
	id: ID
	ops: Operation[]

	constructor(id: ID, ops: Operation[]) {
		this.id	= id
		this.ops = ops
	}
}

export enum OperationType {
	INSERT = "insert",
	DELETE = "delete"
}

/**
 * Base Operation class for any Operations on a given CRDTDocument.
 */
export interface Operation {
	type: OperationType
	content: Content | null
}

/**
 * Sorts the Operations within the Buffer, depending on their id.version.
 * Operations with the smallest version number are sorted to the very front
 * of the Array to minimize computing times when getting Transactions.
 * In case we applied a new Operation that resulted in our Version being incremented,
 * we can check if the Element at index 0 of the Buffer has the correct version number
 * and can simply apply that Transaction.
 */
function bufferSort(v1: number, v2: number) {

}

/**
 * Buffers Operations for until they can be applied.
 *
 * TODO I'm not entirely sure just yet if we need this Buffer.
 *  We might need it for when we get a Transaction from another Client who's Version number
 *  v_remote: v_remote >= v_local+2, which indicates that we have not yet received a Transaction
 *  in between. This might not be an issue after all, as a version number v_remote >= v_local+2
 *  indicates that that client has already received the other changes, which means that the new
 *  Transaction will include those changes as well, depending on how we end up implementing
 *  Transactions for a CRDTDocument.
 */
export class OperationBuffer {

}

export class CRDTDocument {



	/** Internal Data that this Document consists of. Currently just Text. */
	data: Set<TextContent>

	/** Index representing the current Position in the CRDT Document. */
	currentPos: number

	/** An Array of all text nodes. Currently, this is very simple to not overcomplicate things just yet.
	 * Should allow for easy mapping to a new node in a ProseMirror State. One Element of this Array
	 * is now always a Block with Text inside. Meaning, pressing Enter creates a new Element. */
	nodes: Content[]

	public create() {
		this.data = new Set<TextContent>()
	}

	public insert(item: TextContent) {
		this.data.add(item)
	}

	public delete(id: ID) {
	}

	public transformToProseMirrorState(currentState: EditorState): EditorState {
		let newState = currentState
		this.makeTransactionFromLatestChanges(currentState)
			.then(tr => {
				newState = currentState.apply(tr)
			})
		return newState
	}

	makeTransactionFromLatestChanges(currentState: EditorState): Promise<Transaction> {
		const tr = currentState.tr
		// TODO change tr to reflect CRDT changes
		return Promise.resolve(tr)
	}

	applyCRDTTransaction(tr: CRDTTransaction) {
		// TODO we need to check our own
	}


	constructor() {
		this.nodes = new Array<Content>()
		this.data = new Set<TextContent>()
		this.currentPos = 0
	}
}