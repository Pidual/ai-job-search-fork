import { describe, expect, test } from "bun:test"
import { runCLI } from "./helpers"

// Every case here resolves WITHOUT touching the network: argument handling, flag
// validation and roster lookup all happen before any fetch in src/cli.ts, so CI
// never depends on reaching a Consider host.

function expectErrorJSON(stderr: string): { error: string; code: string } {
  const parsed = JSON.parse(stderr) as { error?: unknown; code?: unknown }
  expect(typeof parsed.error).toBe("string")
  expect(typeof parsed.code).toBe("string")
  return parsed as { error: string; code: string }
}

describe("invocation contract", () => {
  test("bare invocation prints help to stdout and exits non-zero", async () => {
    const r = await runCLI([])
    expect(r.exitCode).toBe(1)
    expect(r.stdout).toContain("consider-cli")
    expect(r.stdout).toContain("USAGE")
    expect(r.stderr).toBe("")
  })

  test("--help with a command prints usage and exits 0", async () => {
    const r = await runCLI(["search", "--help"])
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toContain("SEARCH FLAGS")
    expect(r.stdout).toContain("--query")
    expect(r.stdout).toContain("--board")
    expect(r.stderr).toBe("")
  })

  test("-h with a command exits 0", async () => {
    const r = await runCLI(["detail", "-h"])
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toContain("USAGE")
  })

  test("help documents the composite detail id and the server-side filtering", async () => {
    const r = await runCLI(["search", "--help"])
    expect(r.stdout).toContain("<board-slug>:<company-slug>:<job-id>")
    expect(r.stdout).toContain("SERVER-SIDE")
  })

  test("unknown command exits 1 with BAD_CMD on stderr", async () => {
    const r = await runCLI(["frobnicate"])
    expect(r.exitCode).toBe(1)
    expect(r.stdout).toBe("")
    const err = expectErrorJSON(r.stderr)
    expect(err.code).toBe("BAD_CMD")
    expect(err.error).toContain("frobnicate")
  })
})

describe("boards command (reads the roster, no network)", () => {
  test("lists the roster as JSON", async () => {
    const r = await runCLI(["boards", "--format", "json"])
    expect(r.exitCode).toBe(0)
    const parsed = JSON.parse(r.stdout) as {
      meta: { count: number }
      results: { slug: string; host: string; name: string }[]
    }
    expect(parsed.meta.count).toBe(parsed.results.length)
    expect(parsed.results.length).toBeGreaterThanOrEqual(5)
    expect(parsed.results.some((b) => b.slug === "andreessen-horowitz")).toBe(true)
    expect(parsed.results.every((b) => b.host.startsWith("jobs."))).toBe(true)
  })

  test("default output is a readable table", async () => {
    const r = await runCLI(["boards"])
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toContain("jobs.a16z.com")
    expect(r.stdout).toContain("jobs.sequoiacap.com")
  })
})

describe("detail argument contract (runs before any network call)", () => {
  test("detail without an id exits 1 with NO_ID", async () => {
    const r = await runCLI(["detail"])
    expect(r.exitCode).toBe(1)
    expect(r.stdout).toBe("")
    expect(expectErrorJSON(r.stderr).code).toBe("NO_ID")
  })

  test("a non-composite id is rejected with BAD_ID before any request", async () => {
    const r = await runCLI(["detail", "12345"])
    expect(r.exitCode).toBe(1)
    expect(r.stdout).toBe("")
    const err = expectErrorJSON(r.stderr)
    expect(err.code).toBe("BAD_ID")
    expect(err.error).toContain("<board-slug>:<company-slug>:<job-id>")
  })

  test("a two-segment id is rejected", async () => {
    const r = await runCLI(["detail", "andreessen-horowitz:8052599"])
    expect(r.exitCode).toBe(1)
    expect(expectErrorJSON(r.stderr).code).toBe("BAD_ID")
  })

  test("an id naming a board outside the roster never reaches the network", async () => {
    const r = await runCLI(["detail", "evil-corp:acme:123"])
    expect(r.exitCode).toBe(1)
    expect(r.stdout).toBe("")
    const err = expectErrorJSON(r.stderr)
    expect(err.code).toBe("BAD_BOARD")
    expect(err.error).toContain("andreessen-horowitz")
  })
})

