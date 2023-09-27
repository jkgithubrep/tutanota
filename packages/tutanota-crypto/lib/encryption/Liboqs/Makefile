# Makefile for building liboqs.wasm

# If you run out of memory and it's not being caused by a memory leak, try increasing this.
TOTAL_MEMORY=48MB

CC=emcc
WASM=liboqs.wasm

# TODO vendor library and check which functions to expose
# include oqs.h?
LIBOQS_DIR=../../../../../libs/liboqs


all: ${WASM}
clean:
	rm -f ${WASM}
	rm -rf include
include:
	mkdir -p include/oqs
	cp "${LIBOQS_DIR}/src/oqs.h" include/oqs
	cp "${LIBOQS_DIR}/src/common/common.h" include/oqs
	cp "${LIBOQS_DIR}/src/common/rand/rand.h" include/oqs
	cp "${LIBOQS_DIR}/src/common/aes/aes.h" include/oqs
	cp "${LIBOQS_DIR}/src/common/sha2/sha2.h" include/oqs
	cp "${LIBOQS_DIR}/src/common/sha3/sha3.h" include/oqs
	cp "${LIBOQS_DIR}/src/common/sha3/sha3x4.h" include/oqs
	cp "${LIBOQS_DIR}/src/kem/kem.h" include/oqs
	cp "${LIBOQS_DIR}/src/sig/sig.h" include/oqs
	touch include/oqs/oqsconfig.h
${WASM}: include
	${CC} \
    	"${LIBOQS_DIR}/src/kem/kem.c" \
    	"${LIBOQS_DIR}/src/common/common.c" \
    	-I "include" \
    	-DOQS_VERSION_TEXT=\"whatever\" \
    	-flto \
    	-O3 \
    	--no-entry \
    	-s TOTAL_MEMORY=${TOTAL_MEMORY} \
    	-s EXPORTED_FUNCTIONS="['_OQS_KEM_new', '_OQS_KEM_free', '_OQS_KEM_keypair', '_OQS_KEM_encaps', '_OQS_KEM_decaps', '_malloc', '_free']" \
    	-o ${WASM}
