# provider-physical: holtdroid without the UI, built with Frida so rooted
# phones can be instrumented (decision #67). Carries adb from platform-tools,
# scrcpy-server, sing-box and the Holtdroid Tunnel APK for every phone, plus
# the device-side pieces root mode needs: an arm64 frida-server, a static
# arm64 sing-box for the transparent tun, the locales dex and the Frida
# bundles. linux/amd64 only (platform-tools for Linux is x86_64 only).

ARG GO_IMAGE=docker.io/library/golang:1.27.2-bookworm@sha256:5cf287a799e6b94384bad13d16b14904c531f51ba65792237e122ce42b392f61
ARG BUN_IMAGE=docker.io/oven/bun:1.4.3@sha256:ec06c3b6cea04192ae6770c434f668ca41d343ad19fa6472216c7b48be39c598
ARG JDK_IMAGE=docker.io/library/eclipse-temurin:21-jdk-noble@sha256:107215954359f1ab0be058a247d7c64ed6e69c71c1682d471d38ef751ec8e964
ARG FRIDA_VERSION=17.15.5

FROM --platform=$BUILDPLATFORM ${GO_IMAGE} AS tools
ARG FRIDA_VERSION
ARG FRIDA_SERVER_ARM64_SHA256=9799088bc851bcad053388fc02088b3d082c93c3ed7e791b1f4efa803dbad5a5
ARG PLATFORM_TOOLS_ZIP=platform-tools_r37.0.1-linux.zip
ARG PLATFORM_TOOLS_SHA1=477254aa5f903c15cf51001717bdf347fb6b53e0
ARG SCRCPY_VERSION=3.3.3
ARG SCRCPY_SERVER_SHA256=7e70323ba7f259649dd4acce97ac4fefbae8102b2c6d91e2e7be613fd5354be0
ARG SING_BOX_VERSION=1.14.2
ARG SING_BOX_SHA256=a684484d7477d1437282ee411f4d131d0340aaad60a7868841ebd5d87dd8a0c6
ARG TUNNEL_VERSION=0.2.1
ARG TUNNEL_SHA256=d931045a7df4637c1d7f5faea3b5e1a053bc5d10a3071d418d20b2608116ccfe
RUN apt-get update && apt-get install -y --no-install-recommends unzip xz-utils && rm -rf /var/lib/apt/lists/*
WORKDIR /dl
RUN set -eux; \
    curl -fsSLo platform-tools.zip "https://dl.google.com/android/repository/$PLATFORM_TOOLS_ZIP"; \
    curl -fsSLo scrcpy-server "https://github.com/Genymobile/scrcpy/releases/download/v$SCRCPY_VERSION/scrcpy-server-v$SCRCPY_VERSION"; \
    curl -fsSLo sing-box.tar.gz "https://github.com/SagerNet/sing-box/releases/download/v$SING_BOX_VERSION/sing-box-$SING_BOX_VERSION-linux-amd64.tar.gz"; \
    curl -fsSLo tunnel.apk "https://github.com/holtdroid/holtdroid-tunnel/releases/download/v$TUNNEL_VERSION/holtdroid-tunnel-$TUNNEL_VERSION.apk"; \
    curl -fsSLo frida-server.xz "https://github.com/frida/frida/releases/download/$FRIDA_VERSION/frida-server-$FRIDA_VERSION-android-arm64.xz"; \
    echo "$PLATFORM_TOOLS_SHA1  platform-tools.zip" | sha1sum -c -; \
    printf '%s  %s\n' "$SCRCPY_SERVER_SHA256" scrcpy-server "$SING_BOX_SHA256" sing-box.tar.gz "$TUNNEL_SHA256" tunnel.apk "$FRIDA_SERVER_ARM64_SHA256" frida-server.xz | sha256sum -c -; \
    mkdir -p /out/usr/local/bin /out/opt/scrcpy /out/opt/holtdroid /state/holtdroid/.android; \
    unzip -q -j platform-tools.zip platform-tools/adb -d /out/usr/local/bin; \
    tar -xzf sing-box.tar.gz --strip-components=1 -C /out/usr/local/bin "sing-box-$SING_BOX_VERSION-linux-amd64/sing-box"; \
    mv scrcpy-server /out/opt/scrcpy/scrcpy-server; \
    mv tunnel.apk /out/opt/holtdroid/holtdroid-tunnel.apk; \
    xz -dc frida-server.xz > /out/opt/holtdroid/frida-server; \
    chmod 755 /out/opt/holtdroid/frida-server; \
    rm -f platform-tools.zip sing-box.tar.gz frida-server.xz

# Locales.java runs on the device through app_process (decision #59) for the
# system language on rooted phones.
FROM --platform=$BUILDPLATFORM ${JDK_IMAGE} AS dex
ARG R8_VERSION=9.5.26
ARG R8_SHA256=3502f087388ce95bbf5254555927f09385dc2636873964d0bd53f3eaf4fb49ad
WORKDIR /src
COPY images/session/Locales.java ./
RUN set -eux; \
    curl -fsSLo r8.jar "https://dl.google.com/dl/android/maven2/com/android/tools/r8/$R8_VERSION/r8-$R8_VERSION.jar"; \
    echo "$R8_SHA256  r8.jar" | sha256sum -c -; \
    javac --release 11 -d classes Locales.java; \
    mkdir -p dex /out/opt/holtdroid; \
    java -cp r8.jar com.android.tools.r8.D8 --release --min-api 30 --lib "$JAVA_HOME" --output dex classes/Locales.class; \
    mv dex/classes.dex /out/opt/holtdroid/locales.dex

# Static arm64 sing-box for the phone's transparent tun tunnel (root mode).
# The official linux-arm64 release is glibc-dynamic and won't run on Android;
# a CGO-free static build does.
FROM --platform=$BUILDPLATFORM ${GO_IMAGE} AS singbox
ARG SING_BOX_VERSION=1.14.2
RUN set -eux; \
    mkdir /b && cd /b && go mod init holtdroid-singbox; \
    go get "github.com/sagernet/sing-box/cmd/sing-box@v$SING_BOX_VERSION"; \
    CGO_ENABLED=0 GOOS=linux GOARCH=arm64 \
      go build -trimpath -tags "with_gvisor with_quic with_clash_api" -ldflags "-s -w" \
        -o /out/sing-box github.com/sagernet/sing-box/cmd/sing-box

FROM --platform=$BUILDPLATFORM ${BUN_IMAGE} AS script
WORKDIR /opt/holtdroid/script
COPY frida/package.json frida/bun.lock ./
RUN bun install --frozen-lockfile --production
COPY frida/*.ts ./

FROM --platform=$BUILDPLATFORM ${GO_IMAGE} AS go
ARG FRIDA_VERSION
ARG FRIDA_DEVKIT_SHA256=4f7b5ebfef5297f3dfc2ebc7629aa0a1d19334988ce95f74dbfd29b8665235e6
ARG VERSION=dev
RUN set -eux; \
    cross=; [ "$(dpkg --print-architecture)" = amd64 ] || cross="gcc-x86-64-linux-gnu libc6-dev-amd64-cross"; \
    apt-get update && apt-get install -y --no-install-recommends xz-utils $cross && rm -rf /var/lib/apt/lists/*; \
    curl -fsSLo devkit.tar.xz "https://github.com/frida/frida/releases/download/$FRIDA_VERSION/frida-core-devkit-$FRIDA_VERSION-linux-x86_64.tar.xz"; \
    echo "$FRIDA_DEVKIT_SHA256  devkit.tar.xz" | sha256sum -c -; \
    mkdir -p /opt/frida && tar -xJf devkit.tar.xz -C /opt/frida && rm devkit.tar.xz
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY cmd cmd
COPY internal internal
COPY web/embed.go web/
COPY web/dist/.keep web/dist/
RUN set -eux; \
    cc=gcc; [ "$(dpkg --print-architecture)" = amd64 ] || cc=x86_64-linux-gnu-gcc; \
    CGO_ENABLED=1 GOOS=linux GOARCH=amd64 CC=$cc CGO_CFLAGS=-I/opt/frida CGO_LDFLAGS=-L/opt/frida \
      go build -tags frida -trimpath -ldflags "-s -w -X main.version=$VERSION" -o /out/holtdroid ./cmd/holtdroid

# Bundle the Frida scripts by running the frida binary on the build arch.
FROM --platform=$BUILDPLATFORM ${GO_IMAGE} AS bundle
ARG FRIDA_VERSION
ARG FRIDA_DEVKIT_SHA256_AMD64=4f7b5ebfef5297f3dfc2ebc7629aa0a1d19334988ce95f74dbfd29b8665235e6
ARG FRIDA_DEVKIT_SHA256_ARM64=27e28644a21050b0c3368a4a195a3d51331c49befcb63b6b67d099dd25a07ade
RUN set -eux; \
    case "$(dpkg --print-architecture)" in \
      amd64) arch=x86_64 sum=$FRIDA_DEVKIT_SHA256_AMD64 ;; \
      arm64) arch=arm64 sum=$FRIDA_DEVKIT_SHA256_ARM64 ;; \
    esac; \
    apt-get update && apt-get install -y --no-install-recommends xz-utils && rm -rf /var/lib/apt/lists/*; \
    curl -fsSLo devkit.tar.xz "https://github.com/frida/frida/releases/download/$FRIDA_VERSION/frida-core-devkit-$FRIDA_VERSION-linux-$arch.tar.xz"; \
    echo "$sum  devkit.tar.xz" | sha256sum -c -; \
    mkdir -p /opt/frida && tar -xJf devkit.tar.xz -C /opt/frida && rm devkit.tar.xz
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY cmd cmd
COPY internal internal
COPY web/embed.go web/
RUN mkdir -p web/dist && touch web/dist/.keep && \
    CGO_ENABLED=1 CGO_CFLAGS=-I/opt/frida CGO_LDFLAGS=-L/opt/frida go build -tags frida -o /usr/local/bin/holtdroid ./cmd/holtdroid
COPY --from=script /opt/holtdroid/script /script
RUN holtdroid agent compile-scripts /script && mkdir /out && cp /script/agent.js /script/system.js /out/

FROM gcr.io/distroless/cc-debian12:nonroot@sha256:9dac0a79194e45a7da0158a9c6da57b217585af0786db3845d1f0ec1a0dd182f
COPY --from=tools /out/ /
COPY --from=tools --chown=65532:65532 /state/holtdroid /var/lib/holtdroid
COPY --from=dex /out/ /
COPY --from=singbox /out/sing-box /opt/holtdroid/sing-box-android
COPY --from=bundle /out/ /opt/holtdroid/script/
COPY --from=go /out/holtdroid /usr/local/bin/holtdroid
ENV HOME=/var/lib/holtdroid
WORKDIR /var/lib/holtdroid
USER 65532:65532
ENTRYPOINT ["/usr/local/bin/holtdroid"]
CMD ["provider-physical"]
