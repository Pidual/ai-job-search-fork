import {
  SEARCH_URL,
  SEARCH_BY_DATE_URL,
  jsonFetch,
  parseComments,
  pickThread,
  writeError,
  type AlgoliaComment,
  type AlgoliaSearchResponse,
  type AlgoliaStory,
  type Posting,
  type ThreadRef,
} from "../helpers.js"

export interface SearchOpts {
  query?: string
  location?: string
  thread?: string
  month?: string
  remote: boolean
  includeReplies: boolean
  jobage: number
  page: number
  limit?: number
  format: "json" | "table" | "plain"
}

const DEFAULT_PAGE_SIZE = 50

/**
 * Resolve the thread id. `--thread` wins; otherwise ask Algolia for the
 * whoishiring bot's recent stories and pick the newest "Who is hiring?" one
 * (or the one matching `--month`).
 */
export async function resolveThread(opts: {
  thread?: string
  month?: string
}): Promise<ThreadRef | null> {
  if (opts.thread) return { id: opts.thread, title: null, date: null }
  // A generous page size so `--month` can reach several years back.
  const hitsPerPage = opts.month ? 100 : 5
  const url = `${SEARCH_BY_DATE_URL}?tags=story,author_whoishiring&query=hiring&hitsPerPage=${hitsPerPage}`
  const body = await jsonFetch<AlgoliaSearchResponse<AlgoliaStory>>(url)
  return pickThread(body, opts.month)
}

function buildCommentsUrl(threadId: string, query?: string): string {
  const params = new URLSearchParams()
  params.set("tags", `comment,story_${threadId}`)
  // Server-side full-text search across the whole thread — a real advantage over
  // fetching everything and grepping locally.
  if (query) params.set("query", query)
  params.set("hitsPerPage", "1000")
  return `${SEARCH_URL}?${params.toString()}`
}

function renderTable(rows: Posting[]): string {
  if (rows.length === 0) return "No results."
  const header =
    "ID".padEnd(10) +
    " " +
    "COMPANY".padEnd(24) +
    " " +
    "TITLE".padEnd(38) +
    " " +
    "LOCATION".padEnd(26) +
    " " +
    "WORK".padEnd(14) +
    " SALARY"
  const lines = rows.map((r) => {
    const id = r.id.padEnd(10)
    const company = (r.company || "—").slice(0, 24).padEnd(24)
    const title = (r.title || "—").slice(0, 38).padEnd(38)
    const loc = (r.location || "—").slice(0, 26).padEnd(26)
    const work = (r.remote || "—").slice(0, 14).padEnd(14)
    const salary = r.salary || "—"
    return `${id} ${company} ${title} ${loc} ${work} ${salary}`
  })
  return [header, "-".repeat(header.length), ...lines].join("\n")
}

function renderPlain(rows: Posting[]): string {
  if (rows.length === 0) return "No results."
  return rows
    .map((r) => {
      const bits = [
        r.company || "(unknown company)",
        r.title ? `— ${r.title}` : "",
      ]
        .filter(Boolean)
        .join(" ")
      const meta = [
        r.location || "—",
        r.remote || null,
        r.employmentType || null,
        r.salary || null,
        r.visa === true ? "visa: yes" : r.visa === false ? "visa: no" : null,
      ]
        .filter(Boolean)
        .join(" · ")
      return `${bits}\n  ${meta}\n  id: ${r.id}\n  ${r.url}${
        r.companyUrl ? `\n  ${r.companyUrl}` : ""
      }`
    })
    .join("\n\n")
}

export async function runSearch(opts: SearchOpts): Promise<number> {
  try {
    const thread = await resolveThread({ thread: opts.thread, month: opts.month })
    if (!thread) {
      writeError(
        opts.month
          ? `No "Ask HN: Who is hiring?" thread found for ${opts.month}`
          : 'Could not resolve the current "Ask HN: Who is hiring?" thread',
        "NO_THREAD",
      )
      return 1
    }

    const body = await jsonFetch<AlgoliaSearchResponse<AlgoliaComment>>(
      buildCommentsUrl(thread.id, opts.query),
    )
    if (!body) {
      writeError(`Thread ${thread.id} not found`, "NOT_FOUND")
      return 1
    }

    let rows = parseComments(body, { topLevelOnly: !opts.includeReplies })
    const total = rows.length

    if (opts.remote) {
      rows = rows.filter((r) => (r.remote ?? "").includes("remote"))
    }
    if (opts.location) {
      const needle = opts.location.toLowerCase()
      rows = rows.filter((r) => (r.location ?? r.header ?? "").toLowerCase().includes(needle))
    }
    if (opts.jobage > 0 && opts.jobage < 9999) {
      const cutoff = Date.now() - opts.jobage * 86400000
      rows = rows.filter((r) => {
        if (!r.date) return true
        const t = new Date(r.date).getTime()
        return isNaN(t) ? true : t >= cutoff
      })
    }

    const matched = rows.length
    const pageSize = opts.limit !== undefined && opts.limit > 0 ? opts.limit : DEFAULT_PAGE_SIZE
    const start = (opts.page - 1) * pageSize
    rows = opts.limit === 0 ? [] : rows.slice(start, start + pageSize)

    if (opts.format === "table") {
      process.stdout.write(renderTable(rows) + "\n")
    } else if (opts.format === "plain") {
      process.stdout.write(renderPlain(rows) + "\n")
    } else {
      process.stdout.write(
        JSON.stringify(
          {
            meta: {
              count: rows.length,
              page: opts.page,
              pageSize,
              matched,
              total,
              threadId: thread.id,
              threadTitle: thread.title,
              threadDate: thread.date,
              query: opts.query ?? null,
              source: "Hacker News — Ask HN: Who is hiring? (via hn.algolia.com)",
            },
            results: rows,
          },
          null,
          2,
        ) + "\n",
      )
    }
    return 0
  } catch (e) {
    writeError(e instanceof Error ? e.message : String(e), "SEARCH_FAILED")
    return 1
  }
}
