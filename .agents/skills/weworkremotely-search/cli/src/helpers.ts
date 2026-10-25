// Data source: We Work Remotely's public RSS 2.0 feeds. No authentication, no API key.
//
// Only the `.rss` paths are usable. The HTML site (https://weworkremotely.com/remote-jobs,
// and every /remote-jobs/<slug> detail page) answers 403 to automated requests regardless of
// User-Agent, so there is NO detail-page fetch in this skill — the RSS <description> already
// carries the full posting body, which is what `detail` returns.
//
// The feed is XML with entity-escaped HTML inside <description>. We parse it with regex:
// the document is a flat <channel><item>… list with no nesting to speak of, so a full XML
// parser would buy nothing and this package is deliberately zero-runtime-dependency.

export const SITE = "https://weworkremotely.com"
export const ALL_JOBS_FEED = `${SITE}/remote-jobs.rss`

/** Build the feed URL for a category slug. */
export function categoryFeedUrl(slug: string): string {
  return `${SITE}/categories/${slug}.rss`
}

/**
 * Category slugs whose `.rss` feed actually serves items (verified live 2026-08-05,
 * item counts at capture time in the comments).
 */
export const CATEGORY_SLUGS = [
  "remote-programming-jobs", // 25
  "remote-devops-sysadmin-jobs", // 51
  "remote-design-jobs", // 94
  "remote-full-stack-programming-jobs", // 129
  "remote-back-end-programming-jobs", // 30
  "remote-front-end-programming-jobs", // 16
  "remote-product-jobs", // 67
  "remote-sales-and-marketing-jobs", // 147-149
  "remote-customer-support-jobs", // 56
  "remote-management-and-finance-jobs", // 39
] as const

/**
 * Slugs that look plausible but are permanently dead: they answer 301 with an empty body
 * and no Location header, so they yield 0 items. Kept here so the error message can say
 * "this one is dead" instead of "unknown slug".
 */
export const DEAD_CATEGORY_SLUGS = [
  "remote-data-jobs",
  "remote-marketing-jobs",
  "remote-all-other-remote-jobs",
] as const

/**
 * There is NO data/AI/ML category feed on We Work Remotely. For AI/ML searches the best
 * available approach is the all-jobs feed plus the engineering categories, filtered
 * client-side on --query. This is the default feed set when no --category is given.
 */
export const DEFAULT_FEED_SLUGS = [
  "remote-programming-jobs",
  "remote-devops-sysadmin-jobs",
  "remote-full-stack-programming-jobs",
] as const

export function writeError(error: string, code: string): void {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
}

/**
 * Honest User-Agent per the repo convention. Verified live 2026-08-05: the `.rss` paths
 * serve 200 to this UA, so there is no reason to impersonate a browser here. (The HTML
 * site 403s every UA including Mozilla/5.0 — see url-reference.md.)
 */
const UA =
  "ai-job-search/1.0 (+https://github.com/MadsLorentzen/ai-job-search) personal-job-search"

/**
 * Fetch a feed with exponential backoff on 429/5xx.
 * Returns "" for a feed that is gone (404/410) or answers a bodyless redirect (3xx) —
 * WWR's retired category feeds do exactly that, and one dead feed must not abort a
 * multi-feed search.
 */
