# Jobicy API URL Reference

Maintenance document for `jobicy-search`. Everything below was verified live on
**2026-08-05** against `apiVersion` **2.2.15**. Jobicy's own docs page
(`https://jobi.cy/apidocs`) returns **HTTP 403** to non-browser clients, so this
reference is empirical — derived from responses, not transcribed from the docs.

> **Personal use only.** `robots.txt` disallows `/api/` while Jobicy publicly
> documents the same interface for developers. See the robots.txt verdict below
> and the `## ⚠️ Personal use only` section of `SKILL.md`. Keep volume low.
>
> **Attribution is contractual** — see `## Attribution` in `SKILL.md`.

## Base URL

```
https://jobicy.com/api/v2/remote-jobs
```

No authentication, no API key, no cookies. Plain `GET`, JSON response.

## Endpoints

| Purpose | Request |
|---------|---------|
| Search / list jobs | `GET /api/v2/remote-jobs?count=&tag=&geo=&industry=` |
| Enumerate valid `geo` slugs | `GET /api/v2/remote-jobs?get=locations` |
| Enumerate valid `industry` slugs | `GET /api/v2/remote-jobs?get=industries` |
| **Single job by id (API)** | **DOES NOT EXIST** — see below |
| Single job by id (HTML page) | `GET https://jobicy.com/jobs/<id>-<any-slug>` → JSON-LD |

There is **no per-job API endpoint**:

```
?id=143131            -> 400 {"success":false,"error":"Unexpected parameter 'id'. See docs: https://jobi.cy/apidocs"}
?job_id=143131        -> 400 {"success":false,"error":"Unexpected parameter 'job_id'. …"}
?slug=143131-staff-…  -> 400 {"success":false,"error":"Unexpected parameter 'slug'. …"}
?get=job&id=143131    -> 400 (same)
/api/v2/remote-jobs/143131 -> 301 redirect away
```

`detail <id>` therefore re-runs a **list** query and selects the matching record
from `.jobs[]`. See "Cache buckets" below for why it also mirrors `--limit`, and
"Job-page fallback" below for what happens when the id has aged out of the
listing window.

## Search parameters

| Param | CLI flag | Type | Behaviour | Verified |
|-------|----------|------|-----------|----------|
| `count` | `--limit` / `-n` | int | Number of records to return. **Hard cap 100** — `count=200` responds with `appliedFilters.count: 100`. `count=0` is coerced to `1`. | `50→50`, `100→100`, `200→100`, `0→1` |
| `tag` | `--query` / `-q` | string | **Real server-side keyword filter.** Space- or `+`-separated. Broad relevance match over the posting text/taxonomy, not an exact title match. **Length must be 3–50 chars**, else HTTP 400 `The length of the 'tag' value should be between 3 and 50 characters.` | `geo=germany`: no tag → 100 hits, `tag=machine learning` → 27. Length: `2 → 400`, `50 → 200`, `51 → 400` |
| `geo` | `--geo` (`-l`, `--location`) | slug | Region filter. Must be a predefined `geoSlug`; unknown values → HTTP 400. **Case-insensitive but space-intolerant**: `geo=USA` and `geo=Germany` return 200, `geo=New Zealand` and `geo=United Arab Emirates` return 400 — hence `normalizeGeo()` in the CLI. **`geo=anywhere` is explicitly rejected** ("Do not specify 'geo=Anywhere' if you want to get a list of all jobs regardless of region") — omit the param instead. | `usa`, `germany`, `europe`, `USA`, `Germany`, `new-zealand` OK; `New Zealand`, `narnia`, `anywhere` → 400 |
| `industry` | `--industry` | slug | Industry filter. Must be a predefined `industrySlug`. | `data-science` OK |
| `page` | — | — | **NOT SUPPORTED.** `?page=2` → HTTP 400 `Unexpected parameter 'page'`. The CLI never sends it. | 400 confirmed |
| *(none)* | `--jobage` | int | **No server-side age filter exists.** Applied client-side against `pubDate`. | — |

Any unrecognised parameter is rejected with `400 {"success":false,"error":"Unexpected parameter '<name>'. See docs: …"}`.

