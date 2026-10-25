// Data source: Consider (consider.com) — the SaaS that powers the portfolio job
// boards of a16z, Sequoia, Lightspeed, Bessemer, Greylock, GV and peers. Every
// board runs the same application on the fund's OWN domain, so one client speaks
// to all of them. No API key, no account, no CSRF token, no cookies.
//
// ────────────────────────────────────────────────────────────────────────────────
// THE ENDPOINT
//
//   POST https://<host>/api-boards/search-jobs
//   Content-Type: application/json
//   {
//     "meta":  { "size": 25, "sequence": "<cursor from the previous response>" },
//     "board": { "id": "<board slug>", "isParent": true },
//     "query": { "titlePrefix": "machine learning", "remoteOnly": true, ... },
//     "grouped": false
//   }
//
// The body shape is NOT guesswork: it is what the board's own frontend sends.
// Read it out of the bundle at https://jobs.a16z.com/mendel/<hash>/boards —
// module `boards/actions/search-jobs` does literally
//   request.post("/api-boards/search-jobs").send({meta, board, query, grouped, parentSlug})
// and `nextJobs` re-sends the response's own `meta` (which carries `sequence`) to
// page forward. Every `query` key below was read from the same bundle
// (`shared-no-variations/job-query-for-user-fields` and the `param:"…"` props of
// the job-list filter inputs) and then confirmed live against a16z on 2026-08-05.
//
// ⚠️ THE TRAP: the backend IGNORES UNKNOWN `query` KEYS SILENTLY. A misspelled or
// invented filter does not 4xx — it drops out, and you get the WHOLE BOARD back
// (a16z: `total` 15909) looking like a wildly successful search. That is why
// buildQuery() below whitelists keys instead of spreading user input, and why
// `--jobage 3` is formatted as ISO-8601 `P3D`: sending the bare string "3" is
// accepted and returns `total 0`. Verified both, live.
// ────────────────────────────────────────────────────────────────────────────────
//
// Zero runtime dependencies: plain `fetch` + JSON. No HTML parsing anywhere.

import { readFileSync } from "node:fs"
import { join } from "node:path"

/** Roster file lives at the skill root, next to SKILL.md — one level above cli/. */
export const BOARDS_PATH = join(import.meta.dir, "..", "..", "boards.json")

/**
 * The fork's honest User-Agent. Consider does not fingerprint clients: every host
 * in the roster answered 200 to this exact string on 2026-08-05, on all three
 * endpoints. NO BROWSER IMPERSONATION — and none is needed here.
 */
export const USER_AGENT =
  "ai-job-search/1.0 (+https://github.com/MadsLorentzen/ai-job-search) personal-job-search"

/** Responses are small JSON (a 100-job page is ~250 KB), so 20 s is generous. */
export const REQUEST_TIMEOUT_MS = 20000

/** Politeness cap on parallel board fetches. Eleven boards, four at a time. */
export const MAX_CONCURRENCY = 4

/** The API accepts `meta.size` up to at least 100 (verified). Its own UI caps at 50. */
export const MAX_PAGE_SIZE = 100

/**
 * Hard cap on how deep `--page`/`--limit` may reach into ONE board before this CLI
 * refuses. Each 100 records costs one request per board, so `--page 3 --limit 50`
 * would be 2 requests × 11 boards = 22. Beyond 200 records/board, narrow the query.
 */
export const MAX_RECORDS_PER_BOARD = 200

export function writeError(error: string, code: string): void {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
}

/**
 * Write to stdout and wait until the bytes have actually left the process.
 *
 * `process.stdout.write()` only queues once the OS pipe buffer (64 KB) is full and
 * `process.exit()` discards whatever is still queued — so a naive write truncates
 * any piped result set larger than one buffer at exactly 65536 bytes, silently
 * emitting invalid JSON. Resolving on the write callback makes the following exit
 * safe; resolving on `error` too means `| head` ends the command instead of hanging.
 */
export function writeOut(text: string): Promise<void> {
  return new Promise((resolve) => {
    process.stdout.once("error", () => resolve())
    process.stdout.write(text, () => resolve())
  })
}

/* ─────────────────────────────── The roster ─────────────────────────────── */

export interface Board {
  slug: string
  host: string
  name: string
}

