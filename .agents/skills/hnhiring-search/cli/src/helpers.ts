// Data source: the Hacker News Search API by Algolia (hn.algolia.com/api/v1).
// Public, unauthenticated, no key, no attribution requirement, no robots.txt.
//
// "Ask HN: Who is hiring?" is a monthly thread posted by the `whoishiring` bot on
// the 1st of each month. Each top-level comment is one company's job posting, written
// as free text following a loose community convention:
//
//   Company | Role | Location | REMOTE | VISA | Salary | contact/url
//
// Field count and order vary wildly, so the parser below is deliberately tolerant:
// it classifies each pipe-separated field by shape rather than by position, and it
// NEVER drops a posting that failed to parse — an unparsed posting is emitted with
// null fields plus its full text so the reader still sees it.

export const API_BASE = "https://hn.algolia.com/api/v1"
export const SEARCH_URL = `${API_BASE}/search`
export const SEARCH_BY_DATE_URL = `${API_BASE}/search_by_date`
export const ITEM_URL = `${API_BASE}/items`
export const HN_ITEM_URL = "https://news.ycombinator.com/item?id="

export function writeError(error: string, code: string): void {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
}

// Honest User-Agent (fork convention). hn.algolia.com serves this fine — it has no
// robots.txt at all (404) and no bot-detection on the API, so there is nothing to
// impersonate. See url-reference.md.
const UA =
  "ai-job-search/1.0 (+https://github.com/MadsLorentzen/ai-job-search) personal-job-search"

/** Fetch JSON with exponential backoff on 429/5xx. Returns null on a 404. */
export async function jsonFetch<T>(url: string): Promise<T | null> {
  const maxRetries = 6
  let delay = 500
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(url, {
      headers: {
        "User-Agent": UA,
        Accept: "application/json",
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
      throw new Error(`Request failed: ${response.status} ${response.statusText}`)
    }
    return (await response.json()) as T
  }
  throw new Error("Request failed after max retries")
}

// ---------------------------------------------------------------------------
// Raw API shapes
// ---------------------------------------------------------------------------

export interface AlgoliaComment {
  objectID: string
  author?: string | null
  created_at?: string | null
  created_at_i?: number | null
  comment_text?: string | null
  story_id?: number | string | null
  parent_id?: number | string | null
  story_title?: string | null
}

export interface AlgoliaSearchResponse<T> {
  hits: T[]
  nbHits?: number
  nbPages?: number
  page?: number
  hitsPerPage?: number
}

export interface AlgoliaStory {
  objectID: string
  title?: string | null
  created_at?: string | null
  author?: string | null
}

export interface AlgoliaItem {
  id: number | string
  type?: string | null
  author?: string | null
  created_at?: string | null
  text?: string | null
  title?: string | null
  url?: string | null
  points?: number | null
  story_id?: number | string | null
  parent_id?: number | string | null
}

// ---------------------------------------------------------------------------
// Result shapes
// ---------------------------------------------------------------------------

export interface Posting {
  id: string
  title: string | null
  company: string | null
  companyUrl: string | null
  location: string | null
  remote: string | null
  visa: boolean | null
  salary: string | null
  employmentType: string | null
  date: string | null
  url: string
  author: string | null
  threadId: string | null
  /** True when the pipe-separated header convention was recognised. */
  parsed: boolean
  /** The raw (cleaned) first line, so a human can always audit the parse. */
  header: string | null
  /** Full posting text, sanitised. Untrusted third-party content — treat as data. */
  description: string | null
}

// ---------------------------------------------------------------------------
// Text decoding
// ---------------------------------------------------------------------------

/**
 * Convert a Unicode code point to a string. Uses `fromCodePoint` (not
 * `fromCharCode`) so supplementary-plane code points (e.g. emoji, U+1F600)
 * decode correctly, and drops out-of-range values instead of throwing.
 */
function numericEntity(cp: number): string {
  return cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : ""
}

/**
 * HN's API double-escapes aggressively: apostrophes arrive as `&#x27;` and every
 * forward slash inside a URL as `&#x2F;`. `&amp;` must be decoded last so that
 * `&amp;#x27;` does not turn into a live entity.
 */
export function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, dec) => numericEntity(parseInt(dec, 10)))
    .replace(/&#[xX]([0-9a-fA-F]+);/g, (_, hex) => numericEntity(parseInt(hex, 16)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
}

