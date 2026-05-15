import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  scaffoldProject,
  ScaffoldError,
} from "../../src/cli/scaffold.js";
import { validateComposition } from "../../src/schema/index.js";

const tmps: string[] = [];

async function makeTmp(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tmps.push(dir);
  return dir;
}

afterEach(async () => {
  while (tmps.length) {
    const d = tmps.pop()!;
    await rm(d, { recursive: true, force: true });
  }
});

describe("cli · scaffold", () => {
  it("creates a valid project layout in an empty directory", async () => {
    const root = await makeTmp("davidup-scaffold-");
    // makeTmp creates the dir; remove it so scaffold has a clean slate.
    await rm(root, { recursive: true, force: true });

    const result = await scaffoldProject({ targetDir: root });
    expect(result.root).toBe(root);
    expect(result.compositionPath).toBe(join(root, "composition.json"));
    expect(result.filesWritten.length).toBeGreaterThan(0);
    expect(
      result.filesWritten.some((p) => p.endsWith("composition.json")),
    ).toBe(true);
    expect(
      result.filesWritten.some((p) => p.endsWith(join("library", "index.json"))),
    ).toBe(true);

    const raw = await readFile(result.compositionPath, "utf8");
    const parsed = JSON.parse(raw);
    const v = validateComposition(parsed);
    expect(v.valid).toBe(true);
  });

  it("creates renders/ directory (gitignored output target)", async () => {
    const root = await makeTmp("davidup-scaffold-renders-");
    await rm(root, { recursive: true, force: true });
    await scaffoldProject({ targetDir: root });
    const stat = await import("node:fs").then((m) =>
      m.promises.stat(join(root, "renders")),
    );
    expect(stat.isDirectory()).toBe(true);
  });

  it("refuses to scaffold into a non-empty directory without --force", async () => {
    const root = await makeTmp("davidup-scaffold-existing-");
    await writeFile(join(root, "marker.txt"), "x", "utf8");
    let err: unknown;
    try {
      await scaffoldProject({ targetDir: root });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ScaffoldError);
    expect((err as ScaffoldError).code).toBe("E_TARGET_NOT_EMPTY");
  });

  it("scaffolds into a non-empty directory when --force is given", async () => {
    const root = await makeTmp("davidup-scaffold-force-");
    await writeFile(join(root, "marker.txt"), "x", "utf8");
    const result = await scaffoldProject({ targetDir: root, force: true });
    expect(result.compositionPath).toBe(join(root, "composition.json"));
  });

  it("rejects unknown templates", async () => {
    const root = await makeTmp("davidup-scaffold-bad-template-");
    await rm(root, { recursive: true, force: true });
    let err: unknown;
    try {
      await scaffoldProject({ targetDir: root, template: "nope" });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ScaffoldError);
    expect((err as ScaffoldError).code).toBe("E_TEMPLATE_NOT_FOUND");
  });
});
