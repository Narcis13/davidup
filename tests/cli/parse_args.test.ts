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
});
