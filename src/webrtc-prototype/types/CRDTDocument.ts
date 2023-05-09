import { Content, ID, TextContent } from "./Algorithm.js"
import { EditorState, Transaction } from "prosemirror-state"
import { Schema } from "prosemirror-model"

/**
 * Transaction containing all changes to be applied to a given CRDTDocument.
 */
export class CRDTTransaction {
	id: ID
	ops: Operation[]

	constructor(id: ID, ops: Operation[]) {
		this.id = id
		this.ops = ops
	}

	public add(op: Operation) {
		this.ops.push(op)
	}
}

export enum OperationType {
	INSERT = "insert",
	INSERT_NODE = "node",
	DELETE = "delete"
}

/**
 * Base Operation class for any Operations on a given CRDTDocument.
 */
export interface Operation {
	type: OperationType
	content: Content | Content[] | null
	/** Index at which Operation shall be done */
	position: CRDTPos | { from: CRDTPos, to: CRDTPos }
}

export class InsertOperation implements Operation {
	content: Content
	position: CRDTPos
	type: OperationType

	constructor(content: Content, position: CRDTPos) {
		this.content = content
		this.position = position
		this.type = OperationType.INSERT
	}
}

export class InsertNodeOperation implements Operation {
	/** Content is an Array of all content that will
	 * be moved from current the paragraph to the next. */
	content: Content[]
	position: CRDTPos
	type: OperationType

	constructor(content: Content[], position: CRDTPos) {
		this.content = content
		this.position = position
		this.type = OperationType.INSERT_NODE
	}
}

export class DeleteOperation implements Operation {
	content: null
	position: { from: CRDTPos, to: CRDTPos }
	type: OperationType

	/** Define a new Delete Operation, deleting content between 'from' and 'to' inclusive.
	 * If just one character shall be deleted, then from == to. */
	constructor(from: CRDTPos, to: CRDTPos) {
		this.content = null
		this.position = { from: from, to: to }
		this.type = OperationType.DELETE
	}
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

/** Object representing the current Position in the CRDT Document.
 * 'array' defines which first-level element the index is within,
 * 'index' defines the exact index in the second-level element.
 * e.g. (| is current position)
 * abc de		    [[a,b,c, ,d,e], [f,g, ,h,i]
 * fg h|i      ==    [[1,2,3,4,5,6],[9,10,11,12,13]]
 * ProsemirrorPosition: 13
 * CRDTDocumentPosition: {
 *     array: 1,
 *     index: 4
 * }
 * Position is always viewed to the left of index in CRDTPosition.
 * This is due to the usage of Array.splice(), 'inserting' an element
 * to the left of a given index.
 * */
export type CRDTPos = {
	array: number,
	index: number
}

export class CRDTDocument {

	/** Internal Data that this Document consists of. Currently just Text.
	 * Text is represented as a double layered Array, each Element of the first Array
	 * represents one paragraph. As per Prosemirrors Indexing, The Index is to be interpreted
	 * line-persistent, so from one first-level-Array Element to the next.
	 * The Index increments by 2 from each first-level-Array Element to the next.
	 * e.g.:
	 * abc de		    [[a,b,c, ,d,e], [f,g, ,h,i]
	 * fg hi      ==    [[1,2,3,4,5,6],[9,10,11,12,13]] */
	data: Array<Array<TextContent>>

	currentPos: CRDTPos

	/** An Array of all text nodes. Currently, this is very simple to not overcomplicate things just yet.
	 * Should allow for easy mapping to a new node in a ProseMirror State. One Element of this Array
	 * is now always a Block with Text inside. Meaning, pressing Enter creates a new Element. */
	nodes: Content[]

	/** Prosemirror Editor Schema. */
	schema: Schema

	/** Current Version number. Increments according to Lamport Timestamps. */
	version: number

	/**
	 * Insert into the CRDT Document with a given CRDTPos.
	 * Content will be inserted to the left of the specified Index.
	 * @param pos Position to insert at
	 * @param item Item to insert
	 */
	public insert(pos: CRDTPos, item: TextContent) {
		const { array, index } = pos
		this.data[array].splice(index, 0, item)

		// TODO We dont need this anymore?
		// /** Index at which to insert in the CRDTDocument. */
		// let i = 0
		//
		// /** Prosemirror-Index Range that is being covered by current Array-depth */
		// let iRange = 0
		// for (const arr of this.data) {
		// 	// If i == 0, then we are still on the first paragraph and the index is special
		// 	// We cannot increment the Index by 2 in this case, because otherwise we would offset
		// 	// Everything by 1. We increment by 2 to account for both Paragraph Tags, however,
		// 	// In the first line, there is only one tag, so we can only increment by 1.
		// 	i = i == 0 ? iRange + 1 : iRange + 2
		//
		// 	// Increment once to account for paragraph beginning tag
		// 	// Increment by total amount of characters in this paragraph
		// 	// Increment again to account for paragraph ending tag
		// 	iRange += 1 + arr.length + 1
		//
		// 	// If pmIndex is within iRange, then the Position we are trying to
		// 	// access is within this Paragraph. Otherwise, go to next Paragraph.
		// 	if (!(iRange < pmIndex)) {
		// 		i = pmIndex - i
		// 		item.left = arr[i - 1]
		// 		item.right = arr[i + 1]
		// 		arr.splice(i, 0, item)
		// 	}
		// }
	}

