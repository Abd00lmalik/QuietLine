//go:build !linux

package main

// acquireSingleton is a no-op off Linux. The production workload is the
// linux/distroless container; this stub only keeps `go build ./...` green on
// non-Linux developer hosts.
func acquireSingleton(string) (func(), error) {
	return func() {}, nil
}
