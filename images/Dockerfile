ARG GO_SOURCE=build

FROM --platform=$BUILDPLATFORM docker.io/oven/bun:1.4.3@sha256:ec06c3b6cea04192ae6770c434f668ca41d343ad19fa6472216c7b48be39c598 AS web
WORKDIR /src
COPY package.json bun.lock bunfig.toml ./
COPY web/package.json web/
COPY docs/package.json docs/
RUN bun install --frozen-lockfile --ignore-scripts
COPY web web
RUN bun run --cwd web build

FROM --platform=$BUILDPLATFORM docker.io/library/golang:1.27.2-bookworm@sha256:5cf287a799e6b94384bad13d16b14904c531f51ba65792237e122ce42b392f61 AS go-build
ARG TARGETOS TARGETARCH
ARG VERSION=dev
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY cmd cmd
COPY internal internal
COPY web/embed.go web/
COPY --from=web /src/web/dist web/dist
RUN CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH \
    go build -trimpath -ldflags "-s -w -X main.version=$VERSION" -o /out/holtdroid ./cmd/holtdroid

FROM --platform=$BUILDPLATFORM docker.io/library/golang:1.27.2-bookworm@sha256:5cf287a799e6b94384bad13d16b14904c531f51ba65792237e122ce42b392f61 AS connect-build
ARG VERSION=dev
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY cmd/holtdroid-connect cmd/holtdroid-connect
COPY internal internal
RUN for p in darwin/amd64 darwin/arm64 linux/amd64 linux/arm64; do \
      CGO_ENABLED=0 GOOS=${p%/*} GOARCH=${p#*/} go build -trimpath -ldflags "-s -w -X main.version=$VERSION" \
        -o /out/holtdroid-${p%/*}-${p#*/} ./cmd/holtdroid-connect || exit 1; \
    done

# GO_SOURCE=prebuilt takes the binaries the release workflow compiled on the
# runner (with cached builds) instead of compiling here.
FROM scratch AS go-prebuilt
ARG TARGETARCH
COPY --chmod=755 prebuilt/holtdroid-linux-${TARGETARCH} /out/holtdroid

FROM scratch AS connect-prebuilt
COPY --chmod=755 prebuilt/connect/ /out/

FROM go-${GO_SOURCE} AS go
FROM connect-${GO_SOURCE} AS connect

FROM gcr.io/distroless/static-debian12:nonroot@sha256:afa5c872c891853ca7fcf1f12c3edb23f7eeef36189728842dd51042ff57f7ab
COPY --from=go /out/holtdroid /usr/local/bin/holtdroid
COPY --from=connect /out/ /usr/share/holtdroid/connect/
USER 65532:65532
ENTRYPOINT ["/usr/local/bin/holtdroid"]
CMD ["api"]
