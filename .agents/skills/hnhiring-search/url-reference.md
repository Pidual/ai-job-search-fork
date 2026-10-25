# Hacker News "Who is hiring?" — URL & Parsing Reference

Maintenance document for `hnhiring-search`. Everything below was verified live on
**2026-08-05** against the August 2026 thread (`objectID 49156683`).

Data source: the **Algolia HN Search API**, `https://hn.algolia.com/api/v1`.
Public, unauthenticated, no key, CORS-open (`access-control-allow-origin: *`).
It is the same API the public HN search UI calls.

---

## Base URLs

| Constant (`cli/src/helpers.ts`) | Value |
|---|---|
| `API_BASE` | `https://hn.algolia.com/api/v1` |
| `SEARCH_URL` | `https://hn.algolia.com/api/v1/search` |
| `SEARCH_BY_DATE_URL` | `https://hn.algolia.com/api/v1/search_by_date` |
| `ITEM_URL` | `https://hn.algolia.com/api/v1/items` |
| `HN_ITEM_URL` | `https://news.ycombinator.com/item?id=` (link target only — never fetched) |

---

## Endpoint 1 — resolve the current thread

```
GET https://hn.algolia.com/api/v1/search_by_date
      ?tags=story,author_whoishiring
      &query=hiring
      &hitsPerPage=5
```

| Param | Meaning |
|---|---|
| `tags` | `story,author_whoishiring` — comma = AND. Restricts to stories by the `whoishiring` bot. |
| `query` | `hiring` — full-text narrowing; the bot also posts "Who wants to be hired?" and "Freelancer?" threads. |
| `hitsPerPage` | `5` for "newest thread"; the CLI raises this to `100` for `--month` so it can reach years back. |

`search_by_date` returns newest-first. Real response (trimmed, 2026-08-05):

```json
{ "hits": [
  { "objectID": "49156683", "title": "Ask HN: Who is hiring? (August 2026)", "created_at": "2026-08-03T15:00:54Z" },
  { "objectID": "48747976", "title": "Ask HN: Who is hiring? (July 2026)",   "created_at": "2026-07-01T15:01:21Z" },
  { "objectID": "48357725", "title": "Ask HN: Who is hiring? (June 2026)",   "created_at": "2026-06-01T15:00:48Z" },
  { "objectID": "47975571", "title": "Ask HN: Who is hiring? (May 2026)",    "created_at": "2026-05-01T15:00:07Z" },
  { "objectID": "47601859", "title": "Ask HN: Who is hiring? (April 2026)",  "created_at": "2026-04-01T15:01:36Z" }
] }
```

**Selection anchors** (`pickThread` in `helpers.ts`):
- Title must match `/Ask HN:\s*Who is hiring\?/i`. This is what excludes the sibling
  `Who wants to be hired?` and `Freelancer? Seeking freelancer?` threads.
- `--month YYYY-MM` matches the parenthesised English month name and year in the title,
  e.g. `/\(August\s+2026\)/i`. The title format is the parsing anchor — if the bot ever
  changes it, this is the first thing to fix.
- Otherwise the newest by `created_at` wins (sorted defensively; the endpoint is already
  newest-first).

⚠️ **The thread is not always posted on the 1st.** August 2026's went up on the 3rd at
15:00 UTC. Resolution is by title, never by date arithmetic.

---

## Endpoint 2 — fetch the thread's postings

```
GET https://hn.algolia.com/api/v1/search
      ?tags=comment,story_<threadId>
      &query=<keywords>          # optional — SERVER-SIDE full-text
      &hitsPerPage=1000
```

| Param | Meaning |
|---|---|
| `tags` | `comment,story_49156683` — every comment belonging to that story. |
| `query` | Optional. Executed **server-side** by Algolia across the whole comment body. `query=machine%20learning` → `nbHits: 10`. |
| `hitsPerPage` | `1000`. Max page size; the whole thread fits. |

**Pagination: there isn't any to walk.** Verified for August 2026:
`nbHits: 234`, `nbPages: 1`, `page: 0`, `hitsPerPage: 1000`, `hits.length: 234`.
One request returns the month. The CLI's `--page` / `--limit` therefore slice
client-side (page size = `--limit`, default 50).

### Response shape — real field paths

```
.nbHits                 234
.nbPages                1
.page                   0
.hits[]
  .objectID             "49164461"      → result `id`; also the /items/<id> key
  .author               "kevinsane"     → result `author`
  .created_at           "2026-08-04T04:51:04Z"  → normalised to full ISO-8601 → `date`
  .created_at_i         1785…            (unix seconds, unused)
  .comment_text         HTML-escaped free text  → header + `description`
  .story_id             49156683        → result `threadId`
  .parent_id            49156683        → top-level test: parent_id === story_id
  .story_title          "Ask HN: Who is hiring? (August 2026)"
  ._highlightResult     (ignored)
```

### Top-level filter — important

`tags=comment,story_<id>` returns **every** comment in the thread, replies included.
Only comments where `parent_id === story_id` are job postings.

