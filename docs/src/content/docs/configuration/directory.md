---
title: Directory source
description: Serve APKs from a plain directory or mounted volume.
sidebar:
  order: 7
---

The `source-dir` service lists every `*.apk` file in one directory, newest
first by modification time, and streams them on demand. Use it for builds
that land on a shared volume, an NFS export or a CI artifact mount — or just
to try Holtdroid with a few local APKs.

```yaml
listen: ":8080"
path: /data
```

| Key      | Default | Meaning                                       |
| -------- | ------- | --------------------------------------------- |
| `listen` | `:8080` | Address of the Source API                     |
| `path`   | `/data` | Directory to list; subdirectories are ignored |

The file name is the artifact ID and the modification time is its upload
time. Uploader, note and link stay empty.

```sh
holtdroid source-dir --config dir.yaml
# or with environment only
HOLTDROID_PATH=/srv/apks holtdroid source-dir
```
