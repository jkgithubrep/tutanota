import { copyToClipboard } from "../misc/ClipboardUtils.js"
import { neverNull } from "@tutao/tutanota-utils"

export const enum SessionStatus {
	OPEN,
	CLOSED,
	WAITING
}

/**
 * A Handler for handling WebRTC Sessions. Allows the user to create a new Session,
 * join a given Session with an 'offer' and leave or close a current Session.
 * A WebRTCSessionHandler does not always have to have a PeerConnection defined, as such,
 * the same Handler can be used to create multiple Sessions, one at a time.
 */
export class WebRTCSessionHandler {
	dataChannel: RTCDataChannel | null
	peerConnection: RTCPeerConnection | null
	config: RTCConfiguration
	status: SessionStatus

	constructor() {
		this.config = { iceServers: [{ "urls": "stun:stun.l.google.com:19302" }] }
		this.dataChannel = null
		this.peerConnection = null
		this.status = SessionStatus.CLOSED
	}

	// @ts-ignore FIXME
	private handleError(error) {
		console.log(error)
	}

	private createDataChannel(whenClosed: () => void) {
		if (this.peerConnection) {
			this.dataChannel = this.peerConnection.createDataChannel('Channel')
			this.dataChannel.onopen = () => {
				console.log("Channel has been opened for Sender!")
			}
			this.dataChannel.onclose = () => {
				whenClosed()
				console.log("Session has been closed!")
			}
			this.dataChannel.onmessage = (event) => {
				// FIXME figure out way to apply changes to ProseMirror then
			}
			this.dataChannel.onerror = this.handleError
		}
	}

	async createSession(whenClosed: () => void): Promise<void> {
		this.peerConnection = new RTCPeerConnection(this.config)
		this.createDataChannel(whenClosed)
		this.peerConnection.createOffer()
			.then(offer => this.peerConnection?.setLocalDescription(offer))

		this.peerConnection.onicecandidate = (candidate) => {
			if (candidate.candidate == null) {
				console.log("----------------------------------")
				console.log("ICE Candidate gathering has concluded. \n\n")
				copyToClipboard(JSON.stringify(this.peerConnection?.localDescription))
				return Promise.resolve()
			} else {
				console.log("candidate: ", candidate.candidate)
			}
		}

		this.peerConnection.onsignalingstatechange = () => {
		}
		this.peerConnection.oniceconnectionstatechange = () => {
		}
		this.peerConnection.onicegatheringstatechange = () => {
		}
	}

	acceptCollaborator(answer: string): Promise<void> {
		if (this.peerConnection && answer != "") {
			return this.peerConnection.setRemoteDescription(JSON.parse(answer))
		}
		return Promise.reject("Couldn't accept Collaborator, either because the Session hasn't been opened yet, or because the answer was empty!")
	}

	invite() {

	}

	async joinSession(offer: string, whenConnected: () => void, whenClosed: () => void): Promise<void> {
		this.peerConnection = new RTCPeerConnection(this.config)
		this.peerConnection.ondatachannel = (event) => {
			this.dataChannel = event.channel
			this.dataChannel.onopen = () => {
				console.log("Channel has been opened for recipient!")
				whenConnected()
			}
			this.dataChannel.onclose = () => {
				whenClosed()
				console.log("Session has been closed!")
			}
			this.dataChannel.onmessage = (event) => {
				// FIXME figure out way to apply changes to ProseMirror then
			}
			this.dataChannel.onerror = this.handleError
		}
		const data = JSON.parse(offer)
		this.peerConnection.setRemoteDescription(data)
			.then(() => this.peerConnection?.createAnswer()
							.then(answer => this.peerConnection?.setLocalDescription(answer)))

		this.peerConnection.onicecandidate = (candidate) => {
			if (candidate.candidate == null) {
				console.log("----------------------------------")
				console.log("ICE Candidate gathering has concluded. \n\n")
				copyToClipboard(JSON.stringify(neverNull(this.peerConnection).localDescription))
			} else {
				console.log("candidate: ", candidate.candidate)
			}
		}
		this.peerConnection.onsignalingstatechange = () => {
		}
		this.peerConnection.oniceconnectionstatechange = () => {
		}
		this.peerConnection.onicegatheringstatechange = () => {
		}
	}

	leaveSession() {

	}

	closeSession() {
		this.setSessionStatus(SessionStatus.CLOSED)
		this.dataChannel?.close()
		this.peerConnection?.close()
		console.log("Session has been closed!")
	}

	setSessionStatus(status: SessionStatus) {
		this.status = status
	}

	isSessionOpen() {
		return this.status == SessionStatus.OPEN
	}

	isWaiting() {
		return this.status == SessionStatus.WAITING
	}
}