// Command verifyinfo is a READ-ONLY diagnostic. It reads a TEE /info JSON
// document on stdin and recovers the signer of its dataSignature using the
// exact production hashing + recovery code paths (types.MachineData.DataHash,
// signing.Payload.Hash, utils.SignatureToSignersAddress). It starts no node,
// opens no ports, and mutates nothing. Its purpose is to distinguish a claimed
// identity in /info from proof that the signer holding that identity's key
// actually produced the signature.
package main

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"strings"

	"github.com/ethereum/go-ethereum/crypto"

	csigning "github.com/flare-foundation/go-flare-common/pkg/signing"
	"github.com/flare-foundation/tee-node/pkg/types"
	"github.com/flare-foundation/tee-node/pkg/utils"
)

const (
	oldSigner = "0xc8A1F9859bAA86c0b86eb6BC3f7930ABB36BF1cc"
	newSigner = "0xBA96A4F53C03235c036d2b0AB7Ef26E8425ecfbf"
)

func main() {
	raw, err := io.ReadAll(os.Stdin)
	if err != nil {
		fmt.Println("read stdin:", err)
		os.Exit(1)
	}
	var resp types.TeeInfoResponse
	if err := json.Unmarshal(raw, &resp); err != nil {
		fmt.Println("unmarshal /info:", err)
		os.Exit(1)
	}

	// Preimage the node signs for dataSignature (see getutils.TEEInfo):
	//   mdHash = Payload(TEE_MACHINE_REGISTER, chainID, MachineData.DataHash()).Hash()
	mdDataHash, err := resp.MachineData.DataHash()
	if err != nil {
		fmt.Println("MachineData.DataHash:", err)
		os.Exit(1)
	}
	chainID := resp.TeeInfo.ChainID
	mdHash, err := csigning.NewPayload(csigning.TEEMachineRegister, chainID, mdDataHash).Hash()
	if err != nil {
		fmt.Println("payload hash:", err)
		os.Exit(1)
	}

	// Address derived purely from the ADVERTISED public key in the same /info.
	advertised := "ERR"
	if pub, perr := types.ParsePubKey(resp.MachineData.PublicKey); perr == nil {
		advertised = crypto.PubkeyToAddress(*pub).Hex()
	} else {
		advertised = "ERR:" + perr.Error()
	}

	// Signer RECOVERED from dataSignature over the reconstructed preimage,
	// using the production recovery path (EIP-191 TextHash + canonical check).
	recovered := "ERR"
	if addr, rerr := utils.SignatureToSignersAddress(mdHash[:], resp.DataSignature); rerr == nil {
		recovered = addr.Hex()
	} else {
		recovered = "ERR:" + rerr.Error()
	}

	fmt.Println("=== verifyinfo (read-only signature recovery) ===")
	fmt.Println("chainId:                 ", chainID)
	fmt.Println("teeInfo.challenge:       ", resp.TeeInfo.Challenge.Hex())
	fmt.Println("teeInfo.teeTimestamp:    ", resp.TeeInfo.TeeTimestamp)
	fmt.Println("MachineData.DataHash:    ", mdDataHash.Hex())
	fmt.Printf("payload mdHash:           0x%x\n", mdHash)
	fmt.Println("dataSignature len bytes: ", len(resp.DataSignature))
	fmt.Println()
	fmt.Println("advertised pubkey -> addr:      ", advertised)
	fmt.Println("dataSignature RECOVERED signer: ", recovered)
	fmt.Println()
	fmt.Println("recovered == advertised pubkey: ", strings.EqualFold(recovered, advertised), "(self-check: hashing correct + identity consistent)")
	fmt.Println("recovered == OLD 0xc8A1:        ", strings.EqualFold(recovered, oldSigner))
	fmt.Println("recovered == NEW 0xBA96:        ", strings.EqualFold(recovered, newSigner))
}
