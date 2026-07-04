import { describe, expect, it } from "vitest";
import { parseArgs } from "../../src/cli/cli.js";

describe("cli · parseArgs", () => {
  it("returns help for empty argv", () => {
    expect(parseArgs([]).kind).toBe("help");
  });

  it("returns help for -h / --help / help", () => {
    expect(parseArgs(["-h"]).kind).toBe("help");
    expect(parseArgs(["--help"]).kind).toBe("help");
    expect(parseArgs(["help"]).kind).toBe("help");
  });

  it("returns version for -v / --version / version", () => {
    expect(parseArgs(["-v"]).kind).toBe("version");
    expect(parseArgs(["--version"]).kind).toBe("version");
    expect(parseArgs(["version"]).kind).toBe("version");
  });

  it("parses `edit <dir>` with positional", () => {
    const r = parseArgs(["edit", "./my-clip"]);
    expect(r.kind).toBe("edit");
    expect(r.positional).toBe("./my-clip");
  });

  it("parses `new <dir>` with positional", () => {
    const r = parseArgs(["new", "./my-clip"]);
    expect(r.kind).toBe("new");
    expect(r.positional).toBe("./my-clip");
  });

  it("parses --foo=bar flags", () => {
    const r = parseArgs(["edit", "./x", "--port=4000", "--host=0.0.0.0"]);
    expect(r.kind).toBe("edit");
    expect(r.flags).toEqual({ port: "4000", host: "0.0.0.0" });
  });

  it("parses bare --flag as boolean true", () => {
    const r = parseArgs(["edit", "./x", "--no-open"]);
    expect(r.kind).toBe("edit");
    expect(r.flags).toEqual({ "no-open": true });
  });

  it("parses --force on new", () => {
    const r = parseArgs(["new", "./x", "--force", "--template=basic"]);
    expect(r.kind).toBe("new");
    expect(r.flags).toEqual({ force: true, template: "basic" });
  });

  it("errors when edit has no positional", () => {
    const r = parseArgs(["edit"]);
    expect(r.kind).toBe("error");
    expect(r.error).toMatch(/requires a directory/);
  });

  it("errors when new has no positional", () => {
    const r = parseArgs(["new"]);
    expect(r.kind).toBe("error");
    expect(r.error).toMatch(/requires a directory/);
  });

  it("errors when more than one positional", () => {
    const r = parseArgs(["edit", "./a", "./b"]);
    expect(r.kind).toBe("error");
    expect(r.error).toMatch(/exactly one directory/);
  });

  it("errors on unknown command", () => {
    const r = parseArgs(["frobnicate"]);
    expect(r.kind).toBe("error");
    expect(r.error).toMatch(/Unknown command/);
  });

  it("parses `list` with no positional", () => {
    const r = parseArgs(["list"]);
    expect(r.kind).toBe("list");
    expect(r.positional).toBeUndefined();
  });

  it("parses `recent` as its own command kind", () => {
    const r = parseArgs(["recent"]);
    expect(r.kind).toBe("recent");
  });

  it("errors when `list` is given a positional", () => {
    const r = parseArgs(["list", "./somewhere"]);
    expect(r.kind).toBe("error");
    expect(r.error).toMatch(/takes no positional/);
  });

  it("errors when `recent` is given a positional", () => {
    const r = parseArgs(["recent", "./somewhere"]);
    expect(r.kind).toBe("error");
    expect(r.error).toMatch(/takes no positional/);
  });

  it("parses `render <input> -o <out>`", () => {
    const r = parseArgs(["render", "./my-clip", "-o", "out.mp4"]);
    expect(r.kind).toBe("render");
    expect(r.positional).toBe("./my-clip");
    expect(r.flags).toEqual({ output: "out.mp4" });
  });

  it("parses `render <input> --output=<out>` and extra flags", () => {
    const r = parseArgs([
      "render",
      "comp.json",
      "--output=out.mp4",
      "--codec=libx265",
      "--crf=20",
      "--fps=30",
      "--preset=fast",
    ]);
    expect(r.kind).toBe("render");
    expect(r.flags).toEqual({
      output: "out.mp4",
      codec: "libx265",
      crf: "20",
      fps: "30",
      preset: "fast",
    });
  });

  it("errors when render has no positional", () => {
    const r = parseArgs(["render", "-o", "out.mp4"]);
    expect(r.kind).toBe("error");
    expect(r.error).toMatch(/requires a project or composition JSON/);
  });

  it("errors when render is missing -o/--output", () => {
    const r = parseArgs(["render", "./my-clip"]);
    expect(r.kind).toBe("error");
    expect(r.error).toMatch(/requires -o\/--output/);
  });

  it("errors when -o is given with no value", () => {
    const r = parseArgs(["render", "./my-clip", "-o"]);
    expect(r.kind).toBe("error");
    expect(r.error).toMatch(/--output.*requires a value/);
  });

  it("errors when render has more than one positional", () => {
    const r = parseArgs(["render", "./a", "./b", "-o", "out.mp4"]);
    expect(r.kind).toBe("error");
    expect(r.error).toMatch(/exactly one input argument/);
  });
});
