package extension

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"net/http"
	"strings"

	"github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/flare-foundation/tee-node/pkg/types"
	teeutils "github.com/flare-foundation/tee-node/pkg/utils"
	"github.com/quietline/quietline/extension/internal/config"
	quiettypes "github.com/quietline/quietline/extension/pkg/types"
)

var (
	domainTypeHash = crypto.Keccak256Hash([]byte("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"))
	actionTypeHash = crypto.Keccak256Hash([]byte("QuietlineAction(address sender,uint64 nonce,uint64 deadline,bytes32 actionHash,bytes32 payloadHash,bytes32 responseKeyHash)"))
	nameHash       = crypto.Keccak256Hash([]byte("Quietline"))
	versionHash    = crypto.Keccak256Hash([]byte("1"))
)

func (e *Extension) verifySignedAction(req quiettypes.SignedAction, expectedAction string) error {
	if req.Action != expectedAction {
		return fmt.Errorf("action mismatch: expected %s", expectedAction)
	}
	if req.Deadline < uint64(e.clock().Unix()) {
		return errors.New("signed action expired")
	}
	if len(req.ResponsePublicKey) != 65 || req.ResponsePublicKey[0] != 4 {
		return errors.New("response public key must be uncompressed secp256k1")
	}
	digest, err := signedActionDigest(req, e.cfg.ChainID, e.cfg.Vault)
	if err != nil {
		return fmt.Errorf("building signed action digest: %w", err)
	}
	if len(req.Signature) != 65 {
		return errors.New("signature must be 65 bytes")
	}
	sig := append([]byte(nil), req.Signature...)
	if sig[64] >= 27 {
		sig[64] -= 27
	}
	pub, err := crypto.SigToPub(digest.Bytes(), sig)
	if err != nil {
		return fmt.Errorf("recovering signer: %w", err)
	}
	if crypto.PubkeyToAddress(*pub) != req.Sender {
		return errors.New("signature does not match sender")
	}
	state := e.engine.State()
	account := state.Accounts[lower(req.Sender)]
	if expectedAction != "OPEN_ACCOUNT" && account == nil {
		return errors.New("private account does not exist")
	}
	if account != nil && requiresCurrentNonce(expectedAction) && account.Nonce != req.Nonce {
		return fmt.Errorf("account nonce mismatch: expected %d", account.Nonce)
	}
	return nil
}

func signedActionDigest(req quiettypes.SignedAction, chainID uint64, vault common.Address) (common.Hash, error) {
	uint256Ty, err := abi.NewType("uint256", "", nil)
	if err != nil {
		return common.Hash{}, err
	}
	bytes32Ty, err := abi.NewType("bytes32", "", nil)
	if err != nil {
		return common.Hash{}, err
	}
	addressTy, err := abi.NewType("address", "", nil)
	if err != nil {
		return common.Hash{}, err
	}
	uint64Ty, err := abi.NewType("uint64", "", nil)
	if err != nil {
		return common.Hash{}, err
	}
	domainArgs := abi.Arguments{{Type: bytes32Ty}, {Type: bytes32Ty}, {Type: bytes32Ty}, {Type: uint256Ty}, {Type: addressTy}}
	domain, err := domainArgs.Pack(domainTypeHash, nameHash, versionHash, new(big.Int).SetUint64(chainID), vault)
	if err != nil {
		return common.Hash{}, err
	}
	actionArgs := abi.Arguments{{Type: bytes32Ty}, {Type: addressTy}, {Type: uint64Ty}, {Type: uint64Ty}, {Type: bytes32Ty}, {Type: bytes32Ty}, {Type: bytes32Ty}}
	body, err := actionArgs.Pack(
		actionTypeHash,
		req.Sender,
		req.Nonce,
		req.Deadline,
		crypto.Keccak256Hash([]byte(req.Action)),
		crypto.Keccak256Hash(req.Payload),
		crypto.Keccak256Hash(req.ResponsePublicKey),
	)
	if err != nil {
		return common.Hash{}, err
	}
	return crypto.Keccak256Hash([]byte{0x19, 0x01}, crypto.Keccak256(domain), crypto.Keccak256(body)), nil
}

func requiresCurrentNonce(action string) bool {
	switch action {
	case config.OPOpenAccount, config.OPAccountQuery, config.OPStressQuery, config.OPQuoteRequest:
		return false
	default:
		return true
	}
}

func (e *Extension) decrypt(ciphertext []byte) ([]byte, error) {
	body, _ := json.Marshal(types.DecryptRequest{EncryptedMessage: ciphertext})
	resp, err := e.httpClient.Post(fmt.Sprintf("http://localhost:%d/decrypt", e.cfg.SignPort), "application/json", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("decrypt server returned %d", resp.StatusCode)
	}
	var out types.DecryptResponse
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return nil, err
	}
	return out.DecryptedMessage, nil
}

func (e *Extension) encryptResponse(plain, publicKey []byte) ([]byte, error) {
	pub, err := crypto.UnmarshalPubkey(publicKey)
	if err != nil {
		return nil, err
	}
	return teeutils.Encrypt(plain, pub)
}

func lower(address common.Address) string { return strings.ToLower(address.Hex()) }
