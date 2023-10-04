import { KyberEncapsulation, KyberKeyPair, KyberPrivateKey, KyberPublicKey } from "./KyberKeyPair.js"
import { stringToUtf8Uint8Array } from "@tutao/tutanota-utils"
import { random, Randomizer } from "../../random/Randomizer.js"

const KYBER_ALGORITHM = "Kyber1024"
const OQS_KEM_kyber_1024_length_public_key = 1568
const OQS_KEM_kyber_1024_length_secret_key = 3168
const OQS_KEM_kyber_1024_length_ciphertext = 1568
const OQS_KEM_kyber_1024_length_shared_secret = 32

/**
 * @returns a new random kyber key pair.
 */
export function generateKeyPair(kyberWasm: WebAssembly.Exports, randomizer: Randomizer): KyberKeyPair {
	const memory: WebAssembly.Memory = kyberWasm.memory as WebAssembly.Memory
	const free = kyberWasm.free as FreeFN
	const malloc = kyberWasm.malloc as MallocFN
	const OQS_KEM_keypair = kyberWasm.OQS_KEM_keypair as OQS_KEM_KEYPAIR_RawFN
	const OQS_KEM_free = kyberWasm.OQS_KEM_free as OQS_KEM_FREE_RawFN
	const TUTA_inject_entropy = kyberWasm.TUTA_inject_entropy as TUTA_inject_entropy_RawFN

	const publicKeyBuf = new Uint8Array(memory.buffer, malloc(OQS_KEM_kyber_1024_length_public_key), OQS_KEM_kyber_1024_length_public_key)
	const privateKeyBuf = new Uint8Array(memory.buffer, malloc(OQS_KEM_kyber_1024_length_secret_key), OQS_KEM_kyber_1024_length_secret_key)

	const OQS_KEM = createKem(kyberWasm, malloc, free)
	try {
		fillEntropyPool(memory, TUTA_inject_entropy, malloc, free, randomizer)

		if (isNull(publicKeyBuf) || isNull(privateKeyBuf)) {
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
			publicKey: { raw: publicKeyBytes },
			privateKey: { raw: privateKeyBytes },
		}
	} finally {
		// We should clear this, as the VM will otherwise remain in memory when we want to use it again, and we don't want a lingering password here.
		if (!isNull(privateKeyBuf)) {
			privateKeyBuf.fill(0x00)
		}

		// Free allocations (prevent memory leakage as we may re-use this argon)
		free(privateKeyBuf.byteOffset)
		free(publicKeyBuf.byteOffset)
		OQS_KEM_free(OQS_KEM)
	}
}

// The returned pointer needs to be freed once not needed anymore by the caller
function createKem(kyberWasm: WebAssembly.Exports, malloc: MallocFN, free: FreeFN): Ptr {
	const memory: WebAssembly.Memory = kyberWasm.memory as WebAssembly.Memory
	const OQS_KEM_new = kyberWasm.OQS_KEM_new as OQS_KEM_NEW_RawFN

	const methodBuf = allocateString(KYBER_ALGORITHM, memory, malloc, free)
	try {
		const OQS_KEM = OQS_KEM_new(methodBuf.byteOffset)
		if (!OQS_KEM) {
			throw new Error("failed to initialize new kem")
		}
		return OQS_KEM
	} finally {
		free(methodBuf.byteOffset)
	}
}

export function encapsulate(kyberWasm: WebAssembly.Exports, publicKey: KyberPublicKey, randomizer: Randomizer): KyberEncapsulation {
	const memory = kyberWasm.memory as WebAssembly.Memory
	const free = kyberWasm.free as FreeFN
	const malloc = kyberWasm.malloc as MallocFN
	const OQS_KEM_free = kyberWasm.OQS_KEM_free as OQS_KEM_FREE_RawFN
	const OQS_KEM_encaps = kyberWasm.OQS_KEM_encaps as OQS_KEM_encaps_RawFn
	const TUTA_inject_entropy = kyberWasm.TUTA_inject_entropy as TUTA_inject_entropy_RawFN

	let OQS_KEM: Ptr | null = null
	const cipherTextPtr = new Uint8Array(memory.buffer, malloc(OQS_KEM_kyber_1024_length_ciphertext), OQS_KEM_kyber_1024_length_ciphertext)
	const sharedSecretPtr = new Uint8Array(memory.buffer, malloc(OQS_KEM_kyber_1024_length_shared_secret), OQS_KEM_kyber_1024_length_shared_secret)
	const publicKeyPtr = new Uint8Array(memory.buffer, malloc(publicKey.raw.length), publicKey.raw.length)

	try {
		OQS_KEM = createKem(kyberWasm, malloc, free)

		fillEntropyPool(memory, TUTA_inject_entropy, malloc, free, randomizer)
		if (isNull(cipherTextPtr) || isNull(sharedSecretPtr)) {
			throw new Error("kyber key generation malloc failure")
		}

		publicKeyPtr.set(publicKey.raw)

		const result = OQS_KEM_encaps(OQS_KEM, cipherTextPtr.byteOffset, sharedSecretPtr.byteOffset, publicKeyPtr.byteOffset)

		if (result != 0) {
			throw new Error(`OQS_KEM_encaps  returned ${result}`)
		}

		const ciphertext = new Uint8Array(cipherTextPtr.length)
		ciphertext.set(cipherTextPtr)
		const sharedSecret = new Uint8Array(sharedSecretPtr.length)
		sharedSecret.set(sharedSecretPtr)

		return { ciphertext, sharedSecret }
	} finally {
		if (OQS_KEM) {
			OQS_KEM_free(OQS_KEM)
		}
		if (!isNull(cipherTextPtr)) {
			cipherTextPtr.fill(0)
			free(cipherTextPtr.byteOffset)
		}
		if (!isNull(sharedSecretPtr)) {
			sharedSecretPtr.fill(0)
			free(sharedSecretPtr.byteOffset)
		}
		if (!isNull(publicKeyPtr)) {
			publicKeyPtr.fill(0)
			free(publicKeyPtr.byteOffset)
		}
	}
}

