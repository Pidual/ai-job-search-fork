# We Work Remotely URL Reference

Maintenance document for `weworkremotely-search`. Everything below was verified live on
**2026-08-05**; re-verify before assuming a failure is a bug in this CLI.

Base site: `https://weworkremotely.com`

---

## 1. Endpoints

Only the **`.rss` paths** are usable. There is no JSON API and no per-posting endpoint.

| Purpose | URL | Verified |
|---------|-----|----------|
| All jobs | `https://weworkremotely.com/remote-jobs.rss` | 200, exactly 100 `<item>` |
| Category | `https://weworkremotely.com/categories/<slug>.rss` | 200, see table below |

There are **no query parameters** on either endpoint. No `?q=`, no `?page=`, no `?limit=`.
Everything the CLI offers as a search flag (`--query`, `--jobage`, `--page`, `--limit`) is
therefore applied **client-side after download**. Do not go looking for server-side filters;
they do not exist.

### Working category slugs

Item counts at capture time (they drift as jobs are posted and expire):

| Slug | Items | Item shape |
|------|-------|------------|
| `remote-programming-jobs` | 25 | **reduced** (no `<type>`/`<country>`/`<state>`/`<skills>`) |
| `remote-devops-sysadmin-jobs` | 51 | full |
| `remote-design-jobs` | 94 | full |
| `remote-full-stack-programming-jobs` | 129 | full |
| `remote-back-end-programming-jobs` | 30 | full |
| `remote-front-end-programming-jobs` | 16 | full |
| `remote-product-jobs` | 67 | full |
| `remote-sales-and-marketing-jobs` | 147–149 | full |
| `remote-customer-support-jobs` | 56 | full |
| `remote-management-and-finance-jobs` | 39 | full |

### Dead category slugs — do NOT offer these

| Slug | Behaviour |
|------|-----------|
| `remote-data-jobs` | HTTP **301**, **no `Location` header**, **0-byte body** → 0 items |
| `remote-marketing-jobs` | same |
| `remote-all-other-remote-jobs` | same |

Because the 301 carries no `Location`, `fetch(..., { redirect: "follow" })` cannot follow it
and simply returns the bodyless 301. `feedFetch()` maps any 3xx (and 404/410) to `""` so one
retired feed cannot abort a multi-feed search. `validateCategory()` rejects these three by
name with "retired", separately from "unknown slug".

**There is no data / AI / ML / analytics category feed on We Work Remotely.** Items whose
`<category>` is `All Other Remote` do exist in the all-jobs feed even though the
`remote-all-other-remote-jobs` feed itself is dead — that category is only reachable via the
all-jobs feed. For AI/ML the CLI defaults to `remote-jobs.rss` + `remote-programming-jobs` +
`remote-devops-sysadmin-jobs` + `remote-full-stack-programming-jobs` and filters on `--query`.

---

## 2. User-Agent findings (read this before changing the UA)

The brief for this skill anticipated that the honest UA would be rejected. **It is not** —
on the `.rss` paths. Measured directly:

| Path | UA | Status |
|------|----|--------|
| `/remote-jobs.rss` | `ai-job-search/1.0 (+https://github.com/MadsLorentzen/ai-job-search) personal-job-search` | **200**, 863 015 bytes |
| `/remote-jobs.rss` | `Mozilla/5.0` | 200 |
| `/remote-jobs` (HTML) | honest UA | **403** |
| `/remote-jobs` (HTML) | `Mozilla/5.0` | **403** |

Conclusions, in order of importance:

1. **The HTML site 403s automated access regardless of User-Agent.** Browser impersonation
   does not help. There is therefore no detail-page scrape available, and this CLI does not
   attempt one.
2. **The RSS paths serve the honest UA fine.** Per the repo's honest-User-Agent convention
   (`PORTAL_SPEC.md` §5: fall back to a browser UA only on a source that *provably* 403s the
   honest one), this skill uses the honest UA. No browser impersonation is used anywhere in
   `helpers.ts` — the constant `UA` is the honest token.
3. If a future maintainer sees 403s on the `.rss` paths, do **not** reflexively swap in a
   browser UA — re-run the table above first, since a browser UA was measured to be no more
   effective than the honest one on the paths that block.

Request headers sent by `feedFetch()`:

```
User-Agent: ai-job-search/1.0 (+https://github.com/MadsLorentzen/ai-job-search) personal-job-search
Accept: application/rss+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.5
Accept-Language: en-US,en;q=0.9
```

---

## 3. Response shape (RSS 2.0)

```xml
<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/"
     xmlns:media="http://search.yahoo.com/mrss">
  <channel>
    <title>We Work Remotely: Remote jobs in design, programming, marketing and more</title>
    <link>https://weworkremotely.com/remote-jobs.rss</link>
    <description>…</description>
    <language>en-US</language>
    <ttl>60</ttl>
    <item>
      <media:content url="https://wwr-pro.s3.amazonaws.com/logos/…/logo.gif" type="image/png"/>
      <title>Stripe: Backend Engineer, AI Security</title>
      <region>Anywhere in the World</region>
      <country>🇺🇸 United States of America</country>
      <state>Oregon</state>
      <skills>Video Production, AI Content Creation, …</skills>
      <category>Back-End Programming</category>
      <type>Full-Time</type>
      <description>&lt;p&gt;&lt;strong&gt;Headquarters:&lt;/strong&gt; …&lt;/p&gt;</description>
      <pubDate>Wed, 05 Aug 2026 07:31:17 +0000</pubDate>
      <expires_at>Fri, 04 Sep 2026 07:31:17 +0000</expires_at>
      <guid>https://weworkremotely.com/remote-jobs/stripe-backend-engineer-ai-security</guid>
      <link>https://weworkremotely.com/remote-jobs/stripe-backend-engineer-ai-security</link>
    </item>
    …
  </channel>
</rss>
```

