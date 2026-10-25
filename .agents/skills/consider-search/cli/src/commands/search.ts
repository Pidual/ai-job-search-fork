import {
  MAX_CONCURRENCY,
  MAX_PAGE_SIZE,
  MAX_RECORDS_PER_BOARD,
  autocompleteUrl,
  buildAutocompleteBody,
  buildQuery,
  buildSearchBody,
  locationCandidates,
  mapConcurrent,
  pageResults,
  parseJobs,
  parseLocationSuggestions,
  parseSearchResponse,
  pickLocation,
  postJson,
  searchJobsUrl,
  writeError,
  writeOut,
  type Board,
  type JobResult,
} from "../helpers.js"

export interface SearchOpts {
  boards: Board[]
  query?: string | undefined
  location?: string | undefined
  remote?: boolean | undefined
  jobage?: number | undefined
  page: number
  limit: number
  format: "json" | "table" | "plain"
}

export interface BoardError {
  board: string
  host: string
  error: string
}

interface BoardOutcome {
  board: Board
  jobs: JobResult[]
  total: number | null
  error: BoardError | null
}

/**
 * Fetch up to `want` records from one board, following `meta.sequence` cursors in
 * pages of at most MAX_PAGE_SIZE. Never throws: a board that fails is reported and
 * the fan-out continues.
 */
async function fetchBoard(
  board: Board,
  query: Record<string, unknown>,
  want: number,
  now: Date,
): Promise<BoardOutcome> {
  const jobs: JobResult[] = []
  let total: number | null = null
  let sequence: string | null = null

  try {
    while (jobs.length < want) {
      const size = Math.min(MAX_PAGE_SIZE, want - jobs.length)
      const raw = await postJson(searchJobsUrl(board.host), buildSearchBody(board.slug, query, size, sequence))
      if (raw === null) {
        return { board, jobs, total, error: { board: board.slug, host: board.host, error: "endpoint returned 404" } }
      }
      const parsed = parseSearchResponse(raw)
      if (parsed.errors.length > 0) {
        return {
          board,
          jobs,
          total,
          error: { board: board.slug, host: board.host, error: parsed.errors.join("; ") },
        }
      }
      if (total === null) total = parsed.total
      jobs.push(...parseJobs(parsed.jobs, board, now))
      // No cursor, or a short page: the board is exhausted.
      if (!parsed.sequence || parsed.jobs.length === 0 || parsed.jobs.length < size) break
      sequence = parsed.sequence
    }
  } catch (e) {
    return {
      board,
      jobs,
      total,
      error: { board: board.slug, host: board.host, error: e instanceof Error ? e.message : String(e) },
    }
  }

  return { board, jobs, total, error: null }
}

/**
 * Resolve `--location` to Consider's canonical value using the first selected
 * board's autocomplete. One request for a plain-ASCII input; a German endonym
 * costs a second one for its English exonym (Consider's vocabulary is English:
 * "München" returns nothing, "Munich" returns "Munich Area, Germany" / 61 jobs).
 * The resolved value is reused across the whole fan-out.
 */
async function resolveLocation(
  board: Board,
  wanted: string,
): Promise<{ value: string; label: string; count: number } | null> {
  for (const candidate of locationCandidates(wanted)) {
    const raw = await postJson(
      autocompleteUrl(board.host, "locations"),
      buildAutocompleteBody(board.slug, candidate),
    )
    if (raw === null) continue
    const picked = pickLocation(parseLocationSuggestions(raw), candidate)
    if (picked) return picked
  }
  return null
}

function pad(s: string, n: number): string {
  const t = s.length > n - 1 ? s.slice(0, n - 2) + "…" : s
  return t + " ".repeat(Math.max(1, n - t.length))
}

function salaryLabel(r: JobResult): string {
  if (r.salaryMin === null && r.salaryMax === null) return "-"
  const cur = r.salaryCurrency ?? ""
  const k = (v: number): string => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))
  const range =
    r.salaryMin !== null && r.salaryMax !== null
      ? `${k(r.salaryMin)}-${k(r.salaryMax)}`
      : k((r.salaryMin ?? r.salaryMax) as number)
  return `${cur ? `${cur} ` : ""}${range}`.trim()
}

export function renderTable(rows: JobResult[]): string {
  if (rows.length === 0) return "No results.\n"
  const head =
    pad("DATE", 12) +
    pad("TITLE", 46) +
    pad("COMPANY", 22) +
    pad("LOCATION", 26) +
    pad("REM", 5) +
    pad("SALARY", 14) +
    "ID\n"
  const sep = "-".repeat(150) + "\n"
  const body = rows
    .map(
      (r) =>
        pad(r.date ?? "-", 12) +
        pad(r.title ?? "-", 46) +
        pad(r.company ?? "-", 22) +
        pad(r.location ?? "-", 26) +
        pad(r.remote ? "yes" : r.hybrid ? "hyb" : "no", 5) +
        pad(salaryLabel(r), 14) +
        r.id,
    )
    .join("\n")
  return head + sep + body + "\n"
}

