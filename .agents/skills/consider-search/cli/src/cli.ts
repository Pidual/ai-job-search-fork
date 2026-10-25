#!/usr/bin/env bun
// Self-contained CLI for the Consider-powered VC portfolio job boards
// (a16z, Sequoia, Lightspeed, Bessemer, GV, Greylock, Bain Capital Ventures,
// Kleiner Perkins, Battery, First Round, CRV).
//
// No API key, no account, no CSRF token, no cookies, no CLI framework, zero
// runtime dependencies — it runs anywhere `bun` is available.
//
// robots.txt on every roster host is `User-agent: * / Allow: /` and the repo gate
// (tools/robots_check.py) exits 0 for every URL shape this CLI emits, so there is
// no personal-use restriction to warn about. Contrast api.getro.com, a DIFFERENT
// portfolio-board provider, which is robots-DISALLOWED and deliberately absent.
//
// The roster lives in ../../boards.json and is meant to be edited.

import { runSearch, type SearchOpts } from "./commands/search.js"
import { runDetail, type DetailOpts } from "./commands/detail.js"
import { BOARDS_PATH, loadBoards, parseDetailId, writeError, writeOut, type Board } from "./helpers.js"

interface Flags {
  _: string[]
  [k: string]: string | boolean | string[]
}

/** Flags that never consume the following token. */
const BOOLEAN_FLAGS = new Set(["help", "h", "remote"])

/**
 * A leading `-` normally starts the next flag, but `-1` / `-1.5` is a value the
 * user meant to pass. Treating it as a flag would report `--limit -1` as
 * `got "true"` instead of `got "-1"`, hiding what was actually typed.
 */
const NEGATIVE_NUMBER = /^-\d+(?:\.\d+)?$/

