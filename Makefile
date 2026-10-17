GO      ?= go
BUN     ?= bun
VERSION ?= $(shell git describe --tags --always --dirty 2>/dev/null || echo dev)
LDFLAGS := -s -w -X main.version=$(VERSION)

.PHONY: all build web docs openapi sqlc check test lint fmt dev web-dev image session-image clean

all: build

build: web
	CGO_ENABLED=0 $(GO) build -trimpath -ldflags '$(LDFLAGS)' -o bin/holtdroid ./cmd/holtdroid

web: node_modules
	$(BUN) run --cwd web build

docs: node_modules
	$(BUN) run --cwd docs build

node_modules: package.json docs/package.json web/package.json frida/package.json
	$(BUN) install --frozen-lockfile
	$(BUN) install --frozen-lockfile --cwd frida
	@touch node_modules

openapi:
	$(GO) run ./cmd/holtdroid openapi api > web/openapi.json
	$(GO) run ./cmd/holtdroid openapi agent > web/openapi-agent.json
	$(BUN) run --cwd web openapi

sqlc:
	cd internal/db && sqlc generate

test: node_modules
	$(GO) test -race ./...
	cd web && $(BUN) test

lint: node_modules
	golangci-lint run ./...
	$(BUN) run --cwd web typecheck
	$(BUN) x tsc -p frida
	$(BUN) run lint
	$(BUN) run fmt:check

fmt: node_modules
	golangci-lint fmt ./...
	$(BUN) run fmt

check: openapi sqlc lint test build docs
	helm lint deploy/helm/holtdroid
	git diff --exit-code -- web/src/api internal/db

image:
	docker buildx build --platform linux/amd64 -f images/Dockerfile --build-arg VERSION=$(VERSION) -t holtdroid:$(VERSION) --load .

session-image:
	docker buildx build --platform linux/amd64 -f images/session.Dockerfile --build-arg VERSION=$(VERSION) -t holtdroid-session:$(VERSION) --load .

dev:
	$(GO) run ./cmd/holtdroid dev --log-format text

web-dev: node_modules
	$(BUN) run --cwd web dev

clean:
	rm -rf bin web/dist/assets web/dist/index.html docs/dist
