---
title: Browsers from release archives
description: Keep Opera, Firefox and other browsers in a source with holtdroid-archive-sync, from the public archives their makers publish.
sidebar:
  order: 6
---

[holtdroid-archive-sync](https://github.com/holtdroid/holtdroid-sync/blob/main/docs/archive.md)
is a separate job (`job: archive` in the chart
`deploy/helm/holtdroid-sync`). It reads public release archives that are
plain HTTP directory listings and copies the newest versions into a folder or
S3 prefix, which Holtdroid lists as a read-only source.

## Opera and Firefox

Opera publishes every Android build at `get.opera.com`, Firefox at
`archive.mozilla.org`. This config keeps the five newest versions of each:

```yaml
job: archive
existingSecret: holtdroid-archive-sync # S3_ACCESS_KEY, S3_SECRET_KEY
config:
  archives:
    - name: opera
      title: Opera
      url: https://get.opera.com/pub/opera/android/
      versionDir: '^\d+$'
      fileVersion: "Opera_([0-9_]+)_Generic"
      include: ["*_arm8_*.apk", "*_x86_*.apk"]
    - name: opera-gx
      title: Opera GX
      url: https://get.opera.com/pub/opera/android/opera-gx/
      fileVersion: 'opera-gx-([0-9.]+)\.apk'
    - name: opera-mini
      title: Opera Mini
      url: https://get.opera.com/pub/opera/android/mini/
      versionDir: '^\d+\.\d+\.\d+\.\d+$'
    - name: firefox
      title: Firefox
      url: https://archive.mozilla.org/pub/fenix/releases/
      versionDir: '^\d+\.\d+(\.\d+)?$'
      fileVersion: 'fenix-([0-9.]+)\.multi'
      depth: 2
      include: ["*arm64-v8a.apk", "*x86_64.apk"]
  target:
    type: s3
    s3:
      endpoint: https://s3.example.com
      bucket: holtdroid
      prefix: archive
      accessKey: env:S3_ACCESS_KEY
      secretKey: env:S3_SECRET_KEY
```

And the source in Holtdroid:

```yaml
sources:
  - name: browsers
    type: s3
    readOnly: true
    s3:
      endpoint: https://s3.example.com
      bucket: holtdroid
      prefix: archive
      accessKey: env:S3_ACCESS_KEY
      secretKey: env:S3_SECRET_KEY
```

The job sends its own name as the User-Agent and doesn't try to pass bot
checks. Brave, DuckDuckGo and Kiwi publish APKs on GitHub, so
[holtdroid-github-sync](/sources/github/) covers them; for Brave, set
`releaseName: "^Release "`, since its Nightly and Beta builds are normal
releases there.