/**
 * Parse boards.json. Accepts `{ "boards": [...] }` or a bare array, and skips
 * malformed entries rather than rejecting the whole file, so one typo in a
 * user-edited roster does not disable the skill.
 *
 * `host` is validated as a bare hostname: the roster is the only thing that
 * decides which origin this CLI talks to, so a stray "https://…/path" or an
 * embedded credential must never become a request URL.
 */
export function parseBoards(raw: unknown): Board[] {
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object" && Array.isArray((raw as { boards?: unknown }).boards)
      ? (raw as { boards: unknown[] }).boards
      : []
  const out: Board[] = []
  for (const entry of list) {
    if (!entry || typeof entry !== "object") continue
    const e = entry as Record<string, unknown>
    const slug = typeof e.slug === "string" ? e.slug.trim() : ""
    const host = typeof e.host === "string" ? e.host.trim().toLowerCase() : ""
    if (!slug || !host) continue
    if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(host)) continue
    out.push({
      slug,
      host,
      name: typeof e.name === "string" && e.name.trim() ? e.name.trim() : slug,
    })
  }
  return out
}

export function loadBoards(path: string = BOARDS_PATH): Board[] {
  return parseBoards(JSON.parse(readFileSync(path, "utf-8")) as unknown)
}

/* ────────────────────────────── Endpoint URLs ───────────────────────────── */

export function searchJobsUrl(host: string): string {
  return `https://${host}/api-boards/search-jobs`
}

export function searchCompaniesUrl(host: string): string {
  return `https://${host}/api-boards/search-companies`
}

export function autocompleteUrl(host: string, param: string): string {
  return `https://${host}/api-boards/autocomplete/${encodeURIComponent(param)}`
}

/* ─────────────────────────────── HTTP layer ─────────────────────────────── */

/**
 * POST JSON with exponential backoff on 429/5xx. Returns `null` on 404 (spec §5:
 * an empty result, never a crash).
 *
 * NOTE ON 500s: Consider answers HTTP 500 for a malformed body too (a missing
 * `meta` key produces `{"errors":[{"code":"BOARDS_JOBS_ERROR", …}]}`), and this
 * loop will dutifully retry it six times. That is deliberate — the alternative is
 * parsing the error body to guess intent — but it means a body-shape regression
 * shows up as a slow failure. If every board suddenly takes ~30 s to fail, check
 * the request body against url-reference.md before blaming the network.
 */
export async function postJson(url: string, body: unknown): Promise<unknown | null> {
  const maxRetries = 6
  let delay = 500
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "User-Agent": USER_AGENT,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
      redirect: "follow",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    if (response.status === 429 || response.status >= 500) {
      if (attempt === maxRetries) {
        throw new Error(`Request failed: ${response.status} ${response.statusText}`)
      }
      const jitter = Math.floor(Math.random() * 500)
      await new Promise((r) => setTimeout(r, delay + jitter))
      delay = Math.min(delay * 2, 8000)
      continue
    }
    if (response.status === 404) return null
    if (!response.ok) {
      throw new Error(`Request failed: ${response.status} ${response.statusText}`)
    }
    return (await response.json()) as unknown
  }
  throw new Error("Request failed after max retries")
}

/** Run `worker` over `items` with at most `limit` in flight, preserving order. */
export async function mapConcurrent<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  const runners = new Array(Math.max(1, Math.min(limit, items.length))).fill(0).map(async () => {
    for (;;) {
      const i = next++
      if (i >= items.length) return
      results[i] = await worker(items[i]!)
    }
  })
  await Promise.all(runners)
  return results
}

/* ───────────────────────────── Untrusted content ────────────────────────── */

/**
 * Job/company free text is untrusted third-party input and is known to carry
 * prompt-injection payloads aimed at LLM readers. Neutralise the markers an agent
 * might act on, and fence the result so a downstream model treats it as data,
 * never as instructions.
 *
 * Applied to BOTH the company description and every job `title`. Titles are short,
 * but they are attacker-controllable free text that lands in an agent's context
 * exactly like a description does, and none of the patterns stripped here
 * (`**`, `system:`, `<instructions>`, "ignore previous instructions") ever appears
 * in a legitimate job title.
 */
