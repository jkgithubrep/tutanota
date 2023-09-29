import o from "@tutao/otest"
import { loadWasmModuleFromFile } from "./WebAssemblyTestUtils.js"
import { generateKeyPair } from "../lib/encryption/Liboqs/Kyber.js"

const liboqs = await loadWasmModuleFromFile("../lib/encryption/Liboqs/liboqs.wasm")

o.spec("Kyber", async function () {
	o("encryption roundtrip", async function () {
		const keyPair = generateKeyPair(liboqs)
		o(1568).equals(keyPair.privateKey.encoded.length)
		o(1568).equals(keyPair.publicKey.encoded.length)
	})
})
