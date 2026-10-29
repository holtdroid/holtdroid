<p align="center">
  <a href="https://holtdroid.github.io/"><img src="https://github.com/holtdroid/.github/raw/main/profile/assets/social-holtdroid.png" alt="Holtdroid — a cozy holt for your test Androids"></a>
</p>

<p align="center">
  <a href="https://holtdroid.github.io/"><b>Documentation</b></a> ·
  <a href="https://holtdroid.github.io/start/introduction/">Introduction</a> ·
  <a href="https://holtdroid.github.io/start/installation/">Installation</a> ·
  <a href="https://github.com/holtdroid">All repositories</a>
</p>

Holtdroid is a self-hosted, browser-based Android sandbox for testing APKs.
Pick a build from a folder or S3 bucket that your CI or a Slack sync fills, or
upload your own, launch an Android device on demand, and get — in one browser
tab — the device screen, Chrome DevTools attached to the app's WebViews,
clipboard sync and a VPN location switcher. Idle devices shut themselves down.

> **Status:** pre-alpha. The portal (api + web UI) runs locally against
> simulated devices with `make dev`; the Android emulator provider is being
> tried on a real cluster. Builds from Slack, S3 buckets and GitHub releases
> come in through [holtdroid-sync](https://github.com/holtdroid/holtdroid-sync); pages are tested in
> [Holtdroid WebView](https://github.com/holtdroid/holtdroid-webview), a WebView browser with
> DevTools unlocked. The plan lives in [`design/`](design/README.md),
> the docs at [holtdroid.github.io](https://holtdroid.github.io/), with
> [interactive guides](https://holtdroid.github.io/guides/first-steps/launch-app/) in English,
> Russian and Ukrainian.

## Why it exists

I'm a frontend engineer, and I build Holtdroid for my own use first. At work
most of our users open the product inside an app's embedded WebView or in
Chrome, often on old potato phones 🥔 with odd combinations of Android and
WebView versions. Their bugs have to be reproduced on exactly those
combinations.

I'm also lazy, and debugging over ADB through Chrome DevTools is flaky and
awkward. So instead of fighting it I wrote a tool that starts the WebView I
need and then digs into what the page actually does: the network requests on
the critical loading path, graphics problems, how well Cloudflare caches the
assets, and more.

I'm probably not the only person who rewrites SVG filters by hand and obsesses
over caching so the product loads fast on a bad connection without
overloading the phone, so I made it public ^.^ If something should be fixed
or added, I'd be glad to hear it: open an
[issue](https://github.com/holtdroid/holtdroid/issues).

## Try it

```sh
mise install && bun install
make build && ./bin/holtdroid dev --apks ~/Downloads
# open http://localhost:8080
```

## Highlights

- **No APK patching.** WebView remote debugging is switched on at runtime
  (Frida on a rooted image), the APK is installed exactly as shipped.
- **Everything in the browser.** scrcpy screen (multi-touch, H.264 over WebCodecs) and Chrome DevTools side by
  side, same origin, behind your existing forward-auth (Authelia,
  oauth2-proxy, …).
- **Dense, ARM-capable devices.** Android 15 runs in redroid containers on
  the node's kernel, several per node, with ARM translation from Google's
  x86_64 images for ARM-only builds.
- **Any WebView version.** Start a device with a Chromium WebView build of
  the milestone you need, synced from Chromium's snapshots, instead of the
  one built into Android.
- **Per-session VPN.** Each device egresses through its own sing-box sidecar;
  switch country from the UI.
- **Sign-in your way.** Anonymous animal names, one shared password, OIDC,
  a forward-auth proxy, or built-in users with passkeys, invite links,
  approval and per-user limits.
- **Sessions with a lifetime.** Bounded slots, idle timeout, max TTL, one
  click to extend.
- **Builds from anywhere.** Sources are folders or S3 prefixes with an
  optional `.meta.json` per APK (changelog, origin, tags); replaced files are
  picked up, and users can upload their own builds as public or private.
- **Pluggable.** Device providers, VPN providers, secret
  backends and auth are interfaces. Real phones on USB work without root
  as a first stage; rooted phones and the protections a shared phone needs
  are next.

## Architecture at a glance

Kubernetes-native. One Go binary (`holtdroid`) runs as several small services
(`api`, `provider-emulator`, `agent`), a React + shadcn/ui
frontend is embedded in `api`, and a Helm chart ties it together. See
[`design/architecture.md`](design/architecture.md).

## Requirements

- x86_64 Kubernetes nodes with binder and a Mesa GPU for sessions,
  dedicated to them (root in a session is root on the node).
- Pods with extra capabilities (Pod Security level `privileged`) allowed in
  the Holtdroid namespace, and NRI in the nodes' runtime (containerd 2.0+).
- Optionally an OIDC provider, an S3 bucket for the APK cache, or a
  forward-auth proxy.

## Acknowledgements

Generated avatars use [DiceBear](https://www.dicebear.com) (MIT) with the
“Voxel Art” style by DiceBear, licensed under
[CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/).

## License

[Apache-2.0](LICENSE)

---

<p align="center">
  <img src="https://github.com/holtdroid/.github/raw/main/profile/assets/ai-disclaimer.png" alt="Disclaimer: fully AI-generated. Not a single line of code was written or reviewed by a human. Use at your own risk.">
</p>

> [!CAUTION]
> **Fully AI-generated.** Not a single line of this project was written or reviewed by a human: all of it was
> written by Claude through Claude Code. It's a Pandora's box, so use it at your own risk.
