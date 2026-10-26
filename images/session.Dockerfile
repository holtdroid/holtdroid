# Session image: the agent built with Frida, adb, frida-server and
# scrcpy-server. Android itself runs from holtdroid-redroid in the same Pod
# (decision #82). linux/amd64 only, like redroid.

ARG GO_SOURCE=build
ARG GO_IMAGE=docker.io/library/golang:1.27.2-bookworm@sha256:5cf287a799e6b94384bad13d16b14904c531f51ba65792237e122ce42b392f61
ARG BUN_IMAGE=docker.io/oven/bun:1.4.3@sha256:ec06c3b6cea04192ae6770c434f668ca41d343ad19fa6472216c7b48be39c598
ARG FRIDA_VERSION=17.15.5
ARG UBUNTU_IMAGE=docker.io/library/ubuntu:24.04@sha256:68ee22004a9109b44973313b02ff7b1de250f1de0f5ecb628d73f579aaff33ac
ARG JDK_IMAGE=docker.io/library/eclipse-temurin:21-jdk-noble@sha256:107215954359f1ab0be058a247d7c64ed6e69c71c1682d471d38ef751ec8e964

FROM --platform=$BUILDPLATFORM ${GO_IMAGE} AS sdk
ARG PLATFORM_TOOLS_ZIP=platform-tools_r37.0.1-linux.zip
ARG PLATFORM_TOOLS_SHA1=477254aa5f903c15cf51001717bdf347fb6b53e0
RUN apt-get update && apt-get install -y --no-install-recommends unzip && rm -rf /var/lib/apt/lists/*
WORKDIR /dl
RUN set -eux; \
    curl -fsSLo platform-tools.zip "https://dl.google.com/android/repository/$PLATFORM_TOOLS_ZIP"; \
    echo "$PLATFORM_TOOLS_SHA1  platform-tools.zip" | sha1sum -c -; \
    mkdir -p /out/opt/android-sdk; \
    unzip -q platform-tools.zip -d /out/opt/android-sdk; \
    rm platform-tools.zip

# Device-side tools get their own layer.
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

# Locales.java, Geo.java and Clip.java run on the device through app_process
# (decision #59): the system language, test location providers on Android 11
# where `cmd location` has no providers command, and redroid's clipboard on 13+
# without SystemUI's preview (decision #126).
FROM --platform=$BUILDPLATFORM ${JDK_IMAGE} AS dex
ARG R8_VERSION=9.5.26
ARG R8_SHA256=3502f087388ce95bbf5254555927f09385dc2636873964d0bd53f3eaf4fb49ad
WORKDIR /src
COPY images/session/*.java ./
RUN set -eux; \
    curl -fsSLo r8.jar "https://dl.google.com/dl/android/maven2/com/android/tools/r8/$R8_VERSION/r8-$R8_VERSION.jar"; \
    echo "$R8_SHA256  r8.jar" | sha256sum -c -; \
    javac --release 11 -d classes *.java; \
    mkdir -p dex /out/opt/holtdroid; \
    java -cp r8.jar com.android.tools.r8.D8 --release --min-api 30 --lib "$JAVA_HOME" --output dex classes/*.class; \
    mv dex/classes.dex /out/opt/holtdroid/tools.dex

FROM --platform=$BUILDPLATFORM ${BUN_IMAGE} AS script
WORKDIR /opt/holtdroid/script
COPY frida/package.json frida/bun.lock ./
RUN bun install --frozen-lockfile --production
COPY frida/*.ts ./

FROM --platform=$BUILDPLATFORM ${GO_IMAGE} AS go-build
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

FROM --platform=$BUILDPLATFORM ${GO_IMAGE} AS bundle-build
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

# GO_SOURCE=prebuilt takes the Frida build and the bundled scripts the release
# workflow made on the runner (with cached builds) instead of compiling here.
FROM scratch AS go-prebuilt
COPY --chmod=755 prebuilt/holtdroid-frida-linux-amd64 /out/holtdroid

FROM scratch AS bundle-prebuilt
COPY prebuilt/agent.js prebuilt/system.js /out/

FROM go-${GO_SOURCE} AS go
FROM bundle-${GO_SOURCE} AS bundle

FROM ${UBUNTU_IMAGE}
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates iproute2 && rm -rf /var/lib/apt/lists/*
ENV PATH=/opt/android-sdk/platform-tools:$PATH
COPY --from=sdk /out/ /
COPY --from=tools /out/ /
COPY --from=dex /out/ /
COPY --from=bundle /out/ /opt/holtdroid/script/
COPY --from=go /out/holtdroid /usr/local/bin/holtdroid
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/holtdroid"]
CMD ["agent"]
