---
title: Cache
description: How the WebViews' requests use the HTTP cache and a CDN in front of the server, as findings with the requests and headers behind each.
sidebar:
  order: 4
---

An app that downloads the same files on every start is slow on a mobile
network and costs its users data. The **Cache** tab reads the headers of
every request the app's WebViews finish and says where caching goes wrong:
files without caching headers, URLs that change on every request, a CDN
that doesn't cache what it could, or caches what it shouldn't. Each finding
lists the requests behind it and the headers to fix.

## When the tab is there

The tab sits next to DevTools whenever the session has WebView DevTools:
always on emulators, and on [phones](/holtdroid/configuration/phones/) only
for debuggable builds (see [WebView DevTools](/holtdroid/concepts/devtools/)).
The agent follows every page, iframe, worker and service worker of the
WebViews for the whole session, so the tab sees requests made before you
opened it, and fills again after a reload of the portal page.

The headers are the ones that went over the wire, `Set-Cookie` and the
network stack's own request headers included.

## What you see

### The toolbar

**Pause** stops updating the tab, **Resume** catches up. **Clear** empties
it (a reload of the page brings back what the agent kept). On the right,
how many finished requests the tab has.

### The numbers

The top row sums up the requests a cache could keep at all: `GET` and
`HEAD` requests that finished without an error with a status of 200, 203,
204, 206, 300, 301, 304, 308, 404 or 410. Preflights, WebSockets, event
streams, pings, CSP reports, signed exchanges and `data:` or `blob:` URLs
don't count.

| Number                 | What it says                                                                                                                                                   |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Cacheable requests** | how many requests that is                                                                                                                                      |
| **From the WebView**   | the share the WebView answered itself: from its memory or disk cache, a service worker, the prefetch cache, or a `304` revalidation. Hover it for the split    |
| **CDN hits**           | the share of a CDN's hits among its hits and misses; only when responses came through a CDN. Hover it for the counts, and how many the CDN didn't cache at all |
| **Downloaded**         | the bytes of those requests that came over the network                                                                                                         |
| **Could be cached**    | bytes downloaded again that a cache could have served; only when there are any                                                                                 |

A CDN is recognised by its headers. Cloudflare's `cf-cache-status` counts
`HIT`, `REVALIDATED`, `UPDATING` and `STALE` as hits, `MISS` and `EXPIRED`
as misses, and anything else (`BYPASS`, `DYNAMIC`) as not cached. `x-cache`,
`x-cache-status` and `cdn-cache` count for other CDNs, named CloudFront,
Fastly or nginx when their other headers say so.

### Findings

Below the numbers are the findings, errors first, then the ones that waste
the most bytes, then the ones with the most requests. The chips above them
filter by severity: **All**, **Errors**, **Warnings** and **Hints**, each
with its count.

- a red circle is an **error**: the app breaks caching, or a CDN may hand
  one user's response to another;
- an amber triangle is a **warning**: something is downloaded more often
  than it needs to be;
- a grey **i** is a **hint**: worth a look, often harmless.

A row shows the finding, how many bytes a cache could have saved (when it
knows) and `×N`, the number of requests behind it. When the requests leave
nothing to report, the list says **Nothing to improve in how these requests are cached**.

Click a finding for its details:

- what is wrong and what to do about it;
- **Requests**: up to the last 200 of them, each with the time it was sent,
  its status, its name and host, the CDN's status (`HIT`, `MISS`,
  `DYNAMIC`…) and where it came from: its size when it came over the
  network, or **memory cache**, **disk cache**, **service worker**,
  **prefetch cache** or **304**;
- **Response headers** and **Request headers** of the request you pick,
  only the ones that change caching: `Cache-Control`, `CDN-Cache-Control`,
  `Cloudflare-CDN-Cache-Control`, `Expires`, `Pragma`, `ETag`,
  `Last-Modified`, `Vary`, `Age`, `Date`, the CDN's status headers and
  `Set-Cookie` in the response; `Cache-Control`, `Pragma`,
  `If-None-Match`, `If-Modified-Since` and whether there was an
  `Authorization` (its value is hidden) in the request.

## What it looks for

A file counts as **static** when it is a script, stylesheet, image, media
file, font or web app manifest. Its name has a **content hash** when the
last part of the path ends in eight or more letters and digits before the
extension (`app.3f9a8c1d.js`, `chunk-BX2KQ7aZ.css`), or a query value is a
hex string of eight or more characters that mixes digits and letters.