describe("search argument contract (runs before any network call)", () => {
  test("an unknown --board slug exits 1 with BAD_BOARD and lists the valid ones", async () => {
    const r = await runCLI(["search", "-q", "machine learning", "--board", "not-a-fund"])
    expect(r.exitCode).toBe(1)
    expect(r.stdout).toBe("")
    const err = expectErrorJSON(r.stderr)
    expect(err.code).toBe("BAD_BOARD")
    expect(err.error).toContain("not-a-fund")
    expect(err.error).toContain("sequoia-capital")
  })

  test("one bad slug among several is still rejected", async () => {
    const r = await runCLI([
      "search",
      "-q",
      "ml",
      "--board",
      "andreessen-horowitz",
      "--board",
      "nope",
    ])
    expect(r.exitCode).toBe(1)
    expect(expectErrorJSON(r.stderr).code).toBe("BAD_BOARD")
  })

  test("--board with no value is a BAD_ARG, not a silent whole-roster fan-out", async () => {
    const r = await runCLI(["search", "-q", "ml", "--board"])
    expect(r.exitCode).toBe(1)
    const err = expectErrorJSON(r.stderr)
    expect(err.code).toBe("BAD_ARG")
    expect(err.error).toContain("--board")
  })

  test("--query with no value is a BAD_ARG", async () => {
    const r = await runCLI(["search", "--query"])
    expect(r.exitCode).toBe(1)
    const err = expectErrorJSON(r.stderr)
    expect(err.code).toBe("BAD_ARG")
    expect(err.error).toContain("--query")
  })

  test("--limit 0 is rejected as a useless page size", async () => {
    const r = await runCLI(["search", "-q", "ml", "--limit", "0"])
    expect(r.exitCode).toBe(1)
    const err = expectErrorJSON(r.stderr)
    expect(err.code).toBe("BAD_ARG")
    expect(err.error).toContain("--limit 0")
  })

  test("too-deep paging is refused before any request", async () => {
    const r = await runCLI(["search", "-q", "ml", "--page", "9", "--limit", "50"])
    expect(r.exitCode).toBe(1)
    expect(r.stdout).toBe("")
    const err = expectErrorJSON(r.stderr)
    expect(err.code).toBe("PAGE_TOO_DEEP")
    expect(err.error).toContain("200")
  })
})

describe("integer flag validation (runs before any network call)", () => {
  const intFlags = ["jobage", "page", "limit"] as const

  for (const flag of intFlags) {
    for (const bad of ["foo", "-1", "1.5"]) {
      test(`--${flag} rejects "${bad}" with BAD_ARG`, async () => {
        const r = await runCLI(["search", "-q", "machine learning", `--${flag}`, bad])
        expect(r.exitCode).toBe(1)
        expect(r.stdout).toBe("")
        const err = expectErrorJSON(r.stderr)
        expect(err.code).toBe("BAD_ARG")
        expect(err.error).toContain(`--${flag} must be a non-negative integer`)
        expect(err.error).toContain(bad)
      })
    }

    test(`--${flag} rejects a missing value with BAD_ARG`, async () => {
      // Trailing flag with nothing after it parses as boolean true.
      const r = await runCLI(["search", "-q", "machine learning", `--${flag}`])
      expect(r.exitCode).toBe(1)
      expect(r.stdout).toBe("")
      const err = expectErrorJSON(r.stderr)
      expect(err.code).toBe("BAD_ARG")
      expect(err.error).toContain("true")
    })
  }

  // `0` is falsy but valid and must survive parseIntFlag. Proven network-free by
  // pairing it with an unknown --board: the BAD_BOARD guard fires only AFTER every
  // integer flag has parsed, so seeing it means the `0` was accepted.
  for (const flag of intFlags) {
    test(`--${flag} accepts "0"`, async () => {
      const r = await runCLI(["search", `--${flag}`, "0", "--board", "not-a-fund"])
      expect(r.exitCode).toBe(1)
      expect(r.stdout).toBe("")
      const err = expectErrorJSON(r.stderr)
      expect(err.code).toBe("BAD_BOARD")
      expect(err.error).not.toContain("must be a non-negative integer")
    })
  }

  test("integer validation runs before the roster lookup", async () => {
    const r = await runCLI(["search", "--limit", "-1", "--board", "not-a-fund"])
    expect(expectErrorJSON(r.stderr).code).toBe("BAD_ARG")
  })
})
