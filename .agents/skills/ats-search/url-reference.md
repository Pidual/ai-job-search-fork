# ATS Job-Board API Reference (Greenhouse · Ashby · Lever)

Maintenance document for `ats-search`. Everything below was verified live on
**2026-08-05**. All three endpoints are public, unauthenticated, and return JSON.

> No API key. No account. No attribution requirement. No ToS or robots
> restriction on the endpoints used (see *Robots & ToS posture* below).

---

## 1. Greenhouse

### Board (all jobs for one company)

```
GET https://boards-api.greenhouse.io/v1/boards/<token>/jobs?content=true
```

| Param | Meaning |
|-------|---------|
| `content` | `true` embeds the full job description in each record. **Without it the `content` field is absent entirely** — there is no partial/snippet mode. |

Response (top level is an **object**):

```jsonc
{
  "jobs": [
    {
      "id": 5286348008,                    // number, not string
      "title": "Silicon Engineer",
      "absolute_url": "https://job-boards.greenhouse.io/anthropic/jobs/5286348008",
      "updated_at": "2026-08-03T18:25:22-04:00",
      "first_published": "2025-03-31T14:08:49-04:00",
      "company_name": "Anthropic",
      "location": { "name": "San Francisco, CA | New York City, NY" },
      "departments": [ { "id": 4002061008, "name": "AI Research & Engineering" } ],
      "offices": [ … ],
      "content": "&lt;div class=&quot;content-intro&quot;&gt;…"   // only with content=true
    }
  ],
  "meta": { "total": 398 }
}
```

Parsing anchors — see `parseGreenhouseBoard` in `cli/src/helpers.ts`:

| Contract field | Path |
|----------------|------|
| `id` | `.jobs[].id` (composed into `greenhouse:<token>:<id>`) |
| `title` | `.jobs[].title` |
| `company` | `.jobs[].company_name` (falls back to the roster `name`) |
| `location` | `.jobs[].location.name` |
| `date` | `.jobs[].first_published` → `YYYY-MM-DD` (falls back to `updated_at`) |
| `url` | `.jobs[].absolute_url` |
| `department` | `.jobs[].departments[].name`, joined with `", "` |
| `description` | `.jobs[].content` (see below) |

**`content` is double-encoded.** It is HTML that has itself been HTML-escaped, so
the raw string reads `&lt;p&gt;R&amp;amp;D&lt;/p&gt;`. Decode entities **once** to
recover real HTML, then strip tags and decode **again**. A naive replace-chain
that handles `&amp;` before `&lt;` corrupts literal `&lt;` text — the CLI uses a
single-pass alternation decoder (`decodeHtmlEntities`) applied deliberately twice.

Size: `?content=true` costs roughly **20×** the bytes (Anthropic 285 KB → 5.7 MB;
Databricks 693 KB → ~14 MB). `--titles-only` drops the flag.

**⚠️ `updated_at` is a bulk re-index timestamp, not a posting date.** Measured
2026-08-05 over whole boards:

| Board | Jobs | distinct `updated_at` days | distinct `first_published` days |
|-------|------|---------------------------|---------------------------------|
| anthropic | 398 | 2 (382 share one day) | 163 |
| databricks | 808 | 12 (569 share one day) | 272 |
| gitlab | 185 | 2 (180 share one day) | 70 |
| reddit | 187 | 33 | 86 |

Greenhouse re-stamps `updated_at` board-wide, so it dates almost every posting
"today". `first_published` is the true posting date and was present on 100 % of
records on all four boards. The parser therefore reads `first_published` first
and only falls back to `updated_at`. Reversing that order silently turns
`--jobage` into a no-op for all 16 Greenhouse companies and floats months-old
jobs to the top of the newest-first sort.

There is **no remote field**. `remote` is inferred from `location.name` matching
`/\b(remote|anywhere|distributed)\b/i`, and is `null` (unknown) otherwise —
never `false`.

### Single job

```
GET https://boards-api.greenhouse.io/v1/boards/<token>/jobs/<jobId>
```

Returns one job object with the **same field names** and with `content` included
by default (no `content=true` needed). 404 body: `{"status":404,"error":"Job not found"}`.

