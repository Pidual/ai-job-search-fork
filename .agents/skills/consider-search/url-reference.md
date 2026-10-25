# Consider — URL & API reference

Maintenance document for `.agents/skills/consider-search/`.
Everything here was captured live on **2026-08-05** with the fork's honest User-Agent:

```
UA='ai-job-search/1.0 (+https://github.com/MadsLorentzen/ai-job-search) personal-job-search'
```

No API key, no account, no cookie, no CSRF token. All three endpoints answer to that UA.

---

## 1. What Consider is

`consider.com` is a SaaS that hosts "portfolio jobs" boards for venture funds. Every customer gets
the **same application** on the fund's **own** domain, so one client speaks to all of them. The
board is a React SPA; all data comes from a small JSON API under `/api-boards/`.

The board's identity lives in the page's own bootstrap state — this is how you discover a new one:

```bash
curl -sS -A "$UA" https://jobs.a16z.com/jobs | grep -o '"fixedBoard":"[^"]*"'
# -> "fixedBoard":"andreessen-horowitz"
```

`window.serverInitialData` also carries `board: {"id":"andreessen-horowitz","isParent":true}` and a
`csrfToken` — **the API does not require the token**; requests succeed without it (verified).

---

## 2. Hosts (the roster) — robots gate matrix

`boards.json` ships these 11. `slug` is the API's `board.id`, **not** the hostname.

| slug | host | fund | ML jobs (verified) |
|------|------|------|-----|
| `andreessen-horowitz` | `jobs.a16z.com` | Andreessen Horowitz | 153 |
| `gv` | `jobs.gv.com` | GV (Google Ventures) | 100 |
| `lightspeed` | `jobs.lsvp.com` | Lightspeed | 99 |
| `sequoia-capital` | `jobs.sequoiacap.com` | Sequoia Capital | 90 |
| `bessemer-ventures` | `jobs.bvp.com` | Bessemer | 84 |
| `bain-ventures` | `jobs.bcv.com` | Bain Capital Ventures | 34 |
| `kleiner-perkins` | `jobs.kleinerperkins.com` | Kleiner Perkins | 26 |
| `greylock-partners` | `jobs.greylock.com` | Greylock | 19 |
| `battery-ventures` | `jobs.battery.com` | Battery Ventures | 13 |
| `first-round-capital` | `jobs.firstround.com` | First Round | 13 |
| `crv` | `jobs.crv.com` | CRV | 6 |

"ML jobs" is the real `total` for `query.titlePrefix = "machine learning"`, `isParent: true`.
a16z 153 / lightspeed 99 / sequoia 90 / bessemer 84 / greylock 19 reproduces the census's
445-across-five-boards figure exactly.

### robots.txt

Identical on every host. `https://jobs.a16z.com/robots.txt` → **HTTP 200, 82 bytes**, verbatim:

```
# www.robotstxt.org/

User-agent: LinkedInBot
Disallow: /

User-agent: *
Allow: /
```

No AI-crawler group, no `Content-Signal`, no `Crawl-delay`, no `Disallow` for `*`.

### Repo gate results — 33/33 ALLOWED (exit 0)

Every URL shape this CLI emits, on every host:

```bash
cd <repo-root>
for h in jobs.a16z.com jobs.sequoiacap.com jobs.lsvp.com jobs.bvp.com jobs.greylock.com \
         jobs.gv.com jobs.bcv.com jobs.kleinerperkins.com jobs.firstround.com \
         jobs.crv.com jobs.battery.com; do
  for p in api-boards/search-jobs api-boards/search-companies api-boards/autocomplete/locations; do
    python3 tools/robots_check.py "https://$h/$p"
  done
done
```

| URL shape | hosts | result |
|-----------|-------|--------|
| `https://<host>/api-boards/search-jobs` | all 11 | `ALLOWED - robots.txt permits this path` · **exit 0** |
| `https://<host>/api-boards/search-companies` | all 11 | `ALLOWED` · **exit 0** |
| `https://<host>/api-boards/autocomplete/locations` | all 11 | `ALLOWED` · **exit 0** |

**No personal-use warning is required** and SKILL.md says so explicitly.

### ⛔ Getro — a different provider, robots-DISALLOWED

