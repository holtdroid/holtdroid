---
title: Writing your own
description: Principles for a sync job that publishes builds from CI, releases or anywhere else into a source.
sidebar:
  order: 3
---

There is no plugin API for sources. The contract is the file layout: a job
that writes `*.apk` files and their [sidecars](/holtdroid/sources/overview/#the-metajson-sidecar)
into a folder or an S3 prefix is a source integration. It can be written in
any language and deployed and released apart from Holtdroid.
[holtdroid-slack-sync](/holtdroid/sources/slack/) is one example.

The simplest integration is a CI step:

```sh
key="ci/$CI_PIPELINE_ID/app-release.apk"
cat > meta.json <<EOF
{"origin":"ci","link":"$CI_PIPELINE_URL","uploadedBy":"$GITLAB_USER_NAME",
 "changelog":"$(git log -1 --format=%s | sed 's/"/\\"/g')",
 "tags":{"branch":"$CI_COMMIT_REF_NAME","commit":"$CI_COMMIT_SHORT_SHA"}}
EOF
aws s3 cp meta.json "s3://holtdroid/$key.meta.json"
aws s3 cp app/build/outputs/apk/release/app-release.apk "s3://holtdroid/$key"
```

## Principles

**Own a prefix.** Give each job its own prefix (`slack/`, `ci/`,
`releases/`) and point a separate `readOnly` source at it. A job never
touches files outside its prefix, and portal users can't delete what it
manages.

**Use keys built from IDs the origin already has.** Examples are
`{channel}/{file id}/{name}.apk`, `{pipeline}/{job}/{name}.apk` and
`{tag}/{asset}.apk`. Then "is this build already here?" is just a listing,
and the key never collides with another build.

**Let the listing be your state.** Don't keep a database or state file.
Before copying, list your prefix and skip what's there. A restart, a crash
halfway through or a second copy of the job then does nothing wrong. In-memory
caches are fine as an optimisation, never for correctness.

**Write the sidecar first, then the APK.** The api lists whatever exists at
that moment. With the sidecar in place first, a build never shows up without
its owner, visibility and changelog. If the job dies between the two writes,
it is left with a stray sidecar that the next pass overwrites.

**Add an icon if the APK's own can't be rendered.** For example, when the
launcher icon is a vector drawable. Put it in `app.apk.icon.png`, written
before the APK.

**Replace in place to publish a new build under the same name.** The api
notices the new ETag or modification time, parses the file again and treats
it as a new revision. Sessions already running keep the old one.

**Don't modify APKs.** Holtdroid installs them exactly as published.
Anything that needs repackaging is out of scope.

**Fill what you know.** Every sidecar field is optional:

- `origin` tells users where a build came from;
- `link` adds a button back to the pipeline or message;
- `changelog` and `tags` (branch, commit, flavor) make builds searchable;
- `owner` together with `visibility: private` keeps a build to one portal
  user and the admins.

**Clean up on your own schedule.** Holtdroid never deletes from read-only
sources. If storage matters, prune old builds by age in the job, and keep the
retention longer than the window the job scans, or pruned builds come back.

**Keep secrets out of the files.** Tokens for the origin and the bucket belong
in the job's environment. Nothing secret goes into keys or sidecars:
everything in a sidecar is shown to every user who can see the build.

**Link back into the portal.** To announce a build (chat message, PR
comment), use a [launch link](/holtdroid/sources/overview/#launch-links):
`{portal}/?source={source name}&launch={base64url(key)}`.

## Checklist

- [ ] own prefix, `readOnly: true` source in the api config
- [ ] stable keys from origin IDs; skip what the listing already has
- [ ] sidecar before APK; `origin`, `link`, `uploadedAt` set
- [ ] safe to run twice at once and after a crash
- [ ] secrets from the environment, never logged
- [ ] tests against a fake origin and a fake bucket (e.g. `gofakes3`)
