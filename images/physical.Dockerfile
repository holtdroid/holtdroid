# provider-physical: holtdroid without the UI, adb from platform-tools,
# scrcpy-server, sing-box and the Holtdroid Tunnel APK. linux/amd64 only
# (platform-tools for Linux is x86_64 only).

ARG GO_IMAGE=docker.io/library/golang:1.27.2-bookworm@sha256:5cf287a799e6b94384bad13d16b14904c531f51ba65792237e122ce42b392f61

FROM --platform=$BUILDPLATFORM ${GO_IMAGE} AS tools
ARG PLATFORM_TOOLS_ZIP=platform-tools_r37.0.1-linux.zip
ARG PLATFORM_TOOLS_SHA1=477254aa5f903c15cf51001717bdf347fb6b53e0
ARG SCRCPY_VERSION=3.3.3
ARG SCRCPY_SERVER_SHA256=7e70323ba7f259649dd4acce97ac4fefbae8102b2c6d91e2e7be613fd5354be0
ARG SING_BOX_VERSION=1.14.2
ARG SING_BOX_SHA256=a684484d7477d1437282ee411f4d131d0340aaad60a7868841ebd5d87dd8a0c6
ARG TUNNEL_VERSION=0.2.1
ARG TUNNEL_SHA256=d931045a7df4637c1d7f5faea3b5e1a053bc5d10a3071d418d20b2608116ccfe
RUN apt-get update && apt-get install -y --no-install-recommends unzip && rm -rf /var/lib/apt/lists/*
WORKDIR /dl
RUN set -eux; \
    curl -fsSLo platform-tools.zip "https://dl.google.com/android/repository/$PLATFORM_TOOLS_ZIP"; \
    curl -fsSLo scrcpy-server "https://github.com/Genymobile/scrcpy/releases/download/v$SCRCPY_VERSION/scrcpy-server-v$SCRCPY_VERSION"; \
    curl -fsSLo sing-box.tar.gz "https://github.com/SagerNet/sing-box/releases/download/v$SING_BOX_VERSION/sing-box-$SING_BOX_VERSION-linux-amd64.tar.gz"; \
    curl -fsSLo tunnel.apk "https://github.com/kriakiku/holtdroid-tunnel/releases/download/v$TUNNEL_VERSION/holtdroid-tunnel-$TUNNEL_VERSION.apk"; \
    echo "$PLATFORM_TOOLS_SHA1  platform-tools.zip" | sha1sum -c -; \
    printf '%s  %s\n' "$SCRCPY_SERVER_SHA256" scrcpy-server "$SING_BOX_SHA256" sing-box.tar.gz "$TUNNEL_SHA256" tunnel.apk | sha256sum -c -; \
    mkdir -p /out/usr/local/bin /out/opt/scrcpy /out/opt/holtdroid /state/holtdroid/.android; \
    unzip -q -j platform-tools.zip platform-tools/adb -d /out/usr/local/bin; \
    tar -xzf sing-box.tar.gz --strip-components=1 -C /out/usr/local/bin "sing-box-$SING_BOX_VERSION-linux-amd64/sing-box"; \
    mv scrcpy-server /out/opt/scrcpy/scrcpy-server; \
    mv tunnel.apk /out/opt/holtdroid/holtdroid-tunnel.apk; \
    rm -f platform-tools.zip sing-box.tar.gz

FROM --platform=$BUILDPLATFORM ${GO_IMAGE} AS go
ARG VERSION=dev
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY cmd cmd
COPY internal internal
COPY web/embed.go web/
COPY web/dist/.keep web/dist/
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 \
    go build -trimpath -ldflags "-s -w -X main.version=$VERSION" -o /out/holtdroid ./cmd/holtdroid

FROM gcr.io/distroless/cc-debian12:nonroot@sha256:9dac0a79194e45a7da0158a9c6da57b217585af0786db3845d1f0ec1a0dd182f
COPY --from=tools /out/ /
COPY --from=tools --chown=65532:65532 /state/holtdroid /var/lib/holtdroid
COPY --from=go /out/holtdroid /usr/local/bin/holtdroid
ENV HOME=/var/lib/holtdroid
WORKDIR /var/lib/holtdroid
USER 65532:65532
ENTRYPOINT ["/usr/local/bin/holtdroid"]
CMD ["provider-physical"]
