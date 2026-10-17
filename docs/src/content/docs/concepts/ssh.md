---
title: SSH access
description: Connect ADB and publish your localhost ports to a device over SSH.
sidebar:
  order: 5
---

Every running device can be reached over SSH through one gateway, with
`{provider}-{session id}` as the user name. The gateway never runs commands,
it only forwards ADB and ports.

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
screen, which you can accept in the portal. Without `-N`,
`ssh` prints a short help and holds the tunnels open until you press Ctrl+C.

## Keys stay with you

Add your public keys on the **SSH keys** page. They are kept in your browser
and sent to the gateway while you use the site; the gateway only holds them in
memory. After a gateway restart, just open the site once and your keys are
back. If none of the keys your client offers is registered (or they have
expired), the login fails with a message telling you so.

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

Published ports are bound on the device's loopback only, so privileged
ports such as 80 and 443 are fine on emulators (their adbd runs as root).
Shells, `exec`, SFTP, agent forwarding and forwarding to anything other than
the device's ADB are always refused. Traffic through a tunnel counts as
activity, so a device you use only over SSH is not reaped as idle. When the
session ends, its SSH connections are closed.
