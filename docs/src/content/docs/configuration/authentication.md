---
title: Authentication
description: Sign-in modes — anonymous names, a shared password, OIDC, a forward-auth proxy, or users with passkeys and invite links.
sidebar:
  order: 4
---

Holtdroid always knows _who_ owns a session, but how people sign in is up to
you. Pick one mode with `auth.mode`.

| Mode        | Who gets in                              | Identity                                      |
| ----------- | ---------------------------------------- | --------------------------------------------- |
| `anonymous` | Everyone who can reach the URL (default) | A random name like `big-cute-otter`           |
| `password`  | Everyone who knows one shared password   | A random name, assigned after the password    |
| `oidc`      | Users of your identity provider          | Username, name, email and groups from the IdP |
| `users`     | People with an invite link and a passkey | A user in the api's database, with a role     |
| `header`    | Whoever your forward-auth proxy lets in  | Taken from headers the proxy sets             |
| `none`      | Everyone, as one local admin             | `local` — for development only                |

## Signed session cookies

`anonymous`, `password`, `oidc` and `users` keep the signed-in identity in an HttpOnly
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
    pictureClaim: picture
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

## Users and passkeys

The `users` mode keeps its own user directory in the api's
[database](/holtdroid/configuration/database/). People sign up through an
invite link with their name and email and sign in with a **passkey** (Touch
ID, Face ID, Windows Hello, a security key or a password manager); there are
no passwords. Admins get a **Users** page: everyone's role, limits and
passkeys, invite links, recovery links, and the people waiting for approval.

```yaml
publicURL: https://android.example.com # passkeys are bound to this host
database:
  type: sqlite # users must survive restarts
auth:
  mode: users
  sessionKey: env:SESSION_KEY
  users:
    allowedDomains: [example.com, example.org] # optional: who may sign up
    oidcRole: "" # role for new SSO sign-ins: "" waits for approval, or user
    limits: # optional defaults per role
      user: { maxSessions: 2, maxSessionTTL: 4h, recordingsQuota: 20GiB, appDataMaxSize: 512MiB }
      admin: { maxSessions: 0 }
```

:::caution
With the in-memory database every restart forgets all users and passkeys.
Use `database.type: sqlite`, ideally with a replica.
:::

**The first admin.** While there is no admin, the api logs a single-use
invite link with the admin role at startup, valid for 24 hours. Open it, enter
your name and email and register a passkey. Every restart replaces the link
until the first admin exists:

```sh
kubectl -n holtdroid logs deploy/holtdroid-api | grep "first admin"
```

**Roles.** `admin` manages users and sees the inventory and the audit log,
`user` launches devices, and an empty role means _waiting for approval_: the
person is signed in but sees only a waiting screen until an admin gives them a
role. Holtdroid keeps at least one admin.

**Invite links.** An admin creates them on the Users page with a role,
single-use or reusable, expiring after a day, a week, a month or never, and
optionally limited to some email domains (on top of `allowedDomains`). A
reusable link with the _waiting for approval_ role is an open sign-up page
whose newcomers you approve by hand. Only a hash of each link is stored, so it
is shown once; revoke it there when it leaks.

**Domains.** `allowedDomains` and an invite's domains check the email's
domain when someone signs up, but nothing sends mail to verify the address:
treat the check as a guard against typos and the wrong people using a shared
link, not as proof of who someone is.

**Passkeys and recovery.** Under **Account and passkeys** in the user menu,
people add more passkeys, rename them and remove them; the last one stays. An
admin can remove any passkey and create a **recovery link**, single-use and
valid for up to 30 days, with which the user registers a new passkey on a new
device. Creating one cancels earlier recovery links.

**Locked out.** When no admin can sign in, create a recovery link from the
api's container; it writes to the api's database file, and the running api
replicates the change:

```sh
kubectl -n holtdroid exec deploy/holtdroid-api -- \
  holtdroid users recover --config /etc/holtdroid/config.yaml --email you@example.com
```

