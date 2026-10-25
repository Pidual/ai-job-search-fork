import { describe, test, expect } from "bun:test"
import { runCLI } from "./helpers"

// Every assertion here is network-free. Flag validation in src/cli.ts happens
// BEFORE runSearch/runDetail are called, so a rejected flag never reaches
// jobicy.com — that is what makes these tests safe to run in CI.

function parsedStderr(stderr: string): { error?: string; code?: string } {
  try {
    return JSON.parse(stderr) as { error?: string; code?: string }
  } catch {
    return {}
  }
}

describe("invocation and help", () => {
  test("bare invocation prints usage to stdout and exits non-zero", async () => {
    const result = await runCLI([])
    expect(result.exitCode).not.toBe(0)
    expect(result.stdout).toContain("USAGE")
    expect(result.stdout).toContain("jobicy-cli")
    expect(result.stderr).toBe("")
  })

  test("--help with a command prints usage and exits 0", async () => {
    const result = await runCLI(["search", "--help"])
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain("SEARCH FLAGS")
    expect(result.stdout).toContain("--query")
  })

  test("-h with a command also exits 0", async () => {
    const result = await runCLI(["detail", "-h"])
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain("USAGE")
  })

  test("help text documents the personal-use restriction and the attribution duty", async () => {
    const result = await runCLI(["search", "--help"])
    expect(result.stdout).toMatch(/personal use only/i)
    expect(result.stdout).toMatch(/robots\.txt/i)
    expect(result.stdout).toMatch(/credit jobicy/i)
  })

  test("unknown command exits 1 with BAD_CMD on stderr", async () => {
    const result = await runCLI(["frobnicate"])
    expect(result.exitCode).toBe(1)
    const err = parsedStderr(result.stderr)
    expect(err.code).toBe("BAD_CMD")
    expect(err.error).toContain("frobnicate")
    expect(result.stdout).toBe("")
  })

  test("errors are JSON on stderr with error+code keys, never on stdout", async () => {
    const result = await runCLI(["frobnicate"])
    const parsed = JSON.parse(result.stderr) as Record<string, unknown>
    expect(Object.keys(parsed).sort()).toEqual(["code", "error"])
    expect(typeof parsed.error).toBe("string")
    expect(typeof parsed.code).toBe("string")
  })
})

describe("detail argument contract", () => {
  test("detail with no id exits 1 with NO_ID", async () => {
    const result = await runCLI(["detail"])
    expect(result.exitCode).toBe(1)
    const err = parsedStderr(result.stderr)
    expect(err.code).toBe("NO_ID")
  })

  test("detail with an unparseable id exits 1 with BAD_ID (no network)", async () => {
    const result = await runCLI(["detail", "not-an-id"])
    expect(result.exitCode).toBe(1)
    const err = parsedStderr(result.stderr)
    expect(err.code).toBe("BAD_ID")
    expect(err.error).toContain("not-an-id")
  })
})

// --jobage, --page and --limit are the three integer flags. Upstream tightened
// these to reject negative and fractional values as well as non-numeric ones.
const INT_FLAGS = ["jobage", "page", "limit"] as const

