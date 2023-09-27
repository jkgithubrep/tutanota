export type KyberKeyPair = {
	publicKey: KyberPublicKey
	privateKey: KyberPrivateKey
}
export type KyberPrivateKey = {
	encoded: Uint8Array
}
export type KyberPublicKey = {
	encoded: Uint8Array
}

export type KyberEncapsulation = {
	ciphertext: Uint8Array
	sharedSecret: Uint8Array
}
