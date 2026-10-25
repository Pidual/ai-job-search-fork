# ats-search-cli

CLI for searching the **public applicant-tracking-system job boards** (Greenhouse,
Ashby, Lever) of a curated roster of AI companies.

**Data sources**
- `https://boards-api.greenhouse.io/v1/boards/<token>/jobs?content=true`
- `https://api.ashbyhq.com/posting-api/job-board/<token>?includeCompensation=true`
- `https://api.lever.co/v0/postings/<company>?mode=json`

**Authentication**: none — no API key, no account.
**Attribution**: none required by any provider.
**Dependencies**: none (plain `bun` + `fetch`). `bun install` only pulls dev type defs.

> **No personal-use restriction applies.** Greenhouse's robots.txt disallows only
> `/embed/`, Ashby publishes no robots.txt, and Lever's is `Allow: /` with
> `Crawl-delay: 1` (which this CLI honours). See `../url-reference.md` §4.

## Installation

```bash
cd .agents/skills/ats-search/cli
bun install   # optional — only installs TypeScript dev types
```

## Commands

| Command | Description |
|---------|-------------|
| `search` | Fan out over the roster in `../companies.json` and filter client-side |
| `detail` | Fetch one job's full, decoded description |

`search` accepts `--format json|table|plain` (default `json`); `detail` accepts
`--format json|plain`. All errors are written to **stderr** as
`{ "error": "...", "code": "..." }` with exit code `1`.

Results are written through `writeOut()` (`src/helpers.ts`), which waits for the
flush before the process exits. A whole-roster `--format json` run is ~2 MB, and
a plain `process.stdout.write()` followed by `process.exit()` drops everything
still queued — truncating piped output at exactly 65536 bytes and emitting
invalid JSON. Keep any new stdout write going through `writeOut`.

## Search flags

| Flag | Alias | Description |
|------|-------|-------------|
| `--query` | `-q` | Keywords. Client-side, case-insensitive, all space-separated terms must match (title + department + location + description). |
| `--company` | `-c` | Restrict to one roster token. Repeatable. |
| `--provider` | | `greenhouse` \| `ashby` \| `lever`. |
| `--remote` | | Only postings the board marks remote. |
| `--location` | `-l` | Case-insensitive substring on the location field. |
| `--jobage` | | Posted within N days (Greenhouse `first_published`, Ashby `publishedAt`, Lever `createdAt`). |
| `--page` | | 1-indexed page. Default `1`. |
| `--limit` | `-n` | Page size / cap. Default `25`. |
| `--titles-only` | | Match titles + departments only; skips Greenhouse descriptions (~10× less data). |
| `--format` | | `json` \| `table` \| `plain`. |

Integer flags reject non-numeric, negative and fractional values with
`BAD_ARG`; `0` is valid. Validation runs before any network call.

## Quick examples

```bash
# US-remote ML engineering across the whole roster
bun run src/cli.ts search -q "machine learning engineer" --remote --limit 10 --format table

# Research roles at the frontier labs only
bun run src/cli.ts search -q "research scientist" -c anthropic -c openai -c cohere --format table

# Recent MLOps work
bun run src/cli.ts search -q "mlops kubernetes" --jobage 30 --format table

# German offices of US AI companies
bun run src/cli.ts search -q "computer vision" -l "Germany" --format plain

# One job's full description
bun run src/cli.ts detail greenhouse:anthropic:5286348008 --format plain
```

## Job ids

`search` emits a portable composite id, `<provider>:<companyToken>:<jobId>`, and
`detail` takes it back verbatim:

```
greenhouse:anthropic:5286348008
ashby:openai:1bf678c5-1058-45ca-b9bd-b0029fccd60e
lever:matchgroup:2196948b-9338-4943-acba-cb529335ed16
```

A job URL from `job-boards.greenhouse.io`, `jobs.ashbyhq.com` or `jobs.lever.co`
also works. A bare id without the provider prefix is rejected (`BAD_ID`).

## The roster

`../companies.json` lists the companies searched. Editing it is the intended
workflow — see `../SKILL.md` ("Adding a company") and `../url-reference.md` §6
for how to find and verify a company's ATS token.

## Tests

```bash
bun run typecheck   # tsc --noEmit, strict
bun test            # network-free: real captured fixtures + CLI contract
```

`tests/parsing.test.ts` runs the three provider parsers over trimmed but **real**
responses captured on 2026-08-05, and `tests/cli-contract.test.ts` covers flag
validation and the stderr error contract. Neither touches the network.

See `../SKILL.md` for the full flag reference and the portal quirks list.
