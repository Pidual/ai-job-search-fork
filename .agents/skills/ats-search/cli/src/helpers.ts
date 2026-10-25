// Data source: the PUBLIC job-board APIs of three applicant-tracking systems
// (Greenhouse, Ashby, Lever), queried one company at a time from a curated
// roster in ../../companies.json.
//
// No API key, no authentication, no attribution requirement. One request per
// company returns that company's whole board including full job descriptions,
// so every filter except Lever's `team` facet is applied client-side.
//
// Zero runtime dependencies: plain `fetch` + JSON parsing + regex.

import { readFileSync } from "node:fs"
import { join } from "node:path"

export type Provider = "greenhouse" | "ashby" | "lever"

export const PROVIDERS: Provider[] = ["greenhouse", "ashby", "lever"]

/** Roster file lives at the skill root, next to SKILL.md — one level above cli/. */
export const COMPANIES_PATH = join(import.meta.dir, "..", "..", "companies.json")

/**
 * Honest User-Agent (repo convention). None of these three hosts require a
 * browser UA — all three answer 200 to this one, verified 2026-08-05.
 */
export const UA =
  "ai-job-search/1.0 (+https://github.com/MadsLorentzen/ai-job-search) personal-job-search"

/**
 * Boards are large (Greenhouse `content=true` is ~5 MB for a 400-job board,
 * Ashby's OpenAI board is ~12 MB), so the per-request budget is wider than the
 * 15 s used for small HTML pages elsewhere in this repo.
 */
export const REQUEST_TIMEOUT_MS = 30000

/** api.lever.co robots.txt: `Allow: /` + `Crawl-delay: 1`. We honour the 1 s. */
export const LEVER_CRAWL_DELAY_MS = 1000

/** Politeness cap on parallel company fetches (Greenhouse + Ashby). */
export const MAX_CONCURRENCY = 5

export function writeError(error: string, code: string): void {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
}

/**
 * Write to stdout and wait until the bytes have actually left the process.
 *
 * `process.stdout.write()` only queues data once the OS buffer is full (64 KB
 * for a pipe) and `process.exit()` throws whatever is still queued away — so a
 * naive write truncates EVERY piped result set larger than one pipe buffer at
 * exactly 65536 bytes, silently emitting invalid JSON. A whole-roster
 * `--format json` run is ~2 MB, so this is the common case, not an edge case.
 *
 * Resolving on the write callback (fired when the chunk is flushed) makes the
 * subsequent exit safe; resolving on `error` too means a reader that closes
 * early (`| head`) ends the command instead of hanging it.
 */
export function writeOut(text: string): Promise<void> {
  return new Promise((resolve) => {
    process.stdout.once("error", () => resolve())
    process.stdout.write(text, () => resolve())
  })
}

// ---------------------------------------------------------------------------
// Roster
// ---------------------------------------------------------------------------

export interface Company {
  token: string
  provider: Provider
  name: string
}

function isProvider(value: unknown): value is Provider {
  return typeof value === "string" && (PROVIDERS as string[]).includes(value)
}

/**
 * Parse the roster document. Accepts either `{ "companies": [...] }` or a bare
 * array, and skips malformed entries rather than rejecting the whole file so a
 * single typo in a user-edited roster does not disable the skill.
 */
export function parseCompanies(raw: unknown): Company[] {
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object" && Array.isArray((raw as { companies?: unknown }).companies)
      ? ((raw as { companies: unknown[] }).companies)
      : []
  const out: Company[] = []
  for (const entry of list) {
    if (!entry || typeof entry !== "object") continue
    const e = entry as Record<string, unknown>
    if (typeof e.token !== "string" || !e.token.trim()) continue
    if (!isProvider(e.provider)) continue
    out.push({
      token: e.token.trim(),
      provider: e.provider,
      name: typeof e.name === "string" && e.name.trim() ? e.name.trim() : e.token.trim(),
    })
  }
  return out
}

export function loadCompanies(path: string = COMPANIES_PATH): Company[] {
  const text = readFileSync(path, "utf-8")
  return parseCompanies(JSON.parse(text) as unknown)
}