**Signing in with SSO as well.** Set `auth.oidc` as for the `oidc` mode and
the sign-in page also offers **Sign in with SSO**. The provider's email finds
the user; an unknown email signs up with `auth.users.oidcRole`, or as admin
when the user is in one of `auth.adminGroups`. `allowedDomains` applies to
SSO sign-ups too. After that the role comes from the Users page, not from the
provider's groups.

### Limits

Every user has four limits. An admin can set them per user on the Users page;
an empty field uses the role's default from `auth.users.limits`, and a role
without one uses the server-wide setting.

| Limit             | Server-wide setting   | Meaning                                           |
| ----------------- | --------------------- | ------------------------------------------------- |
| `maxSessions`     | `sessions.maxPerUser` | Devices the user may run at once; 0 for no limit  |
| `maxSessionTTL`   | `sessions.maxTTL`     | How long a session lives before it is reaped      |
| `recordingsQuota` | `recordings.quota`    | Storage for the user's recordings; 0 for no limit |
| `appDataMaxSize`  | `appData.maxSize`     | Largest app data save; 0 for no limit             |

Deleting a user signs them out at once and removes their passkeys. Devices
they run keep going until stopped or reaped, and their recordings and app data
stay until they expire.

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
    picture: "" # optional header with an avatar URL
```

<details>
<summary>Traefik + Authelia</summary>

A `forwardAuth` middleware on the portal's route, copying Authelia's
`Remote-*` headers into the request:

```yaml
apiVersion: traefik.io/v1alpha1
kind: Middleware
metadata:
  name: authelia
  namespace: holtdroid
spec:
  forwardAuth:
    address: http://authelia.authelia.svc.cluster.local/api/authz/forward-auth
    trustForwardHeader: true
    authResponseHeaders: [Remote-User, Remote-Groups, Remote-Name, Remote-Email]
```

```yaml
# Helm values
ingress:
  enabled: true
  className: traefik
  host: android.example.com
  annotations:
    traefik.ingress.kubernetes.io/router.middlewares: holtdroid-authelia@kubernetescrd
config:
  auth:
    mode: header
    adminGroups: [admins]
```

Authelia sends `Remote-Groups` comma-separated, which is what Holtdroid
expects.

</details>

<details>
<summary>ingress-nginx + oauth2-proxy</summary>

Run oauth2-proxy with `--set-xauthrequest` (and `--reverse-proxy`), then let
ingress-nginx ask it about every request:

```yaml
# Helm values
ingress:
  enabled: true
  className: nginx
  host: android.example.com
  annotations:
    nginx.ingress.kubernetes.io/auth-url: http://oauth2-proxy.auth.svc.cluster.local/oauth2/auth
    nginx.ingress.kubernetes.io/auth-signin: https://auth.example.com/oauth2/start?rd=$scheme://$host$escaped_request_uri
    nginx.ingress.kubernetes.io/auth-response-headers: X-Auth-Request-User,X-Auth-Request-Groups,X-Auth-Request-Email
config:
  auth:
    mode: header
    header:
      user: X-Auth-Request-User
      groups: X-Auth-Request-Groups
      email: X-Auth-Request-Email
      name: ""
```

</details>

The api and the ssh-gateway must not be reachable around the proxy: keep the
Services `ClusterIP` and, if other workloads share the cluster, add a
NetworkPolicy that only lets the ingress controller reach the api's port 8080.

## Groups and admins

| Key                  | Applies to       | Meaning                                       |
| -------------------- | ---------------- | --------------------------------------------- |
| `auth.allowedGroups` | `oidc`, `header` | If set, only members of these groups get in   |
| `auth.adminGroups`   | `oidc`, `header` | Members can stop and extend anyone's sessions |

In the `users` mode roles come from the directory instead; `adminGroups` only
decides the role of a first SSO sign-in.

Everyone can see all sessions. Only the owner or an admin can stop or extend
one.

## Avatars

When the identity provider supplies a picture (the OIDC `picture` claim, or
`header.picture` in the header mode), the UI shows it. Otherwise — and in the
anonymous and password modes — it draws a deterministic
[DiceBear](https://www.dicebear.com) **Voxel Art** avatar from the username,
in the browser, so `big-cute-otter` always gets the same little voxel figure.
Only absolute `http(s)` picture URLs are accepted.
