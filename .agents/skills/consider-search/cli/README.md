# consider-search-cli

CLI for the **Consider-powered VC portfolio job boards** — a16z, Sequoia, Lightspeed, Bessemer,
GV, Greylock, Bain Capital Ventures, Kleiner Perkins, Battery, First Round and CRV — searched in
one fan-out query.

**Data source**: `POST https://<host>/api-boards/search-jobs` on each fund's own domain. Consider
(`consider.com`) runs the same application for every fund, so one client reaches all of them.
**Authentication**: none. No API key, no account, no cookie, no CSRF token.
**Dependencies**: none (plain `bun` + `fetch` + JSON). `bun install` is optional and only pulls dev
type definitions.

> **robots.txt permits every endpoint used here.** All 11 hosts serve
> `User-agent: * / Allow: /`, and `tools/robots_check.py` exits 0 for all 33 URL shapes this CLI
> emits. The honest User-Agent (`ai-job-search/1.0 (+…) personal-job-search`) is used throughout —
> no browser impersonation. **Getro-powered boards** (`jobs.accel.com`, `jobs.khoslaventures.com`,
> `jobs.menlovc.com`, `jobs.craftventures.com`) are a *different* provider whose API is
> robots-DISALLOWED and are deliberately excluded.

## The two things that shape this CLI

**1. Consider has no job description.** The API returns rich structured metadata — salary range,
inferred seniority, extracted skills, market tags, years of experience — but no posting body text.
`detail` returns that structured record plus the *employer's* company profile, and says so. For
the posting text, follow the result `url` to the employer's ATS.

**2. Unknown query filters are silently ignored.** Send an invented key and the backend drops it
and answers HTTP 200 with the whole board (a16z: `total 15909`). No 4xx. `buildQuery()` whitelists
every key it sends. Verify any new filter actually changes `total` before trusting it.

## Installation

```bash
cd .agents/skills/consider-search/cli
bun install   # optional — only installs TypeScript dev types
```

## Commands

| Command | Description |
|---------|-------------|
| `search` | Fan out over the roster. No flag is required; `-q` is strongly recommended. |
| `boards` | List the roster (slug, host, name). |
| `detail <board:company:jobId>` | Full structured record + the employer profile. |

`search` accepts `--format json|table|plain` (default `json`); `detail` accepts `--format json|plain`.
All errors go to **stderr** as `{ "error": "...", "code": "..." }` with exit code `1`.

## Search flags

| Flag | Alias | Applied | Maps to | Description |
|------|-------|---------|---------|-------------|
| `--query` | `-q` | **server-side** | `query.titlePrefix` | Title keywords; matches anywhere in the title. |
| `--board` | `-b` | client-side | roster subset | One board slug. **Repeatable.** |
| `--remote` | | **server-side** | `query.remoteOnly` | Boolean flag; takes no value. |
| `--location` | `-l` | **server-side** | `query.locations` | Resolved to Consider's canonical value first. |
| `--jobage` | | **server-side** | `query.postedSince` | Days; sent as ISO-8601 `P<N>D`. |
| `--page` | | client-side | — | 1-indexed page over the merged set. Default `1`. |
| `--limit` | `-n` | client-side | `meta.size` | Page size. Default `25`. |
| `--format` | | — | — | `json` \| `table` \| `plain`. |

Only `--board`, `--page` and `--limit` are client-side, and only because they are properties of
the fan-out rather than of any one board. There is **no** client-side keyword re-filtering.

`--location` is resolved through `POST /api-boards/autocomplete/locations` before the search,
because `query.locations` matches a canonical vocabulary and not free text (`"Berlin, Germany"`
→ 0 results; `"Berlin Area, Germany"` → 80). **That vocabulary is English**: `"München"` resolves
to nothing, `"Munich"` works. A small alias table translates German city names, then a
diacritic-stripped retry follows; a plain-ASCII input costs exactly one request. An unresolvable
location is a hard `BAD_LOCATION`, never a silent world-wide search.