// ---------------------------------------------------------------------------
// Endpoints
// ---------------------------------------------------------------------------

export function greenhouseBoardUrl(token: string, withContent: boolean): string {
  const base = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(token)}/jobs`
  return withContent ? `${base}?content=true` : base
}

export function greenhouseJobUrl(token: string, id: string): string {
  return `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(token)}/jobs/${encodeURIComponent(id)}`
}

export function ashbyBoardUrl(token: string): string {
  return `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(token)}?includeCompensation=true`
}

export function leverBoardUrl(token: string, team?: string): string {
  const params = new URLSearchParams({ mode: "json" })
  if (team) params.set("team", team)
  return `https://api.lever.co/v0/postings/${encodeURIComponent(token)}?${params.toString()}`
}

export function leverJobUrl(token: string, id: string): string {
  return `https://api.lever.co/v0/postings/${encodeURIComponent(token)}/${encodeURIComponent(id)}?mode=json`
}

// ---------------------------------------------------------------------------
// Fetch + backoff
// ---------------------------------------------------------------------------

/**
 * Fetch JSON with exponential backoff on 429/5xx. Returns `null` on 404 — every
 * provider 404s an unknown company token, and Lever's 404 body is an OBJECT
 * (`{"ok":false,"error":"Document not found"}`) even though its 200 body is an
 * ARRAY, so callers must never assume a shape from a non-null return either.
 */
export async function jsonFetch(url: string): Promise<unknown | null> {
  const maxRetries = 6
  let delay = 500
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(url, {
      headers: {
        "User-Agent": UA,
        Accept: "application/json",
        "Accept-Language": "en-US,en;q=0.9",
      },
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
    const text = await response.text()
    try {
      return JSON.parse(text) as unknown
    } catch {
      throw new Error("Response was not valid JSON")
    }
  }
  throw new Error("Request failed after max retries")
}

// ---------------------------------------------------------------------------
// Text handling
// ---------------------------------------------------------------------------

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  hellip: "…",
  mdash: "—",
  ndash: "–",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  bull: "•",
  middot: "·",
  eacute: "é",
  uuml: "ü",
  ouml: "ö",
  auml: "ä",
  szlig: "ß",
  copy: "©",
  reg: "®",
  trade: "™",
  deg: "°",
  euro: "€",
  pound: "£",
}

function numericEntity(cp: number): string {
  return cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : ""
}

/**
 * Decode HTML entities in a SINGLE pass. Single-pass matters: Greenhouse's
 * `content` is HTML that has itself been HTML-escaped, so a naive chain that
 * replaces `&amp;` before `&lt;` would turn the literal text `&lt;` into `<`.
 * Callers that need the second level (escaped-HTML -> HTML -> text) call this
 * twice, deliberately.
 */
export function decodeHtmlEntities(text: string): string {
  return text.replace(
    /&(#[0-9]{1,7}|#[xX][0-9a-fA-F]{1,6}|[a-zA-Z][a-zA-Z0-9]{1,31});/g,
    (match, body: string) => {
      if (body[0] === "#") {
        const isHex = body[1] === "x" || body[1] === "X"
        const cp = isHex ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10)
        return Number.isNaN(cp) ? match : numericEntity(cp)
      }
      const named = NAMED_ENTITIES[body.toLowerCase()]
      return named === undefined ? match : named
    },
  )
}

/**
 * Turn an HTML fragment into readable plain text, preserving paragraph and
 * list structure as newlines. Used for Greenhouse `content` and for the HTML
 * inside Lever's `lists[].content`.
 */
export function htmlToText(html: string): string {
  const withBreaks = html
    .replace(/<\s*br\s*\/?\s*>/gi, "\n")
    .replace(/<\s*li[^>]*>/gi, "\n- ")
    .replace(/<\/(p|div|li|ul|ol|h[1-6]|tr|table|section)\s*>/gi, "\n")
    .replace(/<\s*(p|div|h[1-6])[^>]*>/gi, "\n")
  return (
    normalizeWhitespace(decodeHtmlEntities(withBreaks.replace(/<[^>]*>/g, "")))
      // `</li>` and the next `<li>` each emit a newline; drop the blank line
      // that would otherwise sit between every pair of bullets.
      .replace(/\n{2,}(?=- )/g, "\n")
  )
}

