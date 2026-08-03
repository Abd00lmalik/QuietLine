package ledger

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"

	bolt "go.etcd.io/bbolt"
)

var (
	stateBucket   = []byte("state")
	journalBucket = []byte("journal")
	currentKey    = []byte("current")
)

type Store struct {
	db   *bolt.DB
	aead cipher.AEAD
}

type journalRecord struct {
	Sequence     uint64 `json:"sequence"`
	Kind         string `json:"kind"`
	StateRoot    string `json:"stateRoot"`
	PreviousHash string `json:"previousHash"`
	Hash         string `json:"hash"`
}

func OpenStore(path string, key []byte) (*Store, error) {
	if len(key) != 32 {
		return nil, errors.New("state encryption key must be 32 bytes")
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	db, err := bolt.Open(path, 0o600, nil)
	if err != nil {
		return nil, err
	}
	s := &Store{db: db, aead: aead}
	err = db.Update(func(tx *bolt.Tx) error {
		_, e := tx.CreateBucketIfNotExists(stateBucket)
		if e != nil {
			return e
		}
		_, e = tx.CreateBucketIfNotExists(journalBucket)
		return e
	})
	if err != nil {
		_ = db.Close()
		return nil, err
	}
	return s, nil
}

func (s *Store) Close() error { return s.db.Close() }

func (s *Store) Load() (*State, error) {
	var encrypted []byte
	err := s.db.View(func(tx *bolt.Tx) error {
		v := tx.Bucket(stateBucket).Get(currentKey)
		if v == nil {
			return nil
		}
		encrypted = append([]byte(nil), v...)
		return nil
	})
	if err != nil {
		return nil, err
	}
	if encrypted == nil {
		return NewState(), nil
	}
	plain, err := s.decrypt(encrypted)
	if err != nil {
		return nil, fmt.Errorf("decrypting state: %w", err)
	}
	var state State
	if err := json.Unmarshal(plain, &state); err != nil {
		return nil, fmt.Errorf("decoding state: %w", err)
	}
	return &state, nil
}

func (s *Store) Commit(state *State, kind string) error {
	plain, err := json.Marshal(state)
	if err != nil {
		return err
	}
	encrypted, err := s.encrypt(plain)
	if err != nil {
		return err
	}
	return s.db.Update(func(tx *bolt.Tx) error {
		journal := tx.Bucket(journalBucket)
		var prevHash string
		if cursor := journal.Cursor(); cursor != nil {
			_, v := cursor.Last()
			if v != nil {
				var prev journalRecord
				if err := json.Unmarshal(v, &prev); err != nil {
					return err
				}
				prevHash = prev.Hash
			}
		}
		record := journalRecord{Sequence: state.Sequence, Kind: kind, StateRoot: state.Root, PreviousHash: prevHash}
		preimage, _ := json.Marshal(record)
		sum := sha256.Sum256(preimage)
		record.Hash = hex.EncodeToString(sum[:])
		recordJSON, _ := json.Marshal(record)
		var key [8]byte
		binary.BigEndian.PutUint64(key[:], state.Sequence)
		if err := journal.Put(key[:], recordJSON); err != nil {
			return err
		}
		return tx.Bucket(stateBucket).Put(currentKey, encrypted)
	})
}

func (s *Store) SaveState(state *State) error {
	plain, err := json.Marshal(state)
	if err != nil {
		return err
	}
	encrypted, err := s.encrypt(plain)
	if err != nil {
		return err
	}
	return s.db.Update(func(tx *bolt.Tx) error {
		return tx.Bucket(stateBucket).Put(currentKey, encrypted)
	})
}

func (s *Store) encrypt(plain []byte) ([]byte, error) {
	nonce := make([]byte, s.aead.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return nil, err
	}
	return append(nonce, s.aead.Seal(nil, nonce, plain, []byte("quietline-state-v1"))...), nil
}

func (s *Store) decrypt(data []byte) ([]byte, error) {
	if len(data) < s.aead.NonceSize() {
		return nil, errors.New("encrypted state is truncated")
	}
	nonce, ciphertext := data[:s.aead.NonceSize()], data[s.aead.NonceSize():]
	return s.aead.Open(nil, nonce, ciphertext, []byte("quietline-state-v1"))
}
