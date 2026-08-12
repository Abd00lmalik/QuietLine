//go:build linux

package main

import (
	"fmt"
	"os"
	"syscall"
)

// acquireSingleton takes an exclusive, non-blocking advisory lock on path.
// The lock is held for the process lifetime and released by the kernel on
// exit (including crash), so restarts and container recreation reacquire it
// cleanly. It guarantees only one /quietline boots a TEE node against the
// persistent volume, preventing a second process from performing a rogue
// proxy handshake with a second identity key.
func acquireSingleton(path string) (func(), error) {
	f, err := os.OpenFile(path, os.O_CREATE|os.O_RDWR, 0o600)
	if err != nil {
		return nil, fmt.Errorf("opening lock file %s: %w", path, err)
	}
	if err := syscall.Flock(int(f.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		f.Close()
		return nil, fmt.Errorf("lock held on %s: %w", path, err)
	}
	return func() {
		syscall.Flock(int(f.Fd()), syscall.LOCK_UN)
		f.Close()
	}, nil
}
