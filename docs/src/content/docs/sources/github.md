---
title: GitHub releases
description: Copy APKs attached to GitHub releases into a source with holtdroid-github-sync.
sidebar:
  order: 4
---

[holtdroid-github-sync](https://github.com/holtdroid/holtdroid-sync/blob/main/docs/github.md) is
a separate job (`job: github` in the chart `deploy/helm/holtdroid-sync`). It polls the releases of one or
more repositories and copies their `.apk` assets into a folder or S3 prefix,
which Holtdroid lists as a read-only source.

## What it copies

For each repository, the job walks the releases newest first:

- drafts are skipped;
- pre-releases are skipped unless `prereleases: true`;
- only the newest `releases` releases count (`0` = all);
- [`include` rules](/holtdroid/sources/overview/#include-rules) pick assets
  by `{tag}/{asset name}`, e.g. `!*-debug.apk`.

Each asset lands at `{owner}/{repo}/{tag}/{asset}` with a sidecar:

| Field        | Value                                              |
| ------------ | -------------------------------------------------- |
| `note`       | the release name, or the tag, plus "(pre-release)" |
| `changelog`  | the release notes                                  |
| `uploadedBy` | the GitHub login that uploaded the asset           |
| `uploadedAt` | when the asset was last updated                    |
| `link`       | the release page                                   |
| `tags`       | `repo`, `release`, `target` (branch), `prerelease` |

The launcher icon is extracted and written as `x.apk.icon.png`. A
re-uploaded asset is copied again. Copies of assets that are gone, fall out
of the newest `releases` or no longer match the rules are pruned, but only
after every repository was listed.

## Rate limits

Without a token, GitHub allows 60 API requests an hour. A pass costs one
request per repository plus one per new asset, so the default 15-minute
interval fits a handful of public repositories. Set `github.token` for more
repositories, shorter intervals or private repositories.

## Deploying

The chart is in the sync repository (`deploy/helm/holtdroid-sync`); `job`
picks the GitHub sync:

```yaml
job: github
existingSecret: holtdroid-github-sync # S3_ACCESS_KEY, S3_SECRET_KEY, NOTIFY_URL
persistence:
  enabled: false # an S3 target needs no volume
config:
  repos:
    - repo: WebView-CG/CanIAndroidWebView
      releases: 5
  interval: 15m
  target:
    type: s3
    s3:
      endpoint: https://s3.example.com
      bucket: holtdroid
      prefix: github
      accessKey: env:S3_ACCESS_KEY
      secretKey: env:S3_SECRET_KEY
  notify: # optional: announce new builds with launch links
    urls: [env:NOTIFY_URL] # shoutrrr, e.g. slack://xoxb:<bot token>@C0123ABCD
    portalURL: https://holtdroid.example.com
    source: github
```

And the source in Holtdroid:

```yaml
sources:
  - name: github
    type: s3
    readOnly: true
    s3:
      endpoint: https://s3.example.com
      bucket: holtdroid
      prefix: github
      accessKey: env:S3_ACCESS_KEY
      secretKey: env:S3_SECRET_KEY
```

Every option is in the job's
[docs](https://github.com/holtdroid/holtdroid-sync/blob/main/docs/github.md#configuration).