### Valid `geo` slugs (`?get=locations`, 53 entries)

`apac` `emea` `latam` `argentina` `australia` `austria` `belgium` `brazil`
`bulgaria` `canada` `china` `costa-rica` `croatia` `cyprus` `czechia` `denmark`
`estonia` `europe` `finland` `france` `germany` `greece` `hong-kong` `hungary`
`ireland` `israel` `italy` `japan` `latvia` `lithuania` `malaysia` `mexico`
`netherlands` `new-zealand` `norway` `philippines` `poland` `portugal` `romania`
`serbia` `singapore` `slovakia` `slovenia` `south-korea` `spain` `sweden`
`switzerland` `thailand` `turkiye` `united-arab-emirates` `uk` `ukraine` `usa`
`vietnam`

Shape: `{"locations":[{"geoID":1378,"geoName":"Germany","geoSlug":"germany"}, …]}`

### Valid `industry` slugs (`?get=industries`, 22 entries)

| Slug | Name |
|------|------|
| `data-science` | Data Science & Analytics |
| `engineering` | Software Engineering |
| `admin` | DevOps & Infrastructure |
| `cybersecurity` | Cybersecurity |
| `qa-testing` | QA & Testing |
| `project-management` | Project & Program Management |
| `management` | Product & Operations |
| `design-multimedia` | Creative & Design |
| `web-app-design` | Web, UI & UX Design |
| `marketing` | Marketing & Sales |
| `seller` | Sales |
| `seo` | SEO |
| `copywriting` | Content & Editorial |
| `supporting` | Customer Support & Success |
| `technical-support` | Technical Support |
| `hr` | HR & Recruiting |
| `legal` | Legal & Compliance |
| `accounting-finance` | Finance & Accounting |
| `healthcare` | Healthcare & Medical |
| `education` | Education & E-learning |
| `business` | Business Development |
| `admin-support` | Admin & Virtual Assistance |

Shape: `{"industries":[{"industryID":3037,"industryName":"Data Science &amp; Analytics","industrySlug":"data-science"}, …]}`
Note the `&amp;` — entities are undecoded here too.

## Response shape (real field paths)

```jsonc
{
  "apiVersion": "2.2.15",
  "documentationUrl": "https://jobi.cy/apidocs",
  "friendlyNotice": "Thanks for using Jobicy API! Please ensure Jobicy is clearly credited with a direct link to the source, and all application buttons redirect to the original job URL provided in this feed. …",
  "jobCount": 5,
  "lastUpdate": "2026-07-28T12:25:03+00:00",
  "appliedFilters": { "count": 5, "geo": "usa", "tag": "machine learning" },
  "jobs": [
    {
      "id": 143131,                                   // JSON NUMBER
      "url": "https://jobicy.com/jobs/143131-staff-machine-learning-engineer",
      "jobSlug": "143131-staff-machine-learning-engineer",
      "jobTitle": "Staff Machine Learning Engineer",
      "companyName": "Headspace",
      "companyLogo": "https://jobicy.com/data/…/Headspace.jpg",
      "jobIndustry": ["Software Engineering"],        // entities NOT decoded
      "jobType": ["Full-Time"],
      "jobGeo": "USA",                                // or "Canada,  Europe,  USA"
      "jobLevel": "Senior",                           // Entry-Level, Junior | Midweight | Senior | Director | Any
      "jobExcerpt": "…&amp;… &hellip;",               // entities NOT decoded
      "jobDescription": "<p><strong>…</strong></p><ul>\n<li>…</li></ul>",  // HTML
      "pubDate": "2026-07-28T12:25:03+00:00",
      "salaryMin": 140400,                            // key ABSENT when unknown
      "salaryMax": 200000,
      "salaryCurrency": "USD",
      "salaryPeriod": "yearly"
    }
  ],
  "statusCode": 200,
  "success": true
}
```

### Field mapping used by the CLI