export function sanitizeDescription(text: string | null): string | null {
  if (!text) return null
  return (
    text
      // collapse emphasis used to make injected keywords salient
      .replace(/\*{2,}/g, "")
      // defang anything shaped like an instruction to an assistant
      .replace(
        /\b(ignore|disregard|forget)\s+(all\s+|any\s+|the\s+)?(previous|prior|above)\s+instructions?/gi,
        "[redacted-injection]",
      )
      .replace(/\b(system|assistant|developer)\s*:/gi, "$1​:")
      .replace(/<\/?(system|instructions?|prompt)>/gi, "")
      .trim() || null
  )
}

/* ──────────────────────────── Query construction ────────────────────────── */

export interface QueryOpts {
  query?: string | undefined
  location?: string | undefined
  remote?: boolean | undefined
  jobage?: number | undefined
}

/**
 * Build the `query` object. EVERY key here is server-side and was confirmed live
 * against a16z on 2026-08-05:
 *
 *   titlePrefix "machine learning"          -> total  153   (nonsense -> 0)
 *   + remoteOnly true                       -> total   27
 *   + postedSince "P7D"                     -> total    4
 *   locations ["Berlin Area, Germany"]      -> total   80
 *
 * Whitelisting matters: unknown keys are dropped by the backend, so a typo turns a
 * filtered search into "return the entire board" (15909 records) with HTTP 200.
 *
 * `locations` takes a bare string ARRAY of Consider's canonical location values
 * ("San Francisco, California", "Berlin Area, Germany"). Passing the frontend's
 * `{label, value}` objects instead makes the endpoint 500 — verified.
 */
export function buildQuery(opts: QueryOpts): Record<string, unknown> {
  const q: Record<string, unknown> = {}
  const title = opts.query?.trim()
  if (title) q.titlePrefix = title
  if (opts.location) q.locations = [opts.location]
  if (opts.remote) q.remoteOnly = true
  if (opts.jobage !== undefined) q.postedSince = `P${opts.jobage}D`
  return q
}

export function buildSearchBody(
  boardSlug: string,
  query: Record<string, unknown>,
  size: number,
  sequence: string | null,
): Record<string, unknown> {
  const meta: Record<string, unknown> = { size }
  if (sequence) meta.sequence = sequence
  return {
    meta,
    board: { id: boardSlug, isParent: true },
    query,
    grouped: false,
    parentSlug: boardSlug,
  }
}

/* ───────────────────────────── Response parsing ─────────────────────────── */

interface LabelValue {
  id?: unknown
  label?: unknown
  value?: unknown
}

export interface RawSearchResponse {
  jobs: unknown[]
  total: number | null
  sequence: string | null
  errors: string[]
}

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v)
}

function str(v: unknown): string | null {
  if (typeof v !== "string") return null
  const t = v.trim()
  return t || null
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null
}

/** Pull the `label` (falling back to `value`/`id`) out of Consider's `{id,label,value}` chips. */
export function labels(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  const out: string[] = []
  for (const item of v) {
    if (typeof item === "string") {
      const s = item.trim()
      if (s && !out.includes(s)) out.push(s)
      continue
    }
    if (!isObj(item)) continue
    const lv = item as LabelValue
    const s = str(lv.label) ?? str(lv.value) ?? str(lv.id)
    if (s && !out.includes(s)) out.push(s)
  }
  return out
}

/**
 * Unwrap the envelope. Consider always answers 200 with
 * `{version, jobs, meta, availableFilters, total, errors, debug}` — even for a
 * server-side failure, which arrives as a populated `errors[]` and `jobs: []`.
 * So "HTTP 200" is NOT success; `errors` has to be read.
 */
export function parseSearchResponse(raw: unknown): RawSearchResponse {
  if (!isObj(raw)) return { jobs: [], total: null, sequence: null, errors: ["malformed response"] }
  const errors: string[] = []
  if (Array.isArray(raw.errors)) {
    for (const e of raw.errors) {
      if (typeof e === "string") errors.push(e)
      else if (isObj(e)) errors.push(str(e.message) ?? str(e.code) ?? "unknown error")
    }
  }
  const meta = isObj(raw.meta) ? raw.meta : {}
  return {
    jobs: Array.isArray(raw.jobs) ? raw.jobs : [],
    total: num(raw.total),
    sequence: str(meta.sequence),
    errors,
  }
}

