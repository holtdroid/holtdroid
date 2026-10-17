<p align="center">
  <strong>Holtdroid</strong><br>
  <em>A cozy holt for your test Androids.</em>
</p>

Holtdroid is a self-hosted, browser-based Android sandbox for testing APKs.
Pick a build from a folder or S3 bucket that your CI or a Slack sync fills, or
upload your own, launch an Android device on demand, and get — in one browser
tab — the device screen, Chrome DevTools attached to the app's WebViews,
clipboard sync and a VPN location switcher. Idle devices shut themselves down.

> **Status:** pre-alpha. The portal (api + web UI) runs locally against
> simulated devices with `make dev`; the Android emulator provider is being
> tried on a real cluster. Builds from Slack, S3 buckets and GitHub releases
> come in through [holtdroid-sync](https://github.com/kriakiku/holtdroid-sync); pages are tested in
> [Holtdroid WebView](https://github.com/kriakiku/holtdroid-webview), a WebView browser with
> DevTools unlocked. The plan lives in [`design/`](design/README.md),
> the docs at [kriakiku.github.io/holtdroid](https://kriakiku.github.io/holtdroid/).

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
- **ARM APKs on x86 hosts.** Uses Google's x86_64 system images with built-in
  ARM translation and KVM acceleration.
- **Per-session VPN.** Each device egresses through its own sing-box sidecar;
  switch country from the UI.
- **Sign-in your way.** Anonymous animal names, one shared password, OIDC,
  or a forward-auth proxy — all stateless.
- **Sessions with a lifetime.** Bounded slots, idle timeout, max TTL, one
  click to extend.
- **Builds from anywhere.** Sources are folders or S3 prefixes with an
  optional `.meta.json` per APK (changelog, origin, tags); replaced files are
  picked up, and users can upload their own builds as public or private.
- **Pluggable.** Device providers, VPN providers, secret
  backends and auth are interfaces. Physical rooted phones are the next
  provider on the roadmap.

## Architecture at a glance

Kubernetes-native. One Go binary (`holtdroid`) runs as several small services
(`api`, `provider-emulator`, `agent`), a React + shadcn/ui
frontend is embedded in `api`, and a Helm chart ties it together. See
[`design/architecture.md`](design/architecture.md).

## Requirements

- Kubernetes nodes with `/dev/kvm` (x86_64) for emulator sessions.
- Privileged pods allowed in the Holtdroid namespace.
- Optionally an OIDC provider, an S3 bucket for the APK cache, or a
  forward-auth proxy.

## Acknowledgements

Generated avatars use [DiceBear](https://www.dicebear.com) (MIT) with the
“Voxel Art” style by DiceBear, licensed under
[CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/).

## License

[Apache-2.0](LICENSE)
