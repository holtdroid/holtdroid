FROM --platform=$BUILDPLATFORM docker.io/oven/bun:1.4.3@sha256:ec06c3b6cea04192ae6770c434f668ca41d343ad19fa6472216c7b48be39c598 AS web
WORKDIR /src
COPY package.json bun.lock bunfig.toml ./
COPY web/package.json web/
COPY docs/package.json docs/
RUN bun install --frozen-lockfile --ignore-scripts
COPY web web
RUN bun run --cwd web build

FROM --platform=$BUILDPLATFORM docker.io/library/golang:1.27.2-bookworm@sha256:5cf287a799e6b94384bad13d16b14904c531f51ba65792237e122ce42b392f61 AS go
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

FROM gcr.io/distroless/static-debian12:nonroot@sha256:afa5c872c891853ca7fcf1f12c3edb23f7eeef36189728842dd51042ff57f7ab
COPY --from=go /out/holtdroid /usr/local/bin/holtdroid
USER nonroot:nonroot
ENTRYPOINT ["/usr/local/bin/holtdroid"]
CMD ["api"]