### Pagination

None. One request returns the whole board.

---

## 2. Ashby

### Board (all jobs for one company)

```
GET https://api.ashbyhq.com/posting-api/job-board/<token>?includeCompensation=true
```

| Param | Meaning |
|-------|---------|
| `includeCompensation` | `true` adds the `compensation` object (salary band + equity summary). |

`descriptionPlain` comes back in the **default** response — no extra flag needed.

Response (top level is an **object**):

```jsonc
{
  "apiVersion": "1",
  "jobs": [
    {
      "id": "240d459b-696d-43eb-8497-fab3e56ecd9b",   // UUID string
      "title": "Research Engineer",
      "department": "Research",
      "team": "Research",
      "employmentType": "FullTime",
      "location": "San Francisco",
      "secondaryLocations": [],
      "publishedAt": "2025-04-05T00:03:20.653+00:00",
      "isListed": true,
      "isRemote": null,                                // see the warning below
      "workplaceType": null,                           // "Remote" | "Hybrid" | "OnSite" | null
      "address": { "postalAddress": { … } },
      "jobUrl": "https://jobs.ashbyhq.com/openai/240d459b-…",
      "applyUrl": "https://jobs.ashbyhq.com/openai/240d459b-…/application",
      "descriptionHtml": "…",
      "descriptionPlain": "By applying to this role, …",
      "compensation": {
        "compensationTierSummary": "$250K – $445K • Offers Equity",
        "scrapeableCompensationSalarySummary": "$250K - $445K",
        "compensationTiers": [ … ],
        "summaryComponents": [ … ]
      }
    }
  ]
}
```

| Contract field | Path |
|----------------|------|
| `id` | `.jobs[].id` (composed into `ashby:<token>:<id>`) |
| `title` | `.jobs[].title` |
| `company` | not in the payload — taken from the roster `name` |
| `location` | `.jobs[].location` |
| `date` | `.jobs[].publishedAt` → `YYYY-MM-DD` |
| `url` | `.jobs[].jobUrl` |
| `department` | `.jobs[].department`, falling back to `.team` |
| `description` | `.jobs[].descriptionPlain` (already plain text) |
| `compensation` | `.jobs[].compensation.compensationTierSummary` |

**⚠️ `isRemote` is NOT a clean remote flag.** Measured across all four Ashby
boards in the roster:

| Board | `isRemote=true` & `workplaceType="Hybrid"` | `isRemote=true` & `"Remote"` |
|-------|------------------------------------------|------------------------------|
| openai | 442 | 32 |
| ramp | 95 | 16 |
| cohere | 31 | 98 |
| elevenlabs | 6 | 178 |

`isRemote` only means "not strictly on-site". The precise signal is
`workplaceType`, so the parser reads `workplaceType` first (`Remote` → `true`,
`Hybrid`/`OnSite` → `false`) and falls back to `isRemote` only when
`workplaceType` is null (it is null for 236/735 OpenAI postings, where
`isRemote` is also null → `remote` becomes `null`, then location text is tried).

### Single job

**Does not exist publicly.** `GET …/posting-api/job-board/<token>/<jobId>` answers
`401 Unauthorized`. `detail` therefore fetches the whole board and filters by id.

### Pagination

