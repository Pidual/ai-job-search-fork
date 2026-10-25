import { describe, test, expect } from "bun:test";
import { runCLI, type CLIResult } from "./helpers";

// These tests are deliberately network-free. Every assertion below exercises a code
// path that returns BEFORE any fetch() call — see cli.ts, which validates all flags
// up front. If a change ever moves validation after the request, these tests start
// hitting hn.algolia.com and CI becomes flaky; that is the regression they guard.

function errorJSON(result: CLIResult): { error: string; code: string } {
  expect(result.stderr.length).toBeGreaterThan(0);
  const parsed = JSON.parse(result.stderr) as { error: string; code: string };
  expect(typeof parsed.error).toBe("string");
  expect(typeof parsed.code).toBe("string");
  return parsed;
}

describe("invocation contract", () => {
  test("bare invocation prints help and exits non-zero", async () => {
    const r = await runCLI([]);
    expect(r.exitCode).not.toBe(0);
    expect(r.stdout).toContain("hnhiring-cli");
    expect(r.stdout).toContain("USAGE");
  });

  test("--help with a command prints usage to stdout and exits 0", async () => {
    const r = await runCLI(["search", "--help"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("SEARCH FLAGS");
    expect(r.stdout).toContain("--query");
    expect(r.stdout).toContain("--thread");
    expect(r.stdout).toContain("--month");
    expect(r.stderr).toBe("");
  });

  test("-h behaves like --help", async () => {
    const r = await runCLI(["detail", "-h"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("USAGE");
  });

  test("unknown command exits 1 with BAD_CMD on stderr", async () => {
    const r = await runCLI(["frobnicate"]);
    expect(r.exitCode).toBe(1);
    expect(r.stdout).toBe("");
    const e = errorJSON(r);
    expect(e.code).toBe("BAD_CMD");
    expect(e.error).toContain("frobnicate");
  });

  test("errors never go to stdout", async () => {
    for (const args of [["frobnicate"], ["detail"], ["search", "--limit", "foo"]]) {
      const r = await runCLI(args);
      expect(r.stdout).toBe("");
      expect(r.exitCode).toBe(1);
    }
  });
});

describe("detail argument contract", () => {
  test("detail with no id exits 1 with NO_ID", async () => {
    const r = await runCLI(["detail"]);
    expect(r.exitCode).toBe(1);
    expect(errorJSON(r).code).toBe("NO_ID");
  });

  test("detail with an unparseable id exits 1 with BAD_ID before any request", async () => {
    const r = await runCLI(["detail", "not-an-id"]);
    expect(r.exitCode).toBe(1);
    expect(errorJSON(r).code).toBe("BAD_ID");
  });
});

describe("integer flag validation", () => {
  const INT_FLAGS = ["jobage", "page", "limit", "thread"] as const;

  for (const flag of INT_FLAGS) {
    test(`--${flag} rejects a non-numeric value`, async () => {
      const r = await runCLI(["search", `--${flag}`, "foo"]);
      expect(r.exitCode).toBe(1);
      const e = errorJSON(r);
      expect(e.code).toBe("BAD_ARG");
      expect(e.error).toBe(`--${flag} must be a non-negative integer, got "foo"`);
    });

    test(`--${flag} rejects a negative value`, async () => {
      const r = await runCLI(["search", `--${flag}`, "-1"]);
      expect(r.exitCode).toBe(1);
      const e = errorJSON(r);
      expect(e.code).toBe("BAD_ARG");
      // "-1" starts with "-", so it parses as a valueless flag → boolean true.
      expect(e.error).toMatch(/^--\w+ must be a non-negative integer, got "/);
    });

    test(`--${flag} rejects a fractional value`, async () => {
      const r = await runCLI(["search", `--${flag}`, "1.5"]);
      expect(r.exitCode).toBe(1);
      const e = errorJSON(r);
      expect(e.code).toBe("BAD_ARG");
      expect(e.error).toBe(`--${flag} must be a non-negative integer, got "1.5"`);
    });

    test(`--${flag} rejects being supplied with no value`, async () => {
      const r = await runCLI(["search", `--${flag}`]);
      expect(r.exitCode).toBe(1);
      const e = errorJSON(r);
      expect(e.code).toBe("BAD_ARG");
      expect(e.error).toBe(`--${flag} must be a non-negative integer, got "true"`);
    });
  }

  // `0` is falsy but valid — it must not be rejected. To assert acceptance without
  // making a request, we pair the zero with a deliberately invalid --month: the
  // integer flags are validated first, so an error naming --month proves the zero
  // was accepted and nothing ever reached the network.
  for (const flag of INT_FLAGS) {
    test(`--${flag} 0 is accepted (falsy but valid)`, async () => {
      const r = await runCLI(["search", `--${flag}`, "0", "--month", "not-a-month"]);
      expect(r.exitCode).toBe(1);
      const e = errorJSON(r);
      expect(e.code).toBe("BAD_ARG");
      expect(e.error).toContain("--month");
      expect(e.error).not.toContain(`--${flag}`);
    });
  }
});

describe("--month validation", () => {
  test("rejects a malformed month before any request", async () => {
    const r = await runCLI(["search", "--month", "august"]);
    expect(r.exitCode).toBe(1);
    const e = errorJSON(r);
    expect(e.code).toBe("BAD_ARG");
    expect(e.error).toBe('--month must be YYYY-MM, got "august"');
  });

  test("rejects an out-of-range month", async () => {
    const r = await runCLI(["search", "--month", "2026-13"]);
    expect(r.exitCode).toBe(1);
    expect(errorJSON(r).code).toBe("BAD_ARG");
  });

  test("rejects a single-digit month", async () => {
    const r = await runCLI(["search", "--month", "2026-8"]);
    expect(r.exitCode).toBe(1);
    expect(errorJSON(r).code).toBe("BAD_ARG");
  });
});
