import { describe, test, expect } from "bun:test"
import { join } from "path"
import { runCLI } from "./helpers"

// These tests are strictly network-free. Every assertion below exercises a path
// that fails (or short-circuits) BEFORE the first fetch:
//   * flag validation runs before the roster is read and before any request
//   * an unknown --company token is rejected after the roster read, still with
//     zero network traffic — that is how "0 is a valid integer" is proved here
//     without fanning out over 22 job boards.
const NO_SUCH_COMPANY = "__no_such_company__"

function parsedStderr(stderr: string): { error?: string; code?: string } {
  try {
    return JSON.parse(stderr) as { error?: string; code?: string }
  } catch {
    return {}
  }
}

describe("command dispatch", () => {
  test("bare invocation prints help and exits non-zero", async () => {
    const result = await runCLI([])
    expect(result.exitCode).not.toBe(0)
    expect(result.stdout).toContain("USAGE")
    expect(result.stdout).toContain("ats-cli")
  })

  test("--help with a command prints usage and exits 0", async () => {
    const result = await runCLI(["search", "--help"])
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain("SEARCH FLAGS")
    expect(result.stdout).toContain("--provider")
  })

  test("-h with a command prints usage and exits 0", async () => {
    const result = await runCLI(["detail", "-h"])
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain("USAGE")
  })

  test("unknown command exits 1 with BAD_CMD on stderr", async () => {
    const result = await runCLI(["frobnicate"])
    expect(result.exitCode).toBe(1)
    const err = parsedStderr(result.stderr)
    expect(err.code).toBe("BAD_CMD")
    expect(err.error).toMatch(/frobnicate/)
    expect(result.stdout).toBe("")
  })

  test("errors are JSON on stderr with error+code keys, never on stdout", async () => {
    const result = await runCLI(["frobnicate"])
    const err = parsedStderr(result.stderr)
    expect(Object.keys(err).sort()).toEqual(["code", "error"])
  })
})

describe("detail argument contract", () => {
  test("detail with no id exits 1 with NO_ID", async () => {
    const result = await runCLI(["detail"])
    expect(result.exitCode).toBe(1)
    const err = parsedStderr(result.stderr)
    expect(err.code).toBe("NO_ID")
  })

  test("detail with an unparseable reference exits 1 with BAD_ID (no network)", async () => {
    const result = await runCLI(["detail", "4610158008"])
    expect(result.exitCode).toBe(1)
    const err = parsedStderr(result.stderr)
    expect(err.code).toBe("BAD_ID")
    expect(err.error).toMatch(/provider/)
  })

  test("detail rejects an unknown host", async () => {
    const result = await runCLI(["detail", "https://example.com/jobs/1"])
    expect(result.exitCode).toBe(1)
    expect(parsedStderr(result.stderr).code).toBe("BAD_ID")
  })
})

describe("integer flag validation", () => {
  for (const flag of ["jobage", "page", "limit"]) {
    describe(`--${flag}`, () => {
      test('rejects "foo" with BAD_ARG', async () => {
        const result = await runCLI(["search", `--${flag}`, "foo"])
        expect(result.exitCode).toBe(1)
        const err = parsedStderr(result.stderr)
        expect(err.code).toBe("BAD_ARG")
        expect(err.error).toMatch(new RegExp(flag))
        expect(err.error).toMatch(/non-negative integer/)
      })

      test('rejects "-1" with BAD_ARG, echoing what was actually typed', async () => {
        const result = await runCLI(["search", `--${flag}`, "-1"])
        expect(result.exitCode).toBe(1)
        const err = parsedStderr(result.stderr)
        expect(err.code).toBe("BAD_ARG")
        expect(err.error).toMatch(new RegExp(flag))
        // a leading "-" must not be mistaken for the next flag, which would
        // report the useless `got "true"` instead of the value the user gave
        expect(err.error).toContain('"-1"')
      })

      test('rejects "-1.5" with BAD_ARG', async () => {
        const result = await runCLI(["search", `--${flag}`, "-1.5"])
        expect(result.exitCode).toBe(1)
        const err = parsedStderr(result.stderr)
        expect(err.code).toBe("BAD_ARG")
        expect(err.error).toContain('"-1.5"')
      })

      test('rejects "1.5" with BAD_ARG', async () => {
        const result = await runCLI(["search", `--${flag}`, "1.5"])
        expect(result.exitCode).toBe(1)
        const err = parsedStderr(result.stderr)
        expect(err.code).toBe("BAD_ARG")
        expect(err.error).toMatch(new RegExp(flag))
      })

      test("rejects the flag given with no value", async () => {
        const result = await runCLI(["search", `--${flag}`])
        expect(result.exitCode).toBe(1)
        const err = parsedStderr(result.stderr)
        expect(err.code).toBe("BAD_ARG")
      })

      test('accepts "0" (falsy but valid) — stops later, without touching the network', async () => {
        const result = await runCLI(["search", `--${flag}`, "0", "--company", NO_SUCH_COMPANY])
        expect(result.exitCode).toBe(1)
        const err = parsedStderr(result.stderr)
        expect(err.code).toBe("UNKNOWN_COMPANY")
      })
    })
  }

  test("all integer flags together validate, then stop at the company check", async () => {
    const result = await runCLI([
      "search",
      "--jobage",
      "30",
      "--page",
      "2",
      "--limit",
      "5",
      "--company",
      NO_SUCH_COMPANY,
    ])
    const err = parsedStderr(result.stderr)
    expect(err.code).not.toBe("BAD_ARG")
    expect(err.code).toBe("UNKNOWN_COMPANY")
  })
})

