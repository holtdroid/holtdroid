---
title: Overview
description: Folders and S3 buckets with APKs, the optional .meta.json sidecar, change tracking, uploads and launch links.
sidebar:
  order: 1
---

A **source** is a folder or an S3 bucket (or a prefix in one) with `*.apk`
files. The api lists it directly — there is no separate source service. How
the files get there is up to you: copy them by hand, let CI publish them, run
a sync job such as [holtdroid-slack-sync](/holtdroid/sources/slack/) that
pulls builds out of Slack or [holtdroid-github-sync](/holtdroid/sources/github/)
that copies GitHub release assets, [write your own](/holtdroid/sources/custom/), or
upload them in the UI.

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
| `include`      | everything   | Only list APKs whose keys match these [rules](#include-rules); not allowed on the uploads source           |

Every `*.apk` (any depth, case-insensitive) is an artifact; other files,
hidden files and directories that can't be read (`lost+found`) are ignored.
Newest first, by `uploadedAt` from the sidecar or else the file's
modification time.

## Include rules

`include` picks builds from a source that holds more than you want to show,
e.g. a shared bucket. It is a gitignore-style list:

```yaml
include:
  - /releases/* # anchored: releases/ and everything below it
  - "!/releases/night/*" # ...except nightly builds
  - "*-qa.apk" # a name pattern matches at any depth
```

- Keys are relative to the source's directory or S3 prefix.
- `*` matches within one path segment, and `**` spans directories.
- A pattern that matches a directory matches everything below it.
- `!` excludes, and the last matching pattern wins.
- A list that starts with an exclusion starts from "everything".
- Lines starting with `#` are ignored.

Excluded builds aren't listed and can't be launched.

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

## The icon sidecar

The api takes the launcher icon from the APK. It uses the densest bitmap or
composes an adaptive icon from bitmap layers; vector-only icons can't be
rendered. A publisher that knows better can put `app.apk.icon.png` next to
the APK, before the APK itself.

The sidecar may contain PNG, JPEG or WebP data, up to 4 MiB and 4096 px per
side. Icons are untrusted input wherever they come from. The api checks the
dimensions before decoding, decodes them with Go's memory-safe decoders, and
re-renders them as a 256 × 256 PNG, so only pixels reach the browser. A
sidecar that fails any of this is ignored and logged, and the extracted icon
is used instead. An icon is optional: without one the UI shows a
placeholder.

The icon is read when the APK is first cached. Replace the APK, not just the
icon, to change it.

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

## Launch links

`https://holtdroid.example.com/?source={source}&launch={artifact ID}` opens
the portal with the launch dialog for that build. The artifact ID is the
base64url (no padding) of the file's key inside the source, e.g. `slack` +
`C0123/F0456/app.apk` → `?source=slack&launch=QzAxMjMvRjA0NTYvYXBwLmFwaw`.
Add `&quick=1` to skip the dialog: the session starts right away on the
provider and location the user launched with last time (or the first
provider with a free slot), as the quick launch button in the list does.
If nothing is free or the launch fails, the dialog opens instead.
Sync jobs use these links to post launch buttons next to the build; a build
that is gone or private to someone else shows a notice instead.
