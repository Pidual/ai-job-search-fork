import {
  LEVER_CRAWL_DELAY_MS,
  MAX_CONCURRENCY,
  ashbyBoardUrl,
  compareJobs,
  greenhouseBoardUrl,
  jsonFetch,
  leverBoardUrl,
  mapConcurrent,
  mapSerial,
  matchesLocation,
  matchesQuery,
  parseBoard,
  queryTerms,
  withinJobAge,
  writeError,
  writeOut,
  type Company,
  type JobResult,
  type ParsedJob,
  type Provider,
} from "../helpers.js"

export interface SearchOpts {
  query?: string
  companies: Company[]
  /** Restrict the fan-out to these roster tokens (already validated). */
  only?: string[]
  provider?: Provider
  remote: boolean
  location?: string
  jobage?: number
  page: number
  limit?: number
  /** Skip Greenhouse `content=true` and match titles/departments only (fast). */
  titlesOnly: boolean
  format: "json" | "table" | "plain"
}

export interface FetchError {
  company: string
  provider: Provider
  error: string
}

function boardUrl(company: Company, titlesOnly: boolean): string {
  switch (company.provider) {
    case "greenhouse":
      return greenhouseBoardUrl(company.token, !titlesOnly)
    case "ashby":
      return ashbyBoardUrl(company.token)
    case "lever":
      return leverBoardUrl(company.token)
  }
}

interface CompanyOutcome {
  jobs: ParsedJob[]
  error: FetchError | null
}

/**
 * One request per company returns its whole board. A failure is recorded and
 * the fan-out continues — one dead token must never abort the whole search.
 */
async function fetchCompany(company: Company, titlesOnly: boolean): Promise<CompanyOutcome> {
  try {
    const raw = await jsonFetch(boardUrl(company, titlesOnly))
    if (raw === null) {
      return {
        jobs: [],
        error: {
          company: company.token,
          provider: company.provider,
          error: "board not found (404) — token may be wrong or the board was taken down",
        },
      }
    }
    return { jobs: parseBoard(company.provider, raw, company), error: null }
  } catch (e) {
    return {
      jobs: [],
      error: {
        company: company.token,
        provider: company.provider,
        error: e instanceof Error ? e.message : String(e),
      },
    }
  }
}

export async function fanOut(
  companies: Company[],
  titlesOnly: boolean,
): Promise<{ jobs: ParsedJob[]; errors: FetchError[] }> {
  // Lever's robots.txt asks for Crawl-delay: 1, so its calls are serialised
  // with a 1 s pause. Greenhouse and Ashby impose no delay and run at
  // MAX_CONCURRENCY. The two groups hit different hosts, so they run together.
  const lever = companies.filter((c) => c.provider === "lever")
  const rest = companies.filter((c) => c.provider !== "lever")

  const [restOut, leverOut] = await Promise.all([
    mapConcurrent(rest, MAX_CONCURRENCY, (c) => fetchCompany(c, titlesOnly)),
    mapSerial(lever, LEVER_CRAWL_DELAY_MS, (c) => fetchCompany(c, titlesOnly)),
  ])

  const jobs: ParsedJob[] = []
  const errors: FetchError[] = []
  for (const outcome of [...restOut, ...leverOut]) {
    jobs.push(...outcome.jobs)
    if (outcome.error) errors.push(outcome.error)
  }
  return { jobs, errors }
}

export function applyFilters(jobs: ParsedJob[], opts: SearchOpts, now = Date.now()): JobResult[] {
  const terms = queryTerms(opts.query)
  const out: JobResult[] = []
  for (const parsed of jobs) {
    const j = parsed.job
    // In --titles-only mode Ashby/Lever descriptions are still present (they
    // come free in the default response); restrict the haystack so the flag
    // means the same thing across all three providers.
    const haystack = opts.titlesOnly
      ? `${j.title ?? ""}\n${j.department ?? ""}\n${j.location ?? ""}`.toLowerCase()
      : parsed.haystack
    if (!matchesQuery(haystack, terms)) continue
    if (opts.remote && j.remote !== true) continue
    if (!matchesLocation(j.location, opts.location)) continue
    if (!withinJobAge(j.date, opts.jobage, now)) continue
    out.push(j)
  }
  out.sort(compareJobs)
  return out
}

