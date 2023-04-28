import uuid from "uuid"

// This ID forms a Lamport Clock timestamp. (id, clock)
// TODO Im not sure if we need this ID for the actual content.
//  I think we just need this ID for sending Transactions across multiple clients.
//  Why would we need to know the Version on the Item itself? We just need to identify it.
export class ID {
	/** Unique ID of Item. */
	id: string

	/** Version number of the Client that created the new Item. Monotonically increases with every new Item. */
	version: number

	constructor(id: string, version: number) {
		this.id = id
		this.version = version
	}

	nextVersion() {
		this.version++
	}

	newVersion(ver: number) {
		this.version = ver
	}
}

export interface Content {
	/** ID of this Item, including uuid and version number of actors CRDT State. */
	id: string

	/** Item that is currently to the left of this Item.
	 * Can be null if there is no Predecessor, e.g. if this Item is after the start of a paragraph. */
	left: Content | null

	/** Item that is currently to the right of this Item.
	 * Can be null if there is no Successor, e.g. if this Item is after the end of a paragraph. */
	right: Content | null

	/** Item that was originally to the left of this Item at creation time.
	 * Can be null if there is no Predecessor, and as such no Origin for this Item. This means that
	 * the Item has been created at the start of a paragraph. */
	origin: Content | null

	/** Data that this Item contains. */
	data: any

	/** Flag indicating whether this Item has been deleted. We have to keep deleted Items to preserve user intent.
	 * e.g. when User A inserts a new Item_i+1 on the right of Item_i (Item_i+1.origin = Item_i), but User B deletes
	 * Item_i+1, then we lose the reference for Item_i. As such, we must keep all deleted Items until we are certain
	 * that we can delete them. */
	isDeleted: boolean
}

/**
 * Content Object representing Text within the CRDT Document.
 */
export class TextContent implements Content {
	id: string
	left: TextContent | null
	right: TextContent | null
	origin: TextContent | null
	data: string
	isDeleted: boolean

	constructor(id: string, left: TextContent, right: TextContent, origin: TextContent, data: string, isDeleted: boolean = false) {
		this.id = id
		this.left = left
		this.right = right
		this.origin = origin
		this.data = data
		this.isDeleted = isDeleted
	}
}

export class Algorithm {
}