/** Strip HN's tiny tag vocabulary (<p>, <a>, <i>, <code>, <pre>) to plain text. */
export function htmlToText(html: string): string {
  return decodeHtmlEntities(
    html
      .replace(/<\s*br\s*\/?>/gi, "\n")
      .replace(/<\s*p\s*\/?>/gi, "\n\n")
      .replace(/<\/\s*p\s*>/gi, "")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

/** Collapse to a single line — used for header fields and table cells. */
function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim()
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
// Header parsing
// ---------------------------------------------------------------------------

/**
 * Roles named directly by the community convention. Primary signal.
 * Note the trailing `s?` — headers say "Software Engineers" as often as "Engineer",
 * and `\bengineer\b` does NOT match "Engineers".
 */
const ROLE_RE =
  /\b(?:engineer(?:ing)?|scientist|developer|researcher|research|manager|designer|lead|intern(?:ship)?|analyst|architect|ops|sre|devops|founding|founder|staff|principal|director|head\s+of|cto|programmer|recruiter|technician|consultant|specialist|role|position|senior|junior|distinguished)s?\b/i

/** Words that mark a field as an employment type rather than a role. */
const EMPLOYMENT_RE =
  /\b(?:full[\s-]?time|part[\s-]?time|contract(?:or)?|freelance|permanent|temporary|internship|intern|w2|c2c)\b/i

/**
 * A curated set of place tokens that appear constantly in these headers. This is a
 * heuristic tie-breaker only: a field naming one of these is more likely the location
 * than a tech-stack list that happens to sit in the same slot.
 */
const PLACE_WORD_RE =
  /\b(?:remote|anywhere|worldwide|global|onsite|on[\s-]site|hybrid|usa?|uk|eu|emea|apac|latam|europe|america|canada|germany|deutschland|austria|switzerland|netherlands|belgium|sweden|denmark|norway|finland|poland|france|spain|portugal|italy|ireland|israel|india|japan|singapore|australia|brazil|mexico|argentina|nyc|sf|bay\s+area|silicon\s+valley|london|berlin|munich|münchen|hamburg|frankfurt|cologne|köln|amsterdam|paris|madrid|barcelona|lisbon|dublin|zurich|zürich|vienna|copenhagen|stockholm|oslo|helsinki|warsaw|prague|tel\s+aviv|bangalore|bengaluru|tokyo|sydney|toronto|montreal|vancouver|new\s+york|boston|austin|seattle|chicago|denver|atlanta|miami|los\s+angeles|san\s+francisco|washington)\b/i

/** "Cambridge, MA" / "London, UK" — the classic city+code location shape. */
const CITY_CODE_RE = /,\s*[A-Z]{2}\b/

/** A field that is nothing but a "City, ST" pair (so it is a place, not a role). */
const PURE_CITY_CODE_RE = /^[A-Za-z .'À-ɏ-]+,\s*[A-Z]{2}$/

/** Workplace-type tokens. */
const REMOTE_RE = /\b(remote|onsite|on[\s-]site|in[\s-]office|hybrid)\b/i

/**
 * Salary-shaped substring: a currency amount, optionally a range, optionally a
 * directly-attached `+` (so "$200k–$350k+" keeps its plus but "$130k–$200k + equity"
 * does not swallow the words after the space).
 */
const SALARY_RE =
  /[$€£]\s?\d[\d,.]*\s*[kKmM]?(?:\s*(?:-|–|—|to)\s*[$€£]?\s?\d[\d,.]*\s*[kKmM]?)?\+?/

const URL_RE = /https?:\/\/[^\s"'<>)\]]+/

/** A field that is nothing but a bare domain or URL (e.g. "maincode.com"). */
const BARE_DOMAIN_RE = /^(?:https?:\/\/)?(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:\/\S*)?$/i

/**
 * Role phrase used as a fallback when the header carries no role field — e.g. a
 * posting that lists its openings as bullets in the body. This extracts REAL text
 * from the posting; it never invents a title.
 */
const ROLE_PHRASE_RE =
  /\b((?:Senior|Staff|Principal|Lead|Founding|Head\s+of|Chief|Junior|Mid[- ]level|Distinguished)?\s*[A-Z][\w+#/.-]*(?:\s+[A-Z][\w+#/.-]*){0,4}\s+(?:Engineer|Engineering\s+Manager|Scientist|Developer|Researcher|Manager|Designer|Architect|Analyst|Intern|Lead)s?)\b/

/** Normalise a workplace token to remote | hybrid | onsite. */
function normalizeRemoteToken(token: string): string {
  const t = token.toLowerCase().replace(/[\s-]/g, "")
  if (t === "hybrid") return "hybrid"
  if (t === "remote") return "remote"
  return "onsite"
}

/** Detect every workplace token present, e.g. "onsite/remote" for "ONSITE, REMOTE". */
export function detectRemote(text: string): string | null {
  const found = new Set<string>()
  const re = new RegExp(REMOTE_RE.source, "gi")
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) found.add(normalizeRemoteToken(m[1]))
  if (found.size === 0) return null
  return ["onsite", "hybrid", "remote"].filter((v) => found.has(v)).join("/")
}

/**
 * Visa signal. Explicit negations ("no visa sponsorship", "no sponsorship") mean
 * false; a bare VISA / sponsorship mention means true; silence means null.
 */
export function detectVisa(text: string): boolean | null {
  if (/\b(no|without|cannot|can't|not)\b[^|]{0,30}\b(visa|sponsor\w*)\b/i.test(text)) return false
  if (/\b(visa|sponsor\w*)\b[^|]{0,30}\b(not\s+available|unavailable)\b/i.test(text)) return false
  if (/\b(visa|sponsorship|sponsoring)\b/i.test(text)) return true
  return null
}

const WORK_TOKEN = "(?:on[\\s-]?site|remote|hybrid)"

/** True when every "(" in the string has a matching ")" after it. */
function parensBalanced(s: string): boolean {
  let depth = 0
  for (const ch of s) {
    if (ch === "(") depth++
    else if (ch === ")") {
      depth--
      if (depth < 0) return false
    }
  }
  return depth === 0
}

/**
 * Strip workplace tokens that lead or trail a location field, so "NYC, on-site"
 * becomes "NYC" and "Peninsula (Onsite)" becomes "Peninsula" — but "Fully Remote (US)"
 * and "Remote-first" are left alone, because there the token IS the location.
 * Also drops a trailing "(… visa sponsorship …)" aside.
 */
export function stripRemoteFromLocation(loc: string): string {
  let s = loc
  // Leading token run, but only when a real separator follows ("On-site (hybrid) in X").
  s = s.replace(
    new RegExp(
      `^\\s*${WORK_TOKEN}\\b(?:\\s*[/,&+]\\s*${WORK_TOKEN}\\b)*\\s*(?:\\(\\s*${WORK_TOKEN}\\s*\\))?\\s*(?:,|;|\\bin\\b|-\\s)\\s*`,
      "i",
    ),
    "",
  )
  // Trailing token run, optionally parenthesised.
  const trailingStripped = s.replace(
    new RegExp(
      `[\\s,;/]*\\(?\\s*${WORK_TOKEN}\\b(?:\\s*[/,&+]\\s*${WORK_TOKEN}\\b)*\\s*\\)?\\s*$`,
      "i",
    ),
    "",
  )
  // Refuse the strip when it would cut INTO a parenthetical and leave a dangling
  // bracket. Real headers say "Montreal, QC (hybrid, 2-3 days/week onsite)" and
  // "Boston, MA (ONSITE - Hybrid)"; peeling just the trailing token out of those
  // yields the truncated garbage "Montreal, QC (hybrid, 2-3 days/week" and
  // "Boston, MA (ONSITE". A longer honest string beats a mangled one — the workplace
  // itself is already captured separately by detectRemote().
  s = !parensBalanced(trailingStripped) && parensBalanced(s) ? s : trailingStripped
  // Visa asides are not part of a location.
  s = s.replace(/\s*\([^)]*\b(?:visa|sponsor\w*|work[\s-]authori[sz]ed)\b[^)]*\)/gi, "")
  return s.replace(/\s+/g, " ").replace(/^[\s,;/-]+|[\s,;/-]+$/g, "").trim()
}

/** Trim HN italics asterisks and a trailing "(domain.com)" from a company name. */
function cleanCompany(raw: string): { company: string; url: string | null } {
  let s = raw.replace(/^\*+|\*+$/g, "").trim()
  let url: string | null = null
  const paren = s.match(/\(\s*((?:https?:\/\/)?(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+[^\s)]*)\s*\)\s*$/i)
  if (paren) {
    url = paren[1].startsWith("http") ? paren[1] : `https://${paren[1]}`
    s = s.slice(0, paren.index).trim()
  }
  return { company: s, url }
}

/** Extract the first http(s) URL from the raw comment HTML (href or inline). */
export function extractUrl(rawHtml: string): string | null {
  const decoded = decodeHtmlEntities(rawHtml)
  const href = decoded.match(/href="(https?:\/\/[^"]+)"/i)
  if (href) return href[1]
  const inline = decoded.match(URL_RE)
  return inline ? inline[0] : null
}

/** The header is everything before the first paragraph break or newline. */
export function extractHeader(rawHtml: string): string {
  const cut = rawHtml.split(/<\s*p\s*\/?>|\r?\n/i)[0] ?? ""
  return oneLine(htmlToText(cut))
}

export interface ParsedHeader {
  parsed: boolean
  company: string | null
  companyUrl: string | null
  title: string | null
  location: string | null
  remote: string | null
  visa: boolean | null
  salary: string | null
  employmentType: string | null
}

/**
 * Tolerant header parser. Splits on `|` and classifies each field by shape, because
 * field order is a convention, not a rule. Position is used for exactly one thing:
 * field 0 is the company.
 */
export function parseHeader(header: string, fullText: string): ParsedHeader {
  const empty: ParsedHeader = {
    parsed: false,
    company: null,
    companyUrl: null,
    title: null,
    location: null,
    remote: null,
    visa: null,
    salary: null,
    employmentType: null,
  }

  const salaryMatch = header.match(SALARY_RE)
  const salary = salaryMatch ? oneLine(salaryMatch[0]).replace(/\s+/g, "") : null
  const remote = detectRemote(header)
  const visa = detectVisa(header)

  const fields = header
    .split("|")
    .map((f) => oneLine(f))
    .filter((f) => f.length > 0)

  // No pipes → the convention was not followed. Fall back without inventing data.
  if (fields.length < 2) {
    const head = oneLine(header)
    return {
      ...empty,
      parsed: false,
      company: head ? head.slice(0, 60).trim() || null : null,
      title: roleFromText(fullText),
      remote: remote ?? detectRemote(fullText),
      visa,
      salary: salary ?? null,
    }
  }

  const { company, url: companyUrlFromName } = cleanCompany(fields[0])

  let title: string | null = null
  let employmentType: string | null = null
  let bareDomain: string | null = null

  const leftovers: string[] = []

  for (let i = 1; i < fields.length; i++) {
    const f = fields[i]

    // A field that is only a URL/domain carries no classification value, but it is
    // a decent companyUrl fallback when the body has no link.
    if (BARE_DOMAIN_RE.test(f)) {
      if (!bareDomain) bareDomain = f
      continue
    }
    // A salary-only field is already captured by `salary`.
    if (SALARY_RE.test(f) && f.replace(SALARY_RE, "").replace(/[^a-z]/gi, "").length <= 8) continue

    // Employment type only when the field is *nothing but* employment words.
    if (
      !employmentType &&
      EMPLOYMENT_RE.test(f) &&
      f
        .replace(new RegExp(EMPLOYMENT_RE.source, "gi"), "")
        .replace(/[^a-z0-9]/gi, "").length === 0
    ) {
      employmentType = f
      continue
    }

    // Role-ish? First match wins, unless the field is a bare "City, ST" pair. Every
    // role-ish field is excluded from the location candidates, not just the first —
    // multi-role postings list several and none of them is a place.
    if (ROLE_RE.test(f) && !PURE_CITY_CODE_RE.test(f)) {
      if (!title) title = f
      continue
    }

    leftovers.push(f)
  }

  return {
    parsed: true,
    company: company || null,
    companyUrl: companyUrlFromName ?? (bareDomain ? toHttps(bareDomain) : null),
    title: title ?? roleFromText(fullText),
    location: pickLocation(leftovers),
    remote: remote ?? detectRemote(fullText),
    visa,
    salary,
    employmentType,
  }
}

function toHttps(domain: string): string {
  return /^https?:\/\//i.test(domain) ? domain : `https://${domain}`
}

/**
 * Choose the location among the unclassified fields. Order matters: field position is
 * not reliable (a tech-stack list often sits where the location "should" be), so we
 * prefer, in turn, an explicit "City, ST" pair, a known place word, a field carrying a
 * workplace token, then anything short enough to plausibly be a place. A field that is
 * only a workplace token ("Remote") is used last — there the token IS the location.
 */
export function pickLocation(leftovers: string[]): string | null {
  const candidates = leftovers
    .filter((f) => !SALARY_RE.test(f))
    .map((f) => ({ raw: f, stripped: stripRemoteFromLocation(f) }))
    .filter((c) => !/\b(?:visa|sponsor\w*)\b/i.test(c.stripped))

  const substantive = candidates.filter((c) => c.stripped.length > 0 && c.stripped.length <= 80)

  const byCityCode = substantive.find((c) => CITY_CODE_RE.test(c.stripped))
  if (byCityCode) return byCityCode.stripped

  const byPlaceWord = substantive.find((c) => PLACE_WORD_RE.test(c.stripped))
  if (byPlaceWord) return byPlaceWord.stripped

  const byToken = substantive.find((c) => REMOTE_RE.test(c.raw))
  if (byToken) return byToken.stripped

  if (substantive.length > 0) return substantive[0].stripped

  // Everything left collapsed to nothing — i.e. it was a bare "Remote"/"ONSITE".
  const bare = candidates.find((c) => REMOTE_RE.test(c.raw))
  return bare ? bare.raw : null
}

/**
 * Pull a real role phrase out of the posting body. Used only when the header has no
 * role field (multi-role postings that list openings as bullets). Returns null rather
 * than guessing.
 */
export function roleFromText(fullText: string | null): string | null {
  if (!fullText) return null
  const body = fullText.split(/\n/).slice(1).join("\n")
  const m = body.match(ROLE_PHRASE_RE)
  if (!m) return null
  const phrase = oneLine(m[1]).replace(/^(?:We|Our|The|A|An|Us|You|I)\s+/i, "").trim()
  if (phrase.length < 3 || phrase.length > 70) return null
  return phrase
}

// ---------------------------------------------------------------------------
// Record assembly
// ---------------------------------------------------------------------------

/** Normalise an HN timestamp to full ISO-8601 (UTC). Returns null if unusable. */
export function toIso(value: string | null | undefined): string | null {
  if (!value) return null
  const d = new Date(value)
  if (isNaN(d.getTime())) return null
  return d.toISOString()
}

/**
 * Turn one Algolia comment into a Posting. Wrapped so a single malformed record can
 * never abort the batch — on any unexpected shape we still emit the id and raw text.
 */
export function parseComment(hit: AlgoliaComment): Posting {
  const id = String(hit.objectID ?? "")
  const url = `${HN_ITEM_URL}${id}`
  const raw = hit.comment_text ?? ""
  const base: Posting = {
    id,
    title: null,
    company: null,
    companyUrl: null,
    location: null,
    remote: null,
    visa: null,
    salary: null,
    employmentType: null,
    date: toIso(hit.created_at),
    url,
    author: hit.author ?? null,
    threadId: hit.story_id != null ? String(hit.story_id) : null,
    parsed: false,
    header: null,
    description: null,
  }
  try {
    const fullText = htmlToText(raw)
    const header = extractHeader(raw)
    const h = parseHeader(header, fullText)
    return {
      ...base,
      title: h.title,
      company: h.company,
      companyUrl: h.companyUrl ?? extractUrl(raw),
      location: h.location,
      remote: h.remote,
      visa: h.visa,
      salary: h.salary,
      employmentType: h.employmentType,
      parsed: h.parsed,
      header: header || null,
      description: sanitizeDescription(fullText),
    }
  } catch {
    // Never drop a posting: emit it with nulls plus whatever text we can salvage.
    return { ...base, description: sanitizeDescription(htmlToText(raw)) }
  }
}

/** Parse a whole search response, independently per record. */
export function parseComments(
  body: AlgoliaSearchResponse<AlgoliaComment> | null,
  opts: { topLevelOnly?: boolean } = {},
): Posting[] {
  if (!body || !Array.isArray(body.hits)) return []
  const hits = opts.topLevelOnly
    ? body.hits.filter(
        (h) => h.parent_id != null && h.story_id != null && String(h.parent_id) === String(h.story_id),
      )
    : body.hits
  return hits.map(parseComment)
}

// ---------------------------------------------------------------------------
// Thread resolution
// ---------------------------------------------------------------------------

const WHO_IS_HIRING_RE = /Ask HN:\s*Who is hiring\?/i

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
]

export interface ThreadRef {
  id: string
  title: string | null
  date: string | null
}

/** Pick the newest "Ask HN: Who is hiring?" story, or the one for a given YYYY-MM. */
export function pickThread(
  body: AlgoliaSearchResponse<AlgoliaStory> | null,
  month?: string,
): ThreadRef | null {
  if (!body || !Array.isArray(body.hits)) return null
  const candidates = body.hits.filter((h) => WHO_IS_HIRING_RE.test(h.title ?? ""))
  if (candidates.length === 0) return null

  if (month) {
    const m = month.match(/^(\d{4})-(\d{2})$/)
    if (!m) return null
    const name = MONTH_NAMES[parseInt(m[2], 10) - 1]
    if (!name) return null
    const needle = new RegExp(`\\(${name}\\s+${m[1]}\\)`, "i")
    const hit = candidates.find((h) => needle.test(h.title ?? ""))
    return hit ? { id: hit.objectID, title: hit.title ?? null, date: toIso(hit.created_at) } : null
  }

  // search_by_date is already newest-first, but sort defensively.
  const sorted = [...candidates].sort(
    (a, b) => new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime(),
  )
  const top = sorted[0]
  return { id: top.objectID, title: top.title ?? null, date: toIso(top.created_at) }
}

/** Validate a --month value without touching the network. */
export function isValidMonth(value: string): boolean {
  const m = value.match(/^(\d{4})-(\d{2})$/)
  if (!m) return false
  const mm = parseInt(m[2], 10)
  return mm >= 1 && mm <= 12
}
