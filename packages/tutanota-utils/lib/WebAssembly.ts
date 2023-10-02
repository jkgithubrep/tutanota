import { stringToUtf8Uint8Array } from "./Encoding.js"

/**
 * Call the WebAssembly function with the given arguments.
 *
 * Automatically allocates strings and buffers and frees them while passing booleans and numbers as-is.
 *
 * @param func function to call
 * @param exports WASM module instance's exports
 * @param args arguments to pass
 */
export function callWebAssemblyFunctionWithArguments<T>(func: Function, exports: WebAssembly.Exports, ...args: any[]): any {
	const free = exports.free as FreeFN

	const argsToPass: (number | boolean)[] = []
	const toFree: Ptr[] = []
	const toClear: Uint8Array[] = []
	const toOverwrite: { arr: Uint8Array; original: MutableUint8Array }[] = []

	try {
		for (const a of args) {
			// `NULL` in C is equal to 0
			if (a === null) {
				argsToPass.push(0)
				continue
			}

			// These can be passed as-is
			if (typeof a === "number" || typeof a === "boolean") {
				argsToPass.push(a)
				continue
			}

			// Strings require null termination
			if (typeof a === "string") {
				const s = allocateStringCopy(a, exports, toFree)
				toFree.push(s.byteOffset)
				toClear.push(s)
				argsToPass.push(s.byteOffset)
				continue
			}

			if (a instanceof MutableUint8Array) {
				const inputOutput = a.uint8ArrayInputOutput
				let arr: Uint8Array

				if (inputOutput instanceof SecureFreeUint8Array) {
					arr = allocateArrayCopy(inputOutput.uint8ArrayInput, exports, toFree)
					toClear.push(arr)
				} else {
					arr = allocateArrayCopy(inputOutput, exports, toFree)
				}

				toOverwrite.push({ arr, original: a })
				argsToPass.push(arr.byteOffset)
				continue
			}

			if (a instanceof SecureFreeUint8Array) {
				const arr = allocateArrayCopy(a.uint8ArrayInput, exports, toFree)
				toClear.push(arr)
				argsToPass.push(arr.byteOffset)
				continue
			}

			if (a instanceof Uint8Array || a instanceof Int8Array) {
				const arr = allocateArrayCopy(a, exports, toFree)
				argsToPass.push(arr.byteOffset)
				continue
			}

			throw new Error(`passed an unhandled argument type ${typeof a}`)
		}

		return func(...argsToPass)
	} finally {
		for (const f of toOverwrite) {
			const inputOutput = f.original.uint8ArrayInputOutput
			if (inputOutput instanceof SecureFreeUint8Array) {
				inputOutput.uint8ArrayInput.set(f.arr)
			} else {
				inputOutput.set(f.arr)
			}
		}
		for (const f of toClear) {
			f.fill(0)
		}
		for (const f of toFree) {
			free(f)
		}
	}
}

/**
 * Allocate memory on the heap of the WebAssembly instance.
 *
 * Be sure to call `free` on the byteOffset when you are done!
 *
 * @param length length of data to allocate
 * @param exports WASM module instance's exports
 */
export function allocateBuffer(length: number, exports: WebAssembly.Exports): Uint8Array {
	const malloc = exports.malloc as MallocFN
	const memory = exports.memory as WebAssembly.Memory
	const ptr = malloc(length)
	if (ptr === 0) {
		throw new Error("malloc failed to allocate memory for string")
	}
	try {
		return new Uint8Array(memory.buffer, ptr, length)
	} catch (e) {
		const free = exports.free as FreeFN
		free(ptr)
		throw e
	}
}

/**
 * Wrapper to be passed to a WebAssembly function.
 *
 * The contents of the array will be updated when the function finishes.
 */
export class MutableUint8Array {
	constructor(readonly uint8ArrayInputOutput: Uint8Array | SecureFreeUint8Array) {}
}

/**
 * Wrapper to be passed to a WebAssembly function.
 *
 * The copy allocated on the VM will be filled with zero bytes. This is slower, but it will ensure that its contents won't linger after being freed.
 *
 * Note that the buffer pointed to by uint8ArrayInput is *not* zeroed out automatically, as it is not a deep copy, so remember to zero out the original buffer
 * when you are done with it, too!
 */
export class SecureFreeUint8Array {
	constructor(readonly uint8ArrayInput: Uint8Array) {}
}

/**
 * Defines a pointer type
 */
export type Ptr = number

/**
 * Free function interface
 */
export type FreeFN = (what: Ptr) => void

function allocateStringCopy(str: string, exports: WebAssembly.Exports, toFree: Ptr[]): Uint8Array {
	const strBytes = stringToUtf8Uint8Array(str)
	const allocationAmount = strBytes.length + 1
	let buf = allocateBuffer(allocationAmount, exports)
	try {
		buf.set(strBytes)
		buf[buf.length - 1] = 0 // null terminate after string data
		toFree.push(buf.byteOffset)
		return buf
	} catch (e) {
		const free = exports.free as FreeFN
		free(buf.byteOffset)
		throw e
	}
}

function allocateArrayCopy(arr: Uint8Array | Int8Array, exports: WebAssembly.Exports, toFree: Ptr[]): Uint8Array {
	const allocationAmount = arr.length
	let buf = allocateBuffer(allocationAmount, exports)
	try {
		buf.set(arr)
		toFree.push(buf.byteOffset)
		return buf
	} catch (e) {
		const free = exports.free as FreeFN
		free(buf.byteOffset)
		throw e
	}
}

type MallocFN = (len: number) => Ptr
