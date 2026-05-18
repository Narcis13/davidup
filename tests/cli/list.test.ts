import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "../../src/cli/cli.js";

interface CapturedIo {
  out: string[];
  err: string[];
  io: { log: (m: string) => void; error: (m: string) => void };
}

function captureIo(): CapturedIo {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    io: { log: (m) => out.push(m), error: (m) => err.push(m) },
  };
}

const tmps: string[] = [];
afterEach(async () => {
  while (tmps.length) {
    const d = tmps.pop()!;
    await rm(d, { recursive: true, force: true });
  }
});

async function tmp(label: string): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), `davidup-cli-list-${label}-`));
  tmps.push(d);
  return d;
}

describe("cli · list / recent", () => {
  it("prints a friendly message when recents.json is missing", async () => {
    const stateDir = await tmp("missing");
    const cap = captureIo();
    const code = await runCli(["list"], {
      io: cap.io,
      cwd: process.cwd(),
      recentsPath: join(stateDir, "does-not-exist.json"),
    });
    expect(code).toBe(0);
    expect(cap.out.join("\n")).toMatch(/No recent projects/);
  });

  it("prints a table with header + one row per live project", async () => {
    const stateDir = await tmp("happy");
    const p1 = await tmp("proj1");
    const p2 = await tmp("proj2");
    // Seed two project dirs.
    await mkdir(p1, { recursive: true });
    await mkdir(p2, { recursive: true });
    const recents = {
      projects: [
        {
          path: p1,
          name: "alpha",
          lastOpenedAt: Date.parse("2026-05-18T10:00:00Z"),
          lastModifiedAt: Date.parse("2026-05-17T10:00:00Z"),
        },
        {
          path: p2,
          name: "beta",
          lastOpenedAt: Date.parse("2026-05-18T12:00:00Z"),
          lastModifiedAt: Date.parse("2026-05-18T11:00:00Z"),
        },
      ],
    };
    const recentsPath = join(stateDir, "recents.json");
    await writeFile(recentsPath, JSON.stringify(recents), "utf8");

    const cap = captureIo();
    const code = await runCli(["list"], {
      io: cap.io,
      cwd: process.cwd(),
      recentsPath,
      now: () => new Date(Date.parse("2026-05-18T13:00:00Z")),
    });
    expect(code).toBe(0);
    const lines = cap.out;
    // Header + 2 rows.
    expect(lines.length).toBe(3);
    expect(lines[0]).toMatch(/NAME/);
    expect(lines[0]).toMatch(/PATH/);
    expect(lines[0]).toMatch(/LAST OPENED/);
    expect(lines[0]).toMatch(/MODIFIED/);
    // beta opened more recently, so it sorts first.
    expect(lines[1]).toMatch(/^beta\b/);
    expect(lines[2]).toMatch(/^alpha\b/);
    // Relative-time formatting kicks in: 1h ago for beta, 3h ago for alpha.
    expect(lines[1]).toMatch(/1h ago/);
    expect(lines[2]).toMatch(/3h ago/);
  });

  it("prunes entries whose directory no longer exists", async () => {
    const stateDir = await tmp("prune");
    const alive = await tmp("alive");
    await mkdir(alive, { recursive: true });
    const recentsPath = join(stateDir, "recents.json");
    await writeFile(
      recentsPath,
      JSON.stringify({
        projects: [
          {
            path: alive,
            name: "alive",
            lastOpenedAt: Date.now(),
            lastModifiedAt: Date.now(),
          },
          {
            path: "/var/empty/this-path-does-not-exist-davidup",
            name: "ghost",
            lastOpenedAt: Date.now(),
            lastModifiedAt: Date.now(),
          },
        ],
      }),
      "utf8",
    );
    const cap = captureIo();
    const code = await runCli(["list"], {
      io: cap.io,
      cwd: process.cwd(),
      recentsPath,
    });
    expect(code).toBe(0);
    const joined = cap.out.join("\n");
    expect(joined).toMatch(/alive/);
    expect(joined).not.toMatch(/ghost/);
  });

  it("`recent` is an alias of `list`", async () => {
    const stateDir = await tmp("alias");
    const p = await tmp("proj");
    await mkdir(p, { recursive: true });
    const recentsPath = join(stateDir, "recents.json");
    await writeFile(
      recentsPath,
      JSON.stringify({
        projects: [
          {
            path: p,
            name: "only",
            lastOpenedAt: Date.parse("2026-05-18T12:00:00Z"),
            lastModifiedAt: Date.parse("2026-05-18T12:00:00Z"),
          },
        ],
      }),
      "utf8",
    );
    const now = () => new Date(Date.parse("2026-05-18T12:00:30Z"));
    const a = captureIo();
    const b = captureIo();
    const codeA = await runCli(["list"], {
      io: a.io,
      cwd: process.cwd(),
      recentsPath,
      now,
    });
    const codeB = await runCli(["recent"], {
      io: b.io,
      cwd: process.cwd(),
      recentsPath,
      now,
    });
    expect(codeA).toBe(0);
    expect(codeB).toBe(0);
    expect(a.out).toEqual(b.out);
  });

  it("returns 0 with a friendly message when recents.json is malformed", async () => {
    const stateDir = await tmp("malformed");
    const recentsPath = join(stateDir, "recents.json");
    await writeFile(recentsPath, "{not json", "utf8");
    const cap = captureIo();
    const code = await runCli(["list"], {
      io: cap.io,
      cwd: process.cwd(),
      recentsPath,
    });
    expect(code).toBe(0);
    expect(cap.out.join("\n")).toMatch(/No recent projects/);
  });
});