export interface JobResult {
  /** Composite, stable, and the only thing `detail` accepts: board:companySlug:jobId */
  id: string
  title: string | null
  company: string | null
  location: string | null
  date: string | null
  url: string
  board: string
  boardName: string
  /** Every roster board that carries this exact posting (funds co-invest constantly). */
  boards: string[]
  remote: boolean
  hybrid: boolean
  salaryMin: number | null
  salaryMax: number | null
  salaryCurrency: string | null
  salaryPeriod: string | null
  seniority: string[]
  skills: string[]
  /** ISO-8601 duration since `date`, in the API's own `--jobage` vocabulary (e.g. "P3D"). */
  postedSince: string | null
  companySlug: string | null
  companyDomain: string | null
  department: string | null
  jobTypes: string[]
  markets: string[]
  minYearsExp: number | null
  maxYearsExp: number | null
  applyUrl: string | null
  featured: boolean
  /** Raw jobId, without the board/company prefix — the segment `detail` matches on. */
  jobId: string | null
}

function isoDay(v: unknown): string | null {
  const s = str(v)
  if (!s) return null
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null
}

/** ISO-8601 day duration between `date` and `now`. Negative ages clamp to P0D. */
export function isoAge(date: string | null, now: Date = new Date()): string | null {
  if (!date) return null
  const t = Date.parse(`${date}T00:00:00Z`)
  if (Number.isNaN(t)) return null
  const today = Date.parse(`${now.toISOString().slice(0, 10)}T00:00:00Z`)
  return `P${Math.max(0, Math.round((today - t) / 864e5))}D`
}

/**
 * Normalise one raw job record.
 *
 * Returns `null` only when the record has no usable identity (no jobId AND no
 * url) — one bad record must never abort a page. Everything else degrades to
 * `null`/`[]` per the contract.
 *
 * Location: prefer `normalizedLocations` (Consider's canonical, deduplicated
 * "San Mateo, California" form) and fall back to the raw `locations` array, which
 * is ATS-verbatim and REALLY DOES contain empty strings — a live a16z record for
 * Cantina carries `["", "Remote (U.S. or Europe)"]`. Blank entries are dropped.
 *
 * Company: `companyName` and `companyId` diverge after a rebrand — the same live
 * record is `companyName: "Cantina"` but `companyId: "Airtime"` with
 * `companySlug: "airtime"`. Display `companyName`; address the API with the slug.
 */
export function parseJob(raw: unknown, board: Board, now: Date = new Date()): JobResult | null {
  if (!isObj(raw)) return null

  const jobId = str(raw.jobId)
  const url = str(raw.url) ?? str(raw.applyUrl)
  if (!jobId && !url) return null

  const companySlug = str(raw.companySlug)
  const company = str(raw.companyName) ?? str(raw.companyId)

  const normalized = labels(raw.normalizedLocations)
  const rawLocations = Array.isArray(raw.locations)
    ? raw.locations.map((l) => str(l)).filter((l): l is string => !!l)
    : []
  const locationParts = normalized.length ? normalized : rawLocations
  const location = locationParts.length ? locationParts.join(" · ") : null

  const salary = isObj(raw.salary) ? raw.salary : null
  const currency = salary && isObj(salary.currency) ? salary.currency : null
  const period = salary && isObj(salary.period) ? salary.period : null

  const date = isoDay(raw.timeStamp)
  const departments = Array.isArray(raw.departments)
    ? raw.departments.map((d) => str(d)).filter((d): d is string => !!d)
    : []

  return {
    id: [board.slug, companySlug ?? "unknown", jobId ?? "unknown"].join(":"),
    // Titles are untrusted free text and go through the same sanitiser as descriptions.
    title: sanitizeDescription(str(raw.title)),
    company,
    location,
    date,
    url: url ?? `https://${board.host}/jobs`,
    board: board.slug,
    boardName: board.name,
    boards: [board.slug],
    remote: raw.remote === true,
    hybrid: raw.hybrid === true,
    salaryMin: salary ? num(salary.minValue) : null,
    salaryMax: salary ? num(salary.maxValue) : null,
    salaryCurrency: currency ? (str(currency.value) ?? str(currency.label)) : null,
    salaryPeriod: period ? (str(period.value) ?? str(period.label)) : null,
    seniority: Array.isArray(raw.jobSeniorityIds)
      ? raw.jobSeniorityIds.map((s) => str(s)).filter((s): s is string => !!s)
      : labels(raw.jobSeniorities),
    skills: labels(raw.skills),
    postedSince: isoAge(date, now),
    companySlug,
    companyDomain: str(raw.companyDomain),
    department: departments.length ? departments.join(", ") : null,
    jobTypes: labels(raw.jobTypes),
    markets: labels(raw.markets),
    minYearsExp: num(raw.minYearsExp),
    maxYearsExp: num(raw.maxYearsExp),
    // `applyUrl` carries a `?utm_source=jobs.<fund>.com` tracking param on most
    // records; `url` is the clean canonical one. Both are kept, unmodified.
    applyUrl: str(raw.applyUrl),
    featured: raw.isFeatured === true,
    jobId,
  }
}

