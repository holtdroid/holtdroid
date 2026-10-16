---
title: Builds from Slack
description: Get APKs posted in Slack channels into a source.
sidebar:
  order: 5
---

Holtdroid doesn't talk to Slack itself. A small, independent sync job reads
the channels and writes each `.apk` with a
[`.meta.json` sidecar](/holtdroid/configuration/sources/#the-metajson-sidecar)
into a bucket or folder that the api lists as a source. The job can be
written, deployed and upgraded on its own, and the same pattern works for CI,
GitHub Releases or anything else that produces builds.

```yaml
sources:
  - name: slack
    type: s3
    readOnly: true
    s3:
      { endpoint: https://s3.example.com, bucket: apks, prefix: slack, accessKey: env:S3_KEY, secretKey: env:S3_SECRET }
```

A ready-made Slack sync job is planned. Until then, anything that does the
following works:

1. Lists messages with files via `conversations.history` (bot scopes
   `channels:history`, `groups:history`, `files:read`; invite the bot to each
   channel).
2. Downloads every `.apk` with `url_private_download` and the bot token.
3. Writes `{channel}/{file id}/{file name}` and next to it
   `{file name}.meta.json` with `uploadedBy`, `uploadedAt`, `note` (the
   message text), `link` (the message permalink) and `origin: "slack"`.
