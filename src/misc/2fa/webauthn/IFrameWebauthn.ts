import { WebAuthnFacade } from "../../../native/common/generatedipc/WebAuthnFacade.js"
import { WebAuthnRegistrationChallenge } from "../../../native/common/generatedipc/WebAuthnRegistrationChallenge.js"
import { WebAuthnRegistrationResult } from "../../../native/common/generatedipc/WebAuthnRegistrationResult.js"
import { WebAuthnSignChallenge } from "../../../native/common/generatedipc/WebAuthnSignChallenge.js"
import { WebAuthnSignResult } from "../../../native/common/generatedipc/WebAuthnSignResult.js"
import { MessageDispatcher, Request } from "../../../api/common/threading/MessageDispatcher.js"
import { WebAuthnFacadeCommandNames } from "../../../login/YayFrameViewModel.js"
import { IFrameTransport } from "../../../api/common/threading/IFrameTransport.js"

/** a webauthn impl that delegates to a BrowserWebauthn in an iframe */
export class IFrameWebauthn implements WebAuthnFacade {
	private transport!: IFrameTransport<WebAuthnFacadeCommandNames, "ready">
	private dispatcher!: MessageDispatcher<WebAuthnFacadeCommandNames, "ready">

	async init(iframe: HTMLIFrameElement, targetOrigin: string): Promise<void> {
		return new Promise((resolve) => {
			if (iframe.contentWindow == null) {
				throw new Error("cant")
			}
			this.transport = new IFrameTransport(iframe.contentWindow, targetOrigin)
			this.dispatcher = new MessageDispatcher<WebAuthnFacadeCommandNames, "ready">(
				this.transport,
				{
					ready: async () => resolve(),
				},
				"main-iframe",
			)
		})
	}

	dispose() {
		this.transport.dispose()
	}

	async canAttemptChallengeForRpId(rpId: string): Promise<boolean> {
		return this.dispatcher.postRequest(new Request("canAttemptChallengeForRpId", [rpId]))
	}

	async canAttemptChallengeForU2FAppId(appId: string): Promise<boolean> {
		return this.dispatcher.postRequest(new Request("canAttemptChallengeForU2FAppId", [appId]))
	}

	async isSupported(): Promise<boolean> {
		return this.dispatcher.postRequest(new Request("isSupported", []))
	}

	async register(challenge: WebAuthnRegistrationChallenge): Promise<WebAuthnRegistrationResult> {
		return this.dispatcher.postRequest(new Request("register", [challenge]))
	}

	async sign(challenge: WebAuthnSignChallenge): Promise<WebAuthnSignResult> {
		return this.dispatcher.postRequest(new Request("sign", [challenge]))
	}

	async abortCurrentOperation(): Promise<void> {
		return this.dispatcher.postRequest(new Request("abortCurrentOperation", []))
	}
}