/** Parse a whole page, dropping unusable records instead of failing the page. */
export function parseJobs(rawJobs: unknown[], board: Board, now: Date = new Date()): JobResult[] {
  const out: JobResult[] = []
  for (const raw of rawJobs) {
    const job = parseJob(raw, board, now)
    if (job) out.push(job)
  }
  return out
}

/**
 * Merge per-board result lists.
 *
 * Funds co-invest, so the SAME posting appears on several boards — Glean's
 * "Machine Learning Engineer, Assistant Quality" is live on Sequoia, Lightspeed
 * AND Kleiner Perkins right now. Dedupe on `jobId` (falling back to `url`), keep
 * the first sighting, and record every board that carried it in `boards`.
 *
 * Sort is newest-first, with unknown dates last and a title/id tiebreak for
 * determinism. The API's own relevance `score` is per-board and not comparable
 * across boards, so it is deliberately NOT used for the merged order.
 */
export function mergeKey(job: JobResult): string {
  return job.jobId ?? job.url
}

export function mergeResults(perBoard: JobResult[][]): JobResult[] {
  const byKey = new Map<string, JobResult>()
  for (const list of perBoard) {
    for (const job of list) {
      const key = mergeKey(job)
      const seen = byKey.get(key)
      if (seen) {
        if (!seen.boards.includes(job.board)) seen.boards.push(job.board)
        continue
      }
      byKey.set(key, job)
    }
  }
  return [...byKey.values()].sort((a, b) => {
    if (a.date !== b.date) {
      if (!a.date) return 1
      if (!b.date) return -1
      return a.date < b.date ? 1 : -1
    }
    const at = a.title ?? ""
    const bt = b.title ?? ""
    if (at !== bt) return at < bt ? -1 : 1
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })
}

/**
 * Cut page `page` out of a fan-out, without repeating or losing a record.
 *
 * ⚠️ WHY THIS IS NOT `merged.slice(start, start + limit)`.
 *
 * Two orders disagree. The boards return records by RELEVANCE, but the merged
 * list is presented NEWEST-FIRST — and the fetch depth grows with the page
 * (`page × limit` records per board). So the universe a `--page 2` run sees is a
 * strict SUPERSET of the one `--page 1` saw, and re-sorting it by date reshuffles
 * the boundary. Slicing that deeper universe therefore both repeats and drops rows.
 *
 * Observed live on 2026-08-05, `-q "machine learning" -b andreessen-horowitz --limit 3`:
 *
 *   --page 1 (universe = 3 records)   -> airtime:395712e5, bighat, quora
 *   --page 2 (universe = 6 records)   -> quora, airtime:0b1ec7c7, sprinter-health
 *                                        ^^^^^ already shown on page 1
 *
 * and `function-health` (2026-08-03), which ranks 3rd by date in the six-record
 * universe but was not in the first three by relevance, appeared on NEITHER page.
 *
 * The walk below reconstructs every shallower page from the SAME already-fetched
 * records — universe U_k is the merge of the first `k × limit` records of each
 * board, exactly what a `--page k` run would have seen — and skips whatever those
 * pages already showed. Page 1 is unchanged, pages are disjoint, nothing is
 * dropped, and it costs zero extra requests.
 *
 * `perBoard` must be in the boards' own arrival order, one entry per board.
 */
export function pageResults(
  perBoard: JobResult[][],
  page: number,
  limit: number,
): { results: JobResult[]; universe: JobResult[] } {
  const shown = new Set<string>()
  let results: JobResult[] = []
  let universe: JobResult[] = []
  for (let k = 1; k <= page; k++) {
    universe = mergeResults(perBoard.map((list) => list.slice(0, k * limit)))
    results = universe.filter((job) => !shown.has(mergeKey(job))).slice(0, limit)
    for (const job of results) shown.add(mergeKey(job))
  }
  return { results, universe }
}

/* ──────────────────────────────── detail id ─────────────────────────────── */