```bash
python3 tools/robots_check.py 'https://api.getro.com/api/v2/collections/1/search/jobs'
# -> DISALLOWED for Claude-User - do not retry, go to step 3   (exit 1)
```

Getro powers `jobs.accel.com`, `jobs.khoslaventures.com`, `jobs.menlovc.com`,
`jobs.craftventures.com` (probed 2026-08-05: HTTP 200 but **no** `fixedBoard`, and `getro` strings
in the markup). They are **excluded on purpose**, and `tests/parsing.test.ts` asserts the roster
never contains them. Absence of `fixedBoard` is the discriminator.

Hosts that did not resolve at all (2026-08-05): `jobs.nea.com`, `jobs.ivp.com` (DNS),
`jobs.indexventures.com`, `jobs.benchmark.com`, `jobs.redpoint.com`, `jobs.canaan.com` (TLS).

---

## 3. `POST /api-boards/search-jobs` — the main endpoint

### Where the body shape comes from

Not guesswork. The board's own JS bundle (`https://jobs.a16z.com/mendel/<hash>/boards`, ~2 MB,
browserify) contains, in module `boards/actions/search-jobs`:

```js
request.post("/api-boards/search-jobs")
       .set("Accept","application/json")
       .send({ meta: i, board: o, query: n, grouped: u, parentSlug: s })
```

and in `boards/actions/next-jobs`, the pagination step:

```js
s.size = Math.min(2*s.size, 50)          // s is the PREVIOUS RESPONSE's meta
e(searchJobs({query:o, meta:s, board:a, key:t, urlOverride:u, grouped:r}))
```

The `query` vocabulary comes from `shared-no-variations/job-query-for-user-fields`:

```js
queryPayload({ matchMode:"relaxed", remoteOnly, hybridOnly, jobSeniority, jobFunctions,
               locations, markets, companies, stages, skills, staffCountRanges })
```

plus the `param:"…"` props of the filter inputs (`titlePrefix`, `postedSince`, `jobTypes`,
`departments`, `salaryRange`, `staffCountRanges`, `compensationListed`, `internshipOnly`,
`hybridOrRemoteOnly`, `applicationWindow`, `industry`, `educationLevels`,
`civicImpactJobTypes`, `maxTermDurationDays`, `showCanonicalJobs`).

### Request

```
POST https://<host>/api-boards/search-jobs
Content-Type: application/json
Accept: application/json
User-Agent: ai-job-search/1.0 (+https://github.com/MadsLorentzen/ai-job-search) personal-job-search
```

```json
{
  "meta":  { "size": 25, "sequence": "<cursor from the previous response, omit for page 1>" },
  "board": { "id": "andreessen-horowitz", "isParent": true },
  "query": { "titlePrefix": "machine learning", "remoteOnly": true, "postedSince": "P14D" },
  "grouped": false,
  "parentSlug": "andreessen-horowitz"
}
```

Minimal working body (everything else is optional):
`{"meta":{},"board":{"id":"<slug>","isParent":true},"query":{}}`

### Body keys

| Key | Type | Required | Notes |
|-----|------|----------|-------|
| `meta.size` | int | no (defaults small) | Page size. UI caps at 50; **100 verified working**. |
| `meta.sequence` | string | no | Opaque base64 cursor from the previous response's `meta.sequence`. Omit for page 1. |
| `board.id` | string | **yes** | The slug (`fixedBoard`). Omitting `board` → HTTP 500 `Cannot read properties of undefined (reading 'id')`. |
| `board.isParent` | bool | **yes** | `true` = the fund's whole portfolio. `false` + a **company slug** as `id` = that one company's board. |
| `query` | object | **yes** | Filters. `{}` = everything. Must be an OBJECT — a string is spread character-by-character. |
| `grouped` | bool | no | `true` groups by company and changes the `jobs` shape. This CLI always sends `false`. |
| `parentSlug` | string | no | Mirrors `board.id`; the frontend sends it. |

### `query` filters — verified server-side against a16z

