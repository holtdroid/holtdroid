---
title: App data
description: Keep an app's sign-in, settings and WebView storage between sessions.
---

Every session starts from a fresh install. With app data turned on, Holtdroid
can save the app's private data from a session, by hand or when it ends, and
you can start the next session of the same app from that save instead of
signing in and clicking through onboarding again.

## What is saved

The app's internal storage: `/data/data/<package>` and
`/data/user_de/0/<package>`. That covers databases, shared preferences,
files, and the WebView's cookies, local storage and IndexedDB. The cache
(`cache/` and `code_cache/`) is saved only when the server allows it and it
is small enough. External storage (`/sdcard/Android/data/<package>`) is
not saved.

A save is taken when:

- you press **Stop**, or the session is stopped for being idle or reaching
  its maximum lifetime, and **Save app data when the session ends** was
  ticked when it was launched. It is off by default. The launch dialog
  remembers the box in your browser and applies it to every launch from
  then on, quick launch and launch links included;
- you press **Save app data now** next to the app's name in the session
  header. The app is stopped while it is copied and started again.

A session that dies on its own (its node goes away) leaves no save.

## Starting from a save

The launch dialog has an **App data** choice: **Fresh install** (the
default) or one of your saves of that app, newest first. Tick **Also restore
the cache** to bring the cache back too, when the save has one.

The quick launch button (⚡) shows a menu when you hover it:

- **Fresh install**: no app data;
- **With app data**: your newest save of the app;
- **With app data and cache**: the same, with its cache.

A plain click launches the way you picked last time, remembered in your
browser. Until you pick, it uses your newest save, or a fresh install when
there is none.

## Managing saves

The **App data** page (the database icon in the header) lists your saves per
app with their size, build and when they were last used. You can download
a save as a `.tar.zst` archive, unless the server turned that off
(`tar --zstd -xf <file>` unpacks it), and delete it. Saves are private:
nobody else sees them, admins included.

## Limitations

- Apps that encrypt their data with Android Keystore keys can't read it on
  another device, because those keys stay on the device the save came from.
  Such apps may sign you out or reset parts of their state.
- Data from a newer build may break an older one, for example when its
  database can't be downgraded. The launch dialog warns about that.

## Configuration

```yaml
appData:
  enabled: true
  cache: true # allow saving the cache
  maxCacheSize: 256MiB # a bigger cache is left out of the save
  maxSize: 1GiB # the cache is left out when it would push a save over this; bigger data isn't saved
  keep: 6 # saves kept per user and app, the most recently used ones; 0 = no limit
  maxAge: 168h # deleted this long after their last use; 0 = never
  export: true # let users download their saves
  timeout: 5m # how long a save may take before the session is stopped without it
  storage: # optional: where saves go; default is the shared storage under app-data/
    type: s3
    s3:
      endpoint: https://s3.example.com
      bucket: holtdroid
      prefix: app-data
      accessKey: env:S3_ACCESS_KEY
      secretKey: env:S3_SECRET_KEY
```

| Key                    | Default  | Meaning                                                                                                          |
| ---------------------- | -------- | ---------------------------------------------------------------------------------------------------------------- |
| `appData.enabled`      | `false`  | Save app data when sessions stop and offer it at launch                                                          |
| `appData.cache`        | `false`  | Also save `cache/` and `code_cache/`                                                                             |
| `appData.maxCacheSize` | `256MiB` | A cache bigger than this is not saved; the rest of the data still is                                             |
| `appData.maxSize`      | `1GiB`   | The cache is dropped when it would push a save over this; data alone over it is not saved at all; `0` = no limit |
| `appData.keep`         | `6`      | Saves kept per user and app, the most recently used first; `0` = no limit                                        |
| `appData.maxAge`       | `168h`   | A save unused this long is deleted; `0` = never                                                                  |
| `appData.export`       | `true`   | Users may download their saves                                                                                   |
| `appData.timeout`      | `5m`     | Longest a save may take                                                                                          |
| `appData.storage.*`    | shared   | Same keys as [`storage`](/holtdroid/configuration/storage/); empty `type` = the shared storage                   |

The shared storage is often an `emptyDir` cache (the chart's default), which
loses saves on every restart of the api. Point `appData.storage` at S3 or a
persistent volume to keep them.

Sizes are measured on the device, before compression. Stopping a session
waits for its save, so a big save makes **Stop** slower.
