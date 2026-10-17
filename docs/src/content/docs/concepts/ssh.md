---
title: SSH access
description: Connect ADB and publish your localhost ports to a device over SSH.
sidebar:
  order: 5
---

Every running device can be reached over SSH through one gateway, with
`{provider}-{session id}` as the user name. The gateway never runs commands,
it only forwards ADB and ports. Once you are in, it greets you with a banner
naming the session and what you can forward.

```sh
# ADB on your machine
ssh -N -p 2222 -L 5555:adb:5555 emulator-7f3a9c@android.example.com
adb connect localhost:5555

# your dev servers as localhost:3000 / :5000 on the device
ssh -N -p 2222 -R 3000:localhost:3000 -R 5000:localhost:5000 emulator-7f3a9c@android.example.com
```

The **SSH** button on the session page builds this command for you:

- It shows what is connected right now: ADB clients, and each published port
  with who published it and how many connections the device has open to it.
  While the popover is open, each port is checked through its own tunnel:
  green means your server answers, red means nothing listens on that port on
  your machine. Clicking a port copies `http://localhost:<port>`
  (`http://localhost` for 80, `https://localhost` for 443). Every check of a
  port with nothing behind it makes your `ssh` print
  `connect_to localhost port N: failed.`; dead ports are checked less and
  less often, down to once a minute.
- It keeps your list of ports in the browser. The defaults are `80`, `443` and
  `3000-3010`. You can add single ports, ranges (`5173-5175`) and
  device-to-local mappings (`8080:3000`, which serves your local port 3000 as
  the device's port 8080).
- It turns the list into one command with a `-R` per port, plus `-L` for ADB
  if you want it.

Apps and WebViews on the device reach your servers as
`http://localhost:<port>`. Plain HTTP to `localhost`, `127.0.0.1` and `::1`
is allowed even when the app's network security config forbids cleartext
traffic; every other host still follows the app's policy. On emulators `adb connect` needs no
authorization prompt and `adb shell` is root (the session image runs adbd
insecure and the agent restarts it as root); a physical phone would ask on its
screen, which you can accept in the portal. `adb reboot`, `adb unroot`,
`adb remount`, `adb tcpip` and `adb usb` are refused: they would cut the
session off from its device. For logcat, files and a shell without any of
this, use the [ADB tools](/holtdroid/concepts/adb/) on the session page. Without `-N`,
`ssh` prints a short help and holds the tunnels open until you press Ctrl+C.

## All your devices at once

Instead of a session id, connect as your own `user-…` name to publish your
ports on every device you run:

```sh
ssh -N -p 2222 -R 3000:localhost:3000 -R 5173:localhost:5173 user-k3zq7c2mxu4hwa5e@android.example.com
```

The SSH keys page and the **All my devices** switch in the SSH button show
your name. Devices you start later get the ports within a few seconds, and
stopped ones drop out; the connection stays open even when none is running.
Only `-R` works this way. ADB needs one device, so use the session id for
`-L`. If a device already has a port published by another connection, it is
skipped there and tried again later. The name is derived from your login but
doesn't reveal it.

## Keys stay with you

Add your public keys on the **SSH keys** page. They are kept in your browser
and sent to the gateway while you use the site; the gateway only holds them in
memory. After a gateway restart, just open the site once and your keys are
back. If none of the keys your client offers is registered (or they have
expired), the login fails with a message telling you so.

A session that doesn't exist, isn't running yet or isn't yours (with
`clientIsolation`) gets just `Not found.`, whatever key you use. The gateway
says nothing about what it is to anyone who isn't signed in to a session; it
even announces itself as OpenSSH.

### Adding a key straight from the terminal

You don't have to add the key first. When none of your keys is registered,
the gateway has your SSH client prove that it holds one of them, prints a
link and keeps the connection waiting:

```text
This key is not registered yet. To add it to your account, open

    https://android.example.com/ssh?request=k3zq7c2mxu4hwa5e

and check that the portal shows SHA256:Zru7u9KFnruNN8vZsTaJL9hayAphx7lrZ0uGzIib12k.
Waiting 5m0s for it; the connection continues once the key is added.
```

Open the link while signed in, check the fingerprint and confirm. The key
goes into your browser's list like a pasted one, and the waiting `ssh` goes
on within a few seconds. A registered key always wins: if any key your client
offers is already registered, it logs in as usual and no link is shown.

Only confirm a link that your own `ssh` just printed. Whoever holds the key
behind a link can use your sessions once you confirm it, so never confirm a
link someone sent you. Clients that can't show keyboard-interactive prompts
(`ssh -o BatchMode=yes`, some GUI tools) don't get the link; add the key on
the page as usual.

## Running the gateway

With the Helm chart, turn on `sshGateway.enabled` and point a TCP entry at
the `…-ssh-gateway` Service on port 2222. You can use a LoadBalancer or
NodePort (`sshGateway.service.type`), or an ingress TCP route such as a
Traefik `IngressRouteTCP` on a dedicated entrypoint. Give it a stable host
key, a PEM private key referenced as a secret:

```yaml
existingSecret: holtdroid # contains SSH_HOST_KEY (ssh-keygen -t ed25519 -N '' -f host)
sshGateway:
  enabled: true
  hostKey: env:SSH_HOST_KEY
```

The chart wires the rest: the api pushes keys to every gateway replica
through a headless Service, the gateway resolves sessions through the api's
internal port, and the session NetworkPolicy lets only the gateway reach the
agents' tunnel port (8081).

## Operator flags

| Flag                      | Default   | Meaning                                                            |
| ------------------------- | --------- | ------------------------------------------------------------------ |
| `allowADB`                | `true`    | Allow `-L …:adb:5555` to the device's ADB                          |
| `allowReverse`            | `true`    | Allow `-R` to publish client ports on the device's `localhost`     |
| `clientIsolation`         | `false`   | When `true`, only a session's owner (and admins) can connect to it |
| `reversePorts`            | `1-65535` | Device ports that may be published, e.g. `80,443,1024-65535`       |
| `keyTTL`                  | `24h`     | Keys not refreshed by the browser for this long are forgotten      |
| `maxTunnelsPerConnection` | `32`      | ADB channels plus published ports one SSH connection may hold      |
| `keyRequests`             | `true`    | Offer a link to add an unknown key from the terminal (see above)   |
| `skipHostKeyCheck`        | `false`   | Turn off host key checking in the commands the UI shows (below)    |

Published ports are bound on the device's loopback only, so privileged
ports such as 80 and 443 are fine on emulators (their adbd runs as root).
Shells, `exec`, SFTP, agent forwarding and forwarding to anything other than
the device's ADB are always refused. Traffic through a tunnel counts as
activity, so a device you use only over SSH is not reaped as idle. When the
session ends, its SSH connections are closed.

The ssh-gateway's own config also has `keyRequestTimeout` (default `5m`), how
long a connection waits for its key to be added, and `portalURL`, the
portal's address for the link; the chart sets it from `publicURL`.

### Skipping the host key check

:::danger[Bad practice]
`skipHostKeyCheck: true` makes the commands the UI shows include
`-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null`. SSH then
accepts **any** host key without asking and never remembers it, so it can
no longer tell the gateway from a man-in-the-middle, who could see and
change everything that goes through the tunnels, ADB included. Prefer a
stable `hostKey`: users accept it once and are protected from then on. Turn
this on only where nobody can get between the users and the gateway, or
when you can't keep a stable host key and know what you are giving up.
:::

It only changes the commands the portal shows. Users who type their own
commands keep the usual checks.
