import {
  ITEM_URL,
  HN_ITEM_URL,
  jsonFetch,
  parseComment,
  writeError,
  type AlgoliaItem,
  type Posting,
} from "../helpers.js"

export interface DetailOpts {
  id: string
  format: "json" | "plain"
}

/** Accept a bare comment id or a news.ycombinator.com/item?id=… URL. */
export function normalizeId(input: string): string | null {
  const bare = input.match(/^\d{3,}$/)
  if (bare) return input
  const q = input.match(/[?&]id=(\d{3,})\b/)
  if (q) return q[1]
  const path = input.match(/\/(\d{6,})(?:[?#/]|$)/)
  if (path) return path[1]
  return null
}

/** Map the /items/<id> response onto the same Posting shape `search` emits. */
export function itemToPosting(item: AlgoliaItem): Posting {
  return parseComment({
    objectID: String(item.id),
    author: item.author ?? null,
    created_at: item.created_at ?? null,
    comment_text: item.text ?? item.title ?? "",
    story_id: item.story_id ?? null,
    parent_id: item.parent_id ?? null,
  })
}

/**
 * Render one posting as human-readable plain text. Pure, so it is unit-testable
 * without touching the network.
 *
 * `null` = absent field (drop the line); `""` = a deliberate blank separator line
 * that MUST survive, otherwise the description runs straight into the header block
 * and the trailing URLs, and the output stops being readable.
 */
export function renderDetailPlain(posting: Posting): string {
  const lines: (string | null)[] = [
    posting.company || "(unknown company)",
    posting.title ? `Role: ${posting.title}` : null,
    posting.location ? `Location: ${posting.location}` : null,
    posting.remote ? `Workplace: ${posting.remote}` : null,
    posting.employmentType ? `Employment: ${posting.employmentType}` : null,
    posting.salary ? `Salary: ${posting.salary}` : null,
    posting.visa === true
      ? "Visa: mentioned (sponsorship signalled)"
      : posting.visa === false
        ? "Visa: no sponsorship"
        : null,
    posting.author ? `Posted by: ${posting.author}` : null,
    posting.date ? `Date: ${posting.date}` : null,
    "",
    posting.description || "(no text)",
    "",
    `URL: ${posting.url}`,
    posting.companyUrl ? `Apply/company: ${posting.companyUrl}` : null,
  ]
  return lines.filter((l): l is string => l !== null).join("\n")
}

export async function runDetail(opts: DetailOpts): Promise<number> {
  const id = normalizeId(opts.id)
  if (!id) {
    writeError(`Could not parse an HN item id from "${opts.id}"`, "BAD_ID")
    return 1
  }
  try {
    const item = await jsonFetch<AlgoliaItem>(`${ITEM_URL}/${id}`)
    if (!item || item.id == null) {
      writeError("Posting not found", "NOT_FOUND")
      return 1
    }
    const posting = itemToPosting(item)
    posting.url = `${HN_ITEM_URL}${id}`

    if (opts.format === "plain") {
      process.stdout.write(renderDetailPlain(posting) + "\n")
    } else {
      process.stdout.write(JSON.stringify(posting, null, 2) + "\n")
    }
    return 0
  } catch (e) {
    writeError(e instanceof Error ? e.message : String(e), "DETAIL_FAILED")
    return 1
  }
}
