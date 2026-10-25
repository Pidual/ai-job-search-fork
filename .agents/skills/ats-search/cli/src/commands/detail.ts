import {
  ashbyBoardUrl,
  greenhouseJobUrl,
  jsonFetch,
  leverJobUrl,
  parseAshbyBoard,
  parseGreenhouseJob,
  parseLeverJob,
  sanitizeDescription,
  writeError,
  writeOut,
  type Company,
  type JobResult,
  type Provider,
} from "../helpers.js"

export interface DetailOpts {
  id: string
  companies: Company[]
  format: "json" | "plain"
}

export interface JobRef {
  provider: Provider
  token: string
  jobId: string
}

/**
 * Accept the composite id emitted by `search` (`<provider>:<token>:<jobId>`)
 * or a bare job URL from any of the three ATS hosts.
 */
export function parseJobRef(input: string): JobRef | null {
  const raw = input.trim()
  if (!raw) return null

  // Composite id: greenhouse:anthropic:4610158008
  const composite = raw.match(/^(greenhouse|ashby|lever)[:/]([A-Za-z0-9._-]+)[:/](.+)$/i)
  if (composite) {
    return {
      provider: composite[1]!.toLowerCase() as Provider,
      token: composite[2]!,
      jobId: composite[3]!.trim(),
    }
  }

  if (!/^https?:\/\//i.test(raw)) return null
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  const host = url.hostname.toLowerCase()
  const segs = url.pathname.split("/").filter(Boolean)

  // https://boards-api.greenhouse.io/v1/boards/<token>/jobs/<id>
  if (host.endsWith("greenhouse.io") && segs[0] === "v1" && segs[1] === "boards") {
    const token = segs[2]
    const jobId = segs[4]
    if (token && jobId) return { provider: "greenhouse", token, jobId }
    return null
  }
  // https://job-boards.greenhouse.io/<token>/jobs/<id>  (also boards.greenhouse.io)
  if (host.endsWith("greenhouse.io")) {
    const token = segs[0]
    const idx = segs.indexOf("jobs")
    const jobId = idx >= 0 ? segs[idx + 1] : undefined
    if (token && jobId) return { provider: "greenhouse", token, jobId }
    return null
  }
  // https://jobs.ashbyhq.com/<token>/<uuid>[/application]
  if (host.endsWith("ashbyhq.com")) {
    const token = segs[0]
    const jobId = segs[1]
    if (token && jobId) return { provider: "ashby", token, jobId }
    return null
  }
  // https://jobs.lever.co/<token>/<uuid>[/apply]
  // https://api.lever.co/v0/postings/<token>/<uuid>
  if (host.endsWith("lever.co")) {
    if (segs[0] === "v0" && segs[1] === "postings") {
      const token = segs[2]
      const jobId = segs[3]
      if (token && jobId) return { provider: "lever", token, jobId }
      return null
    }
    const token = segs[0]
    const jobId = segs[1]
    if (token && jobId) return { provider: "lever", token, jobId }
    return null
  }
  return null
}

function companyFor(ref: JobRef, roster: Company[]): Company {
  return (
    roster.find((c) => c.provider === ref.provider && c.token === ref.token) ?? {
      token: ref.token,
      provider: ref.provider,
      name: ref.token,
    }
  )
}

export async function runDetail(opts: DetailOpts): Promise<number> {
  const ref = parseJobRef(opts.id)
  if (!ref) {
    writeError(
      `Could not parse a job reference from "${opts.id}". ` +
        'Use "<provider>:<companyToken>:<jobId>" (e.g. greenhouse:anthropic:4610158008) ' +
        "or a job URL from job-boards.greenhouse.io, jobs.ashbyhq.com or jobs.lever.co.",
      "BAD_ID",
    )
    return 1
  }

  const company = companyFor(ref, opts.companies)

  try {
    let job: JobResult | null = null
    let description: string | null = null

    if (ref.provider === "greenhouse") {
      const raw = await jsonFetch(greenhouseJobUrl(ref.token, ref.jobId))
      const parsed = raw === null ? null : parseGreenhouseJob(raw, company)
      if (parsed) {
        job = parsed.job
        description = parsed.description
      }
    } else if (ref.provider === "lever") {
      const raw = await jsonFetch(leverJobUrl(ref.token, ref.jobId))
      // Lever's 404 body is an OBJECT ({"ok":false,...}) while its 200 body for
      // a single posting is an OBJECT too — so check for the posting's own
      // fields via the parser rather than trusting the shape.
      const parsed = raw === null ? null : parseLeverJob(raw, company)
      if (parsed) {
        job = parsed.job
        description = parsed.description
      }
    } else {
      // Ashby has no public single-posting endpoint (it 401s); fetch the board
      // and pick the posting out of it.
      const raw = await jsonFetch(ashbyBoardUrl(ref.token))
      const parsed =
        raw === null ? [] : parseAshbyBoard(raw, company).filter((p) => p.job.jobId === ref.jobId)
      if (parsed[0]) {
        job = parsed[0].job
        description = parsed[0].description
      }
    }

    if (!job) {
      writeError(`Job not found: ${ref.provider}:${ref.token}:${ref.jobId}`, "NOT_FOUND")
      return 1
    }

    const safe = sanitizeDescription(description)

    if (opts.format === "plain") {
      const lines = [
        job.title ?? "(untitled)",
        `${job.company ?? "—"} · ${job.location ?? "—"}`,
        "",
        job.department ? `Department: ${job.department}` : "",
        job.employmentType ? `Employment: ${job.employmentType}` : "",
        job.remote === true ? "Remote: yes" : job.remote === false ? "Remote: no" : "",
        job.compensation ? `Compensation: ${job.compensation}` : "",
        job.date ? `Date: ${job.date}` : "",
        `Source: ${job.provider} (${job.companyToken})`,
        "",
        safe ?? "(no description)",
        "",
        `URL: ${job.url ?? "—"}`,
        job.applyUrl ? `Apply: ${job.applyUrl}` : "",
      ].filter((l) => l !== "")
      await writeOut(lines.join("\n") + "\n")
    } else {
      await writeOut(JSON.stringify({ ...job, description: safe }, null, 2) + "\n")
    }
    return 0
  } catch (e) {
    writeError(e instanceof Error ? e.message : String(e), "DETAIL_FAILED")
    return 1
  }
}