export interface DetailRef {
  board: string
  companySlug: string
  jobId: string
}

/**
 * Parse a `detail` argument.
 *
 * The id format is `<board-slug>:<company-slug>:<job-id>` — exactly the `id` field
 * every search result carries, e.g.
 *   andreessen-horowitz:bighat-biosciences:ed9ce18f-e885-4052-8f9a-e10f952a460a
 *
 * All three segments are load-bearing and none can be derived from the others:
 *   - the board picks the HOST to talk to;
 *   - the company slug is what makes the lookup cheap — Consider has NO
 *     fetch-job-by-id endpoint (`GET /api-boards/jobs/<id>` answers 200 with an
 *     empty body for every non-Consider-hosted posting, i.e. all of them on these
 *     boards), and `query.jobIds` does not exist, so `detail` re-queries the
 *     COMPANY's own child board (`board:{id:<company-slug>, isParent:false}`,
 *     typically <50 records) and matches the id locally;
 *   - the job id is the ATS posting id, whose shape varies by ATS: a UUID
 *     (Ashby), a bare integer (Greenhouse `8052599`), or an opaque base64-ish
 *     token (Gem `am9icG9zdDpeOx5B5La97k6Dl8Ob0wYN`). It is therefore matched
 *     literally and never pattern-validated.
 *
 * Board and company slugs are Consider-generated and colon-free, but ATS job ids
 * are not ours to constrain — so only the FIRST TWO colons are separators and
 * everything after them is the job id, verbatim.
 */
export function parseDetailId(raw: string): DetailRef | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const first = trimmed.indexOf(":")
  if (first <= 0) return null
  const second = trimmed.indexOf(":", first + 1)
  if (second <= first + 1) return null
  const board = trimmed.slice(0, first).trim()
  const companySlug = trimmed.slice(first + 1, second).trim()
  const jobId = trimmed.slice(second + 1).trim()
  if (!board || !companySlug || !jobId) return null
  return { board, companySlug, jobId }
}

/** Body for the company's own child board — the cheap index `detail` walks. */
export function buildCompanyBoardBody(
  companySlug: string,
  size: number,
  sequence: string | null,
): Record<string, unknown> {
  const meta: Record<string, unknown> = { size }
  if (sequence) meta.sequence = sequence
  return { meta, board: { id: companySlug, isParent: false }, query: {}, grouped: false }
}

/** Body for the employer blurb. `query.ids` takes company SLUGS, not display names. */
export function buildCompanyLookupBody(
  boardSlug: string,
  companySlug: string,
): Record<string, unknown> {
  return {
    meta: { size: 1 },
    board: { id: boardSlug, isParent: true },
    query: { ids: [companySlug] },
  }
}

export interface CompanyInfo {
  name: string | null
  description: string | null
  domain: string | null
  markets: string[]
  investors: string[]
  staffCount: number | null
  officeLocations: string[]
}

/** Parse `/api-boards/search-companies`. The blurb is untrusted text — sanitised. */
export function parseCompany(raw: unknown): CompanyInfo | null {
  if (!isObj(raw)) return null
  const list = Array.isArray(raw.companies) ? raw.companies : []
  const first = list.find((c) => isObj(c))
  if (!isObj(first)) return null
  return {
    name: str(first.name) ?? str(first.id),
    description: sanitizeDescription(str(first.description)),
    domain: str(first.domain),
    markets: labels(first.marketsLV).length ? labels(first.marketsLV) : labels(first.markets),
    investors: labels(first.investors),
    staffCount: num(first.staffCount),
    officeLocations: Array.isArray(first.officeLocations)
      ? first.officeLocations.map((l) => str(l)).filter((l): l is string => !!l)
      : [],
  }
}

/* ───────────────────────── Location name resolution ─────────────────────── */

/**
 * `query.locations` matches Consider's CANONICAL location values, not free text:
 * `["Berlin, Germany"]` returns 0 while `["Berlin Area, Germany"]` returns 80.
 * So `--location` is resolved first through the board's own autocomplete, which
 * is the same endpoint the site's location picker uses:
 *
 *   POST /api-boards/autocomplete/locations
 *   {"q":"Berlin","board":{"isParent":true,"id":"<slug>"},"limit":10,"includeZeros":true}
 *   -> {"results":[{"self":{"label":"Berlin","value":"Berlin Area, Germany","count":80}}, …]}
 *
 * Resolution runs against the FIRST board in the selection only, and the winning
 * canonical value is reused for the whole fan-out. That is safe because
 * `includeZeros: true` makes the gazetteer global rather than board-scoped —
 * verified 2026-08-05: "Munich" resolves to "Munich Area, Germany" on greylock
 * and crv too, just with `count: 0` on those boards.
 */
