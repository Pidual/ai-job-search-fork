// Data source: Jobicy's public remote-jobs JSON API.
//
//   GET https://jobicy.com/api/v2/remote-jobs?count=&tag=&geo=&industry=
//
// No API key, no authentication, zero runtime dependencies — plain `fetch` plus
// JSON/regex parsing. Unlike most no-key remote boards, Jobicy's `tag` parameter
// is a REAL server-side keyword filter, so `--query` narrows the result set on
// the server instead of being faked client-side.
//
// Personal use only. jobicy.com/robots.txt line 48 carries `Disallow: /api/`,
// while Jobicy itself advertises this same interface as a developer API (every
// payload carries `documentationUrl: https://jobi.cy/apidocs`). The two signals
// conflict — keep volume low and treat this as personal use. See SKILL.md.
//
// Attribution is contractual: the payload's `friendlyNotice` field asks that
// Jobicy be credited with a direct link and that apply buttons point at the
// original job URL. Every command echoes it — do not strip that.

export const API_BASE = "https://jobicy.com/api/v2/remote-jobs"

/**
 * Public job pages live at `/jobs/<id>-<slug>`. Verified live: ANY slug suffix
 * 301-redirects to the canonical one (`/jobs/143131-x` ->
 * `/jobs/143131-staff-machine-learning-engineer`), while a bare `/jobs/<id>`
 * 404s — so a job id alone is enough to reach the page. This is the fallback
 * `detail` uses when an id is outside the API's listing window.
 *
 * robots.txt allows it: `/jobs/` appears nowhere in the disallow list (unlike
 * `/api/` on line 48, `/job-listings/` on line 42 and `/*?p=` on line 3 — the
 * WordPress `?p=<id>` permalink is disallowed, which is why we go through the
 * `/jobs/<id>-<anything>` redirect instead).
 */
export const JOB_PAGE_BASE = "https://jobicy.com/jobs"

/** Build the job-page URL for a bare id. The slug suffix is arbitrary. */
export function jobPageUrl(id: string): string {
  return `${JOB_PAGE_BASE}/${encodeURIComponent(id)}-job`
}

/** The API silently clamps `count` to 100 (verified: 200 -> appliedFilters.count 100). */
export const MAX_COUNT = 100

/** Sentinel for "no --jobage filter". */
export const NO_JOBAGE = 9999

/**
 * The API rejects a `tag` outside 3..50 characters with HTTP 400
 * ("The length of the 'tag' value should be between 3 and 50 characters.").
 * Verified live: len 2 -> 400, len 50 -> 200, len 51 -> 400. Two-letter queries
 * like "AI" and "ML" therefore cannot be sent — spell them out.
 */
export const TAG_MIN_LENGTH = 3
export const TAG_MAX_LENGTH = 50

/**
 * Common ways a user names a region -> Jobicy's actual `geoSlug`. The API is
 * case-insensitive ("USA" and "Germany" both work) but rejects spaces, and its
 * slugs are not always the obvious ones (`uk`, not `united-kingdom`).
 */
const GEO_ALIASES: Record<string, string> = {
  us: "usa",
  "u-s": "usa",
  "u-s-a": "usa",
  america: "usa",
  "united-states": "usa",
  "united-states-of-america": "usa",
  "vereinigte-staaten": "usa",
  "united-kingdom": "uk",
  "great-britain": "uk",
  britain: "uk",
  england: "uk",
  gb: "uk",
  de: "germany",
  deutschland: "germany",
  ger: "germany",
  holland: "netherlands",
  nl: "netherlands",
  "czech-republic": "czechia",
  turkey: "turkiye",
  korea: "south-korea",
  uae: "united-arab-emirates",
  eu: "europe",
  europa: "europe",
}

/**
 * Normalise a `--geo` / `--location` value into a Jobicy `geoSlug`:
 * lowercase, whitespace and underscores to hyphens, then apply the alias map.
 * A value that still is not a real slug is left alone and the API answers with
 * its own HTTP 400 naming the `?get=locations` endpoint.
 */
export function normalizeGeo(value: string | undefined): string | undefined {
  if (!value) return undefined
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "")
  if (!slug) return undefined
  return GEO_ALIASES[slug] ?? slug
}