### Field mapping

| Feed field | CLI field | Notes |
|------------|-----------|-------|
| `<title>` | `company` + `title` | `"Company: Role"` — split on the **FIRST** `": "`. No `": "` → `company: null`, whole string is the title. |
| `<region>` | `location` (and `region`) | Free text: `Anywhere in the World`, `USA Only`, `Europe`, `Buenos Aires`, `Texas`, `NSA` (sic), … |
| `<pubDate>` | `date`, `publishedAt` | RFC-822 → `date` = `YYYY-MM-DD`, `publishedAt` = full ISO-8601 UTC. |
| `<link>` / `<guid>` | `url`, `guid`, `id` | Identical values in practice. `id` = trailing slug of the link. |
| `<description>` | `description` | Entity-escaped HTML → decoded, tags stripped, paragraph breaks kept, then sanitised. |
| `<category>` | `category` | Human label (`Back-End Programming`), **not** the feed slug. |
| `<type>` | `type` | `Full-Time` \| `Contract`. Absent in `remote-programming-jobs`. |
| `<country>`, `<state>`, `<skills>` | *(not emitted)* | Sparsely populated (11/100, 16/100, 33/100 respectively) and absent from the reduced shape. Available in the raw feed if a future version wants them. |
| `<expires_at>` | *(not emitted)* | RFC-822. Roughly `pubDate` + 30 days. |
| `<media:content>` | *(not emitted)* | Company logo URL. |

### Encoding quirks

- **No CDATA.** WWR entity-escapes instead. `unwrapCdata()` is kept as a defensive no-op
  because sibling feeds on the same platform have used CDATA in the past.
- **Descriptions are double-encoded.** The XML text node holds entity-escaped HTML, so
  `&amp;nbsp;` in the raw bytes means a literal `&nbsp;` in the HTML. The parser decodes
  once to recover HTML, strips tags, then decodes a second time.
- `decodeHtmlEntities()` decodes `&amp;` **last** on purpose. Decoding it first would turn
  `&amp;lt;` into a real `<` and corrupt the document.
- Titles occasionally contain stray variation-selector / emoji characters
  (`MapTiler:  ️ Location Services Engineer | Maps Platform`). They pass through as-is.

---

## 4. Parsing anchors

If the source changes, these are the exact hooks in `cli/src/helpers.ts` to check:

| Anchor | Where | Breaks if… |
|--------|-------|-----------|
| `xml.split(/<item(?:\s[^>]*)?>/i)` | `parseFeed` | the item element is renamed or namespaced |
| `/<\/item\s*>/i` | `parseFeed` | closing tags disappear (already tolerated — the last chunk is parsed leniently) |
| `tagText(chunk, "<tag>")` regex | `tagText` | a field gains attributes (already tolerated) or becomes self-closing |
| `raw.indexOf(": ")` | `splitTitle` | WWR changes the `Company: Role` title convention |
| trailing-slug extraction | `idFromLink` | the `/remote-jobs/<slug>` URL shape changes |
| `Date.parse` on `<pubDate>` | `parseRfc822` | the date format stops being RFC-822 |

Each `<item>` chunk is parsed **independently**, so a single malformed or truncated item is
skipped (when it has no usable id) or degraded (title falls back to the slug, date to
`null`) without affecting the rest of the feed. This is covered by `tests/parsing.test.ts`
using a real captured payload.

---

## 5. Pagination, rate limits, caching

- **No pagination.** The feed is a fixed window: 100 items for all-jobs, 16–149 per
  category. `--page` is a client-side re-slice of what was already downloaded and is
  documented as such in `SKILL.md`. There is no way to reach older postings.
- **`<ttl>60`** — the channel asks consumers not to refetch more than once an hour. Honour it.
- **No rate limiting observed.** ~15 sequential requests during verification produced no
  429s and no throttling. The CLI still implements the standard 6-retry exponential backoff
  (500 ms → 8 s, jittered) on 429/5xx, and a 15 s per-request timeout.
- Feeds are ~500 KB–900 KB each. A default search downloads 4 of them (~2 MB). Prefer
  `--category` when you know where to look.

---

## 6. robots.txt

Fetched from `https://weworkremotely.com/robots.txt`, verbatim:

```
# robots.txt for https://weworkremotely.com/

User-agent: *
Allow: /
Disallow: /admin/
Disallow: /account/
Disallow: /job-seekers/account/
Disallow: /job-seekers/profile/
Disallow: /manage-company/
Disallow: /*edit?token=/
Disallow: /*cancel?token=/
Sitemap: https://weworkremotely.com/sitemap.xml
```

**Verdict: permitted.** `Allow: /` applies to all user-agents; only administrative and
personal-account paths are disallowed. Neither `/remote-jobs.rss` nor `/categories/*.rss`
falls under any `Disallow` rule. This CLI touches only those two path families and never
issues a write.

## 7. Terms of Service — NOT VERIFIED

`https://weworkremotely.com/terms` (and the site's other HTML pages) return **403 to
automated access**, so the Terms of Service **could not be fetched or read** during
implementation. This is an honest gap, not an endorsement:

- We did **not** confirm that automated feed consumption is permitted by the ToS.
- We did **not** find any attribution or backlink requirement — but we could not check
  for one either. The CLI emits the canonical posting `url` on every result regardless,
  so a downstream consumer always has the backlink available.
- The `SKILL.md` accordingly carries a **personal use only / low volume** warning, and the
  CLI honours `<ttl>60`-scale politeness by design (one small set of requests per search).

A maintainer who can read the ToS in a normal browser should update this section with the
actual finding.
