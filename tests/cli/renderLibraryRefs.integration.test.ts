// L-1 regression: `davidup render` must be able to render a composition that
// names a template or an executable behavior from the global library, and one
// that defines its own executable behavior inline.
//
// Before the fix neither was possible: `precompile` only saw the composition's
// own `templates{}` block plus the built-ins, and an executable user behavior
// existed only inside an MCP/editor session — so the vertical showcase had to
// inline `~/.davidup/library/templates/ctaButton.template.json` and call
// `registerBehavior()` from a bespoke render script.
//
// Renders for real (skia-canvas, PNG sequence — no ffmpeg) against a fixture
// library pointed at by $DAVIDUP_LIBRARY, so the Node-only half of
// `resolveLibraryRefs` (node:path + defaultGlobalLibraryRoot) is exercised
// rather than stubbed.

import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { renderComposition } from "../../src/cli/render.js";
import { hasBehavior, hasTemplate } from "../../src/compose/index.js";

const tmps: string[] = [];
const envBefore = process.env.DAVIDUP_LIBRARY;
afterEach(async () => {
  if (envBefore === undefined) delete process.env.DAVIDUP_LIBRARY;
  else process.env.DAVIDUP_LIBRARY = envBefore;
  while (tmps.length) {
    await rm(tmps.pop()!, { recursive: true, force: true });
  }
});

async function makeTmp(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tmps.push(dir);
  return dir;
}

function transform(x: number, y: number): Record<string, number> {
  return { x, y, scaleX: 1, scaleY: 1, rotation: 0, anchorX: 0, anchorY: 0, opacity: 1 };
}

/** A `$DAVIDUP_LIBRARY` root holding one template and one behavior card. */
async function makeLibrary(): Promise<string> {
  const root = await makeTmp("davidup-lib-");
  await mkdir(join(root, "templates"), { recursive: true });
  await mkdir(join(root, "behaviors"), { recursive: true });
  await writeFile(
    join(root, "templates", "libPill.template.json"),
    JSON.stringify({
      id: "libPill",
      description: "A coloured pill.",
      params: [
        { name: "x", type: "number", default: 4 },
        { name: "color", type: "color", default: "#ff0044" },
      ],
      items: {
        pill: {
          type: "shape",
          kind: "rect",
          width: 20,
          height: 10,
          fillColor: "${params.color}",
          transform: {
            x: "${params.x}",
            y: 4,
            scaleX: 1,
            scaleY: 1,
            rotation: 0,
            anchorX: 0,
            anchorY: 0,
            opacity: 1,
          },
        },
      },
      // The template's own tween uses the library behavior — the transitive
      // load path.
      tweens: [{ $behavior: "global:libBlink", target: "pill", start: 0, duration: 0.5 }],
    }),
  );
  await writeFile(
    join(root, "behaviors", "libBlink.behavior.json"),
    JSON.stringify({
      name: "libBlink",
      description: "Opacity blink settling on 1.",
      params: [{ name: "low", type: "number", default: 0.2 }],
      tweens: [
        {
          property: "transform.opacity",
          from: "${params.low}",
          to: 1,
          suffix: "blink",
        },
      ],
    }),
  );
  return root;
}

function composition(): Record<string, unknown> {
  return {
    version: "0.1",
    composition: { width: 64, height: 32, fps: 12, duration: 1 / 12, background: "#000010" },
    assets: [],
    layers: [{ id: "fg", z: 0, opacity: 1, blendMode: "normal", items: ["btn", "dot"] }],
    // An executable behavior the composition itself defines — no session, no
    // process registry.
    behaviors: {
      slideUp: {
        params: [{ name: "by", type: "number", default: 6 }],
        tweens: [
          { property: "transform.y", from: "${20 + params.by}", to: 20, suffix: "up" },
        ],
      },
    },
    items: {
      btn: { $template: "global:libPill", start: 0, params: { x: 6, color: "#33ff88" } },
      dot: {
        type: "shape",
        kind: "circle",
        width: 8,
        height: 8,
        fillColor: "#ffffff",
        transform: transform(40, 20),
      },
    },
    tweens: [{ $behavior: "slideUp", target: "dot", start: 0, duration: 0.5 }],
  };
}

describe("cli · render · library templates and behaviors (L-1, integration)", () => {
  it("renders a composition using a global: template, a global: behavior and its own", async () => {
    process.env.DAVIDUP_LIBRARY = await makeLibrary();

    const project = await makeTmp("davidup-proj-");
    await writeFile(join(project, "composition.json"), JSON.stringify(composition()));

    const out = await makeTmp("davidup-out-");
    const result = await renderComposition({
      input: project,
      outputPath: out,
      format: "png-sequence",
    });

    expect(result.frameCount).toBe(1);
    expect((await readdir(out)).filter((f) => f.endsWith(".png"))).toHaveLength(1);
    // Compile-scoped, both of them: nothing was written to the process
    // registries a second render (or another composition) would read.
    expect(hasTemplate("global:libPill")).toBe(false);
    expect(hasTemplate("libPill")).toBe(false);
    expect(hasBehavior("slideUp")).toBe(false);
    expect(hasBehavior("global:libBlink")).toBe(false);
  }, 30_000);

  it("names the file it looked for when a global: template is missing", async () => {
    const library = await makeTmp("davidup-lib-");
    process.env.DAVIDUP_LIBRARY = library;

    const project = await makeTmp("davidup-proj-");
    const comp = composition();
    (comp.items as Record<string, unknown>).btn = { $template: "global:nope", start: 0 };
    await writeFile(join(project, "composition.json"), JSON.stringify(comp));

    await expect(
      renderComposition({
        input: project,
        outputPath: await makeTmp("davidup-out-"),
        format: "png-sequence",
      }),
    ).rejects.toThrow(join(library, "templates", "nope.template.json"));
  });
});