/** Collapse non-breaking spaces, trailing blanks and 3+ newline runs. */
export function normalizeWhitespace(text: string): string {
  return text
    .replace(/ /g, " ")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

/** Greenhouse ships description as HTML that was then HTML-escaped: decode, then de-tag. */
export function greenhouseContentToText(content: string | null | undefined): string | null {
  if (!content) return null
  return htmlToText(decodeHtmlEntities(content)) || null
}

/**
 * Job descriptions are untrusted third-party text and are known to carry
 * prompt-injection payloads aimed at LLM readers. Neutralise the markers an
 * agent might act on, and fence the result so a downstream model treats it as
 * data, never as instructions.
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

// ---------------------------------------------------------------------------
// Normalised result shape
// ---------------------------------------------------------------------------

export interface JobResult {
  /** Portable composite id: `<provider>:<companyToken>:<providerJobId>`. */
  id: string
  title: string | null
  company: string | null
  location: string | null
  /** ISO `YYYY-MM-DD`, derived from the provider's own posting/update date. */
  date: string | null
  url: string | null
  provider: Provider
  companyToken: string
  /** Provider-native job id, without the `provider:token:` prefix. */
  jobId: string
  department: string | null
  employmentType: string | null
  /** `true`/`false` where the provider states it, `null` where it is unknown. */
  remote: boolean | null
  applyUrl: string | null
  compensation: string | null
}

export interface ParsedJob {
  job: JobResult
  /** Lowercased title + department + description, for client-side `--query`. */
  haystack: string
  /** Full plain-text description. Emitted only by `detail`, after sanitising. */
  description: string | null
}

export function composeId(provider: Provider, token: string, jobId: string): string {
  return `${provider}:${token}:${jobId}`
}

const REMOTE_RE = /\b(remote|anywhere|distributed)\b/i

export function looksRemote(location: string | null): boolean {
  return location !== null && REMOTE_RE.test(location)
}

/** Normalise a provider date (ISO string or unix-ms number) to `YYYY-MM-DD`. */
export function toIsoDate(value: unknown): string | null {
  if (value === null || value === undefined) return null
  let d: Date
  if (typeof value === "number") {
    d = new Date(value)
  } else if (typeof value === "string") {
    const trimmed = value.trim()
    if (!trimmed) return null
    d = /^\d+$/.test(trimmed) ? new Date(parseInt(trimmed, 10)) : new Date(trimmed)
  } else {
    return null
  }
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString().slice(0, 10)
}

function str(value: unknown): string | null {
  if (typeof value === "string") {
    const t = value.trim()
    return t === "" ? null : t
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value)
  return null
}

