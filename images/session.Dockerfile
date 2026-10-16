# Session image: Android emulator (headless), system image, frida-server,
# scrcpy-server and the agent built with Frida. linux/amd64 only (KVM, x86_64 system image).
# Only API 30 and 34+ x86_64 images translate ARM (decision #25).

ARG GO_IMAGE=docker.io/library/golang:1.27.2-bookworm@sha256:5cf287a799e6b94384bad13d16b14904c531f51ba65792237e122ce42b392f61
ARG BUN_IMAGE=docker.io/oven/bun:1.4.3@sha256:ec06c3b6cea04192ae6770c434f668ca41d343ad19fa6472216c7b48be39c598
ARG FRIDA_VERSION=17.15.5

FROM --platform=$BUILDPLATFORM ${GO_IMAGE} AS sdk
ARG FRIDA_VERSION
ARG EMULATOR_ZIP=emulator-linux_x64-16428233.zip
ARG EMULATOR_SHA1=cd7362ea55dfb86a418958138dc396e74165dd01
ARG PLATFORM_TOOLS_ZIP=platform-tools_r37.0.1-linux.zip
ARG PLATFORM_TOOLS_SHA1=477254aa5f903c15cf51001717bdf347fb6b53e0
ARG SYSTEM_IMAGE_ZIP=x86_64-35_r09.zip
ARG SYSTEM_IMAGE_SHA1=0103e6dab21290c4b9d16550a3ce99476f884eef
RUN apt-get update && apt-get install -y --no-install-recommends unzip xz-utils && rm -rf /var/lib/apt/lists/*
WORKDIR /dl
RUN set -eux; \
    repo=https://dl.google.com/android/repository; \
    curl -fsSLo emulator.zip "$repo/$EMULATOR_ZIP"; \
    curl -fsSLo platform-tools.zip "$repo/$PLATFORM_TOOLS_ZIP"; \
    curl -fsSLo system-image.zip "$repo/sys-img/google_apis/$SYSTEM_IMAGE_ZIP"; \
    printf '%s  %s\n' "$EMULATOR_SHA1" emulator.zip "$PLATFORM_TOOLS_SHA1" platform-tools.zip "$SYSTEM_IMAGE_SHA1" system-image.zip | sha1sum -c -; \
    sdk=/out/opt/android-sdk; \
    mkdir -p "$sdk/system-images/android-35/google_apis" "$sdk/platforms"; \
    unzip -q emulator.zip -d "$sdk"; \
    unzip -q platform-tools.zip -d "$sdk"; \
    unzip -q system-image.zip -d "$sdk/system-images/android-35/google_apis"; \
    rm -f *.zip

# Small device-side tools get their own layer so bumping them doesn't change
# the multi-GB SDK layer.
FROM --platform=$BUILDPLATFORM ${GO_IMAGE} AS tools
ARG FRIDA_VERSION
ARG FRIDA_SERVER_SHA256=400cb5b3b08cb897472692636179e44edbc78f9b481651371c8ff8b552a2210e
ARG SCRCPY_VERSION=3.3.3
ARG SCRCPY_SERVER_SHA256=7e70323ba7f259649dd4acce97ac4fefbae8102b2c6d91e2e7be613fd5354be0
RUN apt-get update && apt-get install -y --no-install-recommends xz-utils && rm -rf /var/lib/apt/lists/*
WORKDIR /dl
RUN set -eux; \
    curl -fsSLo frida-server.xz "https://github.com/frida/frida/releases/download/$FRIDA_VERSION/frida-server-$FRIDA_VERSION-android-x86_64.xz"; \
    curl -fsSLo scrcpy-server "https://github.com/Genymobile/scrcpy/releases/download/v$SCRCPY_VERSION/scrcpy-server-v$SCRCPY_VERSION"; \
    printf '%s  %s\n' "$FRIDA_SERVER_SHA256" frida-server.xz "$SCRCPY_SERVER_SHA256" scrcpy-server | sha256sum -c -; \
    mkdir -p /out/opt/holtdroid /out/opt/scrcpy; \
    xz -dc frida-server.xz > /out/opt/holtdroid/frida-server; \
    chmod 755 /out/opt/holtdroid/frida-server; \
    mv scrcpy-server /out/opt/scrcpy/scrcpy-server; \
    rm -f frida-server.xz

FROM --platform=$BUILDPLATFORM ${BUN_IMAGE} AS script
WORKDIR /opt/holtdroid/script
COPY internal/agent/script/package.json internal/agent/script/bun.lock ./
RUN bun install --frozen-lockfile --production
COPY internal/agent/script/agent.js internal/agent/script/system.js ./

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
RUN set -eux; \
    mkdir -p web/dist && touch web/dist/.keep; \
    cc=gcc; [ "$(dpkg --print-architecture)" = amd64 ] || cc=x86_64-linux-gnu-gcc; \
    CGO_ENABLED=1 GOOS=linux GOARCH=amd64 CC=$cc CGO_CFLAGS=-I/opt/frida CGO_LDFLAGS=-L/opt/frida \
      go build -tags frida -trimpath -ldflags "-s -w -X main.version=$VERSION" -o /out/holtdroid ./cmd/holtdroid

FROM docker.io/library/ubuntu:24.04@sha256:534baea6a22c03a63003dbc8dbe78fe34bc0d7e595d9a9dc9834884ff530eb55
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates \
      libasound2t64 libbsd0 libdbus-1-3 libdrm2 libegl1 libfontconfig1 libgbm1 libgl1 libnspr4 libnss3 libpulse0 \
      libx11-xcb1 libxcb-cursor0 libxcb-icccm4 libxcb-image0 libxcb-keysyms1 libxcb-randr0 libxcb-render-util0 \
      libxcb-shape0 libxcb-xfixes0 libxcb-xinerama0 libxcb-xkb1 libxcomposite1 libxcursor1 libxdamage1 libxi6 \
      libxkbcommon-x11-0 libxkbcommon0 libxkbfile1 libxrandr2 libxtst6 \
    && rm -rf /var/lib/apt/lists/*
ENV ANDROID_HOME=/opt/android-sdk \
    ANDROID_SDK_ROOT=/opt/android-sdk \
    ANDROID_AVD_HOME=/root/.android/avd \
    PATH=/opt/android-sdk/emulator:/opt/android-sdk/platform-tools:$PATH
COPY --from=sdk /out/ /
COPY --from=tools /out/ /
COPY images/session/avd /root/.android/avd
COPY --from=script /opt/holtdroid/script /opt/holtdroid/script
COPY --from=go /out/holtdroid /usr/local/bin/holtdroid
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/holtdroid"]
CMD ["agent"]
