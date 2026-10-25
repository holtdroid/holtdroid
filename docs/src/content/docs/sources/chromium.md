---
title: Chromium versions
description: Keep Chromium browser builds of many milestones in a source with holtdroid-chromium-sync, to reproduce bugs on the version they were reported on.
sidebar:
  order: 5
---

[holtdroid-chromium-sync](https://github.com/holtdroid/holtdroid-sync/blob/main/docs/chromium.md)
is a separate job (`job: chromium` in the chart
`deploy/helm/holtdroid-sync`). It copies Chromium browser builds, one per
milestone, into a folder or S3 prefix, which Holtdroid lists as a read-only
source. Launch one like any other build to open a page in that browser
version.

## Where the builds come from

Chromium's x86_64 snapshot builds in the public `chromium-browser-snapshots`
bucket, the same ones the [WebView catalog](/holtdroid/concepts/webview-versions/)
uses: `ChromePublic.apk`, Chromium as `org.chromium.chrome`, one APK with no
splits. It is Chromium, not Google Chrome, so Google sign-in, sync and Play
services features are missing. Builds go back to Chromium 129 (mid-2024),
about 420 MB each.

## Which milestones

Not all of them: the job keeps many recent milestones and fewer older ones.
Counting the available milestones newest first, it keeps:

- the milestones on Android's Stable, Beta, Dev and Canary channels;
- the newest `milestones.latest` (default 10);
- every milestone divisible by `milestones.every` (default 2);
- past the newest `milestones.older.after` (default 24), only milestones
  divisible by `milestones.older.every` (default 5) instead;
- `milestones.extra`.

In October 2026 the defaults pick 149–158, the even milestones 136–148 and
130: 18 builds, about 7.5 GB. Builds that stop matching as new milestones
come out are deleted, but only after a pass in which Chromium Dash and the
bucket answered. Each build is the milestone's last Canary, give or take a
few commits, and the current Canary milestone moves with every new Canary
release.

Each build is `chromium-{milestone}.apk` with a sidecar: the title
`Chromium {milestone}`, the version and snapshot revision as the note, and
the tags `milestone`, `version`, `channel`, `revision`, `minSdk`,
`targetSdk`, `requiresSdk` and `frontend`. Chromium 149 and later are
tagged `requiresSdk: 34`: like the WebView builds, they most likely abort on
Android 11 to 13, so start them on Android 14 or 15. Holtdroid shows the
tag but doesn't stop such a launch.

## Deploying

```yaml
job: chromium
existingSecret: holtdroid-chromium-sync # S3_ACCESS_KEY, S3_SECRET_KEY
tmpSize: 2Gi # one unpacked APK at a time
config:
  interval: 6h
  target:
    type: s3
    s3:
      endpoint: https://s3.example.com
      bucket: holtdroid
      prefix: chromium
      accessKey: env:S3_ACCESS_KEY
      secretKey: env:S3_SECRET_KEY
```

And the source in Holtdroid:

```yaml
sources:
  - name: chromium
    type: s3
    readOnly: true
    s3:
      endpoint: https://s3.example.com
      bucket: holtdroid
      prefix: chromium
      accessKey: env:S3_ACCESS_KEY
      secretKey: env:S3_SECRET_KEY
```

The job needs outbound HTTPS to `chromiumdash.appspot.com` and
`storage.googleapis.com`. Every option is in the job's
[docs](https://github.com/holtdroid/holtdroid-sync/blob/main/docs/chromium.md#configuration).

## Known limits

- DevTools for the browser's own tabs need a frontend revision, and
  snapshot builds report an all-zero one. The WebView catalog passes its
  `frontend` tag to the session, but builds from a source don't pass theirs
  yet, so the DevTools panel can't open the browser's tabs.
- Two builds of the same package can't be installed side by side: to
  compare milestones, start one session per milestone.