/** Returns an error message when --query cannot be sent as a `tag`, else null. */
export function validateQuery(query: string | undefined): string | null {
  if (query === undefined) return null
  const len = query.trim().length
  if (len < TAG_MIN_LENGTH) {
    return (
      `--query must be at least ${TAG_MIN_LENGTH} characters (Jobicy rejects shorter ` +
      `\`tag\` values); got "${query}". Try spelling it out, e.g. "artificial intelligence" ` +
      `or "machine learning" instead of "AI"/"ML".`
    )
  }
  if (len > TAG_MAX_LENGTH) {
    return `--query must be at most ${TAG_MAX_LENGTH} characters (Jobicy limit); got ${len}.`
  }
  return null
}

/**
 * Honest User-Agent (this fork's convention — no browser impersonation).
 * Verified 2026-08-05: the Jobicy API serves HTTP 200 to this UA.
 */
export const USER_AGENT =
  "ai-job-search/1.0 (+https://github.com/MadsLorentzen/ai-job-search) personal-job-search"

export function writeError(error: string, code: string): void {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
}

/**
 * Jobicy answers a bad parameter with HTTP 400 and a JSON body carrying a
 * human-readable `error` (e.g. an unknown geo slug lists the slug endpoint).
 * Pull it out so the CLI surfaces the real reason, not a bare status line.
 */
function apiErrorMessage(body: string): string | null {
  try {
    const parsed: unknown = JSON.parse(body)
    if (parsed && typeof parsed === "object" && "error" in parsed) {
      const msg = (parsed as { error?: unknown }).error
      if (typeof msg === "string" && msg.trim()) return msg.trim()
    }
  } catch {
    /* not JSON — fall through */
  }
  return null
}

/** Fetch JSON with exponential backoff on 429/5xx. Returns null on a 404. */
export async function jsonFetch(url: string): Promise<unknown | null> {
  const maxRetries = 6
  let delay = 500
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "application/json",
        "Accept-Language": "en-US,en;q=0.9",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(15000),
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
      const detail = apiErrorMessage(await response.text().catch(() => ""))
      throw new Error(
        detail
          ? `Request failed: ${response.status} ${response.statusText} — ${detail}`
          : `Request failed: ${response.status} ${response.statusText}`,
      )
    }
    return (await response.json()) as unknown
  }
  throw new Error("Request failed after max retries")
}

/**
 * Fetch an HTML page with the same backoff shape as `jsonFetch`.
 * Returns "" on a 404 (an id that no longer has a page) rather than throwing.
 */
export async function textFetch(url: string): Promise<string> {
  const maxRetries = 6
  let delay = 500
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(15000),
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
    if (response.status === 404) return ""
    if (!response.ok) {
      throw new Error(`Request failed: ${response.status} ${response.statusText}`)
    }
    return await response.text()
  }
  throw new Error("Request failed after max retries")
}

// ---------------------------------------------------------------------------
// HTML entity decoding + tag stripping
//
// jobDescription is raw HTML; jobIndustry / jobExcerpt / jobGeo arrive with
// entities already baked in ("Data Science &amp; Analytics", "&hellip;").
// ---------------------------------------------------------------------------

const NAMED_ENTITIES: Record<string, string> = {
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  hellip: "…",
  mdash: "—",
  ndash: "–",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
  sbquo: "‚",
  bdquo: "„",
  middot: "·",
  bull: "•",
  trade: "™",
  reg: "®",
  copy: "©",
  deg: "°",
  euro: "€",
  pound: "£",
  yen: "¥",
  cent: "¢",
  laquo: "«",
  raquo: "»",
  times: "×",
  minus: "−",
  plusmn: "±",
  frac12: "½",
  frac14: "¼",
  sup2: "²",
  sup3: "³",
  prime: "′",
  Prime: "″",
  dagger: "†",
  permil: "‰",
  eacute: "é",
  egrave: "è",
  agrave: "à",
  ccedil: "ç",
  uuml: "ü",
  ouml: "ö",
  auml: "ä",
  Uuml: "Ü",
  Ouml: "Ö",
  Auml: "Ä",
  szlig: "ß",
  oslash: "ø",
  aring: "å",
  aelig: "æ",
  ntilde: "ñ",
  shy: "",
  zwnj: "",
  zwj: "",
}

