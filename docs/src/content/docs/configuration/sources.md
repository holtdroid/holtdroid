---
title: Artifact sources
description: Folders and S3 buckets with APKs, the optional .meta.json sidecar, change tracking and uploads.
sidebar:
  order: 2
---

A **source** is a folder or an S3 bucket (or a prefix in one) with `*.apk`
files. The api lists it directly — there is no separate source service. How
the files get there is up to you: copy them by hand, let CI publish them, run
a small sync job that pulls builds out of Slack, or upload them in the UI.

```yaml
sources:
  - name: local # default when `sources` is not set
    type: filesystem
    filesystem:
      dir: /var/lib/holtdroid/apks
  - name: slack
    type: s3
    readOnly: true
    pollInterval: 1m
    s3:
      endpoint: https://s3.example.com
      bucket: apks
      prefix: slack
      accessKey: env:S3_ACCESS_KEY
      secretKey: env:S3_SECRET_KEY
```

| Key            | Default      | Meaning                                                                                                    |
| -------------- | ------------ | ---------------------------------------------------------------------------------------------------------- |
| `name`         | –            | Unique, lowercase letters, digits, `-`, `_`; shown in the UI                                               |
| `type`         | `filesystem` | `filesystem` or `s3`; the backend options are the same as for [storage](/holtdroid/configuration/storage/) |
| `readOnly`     | `false`      | Nobody can delete or change files through the portal; a read-only mount works                              |
| `pollInterval` | `30s`        | How often the source is listed to notice new, removed or replaced files and push it to the UI              |

Every `*.apk` (any depth, case-insensitive) is an artifact; other files,
hidden files and directories that can't be read (`lost+found`) are ignored.
Newest first, by `uploadedAt` from the sidecar or else the file's
modification time.

## The `.meta.json` sidecar

Next to `app.apk` you may put `app.apk.meta.json`. It is optional, every
field in it is optional and unknown fields are ignored, so a sync job can add
what it knows:

```json
{
  "title": "Checkout redesign",
  "note": "Build for the QA round on Thursday",
  "changelog": "- New payment sheet\n- Fixed crash on Android 15",
  "uploadedBy": "Jane Doe",
  "uploadedAt": "2026-10-16T09:30:00Z",
  "link": "https://example.slack.com/archives/C0123/p1760607000",
  "origin": "slack",
  "tags": { "branch": "feature/checkout", "commit": "3f2a9c1", "flavor": "staging" },
  "owner": "jane",
  "visibility": "public"
}
```

| Field        | Meaning                                                                                  |
| ------------ | ---------------------------------------------------------------------------------------- |
| `title`      | Display name instead of the APK's label                                                  |
| `note`       | Short description, shown under the title                                                 |
| `changelog`  | What changed, plain text; shown collapsed and searchable                                 |
| `uploadedBy` | Display name of whoever published the build                                              |
| `uploadedAt` | RFC 3339 time; defaults to the file's modification time                                  |
| `link`       | Link back to the origin (Slack message, pipeline, release)                               |
| `origin`     | Free-form label of where it came from: `slack`, `ci`, `upload`, …                        |
| `tags`       | String key/values shown as badges and searchable                                         |
| `owner`      | Portal user ID (as in `/api/v1/me` → `user`) who may delete it and change its visibility |
| `visibility` | `public` (default) or `private`: only the owner and admins see and launch it             |

Write the sidecar **before** the APK when the visibility matters — the api
lists whatever is there at that moment. A sidecar that isn't valid JSON is
ignored (and logged); the APK is still listed.

## Change tracking

Each file gets a **revision** — its ETag on S3, size + modification time on a
filesystem. The APK cache is keyed by it, so replacing `app.apk` with a new
build under the same name is picked up on the next listing: the new file is
downloaded and parsed again, while sessions started from the old one keep
using the copy they started with. Sidecar edits show up on the next listing
too. Each api replica polls its sources every `pollInterval` and tells open
browsers through `/api/v1/events` (`event: artifacts`), so lists refresh by
themselves.

## Uploads

```yaml
uploads:
  enabled: true # default
  source: "" # default: the first source
  prefix: uploads
  maxSize: 1GiB
```

With uploads enabled every signed-in user gets an **Upload** button (and can
drop an `.apk` onto the list). The file is checked to be a valid APK and
stored as `{prefix}/{random}/{file name}` in the uploads source with a
sidecar that records the uploader as `owner`, the chosen visibility, and an
optional note and changelog. The owner and admins can make it public or
private and delete it; admins can also delete builds without an owner in
writable sources. The uploads source can't be `readOnly`.

Uploads live in the source, not in the cache, so the source has to be
persistent: the chart mounts a PersistentVolumeClaim at `/var/lib/holtdroid`
for the default `local` source. A `ReadWriteOnce` claim limits the api to one
replica — use an S3 source for uploads to run more.