None. One request returns the whole board (OpenAI's is ~12 MB / 735 postings).

---

## 3. Lever

### Board (all jobs for one company)

```
GET https://api.lever.co/v0/postings/<company>?mode=json
```

| Param | Meaning |
|-------|---------|
| `mode` | `json` returns JSON (otherwise HTML). |
| `team` | Optional **server-side** facet, e.g. `?team=Engineering`. The only server-side filter any of the three providers offers. The CLI does not use it (a whole board is one request either way). |
| `location`, `commitment`, `department` | Also accepted as facets, same idea. |

Response — **the top level is an ARRAY**:

```jsonc
[
  {
    "id": "10dfc8bc-99ad-4ca2-ab76-853cb90a92c2",
    "text": "Backend Software Engineer - Application Development",   // ← TITLE lives here
    "createdAt": 1710188707256,                                    // unix MILLISECONDS
    "hostedUrl": "https://jobs.lever.co/palantir/10dfc8bc-…",
    "applyUrl":  "https://jobs.lever.co/palantir/10dfc8bc-…/apply",
    "country": "GB",
    "workplaceType": "hybrid",           // "remote" | "hybrid" | "onsite"
    "categories": {
      "commitment": "Full-time",
      "location": "London, United Kingdom",
      "team": "Dev",
      "allLocations": ["London, United Kingdom"]
    },
    "opening": "<div>…</div>",  "openingPlain": "…",
    "descriptionBody": "<div>…</div>", "descriptionBodyPlain": "…",
    "description": "<div>…</div>",
    "descriptionPlain": "A World-Changing Company\n…",   // = openingPlain + descriptionBodyPlain
    "lists": [ { "text": "Core Responsiblities", "content": "\n<li>…</li>\n<li>…</li>" } ],
    "additional": "<div>…</div>", "additionalPlain": "Life at Palantir\n…"
  }
]
```

| Contract field | Path |
|----------------|------|
| `id` | `.[].id` (composed into `lever:<token>:<id>`) |
| `title` | `.[].text` — **not** `.title`, which does not exist |
| `company` | not in the payload — taken from the roster `name` |
| `location` | `.[].categories.location` |
| `date` | `.[].createdAt` (unix ms) → `YYYY-MM-DD` |
| `url` | `.[].hostedUrl` |
| `department` | `.[].categories.team` |
| `employmentType` | `.[].categories.commitment` |
| `description` | `.[].descriptionPlain` **+** `lists[]` **+** `additionalPlain` |

**The requirement bullets live only in `lists[]`.** `descriptionPlain` is just
the intro plus the role summary; the "Core Responsibilities" / "What We Value"
bullets are separate objects with an HTML `content` field. A parser that reads
`descriptionPlain` alone loses most of the skill keywords, which would silently
gut client-side `--query` matching. `leverDescription()` concatenates all three.

Plain-text fields contain U+00A0 non-breaking spaces; the CLI normalises them.

### Single job

```
GET https://api.lever.co/v0/postings/<company>/<jobId>?mode=json
```

Returns a single posting **object** (not wrapped in an array) with the same
field names.

### ⚠️ 404 shape trap

```
GET https://api.lever.co/v0/postings/anthropic?mode=json
→ HTTP 404  {"ok":false,"error":"Document not found"}
```

The 404 body is an **object** even though the success body is an **array**. Any
code that does `data.map(...)` on a non-200 response crashes. `parseLeverBoard`
returns `[]` for anything that is not an array.

A company that has migrated away from Lever returns **HTTP 200 with `[]`** —
verified for `mistral` and `plaid`. That is not a 404 and must be recognised
separately when validating a new token.

### Pagination

None; `skip`/`limit` params exist on some Lever deployments but the roster boards
return in full on one request.

---

## 4. Robots & ToS posture

| Host | robots.txt | Verdict |
|------|-----------|---------|
| `boards-api.greenhouse.io` | `User-agent: *` / `Disallow: /embed/` | **Allowed.** Only `/embed/` is disallowed; `/v1/boards/…` is not. |
| `api.ashbyhq.com` | none — `/robots.txt` returns `401 Unauthorized` | **No restriction published.** The endpoint is Ashby's documented public posting API. |
| `api.lever.co` | `User-agent: *` / `Allow: /` / `Crawl-delay: 1` | **Explicitly allowed**, with a 1-second crawl delay the CLI honours. |

Lever's own posting-API documentation states that these jobs may be scraped by
third parties — the most explicit permission of any source used in this repo.

**No attribution is required by any of the three.**

Client behaviour:

- Honest User-Agent: `ai-job-search/1.0 (+https://github.com/MadsLorentzen/ai-job-search) personal-job-search`.
  All three hosts answer `200` to it; **no browser-UA fallback is needed anywhere.**
- Concurrency capped at 5 for Greenhouse + Ashby (`MAX_CONCURRENCY`).
- Lever calls serialised with a 1000 ms pause (`LEVER_CRAWL_DELAY_MS`).
- Retry with exponential backoff + jitter on `429`/`5xx` (6 retries, 500 ms →
  8 s); `404` returns `null` rather than throwing.
- Request timeout 30 s (`REQUEST_TIMEOUT_MS`) — wider than the repo's usual 15 s
  because these payloads reach 12 MB.

### Rate-limit observations (2026-08-05)

No `429` was observed at any point during development, including a full 22-company
fan-out repeated many times. No `Retry-After` or rate-limit headers are published
by any of the three. A full fan-out with descriptions takes **6–10 s**; with
`--titles-only` it is roughly 2–3 s.

---

## 5. Verified tokens

Live counts measured 2026-08-05. These seed `companies.json`.

| Provider | Token | Postings |
|----------|-------|----------|
| greenhouse | `anthropic` | 398 |
| greenhouse | `databricks` | 808 |
| greenhouse | `scaleai` | 219 |
| greenhouse | `figureai` | 126 |
| greenhouse | `waymo` | 394 |
| greenhouse | `stripe` | 549 |
| greenhouse | `nuro` | 102 |
| greenhouse | `samsara` | 290 |
| greenhouse | `reddit` | 187 |
| greenhouse | `coinbase` | 163 |
| greenhouse | `gitlab` | 185 |
| greenhouse | `instacart` | 117 |
| greenhouse | `robinhood` | 129 |
| greenhouse | `duolingo` | 65 |
| greenhouse | `discord` | 47 |
| greenhouse | `airtable` | 40 |
| ashby | `openai` | 735 |
| ashby | `elevenlabs` | 225 |
| ashby | `cohere` | 140 |
| ashby | `ramp` | 120 |
| lever | `palantir` | 301 |
| lever | `matchgroup` | 84 |

**Known-bad tokens — do NOT add:**

- Greenhouse `404`: `openai`, `huggingface`, `cohere`, `mistralai`,
  `perplexityai`, `elevenlabs`, `scale`, `character`
- Lever `404`: `anthropic`, `openai`, `cohere`, `netflix`, `ramp`
- Lever `200` with `[]` (migrated away): `mistral`, `plaid`

---

## 6. Adding a company

1. Open the company's careers page and follow it through to the ATS-hosted board.
   The host identifies the provider and the first path segment is the token:

   ```
   https://job-boards.greenhouse.io/<token>/jobs/<id>     -> greenhouse
   https://boards.greenhouse.io/<token>                   -> greenhouse
   https://jobs.ashbyhq.com/<token>/<uuid>                -> ashby
   https://jobs.lever.co/<token>/<uuid>                   -> lever
   ```

   If the board is embedded in the company's own site, view source or check the
   network panel for a request to one of those three hosts.

2. Probe the API directly before trusting it:

   ```bash
   curl -s "https://boards-api.greenhouse.io/v1/boards/<token>/jobs" | head -c 200
   curl -s "https://api.ashbyhq.com/posting-api/job-board/<token>"   | head -c 200
   curl -s "https://api.lever.co/v0/postings/<token>?mode=json"      | head -c 200
   ```

   Expect `{"jobs":[…],"meta":{"total":N}}`, `{"apiVersion":"1","jobs":[…]}`, or a
   non-empty `[…]` respectively. Treat `404`, `Not Found`, `{"ok":false,…}` and a
   bare `[]` as "not a valid token".

3. Append `{ "token": "…", "provider": "…", "name": "…" }` to the `companies`
   array in `../companies.json` and re-run a search. A broken entry surfaces in
   `meta.errors[]` without breaking the rest of the fan-out.

## 7. When something breaks

- **All companies of one provider fail at once** → the provider changed its
  endpoint or response envelope. Re-check §1–§3 against a raw `curl`.
- **Titles come back `null`** → a field was renamed. Lever is the likely
  culprit (`text`, not `title`).
- **Descriptions contain visible `&lt;` / `<p>`** → Greenhouse changed its
  escaping depth; adjust the decode/strip/decode order in
  `greenhouseContentToText`.
- **`--remote` returns implausibly many results** → Ashby's `isRemote` semantics
  drifted again; re-run the `isRemote` × `workplaceType` cross-tab in §2.
- **One company 404s** → its token changed or it moved ATS. Re-run §6 step 1.
