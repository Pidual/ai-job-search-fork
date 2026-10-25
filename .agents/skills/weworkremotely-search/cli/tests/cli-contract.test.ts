import { describe, expect, test } from "bun:test"
import { runCLI, type CLIResult } from "./helpers.ts"

/**
 * Contract tests only. Every case here is rejected during argument validation, which
 * happens BEFORE any fetch in src/cli.ts, so this suite never touches the network.
 *
 * The one trick used to prove a *valid* integer is accepted without going online: pair it
 * with a deliberately invalid --category. Category validation runs after the integer flags,
 * so a BAD_CATEGORY (rather than BAD_ARG) exit proves the integer got through.
 */

function expectJSONError(result: CLIResult, code: string): { error: string; code: string } {
  expect(result.exitCode).toBe(1)
  expect(result.stdout).toBe("")
  const parsed = JSON.parse(result.stderr) as { error: string; code: string }
  expect(typeof parsed.error).toBe("string")
  expect(parsed.error.length).toBeGreaterThan(0)
  expect(parsed.code).toBe(code)
  return parsed
}

describe("invocation contract", () => {
  test("bare invocation prints usage and exits non-zero", async () => {
    const result = await runCLI([])
    expect(result.exitCode).not.toBe(0)
    expect(result.stdout).toContain("USAGE")
    expect(result.stdout).toContain("weworkremotely-cli")
  })

  test("--help with a command prints usage and exits 0", async () => {
    const result = await runCLI(["search", "--help"])
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain("SEARCH FLAGS")
    expect(result.stdout).toContain("--category")
  })

  test("-h with a command prints usage and exits 0", async () => {
    const result = await runCLI(["detail", "-h"])
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain("USAGE")
  })

  test("help lists the working category slugs and warns there is no AI/data feed", async () => {
    const result = await runCLI(["search", "--help"])
    expect(result.stdout).toContain("remote-programming-jobs")
    expect(result.stdout).toContain("remote-devops-sysadmin-jobs")
    expect(result.stdout).toContain("no data/AI/ML category feed")
    // Retired feeds must never be advertised.
    expect(result.stdout).not.toContain("remote-data-jobs")
    expect(result.stdout).not.toContain("remote-marketing-jobs")
  })

  test("unknown command exits 1 with BAD_CMD on stderr", async () => {
    const result = await runCLI(["frobnicate"])
    const parsed = expectJSONError(result, "BAD_CMD")
    expect(parsed.error).toContain("frobnicate")
  })

  test("detail with no id exits 1 with NO_ID", async () => {
    const result = await runCLI(["detail"])
    expectJSONError(result, "NO_ID")
  })
})

describe("integer flag validation", () => {
  const intFlags = ["jobage", "page", "limit"] as const

  for (const flag of intFlags) {
    test(`--${flag} rejects a non-numeric value`, async () => {
      const result = await runCLI(["search", `--${flag}`, "foo"])
      const parsed = expectJSONError(result, "BAD_ARG")
      expect(parsed.error).toContain(`--${flag}`)
      expect(parsed.error).toContain("non-negative integer")
      expect(parsed.error).toContain('"foo"')
    })

    test(`--${flag} rejects a negative value and echoes it back`, async () => {
      const result = await runCLI(["search", `--${flag}`, "-1"])
      const parsed = expectJSONError(result, "BAD_ARG")
      expect(parsed.error).toContain('"-1"')
    })

    test(`--${flag} rejects a fractional value`, async () => {
      const result = await runCLI(["search", `--${flag}`, "1.5"])
      const parsed = expectJSONError(result, "BAD_ARG")
      expect(parsed.error).toContain('"1.5"')
    })

    test(`--${flag} rejects being given with no value`, async () => {
      const result = await runCLI(["search", `--${flag}`, "--format", "json"])
      expectJSONError(result, "BAD_ARG")
    })

    test(`--${flag} accepts 0`, async () => {
      // Reaching BAD_CATEGORY means the integer passed validation.
      const result = await runCLI([
        "search",
        `--${flag}`,
        "0",
        "--category",
        "definitely-not-a-category",
      ])
      expectJSONError(result, "BAD_CATEGORY")
    })
  }

  test("-n is an alias for --limit and validates identically", async () => {
    const result = await runCLI(["search", "-n", "-3"])
    const parsed = expectJSONError(result, "BAD_ARG")
    expect(parsed.error).toContain("--limit")
    expect(parsed.error).toContain('"-3"')
  })
})

describe("category flag validation", () => {
  test("an unknown slug exits 1 with BAD_CATEGORY and lists the valid slugs", async () => {
    const result = await runCLI(["search", "--category", "remote-unicorn-jobs"])
    const parsed = expectJSONError(result, "BAD_CATEGORY")
    expect(parsed.error).toContain("remote-unicorn-jobs")
    expect(parsed.error).toContain("remote-programming-jobs")
    expect(parsed.error).toContain("remote-customer-support-jobs")
  })

  test("a retired slug is reported as retired, not merely unknown", async () => {
    const result = await runCLI(["search", "--category", "remote-data-jobs"])
    const parsed = expectJSONError(result, "BAD_CATEGORY")
    expect(parsed.error).toContain("retired")
  })

  test("all three known-dead slugs are rejected", async () => {
    for (const slug of ["remote-data-jobs", "remote-marketing-jobs", "remote-all-other-remote-jobs"]) {
      const result = await runCLI(["search", "--category", slug])
      expectJSONError(result, "BAD_CATEGORY")
    }
  })

  test("--category with no value exits 1 with BAD_ARG", async () => {
    const result = await runCLI(["search", "--category", "--format", "json"])
    expectJSONError(result, "BAD_ARG")
  })

  test("a repeated --category validates every occurrence", async () => {
    const result = await runCLI([
      "search",
      "--category",
      "remote-programming-jobs",
      "--category",
      "remote-nonsense-jobs",
    ])
    const parsed = expectJSONError(result, "BAD_CATEGORY")
    expect(parsed.error).toContain("remote-nonsense-jobs")
  })

  test("-c is an alias for --category", async () => {
    const result = await runCLI(["search", "-c", "remote-nonsense-jobs"])
    expectJSONError(result, "BAD_CATEGORY")
  })

  test("detail validates --category before fetching anything", async () => {
    const result = await runCLI(["detail", "acme-ml-engineer", "--category", "remote-data-jobs"])
    expectJSONError(result, "BAD_CATEGORY")
  })
})

describe("detail id validation", () => {
  test("an id that yields no slug exits 1 with BAD_ID before any fetch", async () => {
    const result = await runCLI(["detail", "///"])
    expectJSONError(result, "BAD_ID")
  })
})