| API field | CLI field | Transform |
|-----------|-----------|-----------|
| `id` | `id` | number → string; falls back to the numeric prefix of `url`/`jobSlug` |
| `jobTitle` | `title` | strip stray tags, decode entities, collapse whitespace |
| `companyName` | `company` | same |
| `jobGeo` | `location` | same — collapses the API's literal double spaces |
| `pubDate` | `date` | `YYYY-MM-DD` |
| `pubDate` | `pubDate` | full ISO-8601 (`…Z`) |
| `url` | `url` | as-is; rebuilt from `jobSlug` when absent |
| `jobLevel` | `level` | cleaned |
| `jobType[]` | `jobType[]` | cleaned, always an array |
| `jobIndustry[]` | `industry[]` | cleaned + decoded (`Data Science &amp; Analytics` → `Data Science & Analytics`) |
| `jobExcerpt` | `excerpt` | cleaned + decoded |
| `jobDescription` | `description` (detail only) | HTML → text, then `sanitizeDescription()` |
| `salaryMin/Max/Currency/Period` | same names | absent → `null` |
| `friendlyNotice` (top level) | `meta.attribution` | **contractual — never strip** |
| `apiVersion`, `lastUpdate`, `message` | `meta.*` | passthrough |

## Error and edge-case responses

| Situation | HTTP | Body |
|-----------|------|------|
| Unknown `geo` | 400 | `{"success":false,"error":"Invalid 'geo' value. This value must contain a predefined 'geoSlug'. See here: https://jobicy.com/api/v2/remote-jobs?get=locations"}` |
| `geo=anywhere` | 400 | `{"success":false,"error":"Do not specify 'geo=Anywhere' if you want to get a list of all jobs regardless of region"}` |
| Unknown param (`page`, `id`) | 400 | `{"success":false,"error":"Unexpected parameter '<name>'. See docs: https://jobi.cy/apidocs"}` |
| `tag` shorter than 3 or longer than 50 chars (e.g. `tag=AI`) | 400 | `{"success":false,"error":"The length of the 'tag' value should be between 3 and 50 characters."}` |
| No matches | **200** | `{… "jobCount":0, "lastUpdate":"", "jobs":[], "success":true, "message":"No jobs found for the applied filters."}` |

The CLI extracts the JSON `error` string out of 4xx bodies and appends it to the
thrown message, so users see the real cause rather than a bare status line.

## Pagination

**None.** `page` is rejected outright. `--page` in the CLI is a client-side slice
of the single (max-100) response, so `page × limit ≤ 100` is a hard ceiling on
what is reachable for one filter combination. To go deeper, narrow with `--query`
/ `--geo` / `--industry` instead of paging.

## Ordering and cache buckets — IMPORTANT

Every response is sorted **newest-first by `pubDate`**. However, **each `count`
value is cached in its own bucket with its own freshness**, so responses for
different `count` values are *not* prefixes/supersets of one another.

Measured within the same minute, unfiltered:

| Request | Newest `pubDate` in response | Subset relation |
|---------|------------------------------|-----------------|
| `count=25` | `2026-08-05T04:50:06Z` | `count=25` ⊄ `count=100` |
| `count=50` | `2026-08-05T04:35:07Z` | `count=50` ⊂ `count=100` ✔ |
| `count=100` | `2026-08-05T04:35:07Z` | — |

Three ids returned by `count=25` (e.g. `145503`, `145332`) were absent from
`count=100` entirely, because the large-count bucket was ~15 minutes staler.
Response headers show `x-jobicy-api-cache: MISS/HIT` alongside Cloudflare's
`cf-cache-status`.

**Maintenance consequence:** `detail` accepts `--limit` and mirrors it into
`count` so it can reproduce the exact bucket the search used. If `detail` starts
failing with `NOT_FOUND` for ids that `search` just returned, this is the reason —
check that the flags match.

## Job-page fallback (how `detail <id>` works without the search flags)

The list API only ever exposes a ~100-row window, so an id more than a day or two
old is unreachable through it no matter which flags are passed. The public job
page is the second source, and it needs nothing but the id.

**Permalink behaviour** (verified 2026-08-05, honest UA):

