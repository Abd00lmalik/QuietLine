package main

import (
	"encoding/hex"
	"flag"
	"fmt"
	"os"
	"strings"

	"github.com/ethereum/go-ethereum/crypto"
	teeutils "github.com/flare-foundation/tee-node/pkg/utils"
)

func main() {
	mode := flag.String("mode", "", "encrypt or decrypt")
	keyHex := flag.String("key", "", "private key for decrypt or public key for encrypt")
	messageHex := flag.String("message", "", "plaintext or ciphertext hex")
	flag.Parse()

	key, err := decode(*keyHex)
	if err != nil {
		fail("key: %v", err)
	}
	message, err := decode(*messageHex)
	if err != nil {
		fail("message: %v", err)
	}

	var output []byte
	switch *mode {
	case "encrypt":
		publicKey, parseErr := crypto.UnmarshalPubkey(key)
		if parseErr != nil {
			fail("public key: %v", parseErr)
		}
		output, err = teeutils.Encrypt(message, publicKey)
	case "decrypt":
		privateKey, parseErr := crypto.ToECDSA(key)
		if parseErr != nil {
			fail("private key: %v", parseErr)
		}
		output, err = teeutils.Decrypt(message, privateKey)
	default:
		fail("mode must be encrypt or decrypt")
	}
	if err != nil {
		fail("%s: %v", *mode, err)
	}
	fmt.Printf("0x%s", hex.EncodeToString(output))
}

func decode(value string) ([]byte, error) {
	return hex.DecodeString(strings.TrimPrefix(value, "0x"))
}

func fail(format string, args ...any) {
	_, _ = fmt.Fprintf(os.Stderr, format+"\n", args...)
	os.Exit(1)
}
