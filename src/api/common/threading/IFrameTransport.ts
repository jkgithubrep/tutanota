import { Message } from "./MessageDispatcher.js"
import { Transport } from "./Transport.js"

/** transport impl for communication between the main thread and an iframe */
export class IFrameTransport<OutgoingCommandType, IncomingCommandType> implements Transport<OutgoingCommandType, IncomingCommandType> {
	private handler?: (message: Message<IncomingCommandType>) => unknown

	constructor(private readonly targetWindow: Window, private readonly targetOrigin: string) {}

	private readonly handleMessage = (event: MessageEvent<Message<IncomingCommandType>>) => {
		console.log("got message", event)
		if (event.source !== this.targetWindow) {
			console.log("not from expected thing?")
			return
		}
		this.handler?.(event.data)
	}

	postMessage(message: Message<OutgoingCommandType>): void {
		return this.targetWindow.postMessage(message, this.targetOrigin)
	}

	setMessageHandler(handler: (message: Message<IncomingCommandType>) => unknown) {
		this.handler = handler
		window.addEventListener("message", this.handleMessage)
	}

	dispose() {
		window.removeEventListener("message", this.handleMessage)
	}
}