	/**
	 * Inserts a new Node at a given position. Does not delete content out of old
	 * Node, as that has already been taken care of with splice() when creating
	 * the Operation. Thus, we just have to insert a singular, new node with
	 * the Content we are passing this function.
	 * @param content Contents that shall be added to new node
	 * @param pos Position in the Double-Array to add the new node
	 */
	public insertNewNode(content: TextContent[], pos: CRDTPos) {
		this.data.splice(pos.array, 0, content)
	}

	/**
	 * Marks every Content between 'from' and 'to' (inclusive)
	 * as deleted. (isDeleted = true)
	 * We cannot delete all characters because otherwise we would
	 * lose the Insert Intention. TODO Check this again!
	 * @param from Position specifying from where to delete
	 * @param to Position specifying until where to delete
	 */
	public delete(from: CRDTPos, to: CRDTPos) {
		if (from.array == to.array) {
			// Deletion does not span multiple arrays
			const array = this.data[from.array] // array to delete in

			// FIXME Mark every Content between 'from' and 'to' (inclusive) as deleted
			//  this currently does not work because our Index calculation is completely
			//  destroyed if we just mark the Content as "deleted".
			// Delete all Content between 'from' and 'to' (inclusive)
			let index = from.index
			array.splice(index, (to.index - index) + 1)
			// for (index; index < to.index; index++) {
			// 	// array[index].isDeleted = true
			// }
		} else {
			// Deletion spans >= 2 arrays
			// This would mean that we are deleting across multiple paragraphs in the Editor
			// TODO check how long this takes. We don't want the CRDT Doc to bottleneck in the back

			// First delete everything at the start and end, then delete the Arrays inbetween
			const firstArray = this.data[from.array]
			let firstIndex = from.index
			firstArray.splice(firstIndex, (firstArray.length - 1) - firstIndex)


			const lastArray = this.data[to.array]
			let lastIndex = to.index
			lastArray.splice(0, to.index + 1)

			// 'to' and 'from' are not in neighbouring arrays -> delete every array inbetween
			if (to.array > from.array + 1) {
				this.data.splice(from.array + 1, (to.array - from.array) - 1)
			}
			// for (firstIndex; firstIndex < firstArray.length; firstIndex++) {
			// 	firstArray[firstIndex].isDeleted = true
			// }

			// for (let arrIndex = from.array + 1; arrIndex < to.array; arrIndex++) {
			// 	this.data[arrIndex].forEach(c => {
			// 		c.isDeleted = true
			// 	})

			// }
			// for (lastIndex; lastIndex < to.index; lastIndex++) {
			// 	lastArray[lastIndex].isDeleted = true
			// }
		}
	}

	/**
	 * Insert into the CRDTDocument with two Prosemirror Indices specifying "from" and "to".
	 * Will delete everything inbetween the "from" and "to" index and then insert the content
	 * @param pmIndexFrom
	 * @param pmIndexTo
	 * @param item
	 */
	public insertFromTo(pmIndexFrom: number, pmIndexTo: number, item: TextContent) {

	}

	/**
	 * Creates a new CRDTTransaction from given Operations,
	 * after applying them to the CRDTDocument.
	 * @param ops Operations to commit
	 */
	public createTransactionFromOperations(ops: Operation[]): CRDTTransaction {
		const tr = new CRDTTransaction(
			new ID("id", this.version + 1),
			[] // do not populate ops yet
		)
		ops.forEach(op => {
			if (op instanceof InsertOperation) {
				this.insert(op.position, op.content)
				tr.add(op)
			} else if (op instanceof InsertNodeOperation) {
				this.insertNewNode(op.content, op.position)
				tr.add(op)
			} else {
				const del = op as DeleteOperation
				this.delete(del.position.from, del.position.to)
				tr.add(op)
			}
		})
		return tr
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


	constructor(schema: Schema) {
		this.nodes = []
		this.data = [[]]
		this.currentPos = {
			array: 0,
			index: 0
		}
		this.schema = schema
		this.version = 0
	}

	public getSchema(): Schema {
		return this.schema
	}

	public getArrayRepresentation(): Array<Array<TextContent>> {
		return this.data
	}
}