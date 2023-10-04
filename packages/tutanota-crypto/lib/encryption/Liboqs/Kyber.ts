import { KyberEncapsulation, KyberKeyPair, KyberPrivateKey, KyberPublicKey } from "./KyberKeyPair.js"
import { callWebAssemblyFunctionWithArguments, mutableSecureFree, Ptr, secureFree } from "@tutao/tutanota-utils"
import { Randomizer } from "../../random/Randomizer.js"

const KYBER_ALGORITHM = "Kyber1024"
const KYBER_K = 4
const KYBER_POLYBYTES = 384
export const KYBER_POLYVECBYTES = KYBER_K * KYBER_POLYBYTES
export const KYBER_SYMBYTES = 32
const OQS_KEM_kyber_1024_length_public_key = 1568
const OQS_KEM_kyber_1024_length_secret_key = 3168
const OQS_KEM_kyber_1024_length_ciphertext = 1568
const OQS_KEM_kyber_1024_length_shared_secret = 32

type OQS_KEM_KEYPAIR_RawFN = (kem: KemPtr, publicKey: Ptr, secretKey: Ptr) => number
type OQS_KEM_NEW_RawFN = (methodName: Ptr) => Ptr
type OQS_KEM_FREE_RawFN = (kem: KemPtr | null) => void
type TUTA_inject_entropy_RawFN = (data: Ptr, size: number) => number
type OQS_KEM_encaps_RawFn = (kem: KemPtr, ciphertext: Ptr, sharedSecret: Ptr, publicKey: Ptr) => number
type OQS_KEM_decaps_RawFn = (kem: KemPtr, shared_secret: Ptr, ciphertext: Ptr, secret_key: Ptr) => number
type KemPtr = Ptr

/**
 * @returns a new random kyber key pair.
 */
export function generateKeyPair(kyberWasm: WebAssembly.Exports, randomizer: Randomizer): KyberKeyPair {
	const OQS_KEM = createKem(kyberWasm)
	try {
		fillEntropyPool(kyberWasm, randomizer)
		const publicKey = new Uint8Array(OQS_KEM_kyber_1024_length_public_key)
		const privateKey = new Uint8Array(OQS_KEM_kyber_1024_length_secret_key)
		const result = callWebAssemblyFunctionWithArguments(
			kyberWasm.OQS_KEM_keypair as OQS_KEM_KEYPAIR_RawFN,
			kyberWasm,
			OQS_KEM,
			mutableSecureFree(publicKey),
			mutableSecureFree(privateKey),
		)
		if (result != 0) {
			throw new Error(`OQS_KEM_keypair  returned ${result}`)
		}
		return {
			publicKey: { raw: publicKey },
			privateKey: { raw: privateKey },
		}
	} finally {
		freeKem(kyberWasm, OQS_KEM)
	}
}

export function encapsulate(kyberWasm: WebAssembly.Exports, publicKey: KyberPublicKey, randomizer: Randomizer): KyberEncapsulation {
	const OQS_KEM = createKem(kyberWasm)
	try {
		fillEntropyPool(kyberWasm, randomizer)
		const ciphertext = new Uint8Array(OQS_KEM_kyber_1024_length_ciphertext)
		const sharedSecret = new Uint8Array(OQS_KEM_kyber_1024_length_shared_secret)
		const result = callWebAssemblyFunctionWithArguments(
			kyberWasm.OQS_KEM_encaps as OQS_KEM_encaps_RawFn,
			kyberWasm,
			OQS_KEM,
			mutableSecureFree(ciphertext),
			mutableSecureFree(sharedSecret),
			mutableSecureFree(publicKey.raw),
		)
		if (result != 0) {
			throw new Error(`OQS_KEM_encaps  returned ${result}`)
		}
		return { ciphertext, sharedSecret }
	} finally {
		freeKem(kyberWasm, OQS_KEM)
	}
}

export function decapsulate(kyberWasm: WebAssembly.Exports, privateKey: KyberPrivateKey, ciphertext: Uint8Array): Uint8Array {
	const OQS_KEM = createKem(kyberWasm)
	try {
		const sharedSecret = new Uint8Array(OQS_KEM_kyber_1024_length_shared_secret)
		const result = callWebAssemblyFunctionWithArguments(
			kyberWasm.OQS_KEM_decaps as OQS_KEM_decaps_RawFn,
			kyberWasm,
			OQS_KEM,
			mutableSecureFree(sharedSecret),
			secureFree(ciphertext),
			secureFree(privateKey.raw),
		)
		if (result != 0) {
			throw new Error(`OQS_KEM_decaps returned ${result}`)
		}
		return sharedSecret
	} finally {
		freeKem(kyberWasm, OQS_KEM)
	}
}

function freeKem(kyberWasm: WebAssembly.Exports, OQS_KEM: KemPtr) {
	callWebAssemblyFunctionWithArguments(kyberWasm.OQS_KEM_free as OQS_KEM_FREE_RawFN, kyberWasm, OQS_KEM)
}

// The returned pointer needs to be freed once not needed anymore by the caller
function createKem(kyberWasm: WebAssembly.Exports): KemPtr {
	return callWebAssemblyFunctionWithArguments(kyberWasm.OQS_KEM_new as OQS_KEM_NEW_RawFN, kyberWasm, KYBER_ALGORITHM)
}

// Add bytes externally to the random number generator
function fillEntropyPool(exports: WebAssembly.Exports, randomizer: Randomizer) {
	const TUTA_inject_entropy = exports.TUTA_inject_entropy as TUTA_inject_entropy_RawFN
	const entropyNeeded = callWebAssemblyFunctionWithArguments(TUTA_inject_entropy, exports, 0, 0)
	const entropy = randomizer.generateRandomData(entropyNeeded)
	callWebAssemblyFunctionWithArguments(TUTA_inject_entropy, exports, entropy, entropy.length)
}
