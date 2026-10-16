---
title: Slack
description: Copy APKs posted in Slack channels, threads and forwards into a source with holtdroid-slack-sync.
sidebar:
  order: 2
---

Holtdroid doesn't talk to Slack itself.
[holtdroid-slack-sync](https://github.com/kriakiku/holtdroid-slack-sync) is a
separate, stateless job that polls channels and writes every `.apk` it finds,
with a [`.meta.json` sidecar](/holtdroid/sources/overview/#the-metajson-sidecar),
into a folder or S3 prefix that the api lists as a read-only source.

It picks up APKs:

- attached to channel messages;
- in thread replies;
- inside forwarded messages.

Optionally it reacts to the message once the build is in the source and
replies in the thread with the app's name, package, version, SDK levels,
ABIs and a [launch link](/holtdroid/sources/overview/#launch-links).

## 1. Create the Slack app

The quickest way is to create it from the manifest:

1. Open <https://api.slack.com/apps> → **Create New App** → **From a
   manifest**, and pick the workspace.
2. Paste the manifest below (it is also
   [`slack-app-manifest.yaml`](https://github.com/kriakiku/holtdroid-slack-sync/blob/main/slack-app-manifest.yaml)
   in the job's repository), then click **Create** → **Install to
   Workspace**.
3. Copy the **Bot User OAuth Token** (`xoxb-…`) from **OAuth &
   Permissions**.

```yaml
display_information:
  name: Holtdroid
  description: Copies APKs posted here into Holtdroid and replies with a launch link.
  background_color: "#8a5a3c"
features:
  bot_user:
    display_name: Holtdroid
    always_online: false
oauth_config:
  scopes:
    bot:
      - channels:history
      - groups:history
      - files:read
      - users:read
      - reactions:write
      - chat:write
settings:
  org_deploy_enabled: false
  socket_mode_enabled: false
  token_rotation_enabled: false
```

| Scope                                | Needed for                                             |
| ------------------------------------ | ------------------------------------------------------ |
| `channels:history`, `groups:history` | reading public / private channels                      |
| `files:read`                         | downloading the APKs                                   |
| `users:read`                         | uploader names (optional; without it you see user IDs) |
| `reactions:write`                    | `slack.react` (optional)                               |
| `chat:write`                         | `slack.reply` (optional)                               |

Manifests can't set the app icon, so upload it under **Basic Information**
if you want one.

Then invite the bot to every channel: `/invite @Holtdroid`. Channels are
configured by ID, e.g. `C0123ABCD`: open the channel details and find the ID
at the bottom of **About**.

For the reaction, add a custom emoji (**Customize workspace → Emoji**) named
`holtdroid` from
[`assets/holtdroid-emoji.png`](https://github.com/kriakiku/holtdroid-slack-sync/blob/main/assets/holtdroid-emoji.png).
Bots can use custom emoji but can't create them. Any stock emoji works too.

## 2. Deploy the job

The chart is in the job's repository (`deploy/helm/holtdroid-slack-sync`, and
`oci://ghcr.io/kriakiku/charts/holtdroid-slack-sync` for tagged releases):

```yaml
existingSecret: holtdroid-slack-sync # SLACK_BOT_TOKEN, S3_ACCESS_KEY, S3_SECRET_KEY
config:
  slack:
    token: env:SLACK_BOT_TOKEN
    channels: [C0123ABCD]
    react: { enabled: true, emoji: holtdroid }
    reply: { enabled: true, portalURL: https://holtdroid.example.com, source: slack }
  target:
    type: s3
    s3:
      endpoint: https://s3.example.com
      region: us-east-1
      bucket: holtdroid
      prefix: slack
      accessKey: env:S3_ACCESS_KEY
      secretKey: env:S3_SECRET_KEY
```

Every key can also come from `HOLTDROID_SLACK_SYNC_*` environment variables,
e.g. `HOLTDROID_SLACK_SYNC_SLACK__CHANNELS=C1,C2`. The full reference is in
the job's
[README](https://github.com/kriakiku/holtdroid-slack-sync#configuration).

## 3. Add the source to Holtdroid

Point a read-only source at the same place. Its `name` has to match
`reply.source`, or the launch links in Slack open the wrong source:

```yaml
sources:
  - name: slack
    type: s3
    readOnly: true
    s3:
      endpoint: https://s3.example.com
      region: us-east-1
      bucket: holtdroid
      prefix: slack
      accessKey: env:S3_ACCESS_KEY
      secretKey: env:S3_SECRET_KEY
```

## What ends up in the source

```
{channel ID}/{file ID}/{file name}.apk
{channel ID}/{file ID}/{file name}.apk.meta.json
```

| Sidecar field  | Value                                                                                   |
| -------------- | --------------------------------------------------------------------------------------- |
| `changelog`    | the message text; for a forward, the forwarder's comment and then the original message  |
| `note`, `link` | permalink of the message in the channel                                                 |
| `uploadedBy`   | display name of whoever posted it (bots: the bot's name; forwards: the original author) |
| `uploadedAt`   | message time (forwards: the original message's time)                                    |
| `title`        | the Slack file title, if it differs from the file name                                  |
| `origin`       | `slack`                                                                                 |

## How it polls

Each pass reads the history of the last `lookback` (7 days by default) and
lists the source. Only files the source doesn't have yet get downloaded, so a
restart loses nothing and does no extra work. A thread is fetched again only
when it has a new reply. Edits to a top-level message rewrite its sidecar;
the APK isn't downloaded again.

Polling has these limits:

- replies to threads whose parent is older than `lookback` are missed;
- edits to thread replies that are already synced show up only after the
  thread gets another reply.

The bot's own reaction marks a message as announced. If the source is wiped
and refilled, messages it already reacted to get no second reply.