/**
 * Convert a Unicode code point to a string. Uses `fromCodePoint` (not
 * `fromCharCode`) so supplementary-plane code points (e.g. emoji, U+1F600)
 * decode correctly, and drops out-of-range values instead of throwing.
 */
function numericEntity(cp: number): string {
  return Number.isFinite(cp) && cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : ""
}

/**
 * Decode HTML entities exactly one level deep. `&amp;` is resolved LAST so that
 * `&amp;hellip;` decodes to the literal text `&hellip;` rather than to `…`
 * (double-decoding would corrupt job descriptions that quote entity syntax).
 */
export function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, dec: string) => numericEntity(parseInt(dec, 10)))
    .replace(/&#[xX]([0-9a-fA-F]+);/g, (_, hex: string) => numericEntity(parseInt(hex, 16)))
    .replace(/&([a-zA-Z][a-zA-Z0-9]*);/g, (match, name: string) => {
      if (name.toLowerCase() === "amp") return match // deferred to the pass below
      const exact = NAMED_ENTITIES[name]
      if (exact !== undefined) return exact
      const lower = NAMED_ENTITIES[name.toLowerCase()]
      return lower !== undefined ? lower : match
    })
    .replace(/&amp;/gi, "&")
}

/**
 * Normalise a short text field: strip any stray markup, decode entities and
 * collapse whitespace. Jobicy's `jobGeo` uses double spaces after its commas
 * ("Canada,  Europe,  USA"), which this fixes. Returns null when empty.
 */
export function cleanText(value: unknown): string | null {
  if (typeof value !== "string") return null
  const out = decodeHtmlEntities(value.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim()
  return out || null
}

/**
 * Flatten `jobDescription` HTML into readable plain text: block tags become
 * newlines, list items get a bullet, script/style blocks are dropped, and
 * entities are decoded after tag removal so `&lt;p&gt;` is never mistaken for
 * markup. Returns null when nothing survives.
 */
export function htmlToText(html: unknown): string | null {
  if (typeof html !== "string" || !html) return null
  const withBreaks = html
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\s*br\s*\/?\s*>/gi, "\n")
    // Drop list items that hold nothing but whitespace/empty blocks before they
    // can turn into a bullet marker with no text after it.
    .replace(/<\s*li[^>]*>(?:\s|<\s*(?:p|div|span|strong|em|br)[^>]*>|<\/\s*[a-z]+\s*>)*<\/\s*li\s*>/gi, "")
    .replace(/<\s*li[^>]*>/gi, "\n- ")
    // `li` is deliberately absent: the opening <li> already emits its own break,
    // so closing it too would put a blank line between every bullet.
    .replace(/<\/(p|ul|ol|div|section|article|tr|table|blockquote|h[1-6])\s*>/gi, "\n")
    .replace(/<\s*(p|div|h[1-6])[^>]*>/gi, "\n")
  return (
    decodeHtmlEntities(withBreaks.replace(/<[^>]+>/g, " "))
      .replace(/[ \t\u00a0\u200b]+/g, " ")
      .replace(/ *\n */g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      // Many postings nest a block inside the bullet ("<li>\n<p>text</p>\n</li>"),
      // which strands the marker on a line of its own — as does the job-page
      // JSON-LD, which ships literal "• \nText". Pull the text back up.
      .replace(/\n([-•])\n+/g, "\n$1 ")
      // Jobicy's markup also puts a literal newline between </li> and the next
      // <li>, which would blank-line-separate every bullet. Keep lists tight.
      // The job-page JSON-LD's "• " bullets are blank-line separated too, so
      // both marker styles are collapsed here.
      .replace(/\n{2,}(?=[-•] )/g, "\n")
      // Drop markers that ended up with no text at all, and collapse any run of
      // markers left over from a degenerate empty list item.
      .replace(/\n[-•] ?(?=\n|$)/g, "")
      .replace(/\n(?:[-•] )+(?=[-•] )/g, "\n")
      .trim() || null
  )
}

/**
 * Job descriptions are untrusted third-party text and are known to carry prompt-injection
 * payloads aimed at LLM readers. Neutralise the markers an agent might act on, and fence
 * the result so a downstream model treats it as data, never as instructions.
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
// Payload parsing
// ---------------------------------------------------------------------------

export interface JobRecord {
  id: string
  title: string | null
  company: string | null
  location: string | null
  date: string | null
  url: string | null
  pubDate: string | null
  level: string | null
  jobType: string[]
  industry: string[]
  salaryMin: number | null
  salaryMax: number | null
  salaryCurrency: string | null
  salaryPeriod: string | null
  excerpt: string | null
}

export interface JobDetailRecord extends JobRecord {
  description: string | null
}

export interface JobicyPayload {
  jobs: JobRecord[]
  /** `friendlyNotice` — the contractual credit requirement. Echo it, don't drop it. */
  attribution: string | null
  apiVersion: string | null
  documentationUrl: string | null
  lastUpdate: string | null
  /** Present on an empty-but-successful response ("No jobs found for the applied filters."). */
  message: string | null
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value.trim())) {
    return parseFloat(value.trim())
  }
  return null
}

function toStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    const single = cleanText(value)
    return single ? [single] : []
  }
  return value.map((v) => cleanText(v)).filter((v): v is string => v !== null)
}

/** Pull the numeric job id out of a Jobicy job URL or slug (`/jobs/143131-some-slug`). */
export function idFromUrl(value: unknown): string | null {
  if (typeof value !== "string") return null
  const m = value.match(/\/jobs\/(\d+)/) || value.match(/^(\d+)-/) || value.match(/^(\d{3,})$/)
  return m ? m[1]! : null
}

/**
 * Normalise `pubDate` ("2026-07-28T12:25:03+00:00") to an ISO calendar date.
 * Returns null for empty strings and unparseable values.
 */
export function toIsoDate(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null
  const direct = value.trim().match(/^(\d{4}-\d{2}-\d{2})/)
  if (direct) return direct[1]!
  const ts = Date.parse(value)
  if (Number.isNaN(ts)) return null
  return new Date(ts).toISOString().slice(0, 10)
}

/** Keep the full ISO-8601 timestamp when the API gives one, else null. */
function toIsoTimestamp(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null
  const ts = Date.parse(value.trim())
  return Number.isNaN(ts) ? null : new Date(ts).toISOString()
}

/**
 * Parse one `.jobs[]` entry. Returns null only when there is no usable id —
 * a record we cannot address is not worth emitting. Every other field
 * degrades to null / [] so a single partial record never breaks the batch.
 */
export function parseJob(raw: unknown): JobRecord | null {
  const job = asRecord(raw)
  if (!job) return null

  const rawId = job["id"]
  const id =
    typeof rawId === "number" && Number.isFinite(rawId)
      ? String(rawId)
      : typeof rawId === "string" && rawId.trim()
        ? rawId.trim()
        : (idFromUrl(job["url"]) ?? idFromUrl(job["jobSlug"]))
  if (!id) return null

  const url = typeof job["url"] === "string" && job["url"].trim() ? job["url"].trim() : null
  const slug = typeof job["jobSlug"] === "string" ? job["jobSlug"].trim() : ""

  return {
    id,
    title: cleanText(job["jobTitle"]),
    company: cleanText(job["companyName"]),
    location: cleanText(job["jobGeo"]),
    date: toIsoDate(job["pubDate"]),
    url: url ?? (slug ? `https://jobicy.com/jobs/${slug}` : null),
    pubDate: toIsoTimestamp(job["pubDate"]),
    level: cleanText(job["jobLevel"]),
    jobType: toStringList(job["jobType"]),
    industry: toStringList(job["jobIndustry"]),
    salaryMin: toNumber(job["salaryMin"]),
    salaryMax: toNumber(job["salaryMax"]),
    salaryCurrency: cleanText(job["salaryCurrency"]),
    salaryPeriod: cleanText(job["salaryPeriod"]),
    excerpt: cleanText(job["jobExcerpt"]),
  }
}

