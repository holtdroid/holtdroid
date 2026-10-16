---
title: Authentication
description: Sign-in modes — anonymous names, a shared password, OIDC, or a forward-auth proxy.
sidebar:
  order: 3
---

Holtdroid always knows _who_ owns a session, but how people sign in is up to
you. Pick one mode with `auth.mode`.

| Mode        | Who gets in                              | Identity                                      |
| ----------- | ---------------------------------------- | --------------------------------------------- |
| `anonymous` | Everyone who can reach the URL (default) | A random name like `big-cute-otter`           |
| `password`  | Everyone who knows one shared password   | A random name, assigned after the password    |
| `oidc`      | Users of your identity provider          | Username, name, email and groups from the IdP |
| `header`    | Whoever your forward-auth proxy lets in  | Taken from headers the proxy sets             |
| `none`      | Everyone, as one local admin             | `local` — for development only                |

## Signed session cookies

`anonymous`, `password` and `oidc` keep the signed-in identity in an HttpOnly
cookie holding a JWT signed with `auth.sessionKey`. Nothing is stored on the
server, so any number of api replicas can verify it and it survives restarts
and rescheduling — as long as they all share the same key.

```yaml
auth:
  mode: anonymous
  sessionKey: env:SESSION_KEY # at least 32 bytes; generate with: openssl rand -base64 48
  sessionTTL: 720h # sessions are refreshed after half of this
  cookieName: holtdroid_session
```

:::caution
Without `sessionKey` the api generates a random key at startup and warns: every
restart signs everybody out and each replica rejects the others' cookies.
:::

The cookie is marked `Secure` when `publicURL` starts with `https://`.
Switching modes invalidates existing cookies.

## Anonymous

Visitors are signed in on their first request with a random
`size-mood-animal` name, so everyone can tell whose session is whose without
accounts. **Get a new name** in the user menu draws another one.

## Shared password

```yaml
auth:
  mode: password
  sessionKey: env:SESSION_KEY
  password: env:HOLTDROID_PASSWORD
```

The sign-in page asks for the password once, then hands out a random name just
like the anonymous mode. Failed attempts are slowed down.

## OIDC

Any OpenID Connect provider works (Authelia, Keycloak, Authentik, Dex, Google,
Entra ID, …). Holtdroid uses the authorization code flow with PKCE and reads
the user's claims from the ID token and the userinfo endpoint.

```yaml
publicURL: https://android.example.com
auth:
  mode: oidc
  sessionKey: env:SESSION_KEY
  allowedGroups: [qa, developers] # optional
  adminGroups: [admins]
  oidc:
    issuer: https://auth.example.com
    clientID: holtdroid
    clientSecret: env:OIDC_CLIENT_SECRET
    scopes: [openid, profile, email, groups]
    usernameClaim: preferred_username
    groupsClaim: groups
```

Register the client at your provider with:

- redirect URI `https://<publicURL>/api/v1/auth/oidc/callback`
  (override with `auth.oidc.redirectURL`);
- grant type `authorization_code`, PKCE `S256`;
- token endpoint authentication `client_secret_basic`.

<details>
<summary>Authelia client example</summary>

```yaml
identity_providers:
  oidc:
    clients:
      - client_id: holtdroid
        client_name: Holtdroid
        client_secret: "$pbkdf2-sha512$…" # digest of the secret given to Holtdroid
        authorization_policy: two_factor
        require_pkce: true
        pkce_challenge_method: S256
        redirect_uris:
          - https://android.example.com/api/v1/auth/oidc/callback
        scopes: [openid, profile, email, groups]
        token_endpoint_auth_method: client_secret_basic
```

</details>

## Forward-auth headers

With `mode: header` Holtdroid trusts identity headers set by a proxy in front
of it, and refuses requests without them.

:::danger
The api must then only be reachable through that proxy — anyone who can reach
it directly can claim any identity.
:::

```yaml
auth:
  mode: header
  header:
    user: Remote-User
    groups: Remote-Groups
    name: Remote-Name
    email: Remote-Email
```

For oauth2-proxy (`--set-xauthrequest`) use `X-Auth-Request-User`,
`X-Auth-Request-Groups` and `X-Auth-Request-Email`.

## Groups and admins

| Key                  | Applies to       | Meaning                                       |
| -------------------- | ---------------- | --------------------------------------------- |
| `auth.allowedGroups` | `oidc`, `header` | If set, only members of these groups get in   |
| `auth.adminGroups`   | `oidc`, `header` | Members can stop and extend anyone's sessions |

Everyone can see all sessions. Only the owner or an admin can stop or extend
one.
