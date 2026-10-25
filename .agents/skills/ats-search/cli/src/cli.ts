#!/usr/bin/env bun
// Self-contained CLI for searching the PUBLIC applicant-tracking-system job
// boards (Greenhouse, Ashby, Lever) of a curated roster of AI companies.
// No API key, no authentication, no attribution requirement, and no external
// CLI framework — it runs anywhere `bun` is available.
//
// The roster lives in ../../companies.json and is meant to be edited: it is the
// list of companies you personally track.

import { runSearch, type SearchOpts } from "./commands/search.js"
import { runDetail, type DetailOpts } from "./commands/detail.js"
import {
  COMPANIES_PATH,
  PROVIDERS,
  loadCompanies,
  writeError,
  writeOut,
  type Company,
  type Provider,
} from "./helpers.js"

interface Flags {
  _: string[]
  [k: string]: string | boolean | string[]
}

/**
 * A leading `-` normally starts the next flag, but `-1` / `-1.5` is a value the
 * user meant to pass. Treating it as a flag would report `--limit -1` as
 * `got "true"` instead of `got "-1"`, hiding what was actually typed.
 */
const NEGATIVE_NUMBER = /^-\d+(\.\d+)?$/

/**
 * Minimal flag parser. A repeated flag accumulates into an array so
 * `--company anthropic --company openai` restricts the fan-out to both.
 */
function parseFlags(argv: string[]): Flags {
  const flags: Flags = { _: [] }
  const alias: Record<string, string> = { q: "query", l: "location", n: "limit", c: "company" }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!
    if ((a.startsWith("--") || a.startsWith("-")) && !NEGATIVE_NUMBER.test(a)) {
      const key = alias[a.replace(/^-+/, "")] ?? a.replace(/^-+/, "")
      const next = argv[i + 1]
      const isFlag = next !== undefined && next.startsWith("-") && !NEGATIVE_NUMBER.test(next)
      const value: string | boolean = next === undefined || isFlag ? true : next
      if (value !== true) i++
      const existing = flags[key]
      if (existing === undefined) {
        flags[key] = value
      } else if (Array.isArray(existing)) {
        if (typeof value === "string") existing.push(value)
      } else if (typeof existing === "string" && typeof value === "string") {
        flags[key] = [existing, value]
      } else {
        flags[key] = value
      }
    } else {
      ;(flags._ as string[]).push(a)
    }
  }
  return flags
}

const HELP = `ats-cli — search the public ATS job boards (Greenhouse / Ashby / Lever)
of a curated roster of AI companies. No API key, no attribution required.

USAGE
  bun run src/cli.ts search [flags]
  bun run src/cli.ts detail <id|url> [--format json|plain]

SEARCH FLAGS
  --query, -q <text>      Keywords. Client-side, case-insensitive; every
                          space-separated term must match (title + department +
                          description). e.g. -q "machine learning engineer"
  --company, -c <token>   Restrict to one roster company. Repeatable.
  --provider <name>       greenhouse | ashby | lever. Restrict by ATS provider.
  --remote                Only jobs the board marks remote (Ashby isRemote /
                          Lever workplaceType; location text elsewhere).
  --location, -l <text>   Client-side substring match on the location field.
  --jobage <days>         Posted within N days (client-side, on the posting date).
  --page <n>              1-indexed page. Default 1.
  --limit, -n <n>         Page size / cap on results emitted. Default 25.
  --titles-only           Match titles + departments only, and skip Greenhouse
                          descriptions (~10x less data, much faster).
  --format <fmt>          json (default) | table | plain.

DETAIL
  <id> is the composite id from search results: <provider>:<token>:<jobId>
  e.g. greenhouse:anthropic:4610158008 · ashby:openai:240d459b-...
  A job URL also works (job-boards.greenhouse.io, jobs.ashbyhq.com, jobs.lever.co).

EXAMPLES
  bun run src/cli.ts search -q "machine learning engineer" --remote --limit 10 --format table
  bun run src/cli.ts search -q "research scientist" -c anthropic -c openai --format table
  bun run src/cli.ts search -q "mlops" --provider greenhouse --jobage 30 --format table
  bun run src/cli.ts search -q "computer vision" -l "Berlin" --format plain
  bun run src/cli.ts detail greenhouse:anthropic:4610158008 --format plain

The roster of companies searched is ${COMPANIES_PATH}
— edit it to track the companies you care about.
`

