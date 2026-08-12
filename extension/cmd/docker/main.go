package main

import (
	"log"
	"os"
	"os/signal"
	"syscall"
	"time"

	teeServer "github.com/flare-foundation/tee-node/pkg/server"
	"github.com/quietline/quietline/extension/internal/config"
	"github.com/quietline/quietline/extension/internal/extension"
)

func main() {
	// The /quietline binary takes no arguments. A second invocation with
	// args (e.g. `docker exec … /quietline --version`) would boot an entire
	// second TEE node with a fresh identity key that races the primary at
	// the proxy. Refuse to start on any argument.
	if len(os.Args) > 1 {
		log.Fatalf("quietline takes no arguments; refusing to start (got %v)", os.Args[1:])
	}

	cfg, err := config.Load()
	if err != nil {
		log.Fatal(err)
	}
	if err := config.ValidateProductionEnvironment(cfg); err != nil {
		log.Fatal(err)
	}

	// Single-instance guard: take an exclusive advisory lock on the
	// persistent volume BEFORE starting the TEE node, so a second process
	// cannot perform a rogue proxy handshake with a second key. The lock is
	// released by the kernel on exit (incl. crash), so a fresh container
	// reacquires it cleanly.
	release, err := acquireSingleton(cfg.StatePath + ".lock")
	if err != nil {
		log.Fatalf("another quietline instance is already running: %v", err)
	}
	defer release()

	go teeServer.StartServerExtension(5501, cfg.SignPort, cfg.ExtensionPort)
	app, err := extension.New(cfg)
	if err != nil {
		log.Fatal(err)
	}
	defer app.Close()
	errCh := make(chan error, 1)
	go func() { errCh <- app.Server.ListenAndServe() }()
	time.Sleep(100 * time.Millisecond)
	signals := make(chan os.Signal, 1)
	signal.Notify(signals, os.Interrupt, syscall.SIGTERM)
	select {
	case err := <-errCh:
		log.Fatal(err)
	case <-signals:
	}
}
