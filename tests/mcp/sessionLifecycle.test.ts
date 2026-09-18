// v1.1 S22 (R-29) — standalone session lifecycle: `reset` clears compositions
// AND the user template/scene/behavior registries, and the idle TTL
// (`--session-ttl` / DAVIDUP_SESSION_TTL) auto-resets everything.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CompositionStore,
  TOOLS,
  createIdleReset,
  createServer,
  dispatchTool,
  resolveSessionTtl,
  type ToolDeps,
} from "../../src/mcp/index.js";

function getTool(name: string) {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) throw new Error(`tool ${name} not registered`);
  return tool;
}

async function call(deps: ToolDeps, name: string, args: Record<string, unknown>) {
  const out = await dispatchTool(getTool(name), args, deps);
  if (!out.ok) throw new Error(`${name} failed: ${out.error.code} ${out.error.message}`);
  return out.result;
}

// A composition plus one entry in each user registry.
async function populate(deps: ToolDeps): Promise<void> {
  await call(deps, "create_composition", { width: 640, height: 360, fps: 30, duration: 2 });
  await call(deps, "define_user_template", {
    id: "stamp",
    params: [{ name: "text", type: "string", required: true }],
    items: {
      label: {
        type: "text",
        text: "${params.text}",
        font: "f",
        fontSize: 48,
        color: "#ffffff",
        transform: {
          x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, anchorX: 0, anchorY: 0, opacity: 1,
        },
      },
    },
    tweens: [],
  });
  await call(deps, "define_scene", {
    id: "blank",
    duration: 1,
    size: { width: 640, height: 360 },
    items: {},
    tweens: [],
  });
  await call(deps, "define_user_behavior", {
    name: "myPulse",
    description: "Scale up and back.",
    params: [],
    tweens: [
      { property: "transform.scaleX", from: 1, to: 1.2, duration: 0.2, suffix: "out" },
    ],
  });
}

function registryCounts(store: CompositionStore) {
  return {
    compositions: store.hasComposition() ? 1 : 0,
    templates: store.listUserTemplates().length,
    scenes: store.listUserScenes().length,
    behaviors: store.listUserBehaviors().length,
  };
}

const EMPTY = { compositions: 0, templates: 0, scenes: 0, behaviors: 0 };
const FULL = { compositions: 1, templates: 1, scenes: 1, behaviors: 1 };

describe("reset scope (R-29)", () => {
  it("reset with no args clears compositions and every user registry", async () => {
    const deps: ToolDeps = { store: new CompositionStore() };
    await populate(deps);
    expect(registryCounts(deps.store)).toEqual(FULL);

    await call(deps, "reset", {});
    expect(registryCounts(deps.store)).toEqual(EMPTY);
    // The ids are free again.
    await populate(deps);
    expect(registryCounts(deps.store)).toEqual(FULL);
  });

  it('scope "compositions" keeps the registries', async () => {
    const deps: ToolDeps = { store: new CompositionStore() };
    await populate(deps);
    await call(deps, "reset", { scope: "compositions" });
    expect(registryCounts(deps.store)).toEqual({ ...FULL, compositions: 0 });
  });

  it("reset({ compositionId }) leaves the registries alone", async () => {
    const deps: ToolDeps = { store: new CompositionStore() };
    await populate(deps);
    const id = deps.store.getDefaultId()!;
    await call(deps, "reset", { compositionId: id });
    expect(registryCounts(deps.store)).toEqual({ ...FULL, compositions: 0 });
  });

  it("rejects an unknown scope", async () => {
    const deps: ToolDeps = { store: new CompositionStore() };
    const out = await dispatchTool(getTool("reset"), { scope: "everything" }, deps);
    expect(out.ok).toBe(false);
  });
});

describe("idle TTL (R-29)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("createIdleReset wipes the store after `seconds` of no touch, and logs", async () => {
    vi.useFakeTimers();
    const store = new CompositionStore();
    const deps: ToolDeps = { store };
    await populate(deps);
    const log = vi.fn();
    const idle = createIdleReset(store, 10, log)!;

    idle.touch();
    vi.advanceTimersByTime(9_000);
    idle.touch(); // activity re-arms the timer
    vi.advanceTimersByTime(9_000);
    expect(registryCounts(store)).toEqual(FULL);
    expect(log).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1_000);
    expect(registryCounts(store)).toEqual(EMPTY);
    expect(log).toHaveBeenCalledOnce();
    expect(log.mock.calls[0]![0]).toMatch(/idle for 10s/);
  });

  it("is disabled at 0 and cancel() prevents the reset", async () => {
    expect(createIdleReset(new CompositionStore(), 0)).toBeNull();

    vi.useFakeTimers();
    const store = new CompositionStore();
    await populate({ store });
    const idle = createIdleReset(store, 5, () => {})!;
    idle.touch();
    idle.cancel();
    vi.advanceTimersByTime(60_000);
    expect(registryCounts(store)).toEqual(FULL);
  });

  it("createServer: tool calls re-arm the TTL and capabilities report it", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const store = new CompositionStore();
    const log = vi.fn();
    const server = createServer({ store, sessionTtlSeconds: 30, log });
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    await server.mcp.connect(serverT);
    const client = new Client({ name: "ttl-test", version: "0.0.0" });
    await client.connect(clientT);
    try {
      const caps = await client.callTool({ name: "list_engine_capabilities", arguments: {} });
      const server_ = (caps.structuredContent as { server: { sessionIdleSeconds: number } }).server;
      expect(server_.sessionIdleSeconds).toBe(30);

      await client.callTool({
        name: "create_composition",
        arguments: { width: 640, height: 360, fps: 30, duration: 1 },
      });
      vi.advanceTimersByTime(29_000);
      expect(store.hasComposition()).toBe(true);
      vi.advanceTimersByTime(1_000);
      expect(store.hasComposition()).toBe(false);
      expect(log).toHaveBeenCalledOnce();
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("capabilities report 0 without a TTL", async () => {
    const deps: ToolDeps = { store: new CompositionStore() };
    const caps = (await call(deps, "list_engine_capabilities", {})) as {
      server: { sessionIdleSeconds: number };
    };
    expect(caps.server.sessionIdleSeconds).toBe(0);
  });
});

describe("resolveSessionTtl", () => {
  it("reads the flag (both spellings), then the env, else 0", () => {
    expect(resolveSessionTtl([])).toBe(0);
    expect(resolveSessionTtl(["--session-ttl", "900"])).toBe(900);
    expect(resolveSessionTtl(["--session-ttl=60"])).toBe(60);
    expect(resolveSessionTtl([], { DAVIDUP_SESSION_TTL: "120" })).toBe(120);
    expect(resolveSessionTtl(["--session-ttl", "5"], { DAVIDUP_SESSION_TTL: "120" })).toBe(5);
    expect(resolveSessionTtl([], { DAVIDUP_SESSION_TTL: "" })).toBe(0);
  });

  it("throws on a malformed value", () => {
    expect(() => resolveSessionTtl(["--session-ttl", "soon"])).toThrow(/--session-ttl/);
    expect(() => resolveSessionTtl([], { DAVIDUP_SESSION_TTL: "-1" })).toThrow(
      /DAVIDUP_SESSION_TTL/,
    );
  });
});
