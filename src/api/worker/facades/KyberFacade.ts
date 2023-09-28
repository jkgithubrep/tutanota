import { LazyLoaded } from "@tutao/tutanota-utils"
import { NativeCryptoFacade } from "../../../native/common/generatedipc/NativeCryptoFacade.js"
import { assertWorkerOrNode } from "../../common/Env.js"
import { KyberEncapsulation, KyberKeyPair, KyberPrivateKey, KyberPublicKey } from "../../../../packages/tutanota-crypto/lib/encryption/Liboqs/KyberKeyPair.js"
import { generateKeyPair } from "../../../../packages/tutanota-crypto/lib/encryption/Liboqs/Kyber.js"

assertWorkerOrNode()

/**
 * Abstract interface for the Liboqs crypto system.
 */
export interface KyberFacade {
	/**
	 * Generate a key new random key pair
	 */
	generateKeypair(): Promise<KyberKeyPair>

	/**
	 *
	 * @param publicKey the public key to encapsulate the secret with
	 * @returns the ciphertext and the shared secret
	 */
	encapsulate(publicKey: KyberPublicKey): Promise<KyberEncapsulation>

	/**
	 *
	 * @param privateKey the corresponding private key to the public key used to encapsulate the cipher text
	 * @param ciphertext the encapsulated ciphertext
	 * @returns the shared secret
	 */
	decapsulate(privateKey: KyberPrivateKey, ciphertext: Uint8Array): Promise<Uint8Array>
}

/**
 * WebAssembly implementation of Liboqs
 */
export class WASMKyberFacade implements KyberFacade {
	// loads liboqs WASM
	private liboqs: LazyLoaded<WebAssembly.Exports> = new LazyLoaded(async () => {
		const wasm = fetch("wasm/liboqs.wasm")
		if (WebAssembly.instantiateStreaming) {
			return (await WebAssembly.instantiateStreaming(wasm)).instance.exports
		} else {
			// Fallback if the client does not support instantiateStreaming
			const buffer = await (await wasm).arrayBuffer()
			return (await WebAssembly.instantiate(buffer)).instance.exports
		}
	})

	async generateKeypair(): Promise<KyberKeyPair> {
		return generateKeyPair(await this.liboqs.getAsync())
	}

	decapsulate(privateKey: KyberPrivateKey, ciphertext: Uint8Array): Promise<Uint8Array> {
		return Promise.resolve(new Uint8Array())
	}

	encapsulate(publicKey: KyberPublicKey): Promise<KyberEncapsulation> {
		return Promise.resolve({ ciphertext: new Uint8Array(), sharedSecret: new Uint8Array() })
	}
}

/**
 * Native implementation of Liboqs
 */
//TODO
export class NativeKyberFacade implements KyberFacade {
	constructor(private readonly nativeCryptoFacade: NativeCryptoFacade) {}

	decapsulate(privateKey: KyberPrivateKey, ciphertext: Uint8Array): Promise<Uint8Array> {
		return Promise.resolve(new Uint8Array())
	}

	encapsulate(publicKey: KyberPublicKey): Promise<KyberEncapsulation> {
		return Promise.resolve({ ciphertext: new Uint8Array(), sharedSecret: new Uint8Array() })
	}

	generateKeypair(): Promise<KyberKeyPair> {
		return Promise.resolve({ privateKey: { encoded: new Uint8Array() }, publicKey: { encoded: new Uint8Array() } })
	}
}