Integer flags reject non-numeric, negative and fractional values with `{"code":"BAD_ARG"}`
**before** any network call. `0` parses (though `--limit 0` is then rejected as a useless page size).

## Examples

```bash
bun run src/cli.ts search -q "machine learning" --limit 10 --format table
bun run src/cli.ts search -q "machine learning engineer" --remote --jobage 14 --format table
bun run src/cli.ts search -q "AI Engineer" -l "Berlin" --format table
bun run src/cli.ts search -q "MLOps" -b andreessen-horowitz -b sequoia-capital --format plain
bun run src/cli.ts boards
bun run src/cli.ts detail andreessen-horowitz:bighat-biosciences:ed9ce18f-e885-4052-8f9a-e10f952a460a --format plain
```

## The detail id

```
<board-slug>:<company-slug>:<job-id>
```

Exactly the `id` field every search result carries. All three segments are required: the board
picks the host, the company slug makes the lookup one cheap request (there is no fetch-by-id
endpoint — `GET /api-boards/jobs/<id>` answers 200 with an empty envelope for every non-Consider-
hosted posting), and the job id is the employer's ATS id — a UUID, a bare integer, or an opaque
token. Only the **first two** colons are separators, so an exotic ATS id survives verbatim.

## Fan-out behaviour

- At most **4** boards in flight (`MAX_CONCURRENCY`).
- **One board failing never aborts the run**: the failure lands in `meta.errors[]` (and a
  `warning:` line on stderr for `table`/`plain`), and the run exits `0` with whatever answered.
  Only an all-boards failure is `FETCH_FAILED` / exit `1`.
- Results are **deduplicated on the ATS `jobId`** — funds co-invest, so the same posting really is
  on several boards — and each row's `boards` array lists every board that carried it.
- Merged order is **newest-first**. The API's relevance `score` is per-board and not comparable
  across boards.
- **`--page` is not a slice of the merged list.** The boards rank by relevance, the output is
  newest-first, and the fetch depth grows with the page — so page N sees a strictly larger universe
  than page N-1 and a date re-sort moves the boundary. A naive slice repeats rows *and* drops
  others (observed live). `pageResults()` replays every shallower page from the same fetched
  records and skips what they already showed: pages are disjoint, nothing is lost, no extra
  requests, and page 1 is unchanged.
- `page × limit` is capped at **200 records per board** → `PAGE_TOO_DEEP`.

## Error codes

| Code | Meaning |
|------|---------|
| `BAD_ARG` | A flag value failed validation (non-integer, negative, fractional, missing value, `--limit 0`). |
| `BAD_CMD` | Unknown command. |
| `BAD_ID` | `detail` id is not `<board>:<company>:<jobId>`. |
| `BAD_BOARD` | A board slug is not in `boards.json`. |
| `BAD_LOCATION` | `--location` matched nothing in Consider's canonical vocabulary. |
| `NO_ID` | `detail` called with no id. |
| `NO_BOARDS` | `boards.json` is missing, unreadable, or has no usable entries. |
| `PAGE_TOO_DEEP` | `--page` × `--limit` exceeds 200 records per board. |
| `NOT_FOUND` | `detail` found no such posting on that company's board (usually filled + delisted). |
| `FETCH_FAILED` | Network/HTTP failure, or every board failed. |
| `INTERNAL_ERROR` | Unhandled exception. |

## The roster

`../boards.json` (next to `SKILL.md`) is meant to be edited — it is the list of funds you track.
It documents the four-step verification for adding a board: read `fixedBoard` out of the board's
own HTML → run the repo robots gate → live POST → add. A host without `fixedBoard` is not
Consider; do not add it.

## Tests

```bash
bun run typecheck   # tsc --noEmit, strict
bun test            # network-free
```

`tests/fixtures.ts` holds **real captured payloads** (a16z search response, a company profile, an
error envelope, an autocomplete response) trimmed but never invented. `tests/parsing.test.ts`
exercises the parsers; `tests/cli-contract.test.ts` drives the binary through `runCLI` and asserts
the flag/error contract. Neither touches the network.

See `../url-reference.md` for the full API reference, the robots matrix and the re-verification
order.