/** Parse the whole `/remote-jobs` response envelope. */
export function parsePayload(raw: unknown): JobicyPayload {
  const root = asRecord(raw)
  const rawJobs = root && Array.isArray(root["jobs"]) ? root["jobs"] : []
  const jobs = rawJobs
    .map((entry) => parseJob(entry))
    .filter((entry): entry is JobRecord => entry !== null)

  return {
    jobs,
    attribution: root ? cleanText(root["friendlyNotice"]) : null,
    apiVersion: root ? cleanText(root["apiVersion"]) : null,
    documentationUrl: root ? cleanText(root["documentationUrl"]) : null,
    lastUpdate: root ? toIsoTimestamp(root["lastUpdate"]) : null,
    message: root ? cleanText(root["message"]) : null,
  }
}

/** Attach the sanitised, de-HTML-ed description to a parsed record. */
export function withDescription(job: JobRecord, raw: unknown): JobDetailRecord {
  const source = asRecord(raw)
  return {
    ...job,
    description: sanitizeDescription(htmlToText(source ? source["jobDescription"] : null)),
  }
}

// ---------------------------------------------------------------------------
// Job-page fallback (schema.org JSON-LD)
//
// The API has no per-job endpoint and only exposes a listing window, so an id
// that has aged out of the listing is unreachable through it. Every public job
// page carries a complete `JobPosting` JSON-LD block, which is a far more
// stable parsing anchor than the page's markup — see url-reference.md.
// ---------------------------------------------------------------------------

/** Extract and JSON.parse every `application/ld+json` block. Bad blocks are skipped. */
export function jsonLdBlocks(html: string): unknown[] {
  const out: unknown[] = []
  const re =
    /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script\s*>/gi
  let match: RegExpExecArray | null
  while ((match = re.exec(html)) !== null) {
    try {
      out.push(JSON.parse(match[1]!) as unknown)
    } catch {
      /* one malformed block must not hide the others */
    }
  }
  return out
}

/** Depth-limited walk for the first `@type: JobPosting` node (handles `@graph`). */
function findJobPosting(node: unknown, depth = 0): Record<string, unknown> | null {
  if (depth > 4) return null
  if (Array.isArray(node)) {
    for (const entry of node) {
      const found = findJobPosting(entry, depth + 1)
      if (found) return found
    }
    return null
  }
  const rec = asRecord(node)
  if (!rec) return null
  const type = rec["@type"]
  const types = Array.isArray(type) ? type : [type]
  if (types.some((t) => typeof t === "string" && t.toLowerCase() === "jobposting")) return rec
  if (rec["@graph"] !== undefined) return findJobPosting(rec["@graph"], depth + 1)
  return null
}

/** `FULL_TIME` -> `Full-Time`, matching how the API spells jobType. */
function normalizeEmploymentType(value: unknown): string[] {
  return toStringList(value).map((v) =>
    v
      .replace(/_/g, "-")
      .toLowerCase()
      .replace(/(^|-)([a-z])/g, (_, sep: string, ch: string) => sep + ch.toUpperCase()),
  )
}

const SALARY_PERIODS: Record<string, string> = {
  YEAR: "yearly",
  MONTH: "monthly",
  WEEK: "weekly",
  DAY: "daily",
  HOUR: "hourly",
}

/**
 * Region string out of `applicantLocationRequirements` (an object, or an array
 * of them on multi-region postings), falling back to `jobLocation`'s address.
 */
function locationFromLd(posting: Record<string, unknown>): string | null {
  const named = (value: unknown): string[] => {
    if (Array.isArray(value)) return value.flatMap((v) => named(v))
    const rec = asRecord(value)
    if (rec) {
      const name = cleanText(rec["name"] ?? rec["addressCountry"] ?? rec["addressRegion"])
      return name ? [name] : []
    }
    const plain = cleanText(value)
    return plain ? [plain] : []
  }

  const requirements = named(posting["applicantLocationRequirements"])
  if (requirements.length) return requirements.join(", ")

  const loc = asRecord(posting["jobLocation"])
  const address = loc ? named(loc["address"]) : []
  if (address.length) return address.join(", ")

  return posting["jobLocationType"] === "TELECOMMUTE" ? "Remote" : null
}

