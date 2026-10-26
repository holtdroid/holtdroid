---
title: WebView versions
description: Start a virtual device with a chosen Chromium or Google WebView instead of the one built into Android.
sidebar:
  order: 3
---

Many WebView bugs depend on the WebView version, not on the Android version.
Each virtual device comes with the WebView built into its Android image:
Chromium 125 on Android 11 up to 128 on Android 15. With a WebView catalog,
the launch dialog offers other versions too. The agent installs the chosen
build over the built-in WebView before the app starts, so every app on the
device, including yours, uses it.

## Choosing a version

On a virtual device, the launch dialog shows a **WebView** step under the
Android version. It lists:

- **Built-in**, the WebView shipped with the Android image;
- one card per Chromium milestone in the catalog, marked with the release
  channels it is on today (Stable, Beta, Dev, Canary);
- with a Google WebView catalog, one card per Google WebView build, titled
  _Google WebView_.

The launch dialog starts on **Built-in** and remembers nothing. Quick launch
uses the version you last launched with, or the newest Chromium milestone on
the Stable channel that works on the chosen Android version, or the newest
Chromium milestone when none is on Stable. A portal whose catalogs hold only
Google WebView builds picks among those the same way. Choosing **Built-in** is remembered like any other choice.

Only builds that work on the chosen Android version are shown. Chromium 149
and later need Android 14 or 15. On Android 11, 12 and 13 they abort as
soon as an app creates a WebView, so there the newest choice is Chromium
145 (148 with `extra: [148]`). The choice
is remembered per provider and reused by quick launch. While the session
starts, the progress shows "Installing WebView …", which adds a few seconds.
The session header then shows the installed version. To compare versions,
start one session per version.

The device card still shows the WebView provider and can switch it during a
session. Uninstalling the update with `pm uninstall com.android.webview`
(over ADB, or in the Terminal tab where it is offered) brings back the
built-in WebView.

## Where the builds come from

The builds are Chromium's own snapshot builds of Android System WebView for
x86_64, published in the public `chromium-browser-snapshots` bucket. They
are `com.android.webview`, signed with Chromium's public debug key. The
[holtdroid-redroid](https://github.com/holtdroid/holtdroid-redroid) images
re-sign the built-in WebView with the same key. Without that, Android would
refuse to install a snapshot as an update of the built-in WebView.

For each milestone, the catalog holds the snapshot closest before that
milestone's last Canary release. Compared with what users get from the Play
Store:

- it is a main-branch build, so fixes merged into the release branch later
  are missing;
- it has no Google-only parts such as Safe Browsing;
- it carries the same Blink, V8 and WebView code, which is what page
  behaviour depends on.

Snapshots for x86_64 go back to Chromium 129, so older versions are only
available as the built-in WebView of some Android image.

DevTools work as usual. Snapshot builds don't report which DevTools frontend
fits them, so the catalog records the commit of that milestone's Canary
release and the agent serves that frontend.

## Google WebView

Chromium's snapshots are built without proprietary codecs: H.264, AAC and
HEVC in `<video>` and Media Source Extensions don't play in them. The
WebView built into the Android images does play them, and so does Google's
Android System WebView, `com.google.android.webview`, which a second
catalog can hold: the x86_64 APKs of Google WebView from APKMirror, with the
same tags as the Chromium catalog plus `package`.

A Google WebView build doesn't replace the built-in one. The agent installs
it next to `com.android.webview` and makes it the device's WebView with
`cmd webviewupdate set-webview-implementation`. Android accepts it because
the [holtdroid-redroid](https://github.com/holtdroid/holtdroid-redroid)
images list it as a WebView provider (not a default one, so a session
without a choice keeps the built-in WebView). Uninstalling
`com.google.android.webview` brings the built-in one back.

Fill it with a job of your own that writes APKs and sidecars to a prefix of
its own (each job prunes its prefix), and list that prefix under
`webview.catalogs`:

```yaml
# holtdroid chart, config:
webview:
  storage: { type: s3, s3: { …, prefix: webview } }
  catalogs:
    - { type: s3, s3: { …, prefix: apkmirror/google-inc/android-system-webview } }
```

A build's sidecar needs the tags `version` and `milestone`, `package:
com.google.android.webview`, and `minSdk` or `requiresSdk` for the Android
versions it runs on.

## Filling the catalog

The catalog is a folder or S3 prefix written by
[holtdroid-webview-sync](https://github.com/holtdroid/holtdroid-sync/blob/main/docs/webview.md)
(`job: webview` in the chart `deploy/helm/holtdroid-sync`). It reads
[Chromium Dash](https://chromiumdash.appspot.com) and keeps:

- the milestones on the Stable, Beta, Dev and Canary channels now;
- the newest `milestones.latest` (6);
- every milestone divisible by `milestones.every` (5);
- any `milestones.extra`.

From each snapshot zip (about 500 MB) it downloads only the WebView APK,
using HTTP range requests. Each build takes about 420 MB in storage, about
4.5 GB with the defaults. Builds of milestones that drop out of the
selection are deleted.

```yaml
# holtdroid-sync chart
job: webview
existingSecret: holtdroid-webview-sync
config:
  milestones: { latest: 6, every: 5 }
  target:
    type: s3
    s3:
      endpoint: https://s3.example.com
      bucket: holtdroid
      prefix: webview
      accessKey: env:S3_ACCESS_KEY
      secretKey: env:S3_SECRET_KEY
```

Then point the api at the same place:

```yaml
# holtdroid chart, config:
webview:
  storage:
    type: s3
    s3:
      endpoint: https://s3.example.com
      bucket: holtdroid
      prefix: webview
      accessKey: env:S3_ACCESS_KEY
      secretKey: env:S3_SECRET_KEY
```

The catalog is not an APK source: its builds don't appear in the build list.
The api lists them from their sidecars alone and streams the chosen one to
the session's agent over its internal port, without putting it in the APK
cache.

## Limits

- Virtual devices only. Phones keep their own WebView, which is signed by
  Google, so a snapshot can't replace it.
- Chromium builds have no proprietary codecs; Google WebView builds do.
- x86_64 builds from Chromium 129 on; earlier versions only as a built-in
  WebView.
- Chromium 149 and later only on Android 14 and 15. The sync job's
  `requirements` rules record this as `requiresSdk` in the catalog, and the
  api refuses a build the chosen Android version can't run.
- A WebView that fails to install fails the session, and the reason says
  why.
