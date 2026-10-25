# jobicy-search-cli

CLI for searching **remote** job listings through Jobicy's public JSON API.

**Data source**: `https://jobicy.com/api/v2/remote-jobs` (plus `?get=locations`
and `?get=industries` for the valid slugs).
**Authentication**: None — no API key, no account.
**Dependencies**: None (plain `bun` + `fetch`). `bun install` is optional and only
pulls dev type definitions.

The differentiator: **`--query` is a real server-side filter** (it maps to the
API's `tag` parameter), so keyword searches actually narrow the result set on
Jobicy's side instead of being faked locally.

> **⚠️ Personal use only.** `jobicy.com/robots.txt` line 48 carries
> `Disallow: /api/`, which covers this endpoint — while Jobicy simultaneously
> documents the same interface as a developer API (every payload carries
> `documentationUrl: https://jobi.cy/apidocs`). The two signals conflict. Keep
> volume low, don't use it commercially or for bulk collection, and run it on
> your own responsibility. The CLI sends an honest User-Agent and does not
> impersonate a browser.
>
> **Attribution is contractual.** The payload's `friendlyNotice` requires that
> Jobicy be credited with a direct link and that apply buttons point at the
> original job URL. It is echoed at `meta.attribution` in JSON and printed under
> `table`/`plain` output — don't strip it. See `../SKILL.md`.

## Installation

```bash
cd .agents/skills/jobicy-search/cli
bun install   # optional — only installs TypeScript dev types
```

## Commands

| Command | Description |
|---------|-------------|
| `search` | Search remote job listings (no flag is required) |
| `detail <id\|url>` | Full detail for a single listing |

`search` accepts `--format json|table|plain` (default `json`); `detail` accepts
`--format json|plain`. Errors go to **stderr** as `{ "error": "...", "code": "..." }`
with exit code `1`.

## Quick examples

```bash
# Remote ML engineering roles open to US candidates
bun run src/cli.ts search -q "machine learning" --geo usa --limit 10 --format table

# Remote AI roles for Germany, last 14 days
bun run src/cli.ts search -q "AI engineer" --geo germany --jobage 14 --format table

# Computer vision, Europe-wide remote
bun run src/cli.ts search -q "computer vision" --geo europe --limit 20 --format plain

# MLOps, narrowed by industry too
bun run src/cli.ts search -q "MLOps" --industry admin --limit 15 --format json

# One job's full description — reuse the search flags
bun run src/cli.ts detail 143131 -q "machine learning" --geo usa --limit 10 --format plain
```

## Search flags

| Flag | Alias | Side | Description |
|------|-------|------|-------------|
| `--query` | `-q` | **server** | Keyword → the API's `tag`. Genuinely narrows results. Must be 3–50 chars — `"AI"`/`"ML"` are rejected upstream; spell them out. |
| `--geo` | `-l`, `--location` | **server** | Region slug (`usa`, `germany`, `europe`, `uk`, `emea`, …). Case/spaces normalised and common names mapped (`"Deutschland"` → `germany`). No `anywhere` and no city granularity — omit for worldwide. |
| `--industry` | | **server** | Industry slug (`data-science`, `engineering`, `admin`, …). |
| `--limit` | `-n` | server | Results per page → `count`. Capped at 100 by the API; the clamp is reported at `meta.limitClamped`. |
| `--jobage` | | client | Posted within N days (on `pubDate`). `0` = today (UTC). |
| `--page` | | client | 1-indexed slice of the single response — the API has no paging, so `page × limit ≤ 100`. |
| `--format` | | — | `json` (default) \| `table` \| `plain`. |

`detail` takes `--query`, `--geo`, `--industry`, `--limit` and `--format`. Jobicy
has **no per-job API endpoint**, so `detail` re-runs a list query and picks the
record out by id — pass the same flags the search used, including `--limit`,
because each `count` value is cached separately with its own freshness, and the
lookup then costs a single request.

If the id is outside that listing window (normal for anything more than a day or
two old), `detail` falls back to the public job page
`https://jobicy.com/jobs/<id>-…` and parses its schema.org `JobPosting` JSON-LD,
so **`detail <id>` works with no other flags**. `meta.resolvedVia` reports which
path answered (`api-listing` / `job-page`); the page carries the description,
salary and region but not Jobicy's `jobLevel` / `jobIndustry` taxonomy.

```bash
bun run src/cli.ts detail 143131 --format plain   # id alone is enough
```

## Development

```bash
bun run typecheck   # tsc --noEmit, strict
bun test            # network-free unit + CLI-contract tests
```

Tests never touch the network: the parsing suite runs against a real captured
response embedded in `tests/parsing.test.ts`, and every flag-validation path in
`src/cli.ts` rejects bad input before a request is built.

See `../SKILL.md` for the full flag reference, the robots.txt/ToS discussion and
the attribution requirement; see `../url-reference.md` for the endpoint,
parameter and response-shape reference.
