---
title: Files
description: Browse the device's file system from the session page, download and upload files, create folders and delete.
sidebar:
  order: 11
---

The **Files** tab is a file browser for the session's device. Use it to grab
a file the app wrote (a database, a log, an export), to put a file on the
device for the app to pick, or to look at what an app keeps in its private
data. It works over [ADB in the browser](/holtdroid/concepts/adb/), so you
need nothing installed on your computer.

## When the tab appears

The tab sits next to **Logcat** and **Terminal**, after the DevTools tabs.
It is there when the portal lets you use ADB on this session:

- the server allows ADB in the browser (`adb.browser`, on by default);
- with `adb.ownerOnly` (the default), the session is yours or you are an
  admin; other users see only the screen and DevTools;
- the device supports ADB (every emulator and phone does).

There is nothing to click or allow: the page connects to the device's ADB
once the device is first ready, and keeps that one connection for Logcat,
Files and Terminal. The browser keeps an ADB key in its storage, and the
device doesn't ask to authorize it. While the connection is being set up the
tab shows **Connecting to ADB…**. If it fails or drops, the tab shows
**Could not reach the device over ADB** with the reason and a **Reconnect**
button.

## What you see

A toolbar, then the list of the current folder. The tab opens in the
device's Downloads folder, `/sdcard/Download`.

- **Go to…** jumps to one of five places:

  | Entry           | Path                                                     |
  | --------------- | -------------------------------------------------------- |
  | Downloads       | `/sdcard/Download`                                       |
  | Shared storage  | `/sdcard`                                                |
  | App data        | `/data/data/<package>`, the session's app's private data |
  | /data/local/tmp | `/data/local/tmp`, a folder ADB may always write to      |
  | Root            | `/`, the whole file system                               |

- **Up** goes to the parent folder.
- The **path field** shows where you are; type another path and press Enter
  to go there.
- **Refresh** lists the folder again. The list doesn't update by itself when
  the app writes a file.
- **New folder** and **Upload files**, described below.

Each row has the name, the size (files only) and the time it was last
modified, in your browser's time zone. Folders come first, then files, both
in alphabetical order. Click a folder's name to open it. **Download** and
**Delete** show up when you hover a row.

`App data` holds what the app keeps for itself: `shared_prefs`, `databases`,
`files`, and the WebView's cookies and storage under `app_webview`. The
[App data](/holtdroid/concepts/app-data/) feature saves and restores this
folder between sessions.

## Common tasks

**Download a file.** Hover the row and click **Download**; the browser saves
it under its own name. Folders and symbolic links have no download button:
download the files in them one by one.

**Upload files.** Click **Upload files** and pick one or more files, or drop
them anywhere on the list. They go into the folder you are looking at, one
after another, with a progress line (`photo.jpg: 1.2 MB of 3.4 MB`). A file
with the same name is replaced. Dropping a picture into Downloads is the
quickest way to test an app's file picker or share sheet.

**Create a folder.** Click **New folder**, type a name and press **Create**.
Missing parent folders in the name (`a/b/c`) are created too.

**Delete.** Hover the row and click **Delete**. The page asks first; for a
folder it asks to delete it _and everything in it_, and removes the whole
tree.

**Look inside the app's data.** Pick **App data** in **Go to…**, open
`databases` or `shared_prefs` and download the file. Open a SQLite database
with any SQLite viewer on your computer. The file is a snapshot of that
moment: an app that keeps the database open may still have changes in its
`-wal` file next to it, so download that too.

## Recordings

[Recordings](/holtdroid/concepts/recordings/) don't keep anything of this
tab: the player has no Files tab, and browsing, uploads and deletions are
not recorded. What you do in the app with an uploaded file shows up on the
recorded screen like anything else.

## Limits

- **Delete** and **New folder** run shell commands (`rm` and `mkdir`). By
  default emulators and phones run only an allowlist of shell commands that
  doesn't include them (`redroid.shell` and the phones' `adb.shell`, see
  [Emulator provider](/holtdroid/configuration/emulator/#users-adb-inside-android)
  and [ADB on phones](/holtdroid/configuration/phones/#adb-on-phones)), so
  there they fail with **Could not delete** or **Could not create the
  folder**. They work where the provider allows any command, which is also
  when the [Terminal](/holtdroid/session-tools/terminal/) tab shows up.
  Browsing, downloading and uploading are file transfer and work under every
  setting, even `off`.
- On emulators ADB runs as root, so every folder can be read and written.
  Uploaded files belong to root with mode `644`: an app can read a file you
  put into its private data, but may not be able to change it.
- On phones ADB runs as Android's `shell` user, also on rooted phones. The
  app's private data and most of the system can't be listed (the tab shows
  **Could not list** with the reason); shared storage and `/data/local/tmp`
  work.
- There is no preview, editing, renaming, moving or copying of files. To
  change a file, download it, edit it on your computer and upload it again.
- A download is read into the browser's memory before it is saved, so very
  large files take a while and a lot of memory.
- Symbolic links are listed like folders. A link to a file can't be opened
  or downloaded from the tab.
- Everything is gone when the session ends, except what
  [App data](/holtdroid/concepts/app-data/) saves.