Measured on August 2026: 234 comments → **164 top-level postings**. The filter also
collapses headers-without-pipes from **81 → 11**, i.e. most no-pipe "headers" were
replies, not malformed postings. `--include-replies` disables the filter.

### Comment text encoding

`comment_text` is HTML with a tiny tag vocabulary — observed across all 234 records:
`<p>`, `<a>`, `<i>`, `<code>`, `<pre>` (and their closers). No `<br>`, but 50/234
records contain literal `\n` as well.

Entities observed, all of them: `&#x27;` (apostrophe), `&#x2F;` (**every slash inside a
URL**), `&amp;`, `&gt;`, `&lt;`, `&quot;`.

`decodeHtmlEntities` must decode `&amp;` **last**, otherwise `&amp;#x27;` collapses into
a live apostrophe. Numeric decoding uses `String.fromCodePoint` so emoji survive.

---

## Endpoint 3 — one posting in full

```
GET https://hn.algolia.com/api/v1/items/<objectID>
```

Returns 404 for an unknown id (verified: `/items/999999999999` → `404`), which
`jsonFetch` maps to `null` → `NOT_FOUND` rather than a crash.

Real response keys (from `/items/49164461`):

```
.id           49164461
.type         "comment"
.author       "kevinsane"
.created_at   "2026-08-04T04:51:04.000Z"   ← note: millis here, "…Z" without millis in search
.text         "<the same escaped HTML as comment_text>"
.parent_id    49156683
.story_id     49156683
.points       null
.children     []          (replies; unused)
.title/.url   null for comments
```

Note the field is `.text` here and `.comment_text` in search — `itemToPosting` maps one
onto the other so both commands emit the identical `Posting` shape.

---

## The header convention — parsing anchors

The community convention is a first line of pipe-separated fields:

```
Company | Role | Location | REMOTE | VISA | Salary | contact/url
```

**Field count and order are not respected.** Pipe-count histogram over the 164
August 2026 top-level postings:

| pipes | 0 | 1 | 2 | 3 | 4 | 5 | 6 |
|---|---|---|---|---|---|---|---|
| postings | 11 | 4 | 15 | 57 | 57 | 18 | 2 |

So the parser classifies each field by **shape**, not position. Only field 0 is
positional (company).

Header = everything before the first `<p>` or `\n`, run through `htmlToText`.

### Classification order (`parseHeader`)

1. **Bare domain / URL field** (`maincode.com`, `https://seeq.com`) → skipped;
   kept as a `companyUrl` fallback.
2. **Salary-only field** → skipped (salary is extracted from the whole header anyway).
3. **Employment type** — only when the field is *nothing but* employment words
   (`Full-time`, `Full Time`, `Contract`). The strictness matters: a loose test would
   swallow `Data Labeling Intern` as an employment type.
4. **Role** — `ROLE_RE`, first match wins. **Every** role-ish field is removed from the
   location candidates, not just the first: multi-role postings list several and none
   of them is a place. Exception: a field matching `PURE_CITY_CODE_RE`
   (`^City, ST$`) is a place, not a role.
5. Everything else becomes a **location candidate**.

`ROLE_RE` must end in `s?` — headers say `Software Engineers` at least as often as
`Engineer`, and `\bengineer\b` does **not** match `Engineers`.

### Location choice (`pickLocation`) — priority order

1. A candidate containing `,\s*[A-Z]{2}\b` (`Seattle, WA`, `London, UK`, `Montreal, QC`).
   Exactly two capitals, so `, GCP` / `, AWS` in a tech-stack list do **not** match
   (the `\b` fails against the third letter).
2. A candidate containing a known place word (`PLACE_WORD_RE`).
3. A candidate carrying a workplace token whose stripped form is non-empty.
4. The first remaining candidate.
5. Last resort: a bare workplace token — there `Remote` **is** the location.

Why the priority list exists: `ML6 | Senior AI Engineer | Python, TensorFlow, PyTorch,
GCP, AWS, Azure | Full-time | Amsterdam, Berlin, Munich, Eindhoven, Ghent (EU)
On-site/hybrid` puts a tech stack exactly where naive position-based parsing expects a
location.

### `stripRemoteFromLocation` — deliberately conservative

| Input | Output | Why |
|---|---|---|
| `NYC, on-site` | `NYC` | trailing token after a comma |
| `Peninsula (Onsite)` | `Peninsula` | parenthesised trailing token |
| `San Francisco, CA (On-site)` | `San Francisco, CA` | ditto |
| `On-site (hybrid) in Stockholm, Sweden (Visa Sponsorship possible)` | `Stockholm, Sweden` | leading token run + `in`, then the visa aside |
| `Fully Remote (US)` | *(unchanged)* | the token carries the meaning |
| `Remote-first` | *(unchanged)* | must not become `first` |
| `100% Remote (Global)` | *(unchanged)* | ditto |
| `Montreal, QC (hybrid, 2-3 days/week onsite)` | *(unchanged)* | **balance guard** — see below |
| `Boston, MA (ONSITE - Hybrid)` | *(unchanged)* | ditto |
| `Remote` / `ONSITE, REMOTE` | `""` | pure token → disqualified, falls to rule 5 |

