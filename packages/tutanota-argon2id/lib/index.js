import { loadArgon2Module } from "./loader.js"

/**
 * @param array {Uint8Array}
 */
function isNull(array) {
	return array.byteOffset === 0
}

/**
 * Calculate an Argon2id hash
 * @param timeCost {number} number of iterations
 * @param memoryCost {number} memory cost in KiB (x1024 bytes)
 * @param parallelism {number} degree of parallelism
 * @param password {Uint8Array} password to hash
 * @param salt {Uint8Array} salt to hash with
 * @param hashLength {number} desired hash length in bytes
 * @returns {Promise<Uint8Array>} generated hash
 * @throws {Error} if parameters are invalid or a memory allocation failure occurs
 */
async function argon2idHashRaw(timeCost, memoryCost, parallelism, password, salt, hashLength) {
	// Load argon2 if not loaded
	let argon2 = await loadArgon2Module()

	// Perform allocations (we have to allocate memory in the argon2 module's heap to pass values, as it can't access memory outside of it)
	const hashBuf = new Uint8Array(argon2.memory.buffer, argon2.malloc(hashLength), hashLength)
	const saltBuf = new Uint8Array(argon2.memory.buffer, argon2.malloc(salt.length), salt.length)
	const pwdBuf = new Uint8Array(argon2.memory.buffer, argon2.malloc(password.length), password.length)

	try {
		// Check if allocations were successful (note that free(NULL) is a no-op if we hit the `finally` block)
		if (isNull(hashBuf.byteOffset) || isNull(saltBuf.byteOffset) || isNull(pwdBuf)) {
			throw new Error("argon2id malloc failure")
		}

		// Copy in the salt and password
		saltBuf.set(salt)
		pwdBuf.set(password)

		// Hash. Nonzero return value is an error.
		const result = argon2.argon2id_hash_raw(
			timeCost,
			memoryCost,
			parallelism,
			pwdBuf.byteOffset,
			password.length,
			saltBuf.byteOffset,
			salt.length,
			hashBuf.byteOffset,
			hashBuf.length,
		)
		if (result !== 0) {
			// If you hit this, refer to argon.h (look for Argon2_ErrorCodes) for a description of what it means. It's likely an issue with one of your inputs.
			//
			// Note: If you got ARGON2_MEMORY_ALLOCATION_ERROR (-22), you probably gave too big of a memory cost. You need to recompile argon2.wasm to support more memory.
			throw new Error(`argon2id_hash_raw returned ${result}`)
		}

		// Make a permanent copy of the final hash and return it, since our malloc'd buffer is only temporary
		const finalHash = new Uint8Array(hashBuf.length)
		finalHash.set(hashBuf)
		return finalHash
	} finally {
		// We should clear this, as the VM will otherwise remain in memory when we want to use it again, and we don't want a lingering password here.
		if (!isNull(pwdBuf)) {
			pwdBuf.fill(0x00)
		}

		// Free allocations (prevent memory leakage as we may re-use this argon)
		argon2.free(pwdBuf.byteOffset)
		argon2.free(saltBuf.byteOffset)
		argon2.free(hashBuf.byteOffset)
	}
}

export { argon2idHashRaw }