| Key | Example | `total` | Note |
|-----|---------|---------|------|
| *(empty)* | `{}` | **15909** | The entire index |
| `titlePrefix` | `"machine learning"` | **153** | Substring match on the title, not a true prefix |
| `titlePrefix` | `"zzzqqqnonsensexyzzy"` | **0** | ✅ control — the filter is real |
| `titlePrefix` | `"AI Engineer"` | 82 | |
| `titlePrefix` | `"machine learning engineer"` | 108 | |
| `remoteOnly` | `true` (+ ML) | **27** | matches `availableFilters` |
| `hybridOrRemoteOnly` | `true` (+ ML) | 56 | |
| `postedSince` | `"P7D"` (+ ML) | **4** | ISO-8601 duration |
| `postedSince` | `"P3D"` / `"P45D"` (+ ML) | 2 / 43 | arbitrary day counts work |
| `postedSince` | `"3"` (+ ML) | **0** | ⚠️ accepted, silently wrong — must be `P<N>D` |
| `locations` | `["San Francisco, California"]` | 2771 | bare **string** array |
| `locations` | `["San Francisco, California"]` + ML | 41 | |
| `locations` | `["Berlin Area, Germany"]` | **80** | |
| `locations` | `["Berlin, Germany"]` | **0** | ⚠️ not the canonical value |
| `locations` | `["Zzzqqq Nonsenseville"]` | 0 | control |
| `locations` | `[{"label":…,"value":…}]` | — | ⚠️ HTTP 500 — objects are **not** accepted here |
| `companies` | `["BigHat Biosciences"]` | 9 | matches `companyId` (display name), **not** the slug |
| `companies` | `["bighat-biosciences"]` | 0 | ⚠️ slug does not work here |
| `compensationListed` | `true` (+ ML) | 107 | |
| `internshipOnly` | `true` (+ ML) | 2 | |
| `managerOnly` | `true` (+ ML) | 7 | |
| `skills` | `["resume:PyTorch"]` | 251 | ids are `resume:<Label>` |

Other keys seen in the bundle but not exercised by this CLI: `hybridOnly`, `jobSeniority`,
`jobFunctions`, `markets`, `stages`, `staffCountRanges`, `departments`, `jobTypes`,
`salaryRange`, `minYearsExp`, `maxYearsExp`, `considerLevels`, `educationLevels`,
`applicationWindow`, `industry`, `fellowshipOnly`, `matchesProfileId`, `isFeatured`,
`bestFit`, `showCanonicalJobs`, `promoteFeatured`, `matchMode`.

> ### ⚠️⚠️ THE ONE TRAP THAT WILL BITE YOU
> **Unknown `query` keys are silently ignored.** `{"jobIds":["…"]}`, `{"ids":[…]}`,
> `{"jobId":[…]}`, `{"urls":[…]}` all returned `total 15909` — the whole board — with HTTP 200
> and `errors: []`. There is no validation error. A misspelled filter therefore looks like a
> spectacularly successful search. `buildQuery()` in `helpers.ts` whitelists keys for this
> reason. **When adding a filter, prove it changes `total` before trusting it.**

### Response envelope

```json
{
  "version": { "client": {...}, "server": {...} },
  "jobs": [ … ],
  "meta": { "size": 3, "sequence": "eyJfaWQiOiAiNzFkYWVjN2Rj…" },
  "availableFilters": [ { "param": "remoteOnly", "value": "true", "total": 27 } ],
  "total": 153,
  "errors": [],
  "debug": []
}
```

**HTTP 200 is not success.** A server-side failure arrives as 200 (or 500) with `jobs: []` and a
populated `errors[]`:

```json
{"jobs":[],"errors":[{"status":500,"code":"BOARDS_JOBS_ERROR",
  "message":"Cannot read properties of undefined (reading 'id')"}],"debug":[]}
```

`parseSearchResponse()` reads `errors[]` and never trusts the status alone.

### Job record — real field paths

Captured from a16z, 2026-08-05. `→` is where each contract field comes from.