**Parenthesis balance guard.** The trailing-token strip is applied, then *rejected* if it
left a dangling `(` in an otherwise balanced string. Without it, real August 2026 headers
produced truncated garbage — `Montreal, QC (hybrid, 2-3 days&#47;week`,
`Boston, MA (ONSITE`, `Dallas, TX (Remote US or`, `REMOTE (all` (5 of 151 parsed
locations). A longer honest string beats a mangled one, and the workplace is captured
separately by `detectRemote` anyway.

### Other detectors

- **Salary** — extracted from the whole header, not per-field, so
  `up to ~ $750k cash …` yields `$750k` instead of classifying a sentence as a salary.
  A directly-attached `+` is kept (`$200k–$350k+`); one after a space is not
  (`$130k–$200k + equity` → `$130k–$200k`). Present on only ~18% of postings.
- **Workplace** — every token found, normalised and joined:
  `ONSITE, REMOTE` → `onsite/remote`.
- **Visa** — explicit negation (`no visa sponsorship`, `no sponsorship`) → `false`;
  a bare `VISA` / `sponsorship` mention → `true`; silence → `null`. The negation regex
  uses `[^|]` so it cannot match across a pipe boundary into a different field.
- **`companyUrl`** — first `href` in the raw comment (slashes arrive as `&#x2F;`),
  falling back to a `(domain.com)` inside the company name, then to a bare-domain field.
- **Fallback when there are no pipes** — `company` = first 60 characters of the header,
  `title` = a real role phrase found in the body if there is one, else `null`,
  `parsed: false`, and the full text is always kept in `description`.

### Never drop a record

`parseComment` wraps the whole parse in try/catch and `parseComments` maps per record,
so one malformed comment cannot abort the batch. A record that fails is still emitted
with its `id`, `url`, `date` and `description`. Verified against `[flagged]` moderation
stubs, which are real and present in every thread.

### Measured field coverage (August 2026, 164 postings)

| field | coverage |
|---|---|
| `company` | 164/164 (100%) |
| `date` / `description` | 164/164 (100%) |
| `location` | 151/164 (92%) |
| `remote` | 148/164 (90%) |
| `companyUrl` | 148/164 (90%) |
| `title` | 139/164 (85%) |
| `employmentType` | 102/164 (62%) |
| `salary` | 29/164 (18%) |

Headers recognised as following the convention: 153/164. Records with HTML tags or
undecoded entities leaking into `title`/`company`/`location`: **0**.

---

## robots.txt verdict

```
$ curl -s -w '%{http_code}' https://hn.algolia.com/robots.txt
<!doctype html>
<html lang=en>
<title>404 Not Found</title>
...
404
```

**No robots.txt exists** on `hn.algolia.com` — there is no crawl directive to comply
with. Nothing to honour, nothing being circumvented.

For completeness, `https://news.ycombinator.com/robots.txt` **does** exist:

```
User-Agent: *
Crawl-delay: 30
Disallow: /collapse?
Disallow: /context?
Disallow: /fave?
Disallow: /flag?
Disallow: /hide?
Disallow: /login
Disallow: /logout
Disallow: /r?
Disallow: /reply?
Disallow: /submitlink?
Disallow: /vote?
Disallow: /x?
```

`/item?` is **not** disallowed, but this CLI does not fetch `news.ycombinator.com` at
all — it only emits `item?id=…` URLs as links for the user to open.

## ToS posture & attribution

No API key, no registration, no terms-acceptance step, and **no attribution
requirement** — unlike, say, Arbeitnow's "please link back". The API is the public
backend of HN's own search page.

## User-Agent

Honest token, per this fork's convention — `hn.algolia.com` serves it without
complaint, so there is nothing to impersonate:

```
ai-job-search/1.0 (+https://github.com/MadsLorentzen/ai-job-search) personal-job-search
```

## Rate limits

No `x-ratelimit-*`, `ratelimit-*` or `retry-after` headers are surfaced (response
headers are just `access-control-allow-origin: *` and `server: Google Frontend`). No
429 was observed across roughly 30 requests during development. The CLI retries 429 and
5xx with exponential backoff (500 ms → 8 s, 6 attempts, ±500 ms jitter) and a 15 s
per-request timeout regardless. A normal `search` costs **1–2 requests**
(thread resolution, which `--thread` removes, plus the comment fetch).

## When this breaks

In likely order:

1. The bot's title format changes → fix `WHO_IS_HIRING_RE` / the `--month` matcher.
2. The community header convention drifts → `ROLE_RE`, `PLACE_WORD_RE`, `pickLocation`.
3. Algolia caps `hitsPerPage` below the thread size → `nbPages` would become > 1 and the
   CLI would need a real pagination loop over `&page=`.
4. `comment_text` gains new tags/entities → `htmlToText` / `decodeHtmlEntities`.
