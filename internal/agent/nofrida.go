//go:build !frida

package agent

import (
	"errors"
	"log/slog"
)

func NewFrida(FridaConfig, *slog.Logger) (Instrumenter, error) {
	return nil, errors.New("this binary was built without Frida; the agent needs the session image (go build -tags frida)")
}

func CompileScripts(string) error {
	return errors.New("this binary was built without Frida (go build -tags frida)")
}
