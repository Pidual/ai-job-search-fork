import {
  API_BASE,
  MAX_COUNT,
  formatSalary,
  jobPageUrl,
  jsonFetch,
  parseJob,
  parseJobPage,
  parsePayload,
  textFetch,
  withDescription,
  writeError,
  type JobDetailRecord,
} from "../helpers.js"

export interface DetailOpts {
  id: string
  /** Same narrowing knobs as `search` — see the note on hit rate below. */
  query?: string
  geo?: string
  industry?: string
  /** Mirrors `search --limit`, i.e. the `count` param. See buildUrl. */
  limit?: number
  format: "json" | "plain"
}

/**
 * Jobicy has NO per-job endpoint. `?id=` is rejected with
 * `{"success":false,"error":"Unexpected parameter 'id'."}` (HTTP 400), and
 * `/remote-jobs/<id>` 301-redirects away. So `detail` re-runs a LIST query and
 * selects the record by id out of the response.
 *
 * Two consequences, both verified live on 2026-08-05:
 *
 * 1. The job must still be inside the listing window for the filters supplied.
 *    Pass the same `--query` / `--geo` / `--industry` you used for `search`.
 *
 * 2. Jobicy caches each `count` value in its OWN bucket, and those buckets have
 *    different freshness. Every response is sorted newest-first, but a small
 *    `count` can be *fresher* than a large one, so `count=100` is not a superset
 *    of `count=25` (observed: count=25 newest pubDate 04:50:06Z vs count=100
 *    newest 04:35:07Z — three brand-new postings were in the small bucket only).
 *    Hence `--limit` is accepted here too: passing the same `--limit` the search
 *    used reproduces the exact request and reliably resolves the id.
 *
 * When the listing does not contain the id — which is the normal case for any
 * posting more than a day or two old, and for `detail <id>` called without the
 * search's filters — we fall back to the public job page and its JSON-LD
 * JobPosting block (see `parseJobPage`). That path needs nothing but the id.
 */
export function buildUrl(opts: DetailOpts): string {
  const count =
    opts.limit === undefined ? MAX_COUNT : Math.min(MAX_COUNT, Math.max(1, opts.limit))
  const params = new URLSearchParams()
  params.set("count", String(count))
  if (opts.query) params.set("tag", opts.query)
  if (opts.geo) params.set("geo", opts.geo)
  if (opts.industry) params.set("industry", opts.industry)
  return `${API_BASE}?${params.toString()}`
}

/** Accept a bare id, a `143131-slug` slug, or a full jobicy.com/jobs/... URL. */
export function normalizeId(input: string): string | null {
  const trimmed = input.trim()
  const fromUrl = trimmed.match(/\/jobs\/(\d+)/)
  if (fromUrl) return fromUrl[1]!
  const fromSlug = trimmed.match(/^(\d+)-/)
  if (fromSlug) return fromSlug[1]!
  const bare = trimmed.match(/^\d+$/)
  if (bare) return trimmed
  return null
}

function renderPlain(
  job: JobDetailRecord,
  attribution: string | null,
  listingError: string | null,
): string {
  const salary = formatSalary(job)
  const lines = [
    job.title ?? "(untitled)",
    `${job.company ?? "—"} · ${job.location ?? "—"}${job.date ? ` · ${job.date}` : ""}`,
    "",
    job.level ? `Level: ${job.level}` : "",
    job.jobType.length ? `Type: ${job.jobType.join(", ")}` : "",
    job.industry.length ? `Industry: ${job.industry.join(", ")}` : "",
    salary ? `Salary: ${salary}` : "",
    "",
    job.description ?? "(no description)",
    "",
    `URL: ${job.url ?? "—"}`,
    job.url ? `Apply: ${job.url}` : "",
  ].filter((l) => l !== "")
  // The credit line is contractual, so it prints even when the API payload that
  // carries `friendlyNotice` was not part of this lookup.
  lines.push("", "Source: Jobicy — https://jobicy.com")
  if (attribution) lines.push(attribution)
  // A failed listing lookup is reported rather than hidden by the fallback.
  if (listingError) lines.push("", `Note: the API listing lookup failed (${listingError}).`)
  return lines.join("\n")
}

export async function runDetail(opts: DetailOpts): Promise<number> {
  const id = normalizeId(opts.id)
  if (!id) {
    writeError(`Could not parse a job ID from "${opts.id}"`, "BAD_ID")
    return 1
  }
  try {
    // A listing failure (portal 5xx, or a bad --geo the user copied over from a
    // search) must not sink the lookup: the job page can still answer it. The
    // error is kept and surfaced at meta.listingError, never swallowed.
    let raw: unknown = null
    let listingError: string | null = null
    try {
      raw = await jsonFetch(buildUrl(opts))
    } catch (e) {
      listingError = e instanceof Error ? e.message : String(e)
    }
    const payload = parsePayload(raw)

    // Re-walk the raw array so the matched entry keeps its jobDescription HTML.
    const rawJobs =
      raw && typeof raw === "object" && Array.isArray((raw as { jobs?: unknown[] }).jobs)
        ? ((raw as { jobs: unknown[] }).jobs as unknown[])
        : []
    const rawMatch = rawJobs.find((entry) => parseJob(entry)?.id === id)

    let job: JobDetailRecord | null = rawMatch ? withDescription(parseJob(rawMatch)!, rawMatch) : null
    let resolvedVia: "api-listing" | "job-page" = "api-listing"

    if (!job) {
      // Outside the listing window — read the public job page instead.
      job = parseJobPage(await textFetch(jobPageUrl(id)), id)
      resolvedVia = "job-page"
    }

    if (!job) {
      if (listingError) {
        writeError(listingError, "DETAIL_FAILED")
        return 1
      }
      writeError(
        `Job ${id} could not be resolved. It is not in the Jobicy listing window this query ` +
          `returned (Jobicy has no per-job API endpoint, so detail re-runs a list query and ` +
          `selects by id), and https://jobicy.com/jobs/${id}-job returned no job posting — the ` +
          `posting has most likely expired. Double-check the id, or re-run with the same ` +
          `--query/--geo/--industry AND the same --limit you used for search.`,
        "NOT_FOUND",
      )
      return 1
    }

    if (opts.format === "plain") {
      process.stdout.write(renderPlain(job, payload.attribution, listingError) + "\n")
    } else {
      process.stdout.write(
        JSON.stringify(
          {
            meta: {
              id,
              query: opts.query ?? null,
              geo: opts.geo ?? null,
              industry: opts.industry ?? null,
              limit: opts.limit ?? MAX_COUNT,
              resolvedVia,
              listingError,
              apiVersion: payload.apiVersion,
              lastUpdate: payload.lastUpdate,
              source: "https://jobicy.com",
              attribution: payload.attribution,
            },
            result: job,
          },
          null,
          2,
        ) + "\n",
      )
    }
    return 0
  } catch (e) {
    writeError(e instanceof Error ? e.message : String(e), "DETAIL_FAILED")
    return 1
  }
}
