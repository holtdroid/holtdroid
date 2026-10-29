# Security policy

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub:
[**Report a vulnerability**](https://github.com/holtdroid/holtdroid/security/advisories/new)
on the repository's Security tab. Don't open a public issue or pull request
for it.

Include what you found, how to reproduce it, and the version or commit you
tested. The report is acknowledged in the advisory, and once a fix is out
the advisory is published with credit to you unless you prefer otherwise.

## Supported versions

Holtdroid is pre-release. Fixes land on `main` and in the next release only;
older commits and releases are not patched.

## Scope

In scope: anything in this repository — the `holtdroid` binary and its
services (api, providers, agent, ssh-gateway), the web UI, the session image
and the Helm chart. For example: bypassing sign-in or session ownership,
reaching a session or the api's internal port from outside, escaping the
ssh-gateway's tunnel-only rules, leaking secrets or another user's private
builds.

Out of scope:

- What the threat model already accepts: session Pods are privileged, an
  APK runs as an untrusted app in a rooted emulator, and ADB through the
  ssh-gateway is a root shell on the device. See the docs'
  [Security](https://holtdroid.github.io/operations/security/) page.
- Deployments that don't follow it, such as exposing the api around a
  forward-auth proxy in `header` mode.
- Vulnerabilities in dependencies without a way to exploit them through
  Holtdroid; report those upstream.
