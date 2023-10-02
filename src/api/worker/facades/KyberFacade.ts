import { concat, Hex, hexToUint8Array, LazyLoaded } from "@tutao/tutanota-utils"
import { NativeCryptoFacade } from "../../../native/common/generatedipc/NativeCryptoFacade.js"
import { assertWorkerOrNode } from "../../common/Env.js"
import { CryptoError, KyberEncapsulation, KyberKeyPair, KyberPrivateKey, KyberPublicKey } from "@tutao/tutanota-crypto"
import { generateKeyPair, encapsulate, decapsulate } from "@tutao/tutanota-crypto/dist/encryption/Liboqs/Kyber.js"
import { BigInteger, parseBigInt } from "@tutao/tutanota-crypto/dist/internal/crypto-jsbn-2012-08-09_1.js"

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

	async encapsulate(publicKey: KyberPublicKey): Promise<KyberEncapsulation> {
		return encapsulate(await this.liboqs.getAsync(), publicKey)
	}

	async decapsulate(privateKey: KyberPrivateKey, ciphertext: Uint8Array): Promise<Uint8Array> {
		return decapsulate(await this.liboqs.getAsync(), privateKey, ciphertext)
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
		return Promise.resolve({ privateKey: { raw: new Uint8Array() }, publicKey: { raw: new Uint8Array() } })
	}
}

export function hexToKyberPublicKey(hex: Hex): KyberPublicKey {
	const keyComponents = _hexToKyberKeyArray(hex)
	if (keyComponents.length != 2) {
		throw new Error("invalid public key hex encoding")
	}

	return { raw: concat(...keyComponents) }
}

export function hexToKyberPrivateKey(hex: Hex): KyberPublicKey {
	const keyComponents = _hexToKyberKeyArray(hex)
	if (keyComponents.length != 5) {
		throw new Error("invalid private key hex encoding")
	}

	return { raw: concat(...keyComponents) }
}

function _hexToKyberKeyArray(hex: Hex): Uint8Array[] {
	try {
		var key: Uint8Array[] = []
		var pos = 0

		while (pos < hex.length) {
			var nextParamLen = parseInt(hex.substring(pos, pos + 4), 16)
			pos += 4
			key.push(hexToUint8Array(hex.substring(pos, pos + nextParamLen)))
			pos += nextParamLen
		}

		return key
	} catch (e) {
		throw new CryptoError("hex to kyber key failed", e as Error)
	}
}