export function decapsulate(kyberWasm: WebAssembly.Exports, privateKey: KyberPrivateKey, ciphertext: Uint8Array): Uint8Array {
	const memory = kyberWasm.memory as WebAssembly.Memory
	const free = kyberWasm.free as FreeFN
	const malloc = kyberWasm.malloc as MallocFN
	const OQS_KEM_free = kyberWasm.OQS_KEM_free as OQS_KEM_FREE_RawFN
	const OQS_KEM_decaps = kyberWasm.OQS_KEM_decaps as OQS_KEM_decaps_RawFn

	let OQS_KEM: Ptr | null = null
	const cipherTextPtr = new Uint8Array(memory.buffer, malloc(OQS_KEM_kyber_1024_length_ciphertext), OQS_KEM_kyber_1024_length_ciphertext)
	const privateKeyPtr = new Uint8Array(memory.buffer, malloc(privateKey.raw.length), privateKey.raw.length)
	const sharedSecretPtr = new Uint8Array(memory.buffer, malloc(OQS_KEM_kyber_1024_length_shared_secret), OQS_KEM_kyber_1024_length_shared_secret)

	try {
		OQS_KEM = createKem(kyberWasm, malloc, free)

		if (isNull(cipherTextPtr) || isNull(sharedSecretPtr) || isNull(privateKeyPtr)) {
			throw new Error("kyber key generation malloc failure")
		}
		cipherTextPtr.set(ciphertext)
		privateKeyPtr.set(privateKey.raw)

		const result = OQS_KEM_decaps(OQS_KEM, sharedSecretPtr.byteOffset, cipherTextPtr.byteOffset, privateKeyPtr.byteOffset)
		if (result != 0) {
			throw new Error(`OQS_KEM_decaps  returned ${result}`)
		}
		const sharedSecret = new Uint8Array(sharedSecretPtr.length)
		sharedSecret.set(sharedSecretPtr)
		return sharedSecret
	} finally {
		if (OQS_KEM) {
			OQS_KEM_free(OQS_KEM)
		}
		if (!isNull(cipherTextPtr)) {
			cipherTextPtr.fill(0)
			free(cipherTextPtr.byteOffset)
		}
		if (!isNull(sharedSecretPtr)) {
			sharedSecretPtr.fill(0)
			free(sharedSecretPtr.byteOffset)
		}
		if (!isNull(privateKeyPtr)) {
			privateKeyPtr.fill(0)
			free(privateKeyPtr.byteOffset)
		}
	}
}

type Ptr = number
type FreeFN = (what: Ptr) => void
type MallocFN = (len: number) => Ptr
type OQS_KEM_KEYPAIR_RawFN = (kem: Ptr, publicKey: Ptr, secretKey: Ptr) => number
type OQS_KEM_NEW_RawFN = (methodName: Ptr) => Ptr
type OQS_KEM_FREE_RawFN = (kem: Ptr | null) => void
type TUTA_inject_entropy_RawFN = (data: Ptr, size: number) => number
type OQS_KEM_encaps_RawFn = (kem: Ptr, ciphertext: Ptr, sharedSecret: Ptr, publicKey: Ptr) => number
type OQS_KEM_decaps_RawFn = (kem: Ptr, shared_secret: Ptr, ciphertext: Ptr, secret_key: Ptr) => number

function isNull(array: Uint8Array): boolean {
	return array.byteOffset === 0
}

// Add bytes externally to the random number generator
function fillEntropyPool(memory: WebAssembly.Memory, TUTA_inject_entropy: TUTA_inject_entropy_RawFN, malloc: MallocFN, free: FreeFN, randomizer: Randomizer) {
	const entropyNeeded = TUTA_inject_entropy(0, 0)
	const entropyBuf = new Uint8Array(memory.buffer, malloc(entropyNeeded), entropyNeeded)
	try {
		if (isNull(entropyBuf)) {
			throw new Error("entropy allocation failure")
		}
		entropyBuf.set(randomizer.generateRandomData(entropyBuf.length))
		TUTA_inject_entropy(entropyBuf.byteOffset, entropyBuf.length)
	} finally {
		if (!isNull(entropyBuf)) {
			entropyBuf.fill(0)
			free(entropyBuf.byteOffset)
		}
	}
}

// Allocate a null-terminated string and return its buffer; throws if failed. You need to free it when you're done!
function allocateString(str: string, memory: WebAssembly.Memory, malloc: MallocFN, free: FreeFN): Uint8Array {
	const allocationAmount = str.length + 1
	const allocated = malloc(allocationAmount)
	if (allocated === 0) {
		throw new Error("malloc failed to allocate memory for string")
	}
	try {
		const buf = new Uint8Array(memory.buffer, allocated, allocationAmount)
		buf.set(stringToUtf8Uint8Array(str))
		buf[buf.length - 1] = 0 // null terminate after string data
		return buf
	} catch (e) {
		free(allocated)
		throw e
	}
}
