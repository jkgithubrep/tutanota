import { Command, MessageDispatcher, Request } from "../api/common/threading/MessageDispatcher.js"
import { WebAuthnFacade } from "../native/common/generatedipc/WebAuthnFacade.js"
import { IFrameTransport } from "../api/common/threading/IFrameTransport.js"
import { BrowserWebauthn } from "../misc/2fa/webauthn/BrowserWebauthn.js"

export type WebAuthnFacadeCommandNames = keyof WebAuthnFacade
type WebAuthnCommandObject = { [K in WebAuthnFacadeCommandNames]: Command<K> }

export class YayFrameViewModel {
	private dispatcher: MessageDispatcher<"ready", WebAuthnFacadeCommandNames>

	constructor(private readonly parentOrigin: string) {
		const webauthn = new BrowserWebauthn(navigator.credentials, window.location.hostname)
		const commands: WebAuthnCommandObject = {
			canAttemptChallengeForRpId: (msg: Request<"canAttemptChallengeForRpId">) => webauthn.canAttemptChallengeForRpId(msg.args[0]),
			canAttemptChallengeForU2FAppId: (msg: Request<"canAttemptChallengeForU2FAppId">) => webauthn.canAttemptChallengeForU2FAppId(msg.args[0]),
			register: (msg: Request<"register">) => webauthn.register(msg.args[0]),
			sign: (msg: Request<"sign">) => webauthn.sign(msg.args[0]),
			abortCurrentOperation: (_msg: Request<"abortCurrentOperation">) => webauthn.abortCurrentOperation(),
			isSupported: (_msg: Request<"isSupported">) => webauthn.isSupported(),
		}
		this.dispatcher = new MessageDispatcher<never, WebAuthnFacadeCommandNames>(new IFrameTransport(window.parent, parentOrigin), commands, "iframe-main")
		console.log("done with setup")
		this.dispatcher.postRequest(new Request("ready", []))
	}
}