/**
 * Strict integer-flag parser: rejects non-numeric, negative and fractional
 * input, and a flag given with no value (which parses as boolean true).
 * Accepts "0".
 */
function parseIntFlag(name: string, raw: unknown): number | null {
  const s = String(raw)
  if (!/^\d+$/.test(s)) {
    writeError(`--${name} must be a non-negative integer, got "${s}"`, "BAD_ARG")
    return null
  }
  return parseInt(s, 10)
}

function asStringList(value: string | boolean | string[] | undefined): string[] | null {
  if (value === undefined) return []
  if (Array.isArray(value)) return value
  if (typeof value === "string") return [value]
  return null // boolean true -> flag given with no value
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2)
  const flags = parseFlags(argv)
  const cmd = (flags._ as string[])[0]

  if (!cmd || flags.help || flags.h) {
    await writeOut(HELP)
    return cmd ? 0 : 1
  }

  if (cmd !== "search" && cmd !== "detail") {
    writeError(`Unknown command "${cmd}"`, "BAD_CMD")
    return 1
  }

  // ---- flag validation happens BEFORE any roster read or network call ----

  if (cmd === "search") {
    let jobage: number | undefined
    let page = 1
    let limit: number | undefined

    if (flags.jobage !== undefined) {
      const v = parseIntFlag("jobage", flags.jobage)
      if (v === null) return 1
      jobage = v
    }
    if (flags.page !== undefined) {
      const v = parseIntFlag("page", flags.page)
      if (v === null) return 1
      page = Math.max(1, v)
    }
    if (flags.limit !== undefined) {
      const v = parseIntFlag("limit", flags.limit)
      if (v === null) return 1
      limit = v
    }

    let provider: Provider | undefined
    if (flags.provider !== undefined) {
      const raw = String(flags.provider).toLowerCase()
      if (!(PROVIDERS as string[]).includes(raw)) {
        writeError(
          `--provider must be one of ${PROVIDERS.join(", ")}, got "${flags.provider}"`,
          "BAD_ARG",
        )
        return 1
      }
      provider = raw as Provider
    }

    const only = asStringList(flags.company)
    if (only === null) {
      writeError('--company requires a company token, e.g. --company anthropic', "BAD_ARG")
      return 1
    }

    const fmt = typeof flags.format === "string" ? flags.format : "json"

    let companies: Company[]
    try {
      companies = loadCompanies()
    } catch (e) {
      writeError(
        `Could not read the company roster at ${COMPANIES_PATH}: ${e instanceof Error ? e.message : String(e)}`,
        "ROSTER_FAILED",
      )
      return 1
    }
    if (companies.length === 0) {
      writeError(`The company roster at ${COMPANIES_PATH} has no valid entries`, "ROSTER_EMPTY")
      return 1
    }

    const known = new Set(companies.map((c) => c.token))
    const unknown = only.filter((t) => !known.has(t))
    if (unknown.length > 0) {
      writeError(
        `unknown --company token(s): ${unknown.join(", ")}. ` +
          `Known tokens: ${[...known].sort().join(", ")}`,
        "UNKNOWN_COMPANY",
      )
      return 1
    }

    const opts: SearchOpts = {
      query: typeof flags.query === "string" ? flags.query : undefined,
      companies,
      only,
      provider,
      remote: flags.remote !== undefined && flags.remote !== "false",
      location: typeof flags.location === "string" ? flags.location : undefined,
      jobage,
      page,
      limit,
      titlesOnly: flags["titles-only"] !== undefined && flags["titles-only"] !== "false",
      format: (["json", "table", "plain"].includes(fmt) ? fmt : "json") as SearchOpts["format"],
    }
    return runSearch(opts)
  }

  const id = (flags._ as string[])[1]
  if (!id) {
    writeError("detail requires an <id|url>", "NO_ID")
    return 1
  }
  const fmt = typeof flags.format === "string" ? flags.format : "json"

  let companies: Company[] = []
  try {
    companies = loadCompanies()
  } catch {
    // The roster only supplies a display name here; detail works without it.
    companies = []
  }

  const opts: DetailOpts = {
    id,
    companies,
    format: (fmt === "plain" ? "plain" : "json") as DetailOpts["format"],
  }
  return runDetail(opts)
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    process.stderr.write(
      JSON.stringify({
        error: e instanceof Error ? e.message : String(e),
        code: "INTERNAL_ERROR",
      }) + "\n",
    )
    process.exit(1)
  })
