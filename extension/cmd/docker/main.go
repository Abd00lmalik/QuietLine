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
	cfg, err := config.Load()
	if err != nil {
		log.Fatal(err)
	}
	if err := config.ValidateProductionEnvironment(cfg); err != nil {
		log.Fatal(err)
	}
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
