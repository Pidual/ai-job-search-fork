import {
  ALL_JOBS_FEED,
  DEFAULT_FEED_SLUGS,
  categoryFeedUrl,
  dedupeById,
  feedFetch,
  matchesQuery,
  parseFeed,
  withinJobage,
  writeError,
  type JobItem,
} from "../helpers.js"

export interface SearchOpts {
  query?: string
  /** Validated category slugs. Empty means "use the default feed set". */
  categories: string[]
  jobage?: number
  /** 1-indexed client-side slice — the feeds are fixed-size, there is no server pagination. */
  page: number
  limit?: number
  format: "json" | "table" | "plain"
}

const DEFAULT_PAGE_SIZE = 25

/**
 * Which feeds to read. With explicit --category slugs we read exactly those; otherwise the
 * all-jobs feed plus the engineering categories, because WWR has no data/AI category feed.
 */
export function feedsFor(categories: string[]): { url: string; name: string }[] {
  if (categories.length > 0) {
    return categories.map((slug) => ({ url: categoryFeedUrl(slug), name: slug }))
  }
  return [
    { url: ALL_JOBS_FEED, name: "all" },
    ...DEFAULT_FEED_SLUGS.map((slug) => ({ url: categoryFeedUrl(slug), name: slug })),
  ]
}

const TABLE_HEADERS = ["ID", "TITLE", "COMPANY", "LOCATION", "DATE"] as const

/** Clip an optional cell to `max`, marking the clip. Empty/absent becomes an em dash. */
function cell(value: string | null, max: number): string {
  const text = value && value.trim() ? value.trim() : "—"
  return text.length > max ? text.slice(0, max - 1) + "…" : text
}

/**
 * Render a result table with content-sized columns.
 *
 * The ID column is NEVER truncated. The documented workflow is to copy an id straight out
 * of this table into `detail <id>`, and WWR slugs routinely exceed 50 characters — a clipped
 * id looks plausible but resolves to NOT_FOUND, which is worse than a wide table.
 */
export function renderTable(items: JobItem[]): string {
  if (items.length === 0) return "No results."
  const rows = items.map((item) => [
    item.id,
    cell(item.title, 60),
    cell(item.company, 24),
    cell(item.location, 24),
    item.date || "—",
  ])
  const widths = TABLE_HEADERS.map((header, i) =>
    Math.max(header.length, ...rows.map((row) => row[i]!.length)),
  )
  const line = (cells: readonly string[]): string =>
    cells
      .map((value, i) => (i === cells.length - 1 ? value : value.padEnd(widths[i]!)))
      .join("  ")
      .trimEnd()
  const rule = "-".repeat(widths.reduce((a, b) => a + b, 0) + 2 * (widths.length - 1))
  return [line(TABLE_HEADERS), rule, ...rows.map(line)].join("\n")
}

function renderPlain(items: JobItem[]): string {
  if (items.length === 0) return "No results."
  return items
    .map((item) =>
      [
        item.title,
        `  ${item.company || "—"} · ${item.location || "—"} · ${item.type || "—"} · ${item.date || "—"}`,
        `  id: ${item.id}`,
        `  ${item.url}`,
      ].join("\n"),
    )
    .join("\n\n")
}

export async function runSearch(opts: SearchOpts): Promise<number> {
  try {
    const feeds = feedsFor(opts.categories)
    const collected: JobItem[] = []
    for (const feed of feeds) {
      const xml = await feedFetch(feed.url)
      collected.push(...parseFeed(xml, feed.name))
    }

    const all = dedupeById(collected)
      .filter((item) => matchesQuery(item, opts.query))
      .filter((item) => withinJobage(item, opts.jobage))
      // Newest first. Items with no date sink to the bottom.
      .sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""))

    const pageSize = opts.limit !== undefined ? opts.limit : DEFAULT_PAGE_SIZE
    const start = (opts.page - 1) * pageSize
    const results = all.slice(start, start + pageSize)

    if (opts.format === "table") {
      process.stdout.write(renderTable(results) + "\n")
    } else if (opts.format === "plain") {
      process.stdout.write(renderPlain(results) + "\n")
    } else {
      process.stdout.write(
        JSON.stringify(
          {
            meta: {
              count: results.length,
              page: opts.page,
              pageSize,
              matched: all.length,
              feeds: feeds.map((f) => f.name),
              query: opts.query ?? null,
              jobage: opts.jobage ?? null,
              source: "weworkremotely-rss",
            },
            results,
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
