import {
  API_BASE,
  MAX_COUNT,
  NO_JOBAGE,
  formatSalary,
  jsonFetch,
  paginate,
  parsePayload,
  withinJobAge,
  writeError,
  type JobRecord,
} from "../helpers.js"

export interface SearchOpts {
  /** Maps to the API's `tag` param — a REAL server-side keyword filter. */
  query?: string
  /** Maps to `geo` (a predefined slug, e.g. usa / germany / europe). */
  geo?: string
  /** Maps to `industry` (a predefined slug, e.g. data-science). */
  industry?: string
  /** Client-side filter on pubDate. NO_JOBAGE = no filter. */
  jobage: number
  /** Client-side slice — the API has no pagination. */
  page: number
  limit?: number
  format: "json" | "table" | "plain"
}

export interface SearchPlan {
  url: string
  /** `count` value actually sent to the API. */
  apiCount: number
  /** Effective per-page size after clamping. */
  perPage: number
  /** The raw --limit the user asked for, before the 100 clamp. */
  requestedLimit: number | null
  limitClamped: boolean
}

/**
 * Work out the request. `count` caps at 100 server-side, so we clamp --limit and
 * report the clamp in `meta`. We ask for only as many rows as the requested page
 * needs — except when --jobage is set, where the client-side date filter can
 * shrink the pool, so we pull the full 100 to have something left to page over.
 */
export function planSearch(opts: SearchOpts): SearchPlan {
  const requestedLimit = opts.limit ?? null
  const limitClamped = requestedLimit !== null && requestedLimit > MAX_COUNT
  const perPage = requestedLimit === null ? MAX_COUNT : Math.min(requestedLimit, MAX_COUNT)
  const needed = Math.max(1, opts.page) * perPage
  const apiCount =
    opts.jobage < NO_JOBAGE ? MAX_COUNT : Math.min(MAX_COUNT, Math.max(1, needed))

  const params = new URLSearchParams()
  params.set("count", String(apiCount))
  if (opts.query) params.set("tag", opts.query)
  if (opts.geo) params.set("geo", opts.geo)
  if (opts.industry) params.set("industry", opts.industry)

  return {
    url: `${API_BASE}?${params.toString()}`,
    apiCount,
    perPage,
    requestedLimit,
    limitClamped,
  }
}

function renderTable(jobs: JobRecord[], attribution: string | null): string {
  const header =
    "ID".padEnd(8) +
    " " +
    "TITLE".padEnd(46) +
    " " +
    "COMPANY".padEnd(24) +
    " " +
    "LOCATION".padEnd(22) +
    " DATE"
  const body =
    jobs.length === 0
      ? "No results."
      : jobs
          .map((j) => {
            const title = (j.title ?? "—").slice(0, 46).padEnd(46)
            const company = (j.company ?? "—").slice(0, 24).padEnd(24)
            const loc = (j.location ?? "—").slice(0, 22).padEnd(22)
            return `${j.id.padEnd(8)} ${title} ${company} ${loc} ${j.date ?? "—"}`
          })
          .join("\n")
  const lines = [header, "-".repeat(header.length), body]
  lines.push("", `Source: Jobicy — https://jobicy.com`)
  if (attribution) lines.push(attribution)
  return lines.join("\n")
}

function renderPlain(jobs: JobRecord[], attribution: string | null): string {
  const body =
    jobs.length === 0
      ? "No results."
      : jobs
          .map((j) => {
            const salary = formatSalary(j)
            const meta = [j.company ?? "—", j.location ?? "—", j.date ?? "—", j.level]
              .filter((v): v is string => Boolean(v))
              .join(" · ")
            return [
              j.title ?? "(untitled)",
              `  ${meta}`,
              salary ? `  ${salary}` : "",
              `  id: ${j.id}`,
              `  ${j.url ?? "—"}`,
            ]
              .filter((l) => l !== "")
              .join("\n")
          })
          .join("\n\n")
  const lines = [body]
  lines.push("", `Source: Jobicy — https://jobicy.com`)
  if (attribution) lines.push(attribution)
  return lines.join("\n")
}

interface EmitExtras {
  fetched: number
  matched: number
  apiVersion: string | null
  lastUpdate: string | null
  message: string | null
}

function emit(
  jobs: JobRecord[],
  attribution: string | null,
  plan: SearchPlan,
  opts: SearchOpts,
  extras: EmitExtras,
): void {
  if (opts.format === "table") {
    process.stdout.write(renderTable(jobs, attribution) + "\n")
    return
  }
  if (opts.format === "plain") {
    process.stdout.write(renderPlain(jobs, attribution) + "\n")
    return
  }
  process.stdout.write(
    JSON.stringify(
      {
        meta: {
          count: jobs.length,
          page: opts.page,
          limit: plan.perPage,
          requestedLimit: plan.requestedLimit,
          limitClamped: plan.limitClamped,
          maxLimit: MAX_COUNT,
          query: opts.query ?? null,
          geo: opts.geo ?? null,
          industry: opts.industry ?? null,
          jobage: opts.jobage >= NO_JOBAGE ? null : opts.jobage,
          apiCount: plan.apiCount,
          fetched: extras.fetched,
          matched: extras.matched,
          apiVersion: extras.apiVersion,
          lastUpdate: extras.lastUpdate,
          message: extras.message,
          source: "https://jobicy.com",
          attribution,
        },
        results: jobs,
      },
      null,
      2,
    ) + "\n",
  )
}

export async function runSearch(opts: SearchOpts): Promise<number> {
  try {
    const plan = planSearch(opts)

    // `--limit 0` asks for nothing, so don't spend a request on it. (The API
    // would silently coerce count=0 to count=1 and bill us a call anyway.)
    if (plan.perPage === 0) {
      emit([], null, plan, opts, {
        fetched: 0,
        matched: 0,
        apiVersion: null,
        lastUpdate: null,
        message: "--limit 0 requested; no request was sent",
      })
      return 0
    }

    const raw = await jsonFetch(plan.url)
    if (raw === null) {
      writeError("Jobicy API returned 404 for the search endpoint", "NOT_FOUND")
      return 1
    }
    const payload = parsePayload(raw)

    const matched = payload.jobs.filter((j) => withinJobAge(j.pubDate, opts.jobage))
    const jobs = paginate(matched, opts.page, plan.perPage)

    emit(jobs, payload.attribution, plan, opts, {
      fetched: payload.jobs.length,
      matched: matched.length,
      apiVersion: payload.apiVersion,
      lastUpdate: payload.lastUpdate,
      message: payload.message,
    })
    return 0
  } catch (e) {
    writeError(e instanceof Error ? e.message : String(e), "SEARCH_FAILED")
    return 1
  }
}
