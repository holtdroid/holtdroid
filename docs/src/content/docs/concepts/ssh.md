---
title: SSH access
description: Connect ADB and publish your localhost ports to a device over SSH.
sidebar:
  order: 5
  badge:
    text: Planned
    variant: caution
---

Every running device will be reachable over SSH through one gateway, using
the session's slug as the user name. The gateway never runs commands — it
only forwards ADB and ports.

```sh
# ADB on your machine
ssh -N -p 2222 -L 5555:adb:5555 emulator-7f3a9c@android.example.com
adb connect localhost:5555

# your dev servers as localhost:3000 / :5000 on the device
ssh -N -p 2222 -R 3000:localhost:3000 -R 5000:localhost:5000 emulator-7f3a9c@android.example.com
```

The session page shows these commands ready to copy.

## Keys stay with you

Add your public keys on the **SSH keys** page. They are kept in your browser
and sent to the server while you use the site; the server only holds them in
memory. After a server restart, just open the site once and your keys are
back.

## Operator flags

| Flag              | Default      | Meaning                                                            |
| ----------------- | ------------ | ------------------------------------------------------------------ |
| `allowADB`        | `true`       | Allow `-L …:adb:5555` to the device's ADB                          |
| `allowReverse`    | `true`       | Allow `-R` to publish client ports on the device's `localhost`     |
| `clientIsolation` | `false`      | When `true`, only a session's owner (and admins) can connect to it |
| `reversePorts`    | `1024-65535` | Device ports that may be published                                 |
| `keyTTL`          | `24h`        | Keys not refreshed by the browser for this long are forgotten      |

Shells, `exec`, SFTP, agent forwarding and forwarding to anything other than
the device's ADB are always refused.