function renderTable(jobs: JobResult[]): string {
  if (jobs.length === 0) return "No results."
  // The id column is sized to the data, never truncated: it is what the user
  // copies into `detail`, and Ashby/Lever ids are 36-char UUIDs.
  const idWidth = Math.max(2, ...jobs.map((j) => j.id.length))
  const cols = { id: idWidth, title: 44, company: 16, loc: 26 }
  const cell = (v: string | null, w: number): string => (v || "—").slice(0, w).padEnd(w)
  const header =
    "ID".padEnd(cols.id) +
    " " +
    "TITLE".padEnd(cols.title) +
    " " +
    "COMPANY".padEnd(cols.company) +
    " " +
    "LOCATION".padEnd(cols.loc) +
    " DATE"
  const rows = jobs.map(
    (j) =>
      `${cell(j.id, cols.id)} ${cell(j.title, cols.title)} ${cell(j.company, cols.company)} ` +
      `${cell(j.location, cols.loc)} ${j.date || "—"}`,
  )
  return [header, "-".repeat(header.length), ...rows].join("\n")
}

function renderPlain(jobs: JobResult[]): string {
  if (jobs.length === 0) return "No results."
  return jobs
    .map((j) => {
      const remote = j.remote === true ? " · remote" : j.remote === false ? " · on-site/hybrid" : ""
      const pay = j.compensation ? ` · ${j.compensation}` : ""
      return (
        `${j.title ?? "(untitled)"}\n` +
        `  ${j.company ?? "—"} · ${j.location ?? "—"} · ${j.date ?? "—"}${remote}${pay}\n` +
        `  ${j.department ?? "—"} · ${j.provider}\n` +
        `  id: ${j.id}\n  ${j.url ?? "—"}`
      )
    })
    .join("\n\n")
}

export async function runSearch(opts: SearchOpts): Promise<number> {
  try {
    const roster = opts.only?.length
      ? opts.companies.filter((c) => opts.only!.includes(c.token))
      : opts.companies
    const selected = opts.provider ? roster.filter((c) => c.provider === opts.provider) : roster

    if (selected.length === 0) {
      writeError(
        "no companies selected — check companies.json, --company and --provider",
        "NO_COMPANIES",
      )
      return 1
    }

    const { jobs, errors } = await fanOut(selected, opts.titlesOnly)
    const matched = applyFilters(jobs, opts)

    const pageSize = opts.limit !== undefined ? opts.limit : 25
    const start = (opts.page - 1) * pageSize
    const pageJobs = pageSize === 0 ? [] : matched.slice(start, start + pageSize)

    if (opts.format === "table") {
      await writeOut(renderTable(pageJobs) + "\n")
    } else if (opts.format === "plain") {
      await writeOut(renderPlain(pageJobs) + "\n")
    } else {
      await writeOut(
        JSON.stringify(
          {
            meta: {
              count: pageJobs.length,
              page: opts.page,
              pageSize,
              total: matched.length,
              scanned: jobs.length,
              query: opts.query ?? null,
              companiesQueried: selected.length,
              companiesFailed: errors.length,
              errors,
            },
            results: pageJobs,
          },
          null,
          2,
        ) + "\n",
      )
    }

    // Non-JSON formats would otherwise swallow partial-failure information.
    if (errors.length > 0 && opts.format !== "json") {
      for (const e of errors) {
        process.stderr.write(`warning: ${e.provider}:${e.company} — ${e.error}\n`)
      }
    }
    return 0
  } catch (e) {
    writeError(e instanceof Error ? e.message : String(e), "SEARCH_FAILED")
    return 1
  }
}