/** Minimal parser. A repeated flag accumulates into an array (`--board` is repeatable). */
function parseFlags(argv: string[]): Flags {
  const flags: Flags = { _: [] }
  const alias: Record<string, string> = { q: "query", l: "location", n: "limit", b: "board" }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!
    if (a.startsWith("-") && !NEGATIVE_NUMBER.test(a)) {
      const key = alias[a.replace(/^-+/, "")] ?? a.replace(/^-+/, "")
      let value: string | boolean
      if (BOOLEAN_FLAGS.has(key)) {
        value = true
      } else {
        const next = argv[i + 1]
        const nextIsValue = next !== undefined && (!next.startsWith("-") || NEGATIVE_NUMBER.test(next))
        value = nextIsValue ? next! : true
        if (nextIsValue) i++
      }
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

const HELP = `consider-cli — search the VC portfolio job boards powered by Consider
(a16z, Sequoia, Lightspeed, Bessemer, GV, Greylock, Bain Capital Ventures,
Kleiner Perkins, Battery, First Round, CRV). No API key. No account.

USAGE
  bun run src/cli.ts search [flags]
  bun run src/cli.ts boards
  bun run src/cli.ts detail <board:company:jobId> [--format json|plain]

SEARCH FLAGS                                     (all filters are SERVER-SIDE)
  --query, -q <text>      Job-title keywords -> query.titlePrefix.
                          Matches anywhere in the title, not just the start.
  --board, -b <slug>      Restrict to one roster board. REPEATABLE.
                          e.g. -b andreessen-horowitz -b sequoia-capital
  --remote                Only postings the board marks remote -> query.remoteOnly.
  --location, -l <text>   Location. Resolved to Consider's canonical value via the
                          board's own autocomplete, then sent as query.locations.
                          e.g. "Berlin" -> "Berlin Area, Germany"; "Remote".
  --jobage <days>         Posted within N days -> query.postedSince ("P<N>D").
  --page <n>              1-indexed page over the merged, deduplicated result set.
                          Default 1.
  --limit, -n <n>         Page size. Default 25. page x limit is capped at 200
                          records per board (PAGE_TOO_DEEP beyond that).
  --format <fmt>          json (default) | table | plain.

BOARDS
  bun run src/cli.ts boards      List the roster (slug, host, name).

DETAIL
  <id> is the composite id every search result carries:
    <board-slug>:<company-slug>:<job-id>
  e.g. andreessen-horowitz:bighat-biosciences:ed9ce18f-e885-4052-8f9a-e10f952a460a
  All three segments are required — Consider has no fetch-job-by-id endpoint, so
  the company slug is what makes the lookup one cheap request.

  Consider's index does NOT carry job-posting body text. "detail" returns the full
  structured record (salary, seniority, skills, markets, years of experience) plus
  the employer's company profile; the posting text itself lives at the result "url".

EXAMPLES
  bun run src/cli.ts search -q "machine learning" --limit 10 --format table
  bun run src/cli.ts search -q "machine learning engineer" --remote --jobage 14 --format table
  bun run src/cli.ts search -q "AI Engineer" -l "Berlin" --format table
  bun run src/cli.ts search -q "research scientist" -b andreessen-horowitz -b sequoia-capital --format plain
  bun run src/cli.ts search -q "computer vision" --remote --limit 5 --format json
  bun run src/cli.ts detail andreessen-horowitz:bighat-biosciences:ed9ce18f-e885-4052-8f9a-e10f952a460a --format plain

The roster of boards searched is ${BOARDS_PATH} — edit it to track the funds you care about.
robots.txt allows every endpoint used here; keep volume low anyway.
`

/**
 * Strict integer-flag parser: rejects non-numeric, negative and fractional input,
 * and a flag given with no value (which parses as boolean true). Accepts "0".
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

function loadRoster(): Board[] | null {
  let boards: Board[]
  try {
    boards = loadBoards()
  } catch (e) {
    writeError(`could not read the board roster at ${BOARDS_PATH}: ${e instanceof Error ? e.message : String(e)}`, "NO_BOARDS")
    return null
  }
  if (boards.length === 0) {
    writeError(`the board roster at ${BOARDS_PATH} has no usable entries`, "NO_BOARDS")
    return null
  }
  return boards
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2)
  const flags = parseFlags(argv)
  const cmd = (flags._ as string[])[0]

  if (!cmd || flags.help || flags.h) {
    await writeOut(HELP)
    return cmd ? 0 : 1
  }

  if (cmd !== "search" && cmd !== "detail" && cmd !== "boards") {
    writeError(`Unknown command "${cmd}"`, "BAD_CMD")
    return 1
  }

  if (cmd === "boards") {
    const boards = loadRoster()
    if (!boards) return 1
    const fmt = typeof flags.format === "string" ? flags.format : "table"
    if (fmt === "json") {
      await writeOut(JSON.stringify({ meta: { count: boards.length, path: BOARDS_PATH }, results: boards }, null, 2) + "\n")
      return 0
    }
    await writeOut(boards.map((b) => `${b.slug.padEnd(24)} ${b.host.padEnd(28)} ${b.name}`).join("\n") + "\n")
    return 0
  }

  if (cmd === "search") {
    // Every flag is validated BEFORE any network call, so the contract tests never
    // touch the network.
    const numeric: Record<string, number | undefined> = {}
    for (const name of ["jobage", "page", "limit"]) {
      if (flags[name] === undefined) continue
      const value = parseIntFlag(name, flags[name])
      if (value === null) return 1
      numeric[name] = value
    }

    const wantedBoards = asStringList(flags.board as string | boolean | string[] | undefined)
    if (wantedBoards === null) {
      writeError('--board/-b needs a board slug, e.g. --board andreessen-horowitz', "BAD_ARG")
      return 1
    }

    if (flags.format !== undefined && typeof flags.format !== "string") {
      writeError('--format needs a value: json, table or plain', "BAD_ARG")
      return 1
    }
    if (flags.query !== undefined && typeof flags.query !== "string") {
      writeError('--query/-q needs a value, e.g. -q "machine learning"', "BAD_ARG")
      return 1
    }
    if (flags.location !== undefined && typeof flags.location !== "string") {
      writeError('--location/-l needs a value, e.g. -l "Berlin"', "BAD_ARG")
      return 1
    }

    const roster = loadRoster()
    if (!roster) return 1

    let boards = roster
    if (wantedBoards.length > 0) {
      const known = new Set(roster.map((b) => b.slug))
      const unknown = wantedBoards.filter((s) => !known.has(s))
      if (unknown.length > 0) {
        writeError(
          `unknown board slug(s): ${unknown.join(", ")}. Known slugs: ${roster.map((b) => b.slug).join(", ")}. ` +
            `Run "boards" to list the roster, and see boards.json for how to add one.`,
          "BAD_BOARD",
        )
        return 1
      }
      boards = roster.filter((b) => wantedBoards.includes(b.slug))
    }

    const page = numeric.page === undefined || numeric.page < 1 ? 1 : numeric.page
    const limit = numeric.limit === undefined ? 25 : numeric.limit
    if (limit === 0) {
      writeError("--limit 0 returns nothing; use a positive page size", "BAD_ARG")
      return 1
    }

    const fmt = typeof flags.format === "string" ? flags.format : "json"
    const opts: SearchOpts = {
      boards,
      query: typeof flags.query === "string" ? flags.query : undefined,
      location: typeof flags.location === "string" ? flags.location : undefined,
      remote: flags.remote === true,
      jobage: numeric.jobage,
      page,
      limit,
      format: (["json", "table", "plain"].includes(fmt) ? fmt : "json") as SearchOpts["format"],
    }
    return runSearch(opts)
  }

  // detail
  const rawId = (flags._ as string[])[1]
  if (!rawId) {
    writeError("detail requires an <id> of the form <board-slug>:<company-slug>:<job-id>", "NO_ID")
    return 1
  }
  const ref = parseDetailId(rawId)
  if (!ref) {
    writeError(
      `could not read a Consider job id out of "${rawId}" — it must be the composite id from ` +
        `search output: <board-slug>:<company-slug>:<job-id>, e.g. ` +
        `andreessen-horowitz:bighat-biosciences:ed9ce18f-e885-4052-8f9a-e10f952a460a`,
      "BAD_ID",
    )
    return 1
  }

  const roster = loadRoster()
  if (!roster) return 1
  const board = roster.find((b) => b.slug === ref.board)
  if (!board) {
    writeError(
      `unknown board slug "${ref.board}". Known slugs: ${roster.map((b) => b.slug).join(", ")}`,
      "BAD_BOARD",
    )
    return 1
  }

  const fmt = typeof flags.format === "string" ? flags.format : "json"
  const opts: DetailOpts = { ref, board, format: fmt === "plain" ? "plain" : "json" }
  return runDetail(opts)
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    writeError(e instanceof Error ? e.message : String(e), "INTERNAL_ERROR")
    process.exit(1)
  })