export function buildAutocompleteBody(
  boardSlug: string,
  text: string,
  limit = 10,
): Record<string, unknown> {
  return { q: text, board: { isParent: true, id: boardSlug }, limit, includeZeros: true }
}

export interface LocationSuggestion {
  label: string
  value: string
  count: number
}

export function parseLocationSuggestions(raw: unknown): LocationSuggestion[] {
  if (!isObj(raw) || !Array.isArray(raw.results)) return []
  const out: LocationSuggestion[] = []
  for (const item of raw.results) {
    if (!isObj(item)) continue
    const self = isObj(item.self) ? item.self : item
    const value = str(self.value)
    if (!value) continue
    out.push({ label: str(self.label) ?? value, value, count: num(self.count) ?? 0 })
  }
  return out
}

/**
 * Pick the canonical location value for a user string.
 *
 * An exact (case-insensitive) hit on the canonical value or its label always wins;
 * otherwise take the suggestion with the most jobs behind it, which is what the
 * site's own picker surfaces first. Returns null when nothing matches, so the
 * caller can fail loudly rather than silently searching the whole world.
 *
 * Labels come back with trailing whitespace ("Munich "), so both sides are trimmed.
 */
export function pickLocation(
  suggestions: LocationSuggestion[],
  wanted: string,
): LocationSuggestion | null {
  if (suggestions.length === 0) return null
  const needle = wanted.trim().toLowerCase()
  const exact = suggestions.find(
    (s) => s.value.trim().toLowerCase() === needle || s.label.trim().toLowerCase() === needle,
  )
  if (exact) return exact
  const ranked = [...suggestions].sort((a, b) => b.count - a.count)
  return ranked[0] ?? null
}

/**
 * Consider's place names are ENGLISH EXONYMS. Verified against the a16z
 * autocomplete on 2026-08-05:
 *
 *   "München"  -> []                                     (no results at all)
 *   "Munchen"  -> []                                     (stripping the umlaut does not help)
 *   "Munich"   -> "Munich Area, Germany", 61 jobs        ✅
 *   "Hamburg"  -> "Hamburg Area, Germany",  3 jobs
 *   "Berlin"   -> "Berlin Area, Germany",  80 jobs
 *   "Germany"  -> "Germany",              257 jobs
 *
 * This fork's users type German endonyms, so a German city name has to be
 * translated before it ever reaches the API. Only cities that genuinely differ
 * between German and English are listed; "Berlin", "Hamburg", "Frankfurt",
 * "Stuttgart", "Dresden", "Leipzig" and friends need no entry.
 */
export const LOCATION_ALIASES: Record<string, string> = {
  münchen: "Munich",
  muenchen: "Munich",
  köln: "Cologne",
  koeln: "Cologne",
  nürnberg: "Nuremberg",
  nuernberg: "Nuremberg",
  hannover: "Hanover",
  braunschweig: "Brunswick",
  "frankfurt am main": "Frankfurt",
  wien: "Vienna",
  zürich: "Zurich",
  zuerich: "Zurich",
  genf: "Geneva",
  deutschland: "Germany",
  österreich: "Austria",
  oesterreich: "Austria",
  schweiz: "Switzerland",
  "vereinigte staaten": "United States",
}

/**
 * Candidate strings to try against the autocomplete, in order, for one user input.
 *
 * 1. the raw string (an English or already-canonical name resolves immediately);
 * 2. its English exonym, if we know one;
 * 3. the diacritic-stripped form — a cheap last resort that helps for names where
 *    the only difference is an accent (e.g. "Malmö" -> "Malmo").
 *
 * Duplicates are collapsed so a plain-ASCII input costs exactly one request.
 */
export function locationCandidates(wanted: string): string[] {
  const raw = wanted.trim()
  if (!raw) return []
  const out = [raw]
  const alias = LOCATION_ALIASES[raw.toLowerCase()]
  if (alias && !out.includes(alias)) out.push(alias)
  const stripped = raw.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  if (!out.includes(stripped)) out.push(stripped)
  return out
}
