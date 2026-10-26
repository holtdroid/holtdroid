---
title: Database
description: The api's SQL database — in memory, or a SQLite file replicated to S3 with Litestream.
sidebar:
  order: 3
---

The api keeps a small SQL database: session events now, and later data such
as connected computers. Sessions, sign-ins, APKs, uploads and recordings
don't live there, so losing it never stops sessions or signs anyone out.

## In memory (default)

```yaml
database:
  type: memory
```

SQLite in RAM. Every restart and every api replica starts empty. Fine for
trying Holtdroid and for deployments that don't need history.

## SQLite file

```yaml
database:
  type: sqlite
  path: /var/lib/holtdroid/holtdroid.db
```

A SQLite file in WAL mode. The Helm chart mounts the api data volume
(`api.persistence`) at `/var/lib/holtdroid`, so the default path survives
restarts as long as that volume does.

SQLite allows one writer, so the api runs as **one replica**: the chart
refuses `api.replicas` above 1 and stops the old pod before starting a new
one.

## Replication to S3

```yaml
database:
  type: sqlite
  path: /var/lib/holtdroid/holtdroid.db
  replica:
    type: s3
    s3:
      endpoint: https://s3.example.com
      region: us-east-1
      bucket: holtdroid
      prefix: database
      accessKey: env:DB_S3_ACCESS_KEY
      secretKey: env:DB_S3_SECRET_KEY
      pathStyle: true
```

[Litestream](https://litestream.io), built into the api, streams every
change to the bucket within about a second. When the api starts and the file
is missing (a new node, a lost volume, an `emptyDir` data volume) the
database is restored from the bucket first. If the bucket is empty too, the
api starts with an empty database.

`replica.s3` takes the same keys as [S3 artifact storage](/holtdroid/configuration/storage/#s3-and-compatible-stores),
except `credentialsURL`: use static keys, or leave both keys empty for the
AWS default credentials (environment, IAM roles). `prefix` defaults to
`database`; give the database a prefix of its own, not one shared with
sources or the cache. The keys need `GetObject`, `PutObject`, `DeleteObject`
and `ListBucket` on it.

`replica.type: filesystem` with `replica.filesystem.dir` replicates to a
directory instead, e.g. a second volume.

| Key                     | Default                           | Meaning                                                      |
| ----------------------- | --------------------------------- | ------------------------------------------------------------ |
| `database.type`         | `memory`                          | `memory` or `sqlite`                                         |
| `database.path`         | `/var/lib/holtdroid/holtdroid.db` | The SQLite file, for `sqlite`                                |
| `database.replica.type` | –                                 | Empty (no replica), `s3` or `filesystem`; only with `sqlite` |

To start over, stop the api and delete the file together with the replica's
prefix; deleting only the file restores it from the replica.

The schema is migrated automatically when the api starts. Downgrading the
api to a version older than the database's schema isn't supported.