function rec(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function buildHaystack(parts: (string | null)[]): string {
  return parts.filter((p): p is string => Boolean(p)).join("\n").toLowerCase()
}

// ---------------------------------------------------------------------------
// Provider parsers — each tolerates a malformed record by skipping just it
// ---------------------------------------------------------------------------

/** `{ "jobs": [...], "meta": { "total": n } }`. Title/location/departments/content. */
export function parseGreenhouseBoard(raw: unknown, company: Company): ParsedJob[] {
  const root = rec(raw)
  const jobs = root && Array.isArray(root.jobs) ? root.jobs : []
  const out: ParsedJob[] = []
  for (const entry of jobs) {
    const j = rec(entry)
    if (!j) continue
    const jobId = str(j.id)
    if (!jobId) continue
    const location = str(rec(j.location)?.name)
    const department = Array.isArray(j.departments)
      ? j.departments
          .map((d) => str(rec(d)?.name))
          .filter((n): n is string => Boolean(n))
          .join(", ") || null
      : null
    const description = greenhouseContentToText(str(j.content))
    const title = str(j.title)
    out.push({
      job: {
        id: composeId("greenhouse", company.token, jobId),
        title,
        company: str(j.company_name) ?? company.name,
        location,
        // `first_published` is the real posting date; `updated_at` is a BULK
        // re-index timestamp — measured 2026-08-05, 382 of Anthropic's 398 jobs
        // and 569 of Databricks' 808 share a single `updated_at` day, while
        // `first_published` spans 163 and 272 distinct days respectively.
        // Preferring `updated_at` would date every Greenhouse job "today",
        // making --jobage a no-op and floating stale jobs to the top of the
        // newest-first sort. `updated_at` remains the fallback.
        date: toIsoDate(j.first_published) ?? toIsoDate(j.updated_at),
        url: str(j.absolute_url),
        provider: "greenhouse",
        companyToken: company.token,
        jobId,
        department,
        employmentType: null,
        // Greenhouse exposes no remote flag; infer from the location text only.
        remote: looksRemote(location) ? true : null,
        applyUrl: str(j.absolute_url),
        compensation: null,
      },
      haystack: buildHaystack([title, department, location, description]),
      description,
    })
  }
  return out
}

const ASHBY_WORKPLACE: Record<string, boolean> = {
  remote: true,
  onsite: false,
  hybrid: false,
}

/**
 * `workplaceType` is checked BEFORE `isRemote`. Measured on the live boards
 * (2026-08-05), Ashby's `isRemote` is true for hybrid postings as well —
 * OpenAI returns isRemote=true for 442 postings whose workplaceType is
 * "Hybrid" and whose location is "San Francisco". `workplaceType` is the
 * precise signal; `isRemote` only means "not strictly on-site".
 */
function ashbyRemote(isRemote: unknown, workplaceType: string | undefined): boolean | null {
  if (workplaceType && workplaceType in ASHBY_WORKPLACE) return ASHBY_WORKPLACE[workplaceType]!
  if (typeof isRemote === "boolean") return isRemote
  return null
}

/** `{ "jobs": [...] }`. `descriptionPlain` is already plain text. */
export function parseAshbyBoard(raw: unknown, company: Company): ParsedJob[] {
  const root = rec(raw)
  const jobs = root && Array.isArray(root.jobs) ? root.jobs : []
  const out: ParsedJob[] = []
  for (const entry of jobs) {
    const j = rec(entry)
    if (!j) continue
    const jobId = str(j.id)
    if (!jobId) continue
    const location = str(j.location)
    const department = str(j.department) ?? str(j.team)
    const description = str(j.descriptionPlain)
      ? normalizeWhitespace(String(j.descriptionPlain))
      : null
    const title = str(j.title)
    const explicit = ashbyRemote(j.isRemote, str(j.workplaceType)?.toLowerCase())
    const comp = rec(j.compensation)
    out.push({
      job: {
        id: composeId("ashby", company.token, jobId),
        title,
        company: company.name,
        location,
        date: toIsoDate(j.publishedAt),
        url: str(j.jobUrl),
        provider: "ashby",
        companyToken: company.token,
        jobId,
        department,
        employmentType: str(j.employmentType),
        remote: explicit ?? (looksRemote(location) ? true : null),
        applyUrl: str(j.applyUrl) ?? str(j.jobUrl),
        compensation:
          str(comp?.compensationTierSummary) ?? str(comp?.scrapeableCompensationSalarySummary),
      },
      haystack: buildHaystack([title, department, location, description]),
      description,
    })
  }
  return out
}

const LEVER_WORKPLACE: Record<string, boolean> = {
  remote: true,
  onsite: false,
  hybrid: false,
}

/**
 * Top level is an ARRAY on success. Title lives in `text`, not `title`.
 * The full description is `descriptionPlain` + the `lists[]` bullet blocks +
 * `additionalPlain` — the requirement bullets are only in `lists`, so keyword
 * matching that skipped them would miss most skill terms.
 */
export function parseLeverBoard(raw: unknown, company: Company): ParsedJob[] {
  if (!Array.isArray(raw)) return []
  const out: ParsedJob[] = []
  for (const entry of raw) {
    const j = rec(entry)
    if (!j) continue
    const jobId = str(j.id)
    if (!jobId) continue
    const categories = rec(j.categories)
    const location = str(categories?.location)
    const department = str(categories?.team)
    const description = leverDescription(j)
    const title = str(j.text)
    const workplace = str(j.workplaceType)?.toLowerCase()
    const explicit = workplace && workplace in LEVER_WORKPLACE ? LEVER_WORKPLACE[workplace] : null
    out.push({
      job: {
        id: composeId("lever", company.token, jobId),
        title,
        company: company.name,
        location,
        date: toIsoDate(j.createdAt),
        url: str(j.hostedUrl),
        provider: "lever",
        companyToken: company.token,
        jobId,
        department,
        employmentType: str(categories?.commitment),
        remote: explicit ?? (looksRemote(location) ? true : null),
        applyUrl: str(j.applyUrl) ?? str(j.hostedUrl),
        compensation: str(rec(j.salaryRange)?.text) ?? null,
      },
      haystack: buildHaystack([title, department, location, description]),
      description,
    })
  }
  return out
}

export function leverDescription(j: Record<string, unknown>): string | null {
  const parts: string[] = []
  const head = str(j.descriptionPlain)
  if (head) parts.push(head)
  if (Array.isArray(j.lists)) {
    for (const item of j.lists) {
      const l = rec(item)
      if (!l) continue
      const heading = str(l.text)
      const body = str(l.content) ? htmlToText(String(l.content)) : null
      if (heading || body) parts.push([heading, body].filter(Boolean).join("\n"))
    }
  }
  const tail = str(j.additionalPlain)
  if (tail) parts.push(tail)
  if (parts.length === 0) return null
  return normalizeWhitespace(parts.join("\n\n")) || null
}

export function parseBoard(provider: Provider, raw: unknown, company: Company): ParsedJob[] {
  switch (provider) {
    case "greenhouse":
      return parseGreenhouseBoard(raw, company)
    case "ashby":
      return parseAshbyBoard(raw, company)
    case "lever":
      return parseLeverBoard(raw, company)
  }
}

/** Wrap a single Greenhouse job object into the board shape its parser expects. */
export function parseGreenhouseJob(raw: unknown, company: Company): ParsedJob | null {
  return parseGreenhouseBoard({ jobs: [raw] }, company)[0] ?? null
}

/** Wrap a single Lever posting object into the board shape its parser expects. */
export function parseLeverJob(raw: unknown, company: Company): ParsedJob | null {
  return parseLeverBoard([raw], company)[0] ?? null
}

// ---------------------------------------------------------------------------
// Client-side filtering
// ---------------------------------------------------------------------------

/** Split a query into lowercased terms; every term must appear (AND semantics). */
export function queryTerms(query: string | undefined): string[] {
  if (!query) return []
  return query
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean)
}