export function renderPlain(rows: JobResult[]): string {
  if (rows.length === 0) return "No results.\n"
  return (
    rows
      .map((r) =>
        [
          r.title ?? "(untitled)",
          `  ${r.company ?? "(unknown company)"} — ${r.location ?? "(unknown location)"}`,
          `  posted: ${r.date ?? "unknown"}${r.postedSince ? ` (${r.postedSince} ago)` : ""}` +
            `${r.remote ? " · remote" : ""}${r.hybrid ? " · hybrid" : ""}` +
            `${r.salaryMin !== null || r.salaryMax !== null ? ` · ${salaryLabel(r)}/${r.salaryPeriod ?? "?"}` : ""}`,
          `  via: ${r.boards.join(", ")}`,
          r.seniority.length ? `  seniority: ${r.seniority.join(", ")}` : "",
          r.skills.length ? `  skills: ${r.skills.slice(0, 12).join(", ")}` : "",
          `  ${r.url}`,
          `  id: ${r.id}`,
        ]
          .filter(Boolean)
          .join("\n"),
      )
      .join("\n\n") + "\n"
  )
}

export async function runSearch(opts: SearchOpts): Promise<number> {
  const want = opts.page * opts.limit
  if (want > MAX_RECORDS_PER_BOARD) {
    writeError(
      `--page ${opts.page} × --limit ${opts.limit} would pull ${want} records from each of ` +
        `${opts.boards.length} boards; this CLI caps at ${MAX_RECORDS_PER_BOARD} per board to keep ` +
        `request volume low. Narrow with --query/--location/--remote/--jobage, or select fewer boards ` +
        `with --board.`,
      "PAGE_TOO_DEEP",
    )
    return 1
  }

  const now = new Date()
  let locationValue: string | null = null
  let locationLabel: string | null = null

  if (opts.location) {
    const first = opts.boards[0]!
    let picked: { value: string; label: string; count: number } | null
    try {
      picked = await resolveLocation(first, opts.location)
    } catch (e) {
      writeError(
        `could not resolve --location "${opts.location}": ${e instanceof Error ? e.message : String(e)}`,
        "FETCH_FAILED",
      )
      return 1
    }
    if (!picked) {
      writeError(
        `--location "${opts.location}" does not match any location Consider knows ` +
          `(tried: ${locationCandidates(opts.location).map((c) => `"${c}"`).join(", ")}). ` +
          `Consider's place names are ENGLISH exonyms — use "Munich", not "München"; ` +
          `"Cologne", not "Köln"; "Vienna", not "Wien". Canonical values look like ` +
          `"San Francisco, California", "Berlin Area, Germany", "Germany", "United States". ` +
          `Try a broader term.`,
        "BAD_LOCATION",
      )
      return 1
    }
    locationValue = picked.value
    locationLabel = picked.label
  }

  const query = buildQuery({
    query: opts.query,
    location: locationValue ?? undefined,
    remote: opts.remote,
    jobage: opts.jobage,
  })

  const outcomes = await mapConcurrent(opts.boards, MAX_CONCURRENCY, (board) =>
    fetchBoard(board, query, want, now),
  )

  const errors: BoardError[] = []
  // One entry per board, in the board's own arrival order — pageResults() slices
  // these lists to reconstruct the shallower pages, so order and arity matter.
  const perBoard: JobResult[][] = []
  const totals: Record<string, number | null> = {}
  for (const o of outcomes) {
    if (o.error) errors.push(o.error)
    perBoard.push(o.jobs)
    totals[o.board.slug] = o.total
  }

  // Every board failing is a real failure, not an empty result set.
  if (errors.length === opts.boards.length) {
    writeError(
      `all ${opts.boards.length} board(s) failed: ${errors.map((e) => `${e.board}: ${e.error}`).join(" | ")}`,
      "FETCH_FAILED",
    )
    return 1
  }

  // NOT a slice of the deepest merge — see pageResults(): the boards rank by
  // relevance while this list is shown newest-first, so a naive slice repeats
  // rows across pages and silently drops others.
  const { results, universe: merged } = pageResults(perBoard, opts.page, opts.limit)

  if (opts.format === "table") {
    await writeOut(renderTable(results))
    for (const e of errors) process.stderr.write(`warning: board ${e.board} (${e.host}) failed: ${e.error}\n`)
    return 0
  }
  if (opts.format === "plain") {
    await writeOut(renderPlain(results))
    for (const e of errors) process.stderr.write(`warning: board ${e.board} (${e.host}) failed: ${e.error}\n`)
    return 0
  }

  await writeOut(
    JSON.stringify(
      {
        meta: {
          count: results.length,
          page: opts.page,
          limit: opts.limit,
          query: opts.query ?? null,
          location: opts.location ?? null,
          locationResolved: locationValue,
          locationLabel,
          remote: opts.remote === true,
          jobage: opts.jobage ?? null,
          serverSideFilters: Object.keys(query),
          boardsSearched: opts.boards.map((b) => b.slug),
          boardsFailed: errors.length,
          totalsPerBoard: totals,
          mergedBeforePaging: merged.length,
          duplicatesCollapsed: perBoard.reduce((n, l) => n + l.length, 0) - merged.length,
          errors,
          note:
            "Every filter here is applied SERVER-SIDE by Consider. Results from all boards are " +
            "deduplicated on jobId and sorted newest-first; `boards` lists every roster board " +
            "carrying the posting. Consider's index has no job description — follow `url` for it.",
        },
        results,
      },
      null,
      2,
    ) + "\n",
  )
  return 0
}