```
GET /jobs/143131            -> 404
GET /jobs/143131-wrong-slug -> 301  Location: /jobs/143131-staff-machine-learning-engineer
GET /jobs/143131-staff-…    -> 200  (~515 KB of HTML)
```

Any slug suffix resolves, so the CLI requests `/jobs/<id>-job` and follows the
redirect. **`?p=<id>` (the raw WordPress permalink) is deliberately NOT used —
robots.txt line 3 disallows `/*?p=`, while `/jobs/` is not disallowed anywhere.**

**Parsing anchor: schema.org JSON-LD, not the markup.** Each page carries three
`<script type="application/ld+json">` blocks; the CLI walks them (also through
`@graph` and top-level arrays) for `"@type": "JobPosting"`:

```jsonc
{
  "@context": "http://schema.org/",
  "@type": "JobPosting",
  "datePosted": "2026-07-28T12:25:03+00:00",
  "validThrough": "2026-08-28T23:59:59+00:00",
  "title": "Staff Machine Learning Engineer",
  "description": "About the …\n\n• Technical Leadership: …",   // PLAIN TEXT, "• " bullets,
                                                              // entities NOT decoded (&amp;)
  "employmentType": ["FULL_TIME"],
  "hiringOrganization": { "@type": "Organization", "name": "Headspace", "url": "…" },
  "identifier": { "@type": "PropertyValue", "name": "Headspace", "value": "143131" },
  "applicantLocationRequirements": { "@type": "Country", "name": "Canada,  Europe,  USA" },
  "jobLocationType": "TELECOMMUTE",
  "baseSalary": {
    "@type": "MonetaryAmount", "currency": "USD",
    "value": { "@type": "QuantitativeValue", "minValue": 140400, "maxValue": 200000, "unitText": "YEAR" }
  }
}
```

| JSON-LD path | CLI field | Transform |
|--------------|-----------|-----------|
| `identifier.value` | `id` | falls back to the requested id |
| `title` | `title` | cleaned |
| `hiringOrganization.name` | `company` | cleaned |
| `applicantLocationRequirements[].name` | `location` | joined with `, `; falls back to `jobLocation.address`, then `"Remote"` when `jobLocationType: TELECOMMUTE` |
| `datePosted` | `date` / `pubDate` | `YYYY-MM-DD` / full ISO-8601 |
| `<link rel="canonical">` | `url` | the real slug URL; falls back to `/jobs/<id>-job` |
| `employmentType[]` | `jobType[]` | `FULL_TIME` → `Full-Time` |
| `baseSalary.currency`, `.value.minValue/.maxValue/.unitText` | `salary*` | `YEAR`→`yearly`, `HOUR`→`hourly`, … |
| `description` | `description` | `htmlToText()` (decodes entities, keeps paragraph breaks) then `sanitizeDescription()` |
| — | `level`, `industry`, `excerpt` | **not present in the JSON-LD** → `null` / `[]` |

`meta.resolvedVia` on `detail --format json` reports `api-listing` or `job-page`.
A page with no `JobPosting` block, or a 404, yields
`{"error": "…", "code": "NOT_FOUND"}` — the posting has expired.

A stage-1 failure (portal 5xx, rejected `--geo`) does not abort the lookup: it is
recorded at `meta.listingError` (and printed as a `Note:` line under `plain`
output), and only becomes the fatal `DETAIL_FAILED` error if the job page also
fails to resolve the id.

Re-capture the page fixture used by `tests/parsing.test.ts` with:

```bash
curl -sL -A "ai-job-search/1.0 (+https://github.com/MadsLorentzen/ai-job-search) personal-job-search" \
  "https://jobicy.com/jobs/143131-x" | grep -o '<script type="application/ld+json">.*</script>'
```

## Rate limits

No `RateLimit-*` / `Retry-After` headers are exposed. No throttling was observed
across roughly 30 requests in ~10 minutes. The CLI still backs off exponentially
on 429/5xx (6 retries, 500 ms → 8 s with jitter, 15 s per-request timeout).
Given the robots.txt posture, keep the volume low regardless.

## robots.txt verdict

`https://jobicy.com/robots.txt` (88 lines, fetched 2026-08-05). Relevant lines:

