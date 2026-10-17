---
title: Artifact storage
description: Where downloaded APKs and their metadata are cached — a directory or S3.
sidebar:
  order: 2
---

The api downloads an APK from its source once, parses it (package, version,
label, icon, ABIs) and keeps the file and metadata in an artifact store.
Agents fetch the APK from the api, never from the source.

The store is a **cache**: sources stay the source of truth, and anything
missing is downloaded again on demand. That's why the api has no database and
no persistent state of its own.

## Filesystem

```yaml
storage:
  type: filesystem
  filesystem:
    dir: /var/cache/holtdroid
cache:
  maxSize: 20GiB
  warm: 10
```

Each api replica keeps its own copy. An `emptyDir` is enough (the chart's
default): after a restart the cache fills again as people browse.

## S3 and compatible stores

Use a bucket when you run several api replicas, want warm caches across
restarts, or don't want APKs on node disks. Anything S3-compatible works —
AWS S3, MinIO, Ceph RGW, Garage, VersityGW, Cloudflare R2.

```yaml
storage:
  type: s3
  s3:
    endpoint: https://s3.example.com
    region: us-east-1
    bucket: holtdroid
    prefix: cache/
    accessKey: env:S3_ACCESS_KEY
    secretKey: env:S3_SECRET_KEY
    pathStyle: true
```

| Key                | Meaning                                                                                                                                                              |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `endpoint`         | Base URL; `https://` enables TLS                                                                                                                                     |
| `region`           | Bucket region, if your store cares                                                                                                                                   |
| `bucket`           | Existing bucket                                                                                                                                                      |
| `prefix`           | Optional key prefix, to share a bucket                                                                                                                               |
| `accessKey`        | Secret reference; leave both keys empty to use IAM roles / instance profile                                                                                          |
| `secretKey`        | Secret reference                                                                                                                                                     |
| `pathStyle`        | `true` for most self-hosted stores (`endpoint/bucket/key`)                                                                                                           |
| `credentialsURL`   | Fetch temporary keys instead, in the ECS container credentials format (e.g. from [holtdroid-s3-sync](/holtdroid/sources/s3/)'s broker); refreshed before they expire |
| `credentialsToken` | Secret reference sent as the `Authorization` header to `credentialsURL`                                                                                              |

The api needs `GetObject`, `PutObject`, `DeleteObject` and `ListBucket` on
the bucket/prefix.

## Size limit and warm-up

| Key             | Default | Meaning                                                                  |
| --------------- | ------- | ------------------------------------------------------------------------ |
| `cache.maxSize` | `20GiB` | Beyond this the least recently used APKs are evicted                     |
| `cache.warm`    | `10`    | Newest uncached APKs per listing to download and parse in the background |

On S3, "least recently used" means "oldest upload", since objects can't be
touched cheaply; a bucket lifecycle rule is a fine alternative to `maxSize`.

## Layout

One prefix per artifact revision, named after a hash of source, file and
revision — a replaced file gets a fresh entry:

```
<hash>/app.apk
<hash>/icon.png     # when the launcher icon is a bitmap
<hash>/meta.json    # written last; marks the entry complete
```