export async function feedFetch(url: string): Promise<string> {
  const maxRetries = 6
  let delay = 500
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(url, {
      headers: {
        "User-Agent": UA,
        Accept: "application/rss+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.5",
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
    if (response.status === 404 || response.status === 410) return ""
    if (response.status >= 300 && response.status < 400) return ""
    if (!response.ok) {
      throw new Error(`Request failed: ${response.status} ${response.statusText}`)
    }
    return response.text()
  }
  throw new Error("Request failed after max retries")
}

export interface JobItem {
  /** Stable slug derived from the item's <link>/<guid> (e.g. "stripe-backend-engineer-ai-security"). */
  id: string
  title: string
  company: string | null
  location: string | null
  /** ISO YYYY-MM-DD, derived from the RFC-822 <pubDate>. */
  date: string | null
  url: string
  /** Full ISO-8601 timestamp from <pubDate>, or null when unparseable. */
  publishedAt: string | null
  guid: string | null
  region: string | null
  category: string | null
  type: string | null
  /** Plain text, sanitised. The RSS description IS the full posting body. */
  description: string | null
  /** Which feed this item was read from — useful when several feeds are merged. */
  feed: string | null
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

/**
 * Convert a Unicode code point to a string. Uses `fromCodePoint` (not `fromCharCode`) so
 * supplementary-plane code points (e.g. emoji, U+1F600) decode correctly, and drops
 * out-of-range values instead of throwing.
 */
function numericEntity(cp: number): string {
  return cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : ""
}

export function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&mdash;/g, "—")
    .replace(/&ndash;/g, "–")
    .replace(/&hellip;/g, "…")
    // Numeric character references: decimal (&#233;) and hexadecimal (&#xE9;).
    .replace(/&#(\d+);/g, (_, dec) => numericEntity(parseInt(dec, 10)))
    .replace(/&#[xX]([0-9a-fA-F]+);/g, (_, hex) => numericEntity(parseInt(hex, 16)))
    // &amp; LAST so "&amp;lt;" does not collapse into a tag on a single pass.
    .replace(/&amp;/g, "&")
}

/** Unwrap a `<![CDATA[ … ]]>` wrapper if present. Defensive: WWR currently entity-escapes
 * instead of using CDATA, but sibling feeds on the same platform have used CDATA. */
export function unwrapCdata(text: string): string {
  const m = text.match(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/)
  return m ? m[1] : text
}

/** Raw inner text of the first `<tag>…</tag>` in a chunk, CDATA-unwrapped. Null when absent. */
export function tagText(chunk: string, tag: string): string | null {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "i")
  const m = re.exec(chunk)
  if (!m) return null
  return unwrapCdata(m[1])
}

/** Decoded, whitespace-collapsed inner text of a tag. Null when absent or empty. */
function tagValue(chunk: string, tag: string): string | null {
  const raw = tagText(chunk, tag)
  if (raw === null) return null
  const value = decodeHtmlEntities(raw).replace(/\s+/g, " ").trim()
  return value || null
}

/**
 * Turn the description's HTML into readable plain text, preserving paragraph breaks.
 * The feed double-encodes: the XML text node holds entity-escaped HTML, so the caller
 * decodes once to recover the HTML and this function decodes again after stripping tags.
 */
export function htmlToText(html: string): string {
  const withBreaks = html
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\s*li[^>]*>/gi, "\n- ")
    .replace(/<\/(p|li|ul|ol|div|h[1-6]|tr|blockquote)\s*>/gi, "\n")
    .replace(/<\s*(p|div|h[1-6]|tr|blockquote)[^>]*>/gi, "\n")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
  return decodeHtmlEntities(withBreaks.replace(/<[^>]+>/g, ""))
    .replace(/[ \t\u00a0]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

/**
 * WWR titles are "Company: Role". Split on the FIRST ": ". When there is no ": " the whole
 * string is the title and the company is unknown (null) — never guess.
 */
export function splitTitle(raw: string): { company: string | null; title: string } {
  const idx = raw.indexOf(": ")
  if (idx <= 0) return { company: null, title: raw.trim() }
  const company = raw.slice(0, idx).trim()
  const title = raw.slice(idx + 2).trim()
  if (!company || !title) return { company: null, title: raw.trim() }
  return { company, title }
}

/** Parse an RFC-822 <pubDate> into { date: "YYYY-MM-DD", iso }. Nulls when unparseable. */
export function parseRfc822(raw: string | null): { date: string | null; iso: string | null } {
  if (!raw) return { date: null, iso: null }
  const ms = Date.parse(raw.trim())
  if (Number.isNaN(ms)) return { date: null, iso: null }
  const iso = new Date(ms).toISOString()
  return { date: iso.slice(0, 10), iso }
}

/**
 * Stable id: the trailing slug of the item's link/guid. WWR links look like
 * https://weworkremotely.com/remote-jobs/<slug> — the slug is unique and human-readable.
 */
export function idFromLink(link: string | null): string | null {
  if (!link) return null
  const cleaned = link.split(/[?#]/)[0].replace(/\/+$/, "")
  const slug = cleaned.slice(cleaned.lastIndexOf("/") + 1)
  return slug || null
}

/** Reconstruct the canonical posting URL from an id (slug). */
export function urlFromId(id: string): string {
  return `${SITE}/remote-jobs/${id}`
}

/**
 * Parse an RSS document into items. The XML is split on `<item>` and each chunk is parsed
 * independently, so one malformed or truncated item cannot break the rest of the feed.
 */
export function parseFeed(xml: string, feed: string | null = null): JobItem[] {
  const results: JobItem[] = []
  if (!xml) return results

  for (const piece of xml.split(/<item(?:\s[^>]*)?>/i).slice(1)) {
    const end = piece.search(/<\/item\s*>/i)
    const chunk = end === -1 ? piece : piece.slice(0, end)

    const rawTitle = tagText(chunk, "title")
    const link = tagValue(chunk, "link")
    const guid = tagValue(chunk, "guid")

    const id = idFromLink(link) ?? idFromLink(guid)
    // Without an id there is nothing stable to key on or to pass to `detail`. Skip, but
    // keep going: the surrounding items are still fine.
    if (!id) continue

    let company: string | null = null
    let title: string | null = null
    if (rawTitle !== null) {
      const decoded = decodeHtmlEntities(rawTitle).replace(/\s+/g, " ").trim()
      if (decoded) {
        const split = splitTitle(decoded)
        company = split.company
        title = split.title
      }
    }
    // A title is the one field a job posting cannot meaningfully lack; fall back to the
    // slug rather than emitting null (the contract requires a title).
    if (!title) title = id.replace(/-/g, " ")

    const region = tagValue(chunk, "region")
    const { date, iso } = parseRfc822(tagText(chunk, "pubDate"))

    const rawDescription = tagText(chunk, "description")
    const description = rawDescription
      ? sanitizeDescription(htmlToText(decodeHtmlEntities(rawDescription)))
      : null

    results.push({
      id,
      title,
      company,
      location: region,
      date,
      url: link ?? guid ?? urlFromId(id),
      publishedAt: iso,
      guid: guid ?? link ?? null,
      region,
      category: tagValue(chunk, "category"),
      type: tagValue(chunk, "type"),
      description,
      feed,
    })
  }

  return results
}

/** Case-insensitive substring match over title, company and description. */
export function matchesQuery(item: JobItem, query: string | undefined): boolean {
  if (!query) return true
  const needle = query.toLowerCase()
  const haystack = [item.title, item.company, item.category, item.description]
    .filter((v): v is string => typeof v === "string")
    .join("\n")
    .toLowerCase()
  return haystack.includes(needle)
}

/** Keep items published within the last `days` days. Items with no date are kept. */
export function withinJobage(item: JobItem, days: number | undefined): boolean {
  if (days === undefined || days >= 9999) return true
  if (!item.publishedAt) return true
  const ms = Date.parse(item.publishedAt)
  if (Number.isNaN(ms)) return true
  return Date.now() - ms <= days * 86400000
}

/** Merge feeds, dropping duplicates by id (a job appears in both all-jobs and its category). */
export function dedupeById(items: JobItem[]): JobItem[] {
  const seen = new Set<string>()
  const out: JobItem[] = []
  for (const item of items) {
    if (seen.has(item.id)) continue
    seen.add(item.id)
    out.push(item)
  }
  return out
}

/** Validate a --category slug. Returns null when valid, else a human-readable message. */
export function validateCategory(slug: string): string | null {
  if ((CATEGORY_SLUGS as readonly string[]).includes(slug)) return null
  const dead = (DEAD_CATEGORY_SLUGS as readonly string[]).includes(slug)
  const lead = dead
    ? `--category "${slug}" is a retired We Work Remotely feed (permanent 301, 0 items)`
    : `--category "${slug}" is not a known We Work Remotely category`
  return (
    `${lead}. Valid slugs: ${CATEGORY_SLUGS.join(", ")}. ` +
    `Note there is no data/AI category feed — omit --category to search the all-jobs feed ` +
    `plus the engineering categories and filter with --query.`
  )
}
