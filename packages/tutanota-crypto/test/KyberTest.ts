import o from "@tutao/otest"
import { loadWasmModuleFromFile } from "./WebAssemblyTestUtils.js"
import { generateKeyPair } from "../lib/encryption/Liboqs/Kyber.js"

const liboqs = await loadWasmModuleFromFile("../lib/encryption/Liboqs/liboqs.wasm")

o.spec("Kyber", async function () {
	o("encryption roundtrip", async function () {
		const keyPair = generateKeyPair(liboqs)
		o(keyPair.privateKey.encoded.length).equals(3168)
		o(keyPair.publicKey.encoded.length).equals(1568)
	})
})
