#!/usr/bin/env bun
// Self-contained CLI for Jobicy's public remote-jobs JSON API. No external CLI
// framework and zero runtime dependencies, so it runs anywhere `bun` is
// available with no install beyond the repo clone.
//
// Personal use only. jobicy.com/robots.txt line 48 says `Disallow: /api/`, yet
// Jobicy publicly documents this same interface as a developer API (every
// payload carries `documentationUrl: https://jobi.cy/apidocs`). Those two
// signals conflict; keep volume low and treat this strictly as personal use.
//
// Attribution is contractual — the payload's `friendlyNotice` asks that Jobicy
// be credited with a direct link and that apply buttons point at the original
// job URL. It is echoed in every output format. Do not strip it.

import { NO_JOBAGE, normalizeGeo, validateQuery, writeError } from "./helpers.js"
import { runSearch, type SearchOpts } from "./commands/search.js"
import { runDetail, type DetailOpts } from "./commands/detail.js"

interface Flags {
  _: string[]
  [k: string]: string | boolean | string[]
}

function parseFlags(argv: string[]): Flags {
  const flags: Flags = { _: [] }
  const alias: Record<string, string> = {
    q: "query",
    n: "limit",
    // Jobicy's location knob is `geo`; -l/--location is accepted as an alias so
    // the flag name matches the other portal skills in this repo.
    l: "geo",
    location: "geo",
  }
  const named = (raw: string): string => alias[raw] ?? raw
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!
    if (a.startsWith("--") || a.startsWith("-")) {
      // `--flag=value` is bound inline, so it can never be silently ignored.
      const eq = a.indexOf("=")
      if (eq > 0) {
        flags[named(a.slice(0, eq).replace(/^-+/, ""))] = a.slice(eq + 1)
        continue
      }
      const key = named(a.replace(/^-+/, ""))
      const next = argv[i + 1]
      // A leading "-" normally marks the next flag, but a bare number is a
      // value: taking it lets `--limit -1` report `got "-1"` rather than the
      // misleading `got "true"` of a flag that looks like it had no value.
      const isValue = next !== undefined && (!next.startsWith("-") || /^-\d+(\.\d+)?$/.test(next))
      if (!isValue) {
        flags[key] = true
      } else {
        flags[key] = next
        i++
      }
    } else {
      ;(flags._ as string[]).push(a)
    }
  }
  return flags
}

const HELP = `jobicy-cli — search remote jobs on Jobicy's public API (working server-side keyword filter)

USAGE
  bun run src/cli.ts search [flags]
  bun run src/cli.ts detail <id|url> [--query <text>] [--geo <slug>] [--format json|plain]

SEARCH FLAGS
  --query, -q <text>      Keyword. SERVER-SIDE (maps to the API's \`tag\`) — the result
                          set is genuinely narrowed by Jobicy, not filtered locally.
                          Must be 3-50 characters: "AI"/"ML" are rejected upstream,
                          use "artificial intelligence" / "machine learning".
  --geo <slug>            Region slug: usa, germany, europe, uk, canada, emea, apac, …
                          (-l/--location are accepted aliases). Case and spaces are
                          normalised ("New Zealand" -> new-zealand) and common names
                          are mapped ("Deutschland" -> germany, "United Kingdom" -> uk).
                          "anywhere" is REJECTED by the API — omit --geo for worldwide.
  --industry <slug>       Industry slug: data-science, engineering, admin (DevOps),
                          cybersecurity, design-multimedia, …
  --jobage <days>         Posted within N days (client-side on pubDate). 0 = today.
  --page <n>              1-indexed page. Client-side slice — the API has NO paging,
                          so page*limit must stay within the 100-row response.
  --limit, -n <n>         Results per page. Maps to \`count\`, clamped to 100 by the API;
                          the clamp is reported in meta.limitClamped.
  --format <fmt>          json (default) | table | plain.

DETAIL
  Jobicy has no per-job endpoint, so \`detail\` re-runs a list query and selects by id.
  It accepts --query/--geo/--industry/--limit: pass the SAME values you used for the
  search that produced the id and it resolves in a single request. Jobicy caches every
  \`count\` value in its own bucket with its own freshness, so a different --limit can
  return a different job set.
  When the id is outside that listing window — normal for anything more than a day or
  two old — \`detail\` falls back to the public job page (https://jobicy.com/jobs/<id>-…)
  and reads its schema.org JobPosting JSON-LD, so a bare \`detail <id>\` always works.
  meta.resolvedVia reports which path answered ("api-listing" or "job-page").

EXAMPLES
  bun run src/cli.ts search -q "machine learning" --geo usa --limit 5 --format table
  bun run src/cli.ts search -q "machine learning engineer" --geo germany --jobage 14 --format table
  bun run src/cli.ts search -q "computer vision" --industry data-science --format plain
  bun run src/cli.ts detail 143131 -q "machine learning" --geo usa --limit 5 --format plain

Personal use only — robots.txt disallows /api/ while Jobicy documents it publicly.
Keep volume low. Credit Jobicy (https://jobicy.com) and link apply buttons to the job URL.
`