| Finding                                                                                                                                                                                                    | Severity                                                                     | What to fix                                                                                                                                                                                      |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Request time in the URL of …**: a query parameter or path segment holds the time the request was sent (within an hour; a date within a day and a half), such as `_=1730032212345` or `/feed/2026-10-27/` | error when the headers or a CDN would have cached the response, else warning | Leave it out, or put a version or a content hash there instead                                                                                                                                   |
| **`name` changes on every request to …**: three or more requests to the same path where one parameter is new every time (six characters or more, with a digit)                                             | warning                                                                      | If it is a cache-buster or a nonce, every response is a miss: drop it                                                                                                                            |
| **… downloaded N times**: the same URL came over the network in full twice or more                                                                                                                         | warning                                                                      | Depends on the reason it gives: add `Cache-Control`; add an `ETag` or `Last-Modified`; answer revalidations with `304`; or find why the request asked for a fresh copy                           |
| **Cloudflare missed … N times** (or another CDN)                                                                                                                                                           | warning                                                                      | A lifetime under a minute for the CDN, a `Vary` header, another edge or a purge; give it a longer `s-maxage`                                                                                     |
| **… serves a cached copy of … that is marked private / no-store / sets a cookie**                                                                                                                          | error                                                                        | Another user may get this response; a cache rule likely overrides the origin's headers                                                                                                           |
| **… bypassed its cache for …** (`BYPASS`)                                                                                                                                                                  | warning for static files, else hint                                          | It names the header that caused it (`Cache-Control: private`, `no-store`, `no-cache`, `max-age=0`, `Set-Cookie`, an `Authorization` header); with none, a cache rule or Page Rule says to bypass |
| **… doesn't cache …** (`DYNAMIC`) on a static file or on a response whose headers allow caching                                                                                                            | warning                                                                      | Send `Cache-Control` with a `max-age`, or add a cache rule: Cloudflare doesn't cache HTML or JSON, and only some extensions, by default                                                          |
| **… served … past its lifetime**: a CDN hit whose `Age` is over the lifetime the headers give                                                                                                              | hint                                                                         | `stale-while-revalidate`, an edge TTL override, or a stale copy                                                                                                                                  |
| **No caching headers on …**: a static file or a page without `Cache-Control` or `Expires`                                                                                                                  | warning for static files, hint for pages                                     | Send `Cache-Control`. With only `Last-Modified` the WebView guesses a lifetime of a tenth of the file's age                                                                                      |
| **… is no-store** on a static file                                                                                                                                                                         | warning                                                                      | `no-cache` with an `ETag`; a hashed file can be cached for a year with `immutable`                                                                                                               |
| **… must be revalidated but has nothing to revalidate with**: `no-cache` or a zero lifetime without `ETag` or `Last-Modified`                                                                              | warning for static files, else hint                                          | Add a validator, so a short `304` replaces the whole body                                                                                                                                        |
| **… has a content hash but a short lifetime** (under seven days)                                                                                                                                           | hint                                                                         | `Cache-Control: public, max-age=31536000, immutable`                                                                                                                                             |
| **… sets a cookie** on a static file or a response marked `public` or `s-maxage`                                                                                                                           | warning when marked for shared caches, else hint                             | Most CDNs, Cloudflare included, don't cache responses with `Set-Cookie`; move the cookie elsewhere                                                                                               |
| **… varies by …** `*`, `Cookie`, `User-Agent` or `Authorization`                                                                                                                                           | error for `*`, else warning                                                  | `Vary: *` means no cache may reuse it; the others split the cache into many copies, and Cloudflare ignores `Vary` except `Accept-Encoding`                                                       |
| **… has only Pragma: …** in a response without `Cache-Control`                                                                                                                                             | hint                                                                         | Caches ignore `Pragma` in responses; send `Cache-Control`                                                                                                                                        |
| **Almost every request asked for a fresh copy** (80% or more of at least five), or **N requests asked for a fresh copy**                                                                                   | warning, or hint for a few                                                   | The requests carried `Cache-Control: no-cache` or `Pragma: no-cache`. When almost all do, DevTools' **Disable cache** is probably on (see below)                                                 |

**Could be cached** adds up the bytes downloaded again in the first three:
the request time in the URL, a parameter that changes every time, and the
same file downloaded again.

## Common tasks

**See what the second start reuses.** Use the app once so it fills its
cache, then go through the same screens again, or reload the page from
DevTools. Requests answered from the cache move **From the WebView** up;
the ones that don't come back as **downloaded N times**.

**Check that the CDN caches the API.** Pick a request in a CDN finding and
read `cf-cache-status` (or `x-cache`) and `Cache-Control` side by side in
**Response headers**. `DYNAMIC` with a `max-age` means the CDN needs a
cache rule; `BYPASS` says which header turned it off.

**Make sure the tab shows how the app caches.** Turn off **Disable cache**
in the DevTools tab's Network panel. While it is on, every request asks for
a fresh copy and the tab warns **Almost every request asked for a fresh
copy**.

**Find a cache-buster.** The **Request time in the URL** and **changes on
every request** findings name the parameter and its value; the
**Requests** list shows that every request had a URL of its own.

## In recordings

A [recording](/holtdroid/concepts/recordings/#cache-images-and-svg) has the same Cache
tab, checked over the requests up to the playhead. There a request's time
seeks the video to it, and **Open in Network** opens the request you picked
on the recording's Network tab with all its headers and the body.

## Limits

- Only the WebViews' requests are seen; native code that talks to the
  network on its own (an HTTP client in Kotlin or Java) isn't.
- The tab keeps the last 5000 finished requests; for a reload or another
  browser the agent keeps about 8 MB of them (without bodies), dropping the
  oldest first.
- The findings read headers only. Whether a file really changed between two
  downloads, and what the CDN's own rules say, the tab can't know.
- Requests still loading show up once they finish.
- The live tab has no **Open in Network**: find the request in the DevTools
  tab's Network panel.