describe("integer flag validation", () => {
  for (const flag of INT_FLAGS) {
    describe(`--${flag}`, () => {
      for (const bad of ["foo", "-1", "1.5"]) {
        test(`rejects ${JSON.stringify(bad)} with BAD_ARG and exit 1`, async () => {
          const result = await runCLI(["search", `--${flag}`, bad])
          expect(result.exitCode).toBe(1)
          const err = parsedStderr(result.stderr)
          expect(err.code).toBe("BAD_ARG")
          expect(err.error).toContain(`--${flag}`)
          expect(err.error).toContain("non-negative integer")
          expect(result.stdout).toBe("")
        })
      }

      test("a flag given with no value (parsed as boolean true) is BAD_ARG", async () => {
        const result = await runCLI(["search", `--${flag}`])
        expect(result.exitCode).toBe(1)
        const err = parsedStderr(result.stderr)
        expect(err.code).toBe("BAD_ARG")
        expect(err.error).toContain("true")
      })

      test('accepts "0" (falsy but valid) — no BAD_ARG', async () => {
        // --limit 0 short-circuits to an empty result set without a request.
        const result = await runCLI(["search", `--${flag}`, "0", "--limit", "0"])
        const err = parsedStderr(result.stderr)
        expect(err.code).not.toBe("BAD_ARG")
      })
    })
  }

  test("validation happens before any network call — a bad flag fails fast", async () => {
    const started = Date.now()
    const result = await runCLI(["search", "-q", "machine learning", "--limit", "abc"])
    expect(result.exitCode).toBe(1)
    expect(parsedStderr(result.stderr).code).toBe("BAD_ARG")
    // A real request (fetch + up to 15s timeout) could never finish this fast.
    expect(Date.now() - started).toBeLessThan(5000)
  })

  test("a bad flag is caught even when it follows valid ones", async () => {
    const result = await runCLI([
      "search",
      "--jobage",
      "7",
      "--page",
      "1",
      "--limit",
      "-3",
    ])
    expect(result.exitCode).toBe(1)
    expect(parsedStderr(result.stderr).code).toBe("BAD_ARG")
  })

  test("the missing-id check runs before flag parsing on `detail`", async () => {
    const result = await runCLI(["detail", "--format", "plain"])
    expect(result.exitCode).toBe(1)
    expect(parsedStderr(result.stderr).code).toBe("NO_ID")
  })

  test("a too-short --query is rejected before any network call", async () => {
    // Jobicy 400s on a `tag` shorter than 3 chars; catch it locally instead.
    const result = await runCLI(["search", "-q", "AI"])
    expect(result.exitCode).toBe(1)
    const err = parsedStderr(result.stderr)
    expect(err.code).toBe("BAD_ARG")
    expect(err.error).toContain("--query")
    expect(result.stdout).toBe("")
  })

  test("a too-long --query is rejected before any network call", async () => {
    const result = await runCLI(["search", "-q", "x".repeat(51)])
    expect(result.exitCode).toBe(1)
    expect(parsedStderr(result.stderr).code).toBe("BAD_ARG")
  })

  test("a negative value is reported verbatim, not as `true`", async () => {
    // A bare number after a flag is a value even though it starts with "-",
    // so the error quotes what the user actually typed.
    const result = await runCLI(["search", "--limit", "-1"])
    expect(result.exitCode).toBe(1)
    const err = parsedStderr(result.stderr)
    expect(err.code).toBe("BAD_ARG")
    expect(err.error).toContain('got "-1"')
  })

  test("the --flag=value form is bound, never silently ignored", async () => {
    const bad = await runCLI(["search", "--limit=-1"])
    expect(bad.exitCode).toBe(1)
    expect(parsedStderr(bad.stderr).code).toBe("BAD_ARG")
    expect(parsedStderr(bad.stderr).error).toContain('got "-1"')

    const fractional = await runCLI(["search", "--jobage=1.5"])
    expect(fractional.exitCode).toBe(1)
    expect(parsedStderr(fractional.stderr).code).toBe("BAD_ARG")

    // Short queries are rejected client-side, which proves -q= bound the value.
    const short = await runCLI(["search", "-q=AI"])
    expect(short.exitCode).toBe(1)
    expect(parsedStderr(short.stderr).error).toContain("--query")
  })

  test("`detail --limit` is validated before any network call", async () => {
    for (const bad of ["foo", "-1", "1.5"]) {
      const result = await runCLI(["detail", "143131", "--limit", bad])
      expect(result.exitCode).toBe(1)
      const err = parsedStderr(result.stderr)
      expect(err.code).toBe("BAD_ARG")
      expect(err.error).toContain("--limit")
    }
  })
})