/**
 * Strict integer flag parsing: rejects non-numeric, negative and fractional
 * input (and a flag given with no value, which parses as boolean true).
 * `0` is valid even though it is falsy.
 */
function parseIntFlag(name: string, raw: unknown): number | null {
  const s = String(raw)
  if (!/^\d+$/.test(s)) {
    writeError(`--${name} must be a non-negative integer, got "${s}"`, "BAD_ARG")
    return null
  }
  return parseInt(s, 10)
}

function str(v: string | boolean | string[] | undefined): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2)
  const flags = parseFlags(argv)
  const cmd = (flags._ as string[])[0]

  if (!cmd || flags.help || flags.h) {
    process.stdout.write(HELP)
    return cmd ? 0 : 1
  }

  if (cmd === "search") {
    // Validate every integer flag BEFORE any network call.
    let jobage = NO_JOBAGE
    if (flags.jobage !== undefined) {
      const v = parseIntFlag("jobage", flags.jobage)
      if (v === null) return 1
      jobage = v
    }
    let page = 1
    if (flags.page !== undefined) {
      const v = parseIntFlag("page", flags.page)
      if (v === null) return 1
      page = Math.max(1, v)
    }
    let limit: number | undefined
    if (flags.limit !== undefined) {
      const v = parseIntFlag("limit", flags.limit)
      if (v === null) return 1
      limit = v
    }

    const queryError = validateQuery(str(flags.query))
    if (queryError) {
      writeError(queryError, "BAD_ARG")
      return 1
    }

    const fmt = str(flags.format) ?? "json"
    const opts: SearchOpts = {
      query: str(flags.query),
      geo: normalizeGeo(str(flags.geo)),
      industry: str(flags.industry),
      jobage,
      page,
      limit,
      format: (["json", "table", "plain"].includes(fmt) ? fmt : "json") as SearchOpts["format"],
    }
    return runSearch(opts)
  }

  if (cmd === "detail") {
    const id = (flags._ as string[])[1]
    if (!id) {
      writeError("detail requires an <id|url>", "NO_ID")
      return 1
    }
    // Validated before any network call, exactly as on `search`.
    let limit: number | undefined
    if (flags.limit !== undefined) {
      const v = parseIntFlag("limit", flags.limit)
      if (v === null) return 1
      limit = v
    }
    const queryError = validateQuery(str(flags.query))
    if (queryError) {
      writeError(queryError, "BAD_ARG")
      return 1
    }
    const fmt = str(flags.format) ?? "json"
    const opts: DetailOpts = {
      id,
      query: str(flags.query),
      geo: normalizeGeo(str(flags.geo)),
      industry: str(flags.industry),
      limit,
      format: fmt === "plain" ? "plain" : "json",
    }
    return runDetail(opts)
  }

  writeError(`Unknown command "${cmd}"`, "BAD_CMD")
  return 1
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    writeError(e instanceof Error ? e.message : String(e), "INTERNAL_ERROR")
    process.exit(1)
  })
