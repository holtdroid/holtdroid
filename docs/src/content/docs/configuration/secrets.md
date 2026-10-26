---
title: Secrets
description: Secret references and the supported backends — environment, files and OpenBao/Vault.
sidebar:
  order: 5
---

Credentials are never written into config files. Every secret field takes a
**reference** of the form `scheme:value`, which is resolved at startup.

| Scheme    | Example                                    | Resolves to                                                               |
| --------- | ------------------------------------------ | ------------------------------------------------------------------------- |
| `env`     | `env:SLACK_BOT_TOKEN`                      | The environment variable's value                                          |
| `file`    | `file:/run/secrets/slack/token`            | The file's contents, trailing newline trimmed                             |
| `openbao` | `openbao:secret/holtdroid#slack_bot_token` | Field `slack_bot_token` of the KV v2 secret `holtdroid` in mount `secret` |

A value without a known scheme is rejected, so a token pasted directly into
config fails fast instead of being used and logged.

## Kubernetes Secrets

The simplest option. Mount a Secret as environment variables (`env:`) or as
files (`file:`). This also covers [External Secrets Operator](https://external-secrets.io/),
Sealed Secrets and anything else that produces a Kubernetes Secret.

## OpenBao and HashiCorp Vault

The `openbao` resolver talks to OpenBao (or Vault, same API) directly. Configure
it once per service:

```yaml
secrets:
  openbao:
    address: https://bao.example.com
    # either a token reference…
    token: file:/var/run/secrets/bao-token
    # …or Kubernetes auth
    kubernetes:
      mount: kubernetes
      role: holtdroid
```

The reference format is `openbao:<mount>/<path>#<field>` for KV v2 secrets.
The path must not include `data/`; the resolver adds it.
