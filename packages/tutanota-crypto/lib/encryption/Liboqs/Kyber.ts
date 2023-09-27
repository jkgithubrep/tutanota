import { KyberEncapsulation, KyberKeyPair, KyberPrivateKey, KyberPublicKey } from "./KyberKeyPair.js"

export const KYBER_ALGORITHM = 1024

/**
 * @returns a new random kyber key pair.
 */
export function generateKeyPair(kyberWasm: WebAssembly.Exports): KyberKeyPair {
	const keyPair = generateKeyPair(kyberWasm)
}

export function encapsulate(publicKey: KyberPublicKey): KyberEncapsulation {}

export function decapsulate(privateKey: KyberPrivateKey, ciphertext: Uint8Array): Uint8Array {}

type Ptr = number
type ConstVoidPtr = Ptr
type VoidPtr = Ptr

type FreeFN = (what: Ptr) => void
type MallocFN = (len: number) => Ptr
type KyberGenerateKeyPairRawFN = () => number

function isNull(array: Uint8Array): boolean {
	return array.byteOffset === 0
}

function generateKeyPair(kyber: WebAssembly.Exports): Uint8Array {
	const memory: WebAssembly.Memory = kyber.memory as WebAssembly.Memory
	const free = kyber.free as FreeFN
	const malloc = kyber.malloc as MallocFN
}