| Path | Type | → CLI field | Notes |
|------|------|-------------|-------|
| `jobId` | string | `jobId`, id segment 3 | UUID (Ashby/Pinpoint), bare int (Greenhouse `8052599`), or opaque token (Gem `am9icG9zdDpeOx5B5La97k6Dl8Ob0wYN`). **Never pattern-validate it.** |
| `title` | string | `title` | Sanitised (untrusted text) |
| `companyName` | string | `company` | Display name |
| `companyId` | string | fallback for `company` | ⚠️ diverges after a rebrand: `companyName "Cantina"` vs `companyId "Airtime"` |
| `companySlug` | string | `companySlug`, id segment 2 | The API-addressable handle |
| `companyDomain` | string | `companyDomain` | |
| `normalizedLocations[].label` | chip[] | `location` (preferred) | Canonical `"San Mateo, California"` |
| `locations[]` | string[] | `location` (fallback) | ATS-verbatim; **contains `""` entries** — a live Cantina record is `["", "Remote (U.S. or Europe)"]` |
| `timeStamp` | ISO8601 | `date` (sliced to 10) → `postedSince` | |
| `url` | string | `url` | Clean canonical link |
| `applyUrl` | string | `applyUrl` | Usually `?utm_source=jobs.<fund>.com` |
| `remote` / `hybrid` | bool | `remote` / `hybrid` | |
| `salary.minValue` / `.maxValue` | number | `salaryMin` / `salaryMax` | Absent entirely when not listed |
| `salary.currency.value` / `.period.value` | string | `salaryCurrency` / `salaryPeriod` | `"USD"` / `"year"` |
| `salary.isOriginal` | bool | — | `false` = converted/inferred; treat as a hint |
| `jobSeniorityIds[]` | string[] | `seniority` | `["senior","mid"]`; `jobSeniorities[]` is the chip form |
| `skills[].label` | chip[] | `skills` | ids are `resume:<Label>`; `requiredSkills`/`preferredSkills` split the same list |
| `departments[]` | string[] | `department` (joined) | Often `[]` |
| `jobTypes[].label` | chip[] | `jobTypes` | `"Machine Learning Engineer"`, `"Data Scientist"` |
| `markets[].label` | chip[] | `markets` | `"Bio + Health"`, `"Consumer"` |
| `minYearsExp` / `maxYearsExp` | number | same | Frequently absent |
| `isFeatured` | bool | `featured` | |
| `considerLevels`, `scores`, `matchingTalent`, `regions`, `stages`, `fundingLV`, `companyLogos`, `companyStaffCount`, `atsJobs`, `applicationWindow` | | not emitted | Available if needed |

**There is no `description` field. Anywhere.** Consider indexes structured metadata only.

### Pagination — cursor, not offset

```bash
# page 1
-d '{"meta":{"size":5},"board":{"id":"andreessen-horowitz","isParent":true},
     "query":{"titlePrefix":"machine learning"}}'
# -> meta.sequence "eyJfaWQiOiAiNDRiMWExNjgxODQ4NjNjYThlYWZiNjYyMGJlZDQyZDgiLCAic2NvcmUiOiAwLjg5Mj…"

# page 2: feed that value straight back
-d '{"meta":{"size":5,"sequence":"<that value>"}, …same board/query… }'
```

Verified: page 1 and page 2 return disjoint records, `total` stays 153. The cursor is
base64 of `{"_id": "...", "score": ...}` — an opaque relevance-keyset, so it is only valid for the
**same** `query`. `meta.size` 100 works; the UI's own cap is 50.

`--page N` in this CLI walks the cursor. `page × limit` is capped at **200 records per board**
(`MAX_RECORDS_PER_BOARD`) → `PAGE_TOO_DEEP` beyond that.

#### ⚠️ Relevance order vs. newest-first — why `--page` is not a slice

The cursor walks Consider's **relevance** order, but the merged output is presented
**newest-first**, and the fetch depth is `page × limit` per board. Page N therefore re-sorts a
strictly larger universe than page N-1 did, which moves the page boundary. A naive
`merged.slice(start, start + limit)` both repeats and drops records. Measured live 2026-08-05,
`-q "machine learning" -b andreessen-horowitz --limit 3` — the board's relevance order and the
dates disagree at rank 3/4:

| relevance rank | jobId | date |
|---|---|---|
| 1 | `395712e5…` (Cantina) | 2026-08-04 |
| 2 | `ed9ce18f…` (BigHat) | 2026-08-04 |
| 3 | `452afc2e…` (Quora) | 2026-07-31 |
| 4 | `am9icG9z…` (Function Health) | **2026-08-03** ← newer than rank 3 |
| 5 | `0b1ec7c7…` (Cantina) | 2026-07-30 |
| 6 | `848fd6c2…` (Sprinter Health) | 2026-07-27 |

- `--page 1` fetched 3 records → showed ranks 1, 2, 3.
- `--page 2` fetched 6, date-sorted them, sliced `[3:6]` → showed **Quora again**, and Function
  Health (date-rank 3 of 6) was shown on **neither** page.