/**
 * Build a detail record from a public job page. Returns null when the page
 * carries no JobPosting block (e.g. a redirect landing page or a 404 body).
 * `fallbackId` is used when the posting omits `identifier.value`.
 */
export function parseJobPage(html: string, fallbackId: string): JobDetailRecord | null {
  if (typeof html !== "string" || !html.trim()) return null

  let posting: Record<string, unknown> | null = null
  for (const block of jsonLdBlocks(html)) {
    posting = findJobPosting(block)
    if (posting) break
  }
  if (!posting) return null

  const identifier = asRecord(posting["identifier"])
  const idValue = identifier ? identifier["value"] : null
  const id =
    typeof idValue === "number" && Number.isFinite(idValue)
      ? String(idValue)
      : typeof idValue === "string" && idValue.trim()
        ? idValue.trim()
        : fallbackId

  const org = asRecord(posting["hiringOrganization"])
  const salary = asRecord(posting["baseSalary"])
  const amount = salary ? asRecord(salary["value"]) : null
  const unit = amount ? cleanText(amount["unitText"]) : null

  const canonical =
    html.match(/<link\b[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)["']/i) ??
    html.match(/<link\b[^>]*href=["']([^"']+)["'][^>]*rel=["']canonical["']/i)

  return {
    id,
    title: cleanText(posting["title"]),
    company: org ? cleanText(org["name"]) : null,
    location: locationFromLd(posting),
    date: toIsoDate(posting["datePosted"]),
    url: canonical ? canonical[1]! : `${JOB_PAGE_BASE}/${id}-job`,
    pubDate: toIsoTimestamp(posting["datePosted"]),
    // Neither seniority nor Jobicy's own industry taxonomy is exposed in the
    // JSON-LD; they stay null/empty rather than being guessed from the markup.
    level: null,
    jobType: normalizeEmploymentType(posting["employmentType"]),
    industry: [],
    salaryMin: amount ? toNumber(amount["minValue"]) : null,
    salaryMax: amount ? toNumber(amount["maxValue"] ?? amount["value"]) : null,
    salaryCurrency: salary ? cleanText(salary["currency"]) : null,
    salaryPeriod: unit ? (SALARY_PERIODS[unit.toUpperCase()] ?? unit.toLowerCase()) : null,
    excerpt: null,
    description: sanitizeDescription(htmlToText(posting["description"])),
  }
}

// ---------------------------------------------------------------------------
// Client-side filters (the API supports neither age filtering nor pagination)
// ---------------------------------------------------------------------------

/**
 * `--jobage <days>` is applied locally against `pubDate`.
 * `--jobage 0` means "posted today" (UTC calendar day), not "within zero ms".
 * Records with no parseable date are excluded whenever a filter is active —
 * an unknown date cannot be shown to satisfy "posted within N days".
 */
export function withinJobAge(pubDate: string | null, days: number, now: number = Date.now()): boolean {
  if (days >= NO_JOBAGE) return true
  if (!pubDate) return false
  const ts = Date.parse(pubDate)
  if (Number.isNaN(ts)) return false
  if (days <= 0) {
    const startOfToday = new Date(now)
    startOfToday.setUTCHours(0, 0, 0, 0)
    return ts >= startOfToday.getTime()
  }
  return now - ts <= days * 86_400_000
}

/** 1-indexed client-side paging over an already-fetched list. */
export function paginate<T>(items: T[], page: number, perPage: number): T[] {
  const size = Math.max(0, perPage)
  const start = Math.max(0, (Math.max(1, page) - 1) * size)
  return items.slice(start, start + size)
}

/** Format a salary range for human-readable output, or null when absent. */
export function formatSalary(job: JobRecord): string | null {
  if (job.salaryMin === null && job.salaryMax === null) return null
  const currency = job.salaryCurrency ? `${job.salaryCurrency} ` : ""
  const period = job.salaryPeriod ? `/${job.salaryPeriod}` : ""
  const num = (n: number): string => n.toLocaleString("en-US")
  if (job.salaryMin !== null && job.salaryMax !== null) {
    return `${currency}${num(job.salaryMin)}–${num(job.salaryMax)}${period}`
  }
  const only = job.salaryMin ?? job.salaryMax
  return only === null ? null : `${currency}${num(only)}${period}`
}