```
line  3: Disallow: /*?p=
line 24: Disallow: /*api_access_key=*
line 42: Disallow: /job-listings/
line 48: Disallow: /api/
```

**Verdict: `Disallow: /api/` covers `/api/v2/remote-jobs`.** This skill's endpoint
is disallowed to crawlers by robots.txt.

`/jobs/` — the job-page fallback path — appears **nowhere** in the disallow list,
so that request is robots-clean. The WordPress `?p=<id>` shortcut to the same page
*is* disallowed (line 3), which is why the CLI goes through
`/jobs/<id>-<slug>` instead.

**Counter-signal:** Jobicy publishes the same interface as a developer API. The
payload itself carries `"documentationUrl": "https://jobi.cy/apidocs"` and a
`friendlyNotice` written for API consumers ("You might be building something
amazing, we wish you the best of luck!"), which spells out attribution terms
rather than prohibiting access.

The two signals conflict and the skill documents both rather than picking the
convenient one. Posture taken: **personal use only, low volume, honest
User-Agent, attribution honoured.** Not for commercial use, bulk collection, or
redistribution.

## ToS posture

- No public API terms page was reachable (`jobi.cy/apidocs` → 403 to
  non-browsers; `jobicy.com/jobs-api` → 404).
- The `friendlyNotice` field is the only machine-readable statement of terms and
  it is treated as binding: credit Jobicy with a direct link, and point apply
  actions at the original `url` from the feed.

## User-Agent

The honest fork UA is used and **works** — HTTP 200, no challenge:

```
ai-job-search/1.0 (+https://github.com/MadsLorentzen/ai-job-search) personal-job-search
```

No browser impersonation is needed or used here. (Contrast We Work Remotely,
which provably 403s the honest UA.) If Jobicy ever 403s this UA, that is a
deliberate block — stop, do not swap in a browser UA.

## Parsing anchors for a future maintainer

The response is JSON, so there are no HTML selectors to break. The things that
*will* break if Jobicy changes them, in `cli/src/helpers.ts`:

1. `parsePayload()` — reads `.jobs[]`, `.friendlyNotice`, `.apiVersion`,
   `.lastUpdate`, `.message`.
2. `parseJob()` — the field names in the mapping table above. A record with no
   usable `id` is dropped; every other field degrades to `null`/`[]`.
3. `decodeHtmlEntities()` — `&amp;` is resolved LAST so decoding stays one level
   deep. Named-entity table covers what Jobicy actually emits (`&hellip;`,
   `&rsquo;`, `&amp;`, `&ndash;`, …).
4. `htmlToText()` — block tags → newlines, `<li>` → `- `; `</li>` deliberately
   does *not* emit a newline, and a blank line directly before a bullet is
   collapsed, because Jobicy's markup contains a literal `\n` between `</li>`
   and the next `<li>`.
5. `planSearch()` / `buildUrl()` (detail) — the only places that construct query
   strings. `page` must never appear in either.
6. `validateQuery()` — mirrors the API's 3..50 character `tag` limit locally so a
   two-letter query fails fast instead of burning a 400.
7. `parseJobPage()` / `jsonLdBlocks()` — the job-page fallback. It reads only the
   `application/ld+json` `JobPosting` block, so ordinary template/CSS changes on
   jobicy.com cannot break it; a change to the JSON-LD field names (see the table
   in "Job-page fallback") can.
8. `normalizeGeo()` — lowercases/hyphenates and applies an alias map
   (`united-kingdom`→`uk`, `deutschland`→`germany`, `czech-republic`→`czechia`,
   `turkey`→`turkiye`, …). If Jobicy renames a slug, update the map here and the
   slug list above.

The test fixture in `cli/tests/parsing.test.ts` is a real captured response
(count=5, tag=machine learning, geo=usa) with only the long description strings
truncated. Re-capture it with:

```bash
curl -s -A "ai-job-search/1.0 (+https://github.com/MadsLorentzen/ai-job-search) personal-job-search" \
  "https://jobicy.com/api/v2/remote-jobs?count=5&tag=machine+learning&geo=usa"
```