`pageResults()` in `helpers.ts` fixes this by reconstructing universe `U_k` = the merge of the
first `k × limit` records of each board — exactly what a `--page k` run saw — for every `k ≤ page`,
and skipping whatever those pages already emitted. Page 1 output is byte-identical to before,
pages are disjoint, no record is lost, and it costs **zero** extra requests. Regression pinned in
`tests/parsing.test.ts` → `describe("paging")`, network-free.

---

## 4. `POST /api-boards/search-companies`

Used by `detail` for the employer blurb — the only free text Consider exposes.

```json
{ "meta": { "size": 1 },
  "board": { "id": "andreessen-horowitz", "isParent": true },
  "query": { "ids": ["bighat-biosciences"] } }
```

⚠️ Here `query.ids` takes the company **slug** — the opposite of `search-jobs`'s `query.companies`,
which takes the display name. Response: `{companies:[…], total, meta, availableFilters, errors}`.

Useful fields: `description` (the blurb — **sanitised** before emission), `name`, `id`, `domain`,
`website`, `investors[]`, `investorSlugs[]`, `markets[]`/`marketsLV[]`, `stages[]`/`stagesLV[]`,
`officeLocations[]`, `staffCount`, `numJobs`, `numRemoteJobs`, `fractionRemote`,
`isRemoteFriendly`, `jobSources[]` (which ATS the company runs), `skills[]`/`skillsLV[]`,
`parentSlugs[]` (which funds' boards it appears on).

---

## 5. `POST /api-boards/autocomplete/<param>`

Resolves free text to Consider's canonical filter vocabulary. `--location` depends on it.

```json
{ "q": "Berlin", "board": { "isParent": true, "id": "andreessen-horowitz" },
  "limit": 10, "includeZeros": true }
```

```json
{"results":[
  {"self":{"label":"Berlin","bolding":"**Berlin**","value":"Berlin Area, Germany","score":69,"count":80}},
  {"self":{"label":"New Berlin, Wisconsin","value":"New Berlin, Wisconsin","count":0}},
  {"self":{"label":"Berlin, Wisconsin","value":"Berlin, Wisconsin","count":0}}
]}
```

`self.value` is what `query.locations` wants; `self.count` is how many jobs sit behind it.
`pickLocation()` prefers an exact value/label match, else the highest `count`. Labels come back
with trailing whitespace (`"Munich "`), so both sides are trimmed before comparing.

### ⚠️ The gazetteer is English-only

| `q` | results |
|-----|---------|
| `München` | **`[]`** |
| `Munchen` | **`[]`** — stripping the umlaut does not help |
| `Munich` | `"Munich Area, Germany"`, count **61** ✅ |
| `Berlin` | `"Berlin Area, Germany"`, count **80** |
| `Hamburg` | `"Hamburg Area, Germany"`, count 3 |
| `Germany` | `"Germany"`, count **257** |
| `Cologne` / `Köln` | **`[]` on every board** — no portfolio company there at all |

`LOCATION_ALIASES` + `locationCandidates()` in `helpers.ts` translate German endonyms before the
request (`München`→`Munich`, `Köln`→`Cologne`, `Nürnberg`→`Nuremberg`, `Hannover`→`Hanover`,
`Wien`→`Vienna`, `Zürich`→`Zurich`, `Deutschland`→`Germany`, …), then retry diacritic-stripped.
A plain-ASCII input costs exactly one request.

### Why resolving against ONE board is safe

`includeZeros: true` makes the gazetteer **global**, not board-scoped. Verified 2026-08-05:
`"Munich"` resolves to `"Munich Area, Germany"` on `jobs.greylock.com` and `jobs.crv.com` too —
just with `count: 0`, because those funds have no Munich portfolio company. So the canonical value
picked on the first board is valid for the whole fan-out.

Other params the same route accepts: `skills`, `markets`, `stages`, `jobfunctions`, `companies`,
`staffCountRanges`. A related GET route `/api-boards/autocomplete-global/<param>?q=&category=&slug=`
exists for the signup flow.

---

## 6. Endpoints deliberately NOT used

| Endpoint | Why not |
|----------|---------|
| `GET /api-boards/jobs/<jobId>?companyId=…` | **Returns HTTP 200 with an empty envelope** (`{version, errors: [], debug: []}` — no `job` key) for every posting that is not Consider-hosted. a16z has **zero** `considerHosted: true` records in a 50-record sample. Tried with `companyId=`, `companySlug=` and no params. This is the reason `detail` re-queries the company's child board instead. |
| `/api-boards/favorites`, `/save-user`, `/toggle-favorite`, `/job-interest`, `/user-file-upload`, `/validate-li`, `/delete-request` | Account/state mutation. Out of scope. |
| `/api-boards/search-fellowships` | Fellowship listings (`query.fellowshipOnly`), not jobs. |
| `/api-boards/name-mapping` | Bulk label→value mapping for URL seeding; `autocomplete` covers our one need. |

### How `detail` works instead

`detail <board>:<company-slug>:<jobId>`:

1. `POST /api-boards/search-jobs` with `board: {id: "<company-slug>", isParent: false}`,
   `query: {}`, `meta.size: 100` — the company's **own** board. Verified:
   `{"id":"bighat-biosciences","isParent":false}` → `total 9`. Real company boards are small.
   Up to 3 cursor pages are walked, then `NOT_FOUND`.
2. Match `jobId` locally.
3. `POST /api-boards/search-companies` for the blurb (best-effort; a failure here does not lose
   the job record).

Two requests. There is no cheaper exact lookup — `query.jobIds` does not exist (see the trap above).

---

## 7. Rate limits & timing

No documented limit, no `Retry-After`, no 429 observed across ~60 requests on 2026-08-05.
Typical latency 0.5–2 s per request; a whole-roster `--limit 5` search (11 requests, 4 in flight)
completes in **~3.4 s** wall-clock.

The CLI: 6 retries on 429/5xx, 500 ms → 8 s exponential backoff with ±500 ms jitter, 20 s request
timeout, `MAX_CONCURRENCY = 4`.

> Note: a malformed body also returns HTTP 500, so the backoff loop will retry it 6 times before
> failing (~30 s). If **every** board suddenly takes ~30 s to fail, check the request body against
> §3 before blaming the network.

---

## 8. ToS posture

- `robots.txt`: `User-agent: * / Allow: /`. No AI-crawler restriction, no crawl-delay.
- No API key, no ToS click-through, no rate-limit header, no attribution requirement.
- Footer links `https://consider.com/legal/terms` and `/legal/privacy` (Consider's own terms; not
  quoted here, not machine-enforced against this path).
- Personal, low-volume job search only. Do not bulk-harvest, redistribute, or use commercially.

---

## 9. Adding a board

1. Find the fund's portfolio board (usually `jobs.<fund>.com`; the footer says "Powered by Consider").
2. `curl -sS -A "$UA" https://<host>/jobs | grep -o '"fixedBoard":"[^"]*"'` → that is the `slug`.
   **No `fixedBoard` means it is not Consider** — most likely Getro, which is robots-disallowed.
3. `python3 tools/robots_check.py https://<host>/api-boards/search-jobs` — require **exit 0**.
4. Live POST per §3 — require HTTP 200, non-zero `total`, `errors: []`.
5. Add `{ "slug", "host", "name" }` to `boards.json`. Record the verified ML count.

---

## 10. Re-verification order when things break

1. **Empty results everywhere** → is the body still `{meta, board, query, grouped}`? Re-read the
   bundle: `curl https://jobs.a16z.com/jobs | grep -o 'src="/mendel/[^"]*"'`, download that path,
   `grep -o '.\{1500\}search-jobs.\{800\}'`.
2. **`total` is suddenly ~15000** → a `query` key stopped being recognised (see the trap in §3).
   Bisect by sending one filter at a time and watching `total`.
3. **All boards fail with the same message** → read `errors[0].message`; the backend echoes the
   FastAPI validation error including which body field is missing.
4. **`--location` matches nothing** → the canonical vocabulary changed. Hit
   `/api-boards/autocomplete/locations` directly and read `self.value`.
5. **`detail` says NOT_FOUND for a fresh id** → either the posting was filled (normal), or
   `isParent: false` company boards changed shape. Test
   `{"meta":{"size":5},"board":{"id":"<company-slug>","isParent":false},"query":{}}` by hand.
6. **A host 403s** → re-run the robots gate before doing anything else. If robots changed, drop
   the board from the roster; do not work around it.