describe("stdout flushing (regression: 64 KB pipe truncation)", () => {
  // A whole-roster `--format json` run is ~2 MB. `process.stdout.write()` only
  // queues once the OS pipe buffer (64 KB) is full and `process.exit()` discards
  // the queue, so writing without waiting for the flush truncated output at
  // exactly 65536 bytes and emitted invalid JSON. Network-free: this drives
  // writeOut directly through a child process whose stdout is a real pipe.
  const HELPERS = join(import.meta.dir, "../src/helpers.ts")
  const SIZE = 300000

  test("writeOut delivers a payload far larger than one pipe buffer", async () => {
    const script =
      `import { writeOut } from ${JSON.stringify(HELPERS)}\n` +
      `await writeOut("y".repeat(${SIZE}) + "\\nEND\\n")\n` +
      `process.exit(0)\n`
    const proc = Bun.spawn(["bun", "-e", script], { stdout: "pipe", stderr: "pipe" })
    const [stdout] = await Promise.all([new Response(proc.stdout).text(), proc.exited])
    expect(stdout.length).toBe(SIZE + 5)
    expect(stdout.endsWith("\nEND\n")).toBe(true)
    expect(stdout.length).toBeGreaterThan(65536)
  })
})

describe("enum and roster flag validation", () => {
  test("--provider rejects an unknown provider with BAD_ARG before any request", async () => {
    const result = await runCLI(["search", "--provider", "workday"])
    expect(result.exitCode).toBe(1)
    const err = parsedStderr(result.stderr)
    expect(err.code).toBe("BAD_ARG")
    expect(err.error).toMatch(/greenhouse, ashby, lever/)
  })

  test("--provider accepts the three real providers (stops at the company check)", async () => {
    for (const provider of ["greenhouse", "ashby", "lever"]) {
      const result = await runCLI(["search", "--provider", provider, "--company", NO_SUCH_COMPANY])
      const err = parsedStderr(result.stderr)
      expect(err.code).toBe("UNKNOWN_COMPANY")
    }
  })

  test("--company with no value is rejected with BAD_ARG", async () => {
    const result = await runCLI(["search", "--company"])
    expect(result.exitCode).toBe(1)
    expect(parsedStderr(result.stderr).code).toBe("BAD_ARG")
  })

  test("unknown --company token lists the known tokens", async () => {
    const result = await runCLI(["search", "--company", NO_SUCH_COMPANY])
    expect(result.exitCode).toBe(1)
    const err = parsedStderr(result.stderr)
    expect(err.code).toBe("UNKNOWN_COMPANY")
    expect(err.error).toMatch(/Known tokens:/)
    expect(err.error).toMatch(/anthropic/)
  })

  test("--company is repeatable; an unknown token in a valid list is reported", async () => {
    const result = await runCLI([
      "search",
      "--company",
      "anthropic",
      "--company",
      NO_SUCH_COMPANY,
    ])
    expect(result.exitCode).toBe(1)
    const err = parsedStderr(result.stderr)
    expect(err.code).toBe("UNKNOWN_COMPANY")
    expect(err.error).toContain(NO_SUCH_COMPANY)
    expect(err.error).not.toMatch(/token\(s\): anthropic/)
  })
})
