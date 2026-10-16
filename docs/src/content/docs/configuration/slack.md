---
title: Slack source
description: List and download APKs posted in Slack channels.
sidebar:
  order: 5
---

The `source-slack` service lists `.apk` files posted in one or more Slack
channels and streams them to the api on demand.

## Create the Slack app

1. Go to [api.slack.com/apps](https://api.slack.com/apps) → **Create New
   App** → _From scratch_.
2. Under **OAuth & Permissions**, add these **bot token scopes**:
   - `channels:history` (public channels)
   - `groups:history` (private channels)
   - `files:read`
3. **Install to Workspace** and copy the _Bot User OAuth Token_ (`xoxb-…`).
4. In every channel you want to read, run `/invite @your-app`.
5. Copy the channel ID: open the channel details, the ID is at the bottom
   (`C…` or `G…`).

## Configuration

```yaml
listen: ":8080"
token: env:SLACK_BOT_TOKEN
channels: [C0123456789]
pollInterval: 1m
lookback: 720h
```

| Key            | Default | Meaning                              |
| -------------- | ------- | ------------------------------------ |
| `token`        | –       | Secret reference to the bot token    |
| `channels`     | –       | Channel IDs to read                  |
| `pollInterval` | `1m`    | How often the file list is refreshed |
| `lookback`     | `720h`  | Ignore messages older than this      |

Each artifact shows the file name, size, uploader, time, the message text and
a link back to the message.