export function matchesQuery(haystack: string, terms: string[]): boolean {
  return terms.every((t) => haystack.includes(t))
}

export function matchesLocation(location: string | null, needle: string | undefined): boolean {
  if (!needle) return true
  if (!location) return false
  return location.toLowerCase().includes(needle.toLowerCase())
}

/** `date` (YYYY-MM-DD) within `days` of `now`. Unknown dates are filtered out. */
export function withinJobAge(date: string | null, days: number | undefined, now = Date.now()): boolean {
  if (days === undefined) return true
  if (!date) return false
  const t = Date.parse(`${date}T00:00:00Z`)
  if (Number.isNaN(t)) return false
  return now - t <= days * 86400000
}

/** Newest first; unknown dates last; stable tiebreak on id for determinism. */
export function compareJobs(a: JobResult, b: JobResult): number {
  if (a.date !== b.date) {
    if (!a.date) return 1
    if (!b.date) return -1
    return a.date < b.date ? 1 : -1
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

// ---------------------------------------------------------------------------
// Polite fan-out
// ---------------------------------------------------------------------------

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

/** Run `worker` strictly one at a time, pausing `delayMs` between calls. */
export async function mapSerial<T, R>(
  items: T[],
  delayMs: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = []
  for (let i = 0; i < items.length; i++) {
    if (i > 0 && delayMs > 0) await new Promise((r) => setTimeout(r, delayMs))
    results.push(await worker(items[i]!))
  }
  return results
}
