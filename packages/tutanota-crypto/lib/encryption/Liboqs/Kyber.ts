import { KyberEncapsulation, KyberKeyPair, KyberPrivateKey, KyberPublicKey } from "./KyberKeyPair.js"
import { stringToUtf8Uint8Array } from "@tutao/tutanota-utils"

const KYBER_ALGORITHM = "Kyber1024\0"
const OQS_KEM_kyber_1024_length_public_key = 1568
const OQS_KEM_kyber_1024_length_secret_key = 3168
const OQS_KEM_kyber_1024_length_ciphertext = 1568
const OQS_KEM_kyber_1024_length_shared_secret = 32

/**
 * @returns a new random kyber key pair.
 */
export function generateKeyPair(kyberWasm: WebAssembly.Exports): KyberKeyPair {
	const memory: WebAssembly.Memory = kyberWasm.memory as WebAssembly.Memory
	const free = kyberWasm.free as FreeFN
	const malloc = kyberWasm.malloc as MallocFN
	const OQS_KEM_keypair = kyberWasm.OQS_KEM_keypair as OQS_KEM_KEYPAIR_RawFN
	const OQS_KEM_new = kyberWasm.OQS_KEM_new as OQS_KEM_NEW_RawFN
	const OQS_KEM_free = kyberWasm.OQS_KEM_free as OQS_KEM_FREE_RawFN

	const methodBuf = new Uint8Array(memory.buffer, malloc(KYBER_ALGORITHM.length), KYBER_ALGORITHM.length)
	const publicKeyBuf = new Uint8Array(memory.buffer, malloc(OQS_KEM_kyber_1024_length_public_key), OQS_KEM_kyber_1024_length_public_key)
	const privateKeyBuf = new Uint8Array(memory.buffer, malloc(OQS_KEM_kyber_1024_length_secret_key), OQS_KEM_kyber_1024_length_secret_key)
	let OQS_KEM: Ptr | null = null
	try {
		if (isNull(methodBuf)) {
			throw new Error("kyber key generation malloc failure")
		}
		methodBuf.set(stringToUtf8Uint8Array(KYBER_ALGORITHM))

		OQS_KEM = OQS_KEM_new(methodBuf.byteOffset)

		if (!OQS_KEM || isNull(publicKeyBuf) || isNull(privateKeyBuf)) {
			throw new Error("kyber key generation malloc failure")
		}

		const result = OQS_KEM_keypair(OQS_KEM, publicKeyBuf.byteOffset, privateKeyBuf.byteOffset)
		if (result != 0) {
			throw new Error(`OQS_KEM_keypair  returned ${result}`)
		}

		const publicKeyBytes = new Uint8Array(publicKeyBuf.length)
		publicKeyBytes.set(publicKeyBuf)

		const privateKeyBytes = new Uint8Array(privateKeyBuf.length)
		privateKeyBytes.set(privateKeyBuf)

		return {
			publicKey: { encoded: publicKeyBytes },
			privateKey: { encoded: privateKeyBytes },
		}
	} finally {
		// We should clear this, as the VM will otherwise remain in memory when we want to use it again, and we don't want a lingering password here.
		if (!isNull(privateKeyBuf)) {
			privateKeyBuf.fill(0x00)
		}

		// Free allocations (prevent memory leakage as we may re-use this argon)
		free(privateKeyBuf.byteOffset)
		free(publicKeyBuf.byteOffset)
		free(methodBuf.byteOffset)
		if (OQS_KEM) {
			OQS_KEM_free(OQS_KEM)
		}
	}
}

export function encapsulate(publicKey: KyberPublicKey): KyberEncapsulation {
	return { ciphertext: new Uint8Array(0), sharedSecret: new Uint8Array(0) }
}

export function decapsulate(privateKey: KyberPrivateKey, ciphertext: Uint8Array): Uint8Array {
	return new Uint8Array(0)
}

type Ptr = number
type ConstVoidPtr = Ptr
type VoidPtr = Ptr

type FreeFN = (what: Ptr) => void
type MallocFN = (len: number) => Ptr
type OQS_KEM_KEYPAIR_RawFN = (kem: Ptr, publicKey: Ptr, secretKey: Ptr) => number
type OQS_KEM_NEW_RawFN = (methodName: Ptr) => Ptr
type OQS_KEM_FREE_RawFN = (kem: Ptr | null) => void

function isNull(array: Uint8Array): boolean {
	return array.byteOffset === 0
}
