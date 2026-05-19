# Implementation notes

**Spec:** **20.32 — Structured error details in MCP responses.**
- `mcp_bridge.ts:208-215` — preserve `issues[]` and `warnings[]` in `MCPErrorBody`. Add `details` field. Agents finally get actionable validation feedback instead of `errors[0].message`. dont run tests, i will test manually later

**Started:** 2026-05-19

---

## Spec line numbers don't match the file

The spec points at `mcp_bridge.ts:208-215`, but that range is inside `buildProjectControls` (project metadata mapping). The error-mapping code the spec describes lives at lines 568-618 — `errorResult()` and `mapBusErrorToDispatch()`. Proceeded against those, since the body of the spec (preserve `issues[]`/`warnings[]`, add `details`) only makes sense there.

**Why:** The spec's *intent* is unambiguous; the line numbers were almost certainly written against a stale snapshot. Flagging rather than guessing what 208-215 might have been.

## Touched `src/mcp/errors.ts` as well as the bridge

The spec called out `mcp_bridge.ts` only, but `MCPErrorBody` is the canonical envelope type defined in `src/mcp/errors.ts`. Adding fields only in the bridge would require widening to `as any` at the call sites and would leave engine-side `MCPToolError.toBody()` unable to populate them — meaning a tool that throws an `MCPToolError` with rich details can't propagate them through `dispatchTool`.

**Why:** The envelope contract is shared between the engine's direct dispatch path and the editor's bridge. Extending it in one place keeps both consistent.

**Alternative considered:** Keep `MCPErrorBody` minimal and add a parallel `EditorMCPErrorBody` in the bridge. Rejected — agents consume one wire shape regardless of which path produced the error; two body types would diverge.

## Shape of the new fields

- `issues?: ReadonlyArray<MCPIssue>` — validation failures that prevented the command (Zod issues, post-validate `errors`). Each `MCPIssue` has `message`, optional `path`, optional `code`. Mirrors `ValidationError` from `schema/validator.ts` and Zod issue shape, so callers can do either.
- `warnings?: ReadonlyArray<MCPIssue>` — non-fatal validator output (e.g. `W_TWEEN_TRUNCATED`). Same shape as issues for consistency; agents shouldn't need a second parser.
- `details?: Record<string, unknown>` — open-ended bag for error-specific context (e.g. for `E_TWEEN_OVERLAP`, the conflicting tween id; for `E_INVALID_VALUE` from project create, the rejected name). Populated opportunistically; agents must tolerate it being absent.

**Why:** Symmetric issues/warnings shape keeps the consumer trivial; `details` is the escape hatch for things that don't fit the issue model.

## `CommandValidationError` now forwards all issues, not just `[0]`

Previous behaviour took `err.issues[0]` and dropped the rest into the message. After this change, the full array goes into `error.issues`, and `hint` keeps its single-issue path summary for human readers / backwards compat. Same for `PostValidationError`: full `result.errors`/`result.warnings` arrays are forwarded.

**Why:** That's the headline of the spec — "actionable validation feedback instead of `errors[0].message`".

## Zod parse failure in `dispatchTool` also gets the upgrade

Updated `src/mcp/dispatch.ts` so input-schema failures attach the full `parsed.error.issues` list to the error body too. Without this, the editor bridge would emit rich errors for command-level validation but the engine's own arg validation would still flatten to a single message.

**Why:** Same contract on both error paths; agents shouldn't have to learn which one they hit to know whether `issues` will be present.

## Existing `MCPToolError` constructor — backwards compatible

`MCPToolError(code, message, hint?)` is called from many sites. Added an optional fourth `extras` arg (`{ issues?, warnings?, details? }`) rather than re-ordering positional args. All existing call sites keep working unchanged.

**Why:** Zero ripple for unrelated tool handlers. The new arg is purely additive.

## Deferred / out-of-scope

- Did not retrofit existing throw sites (e.g. `add_tween` for `E_TWEEN_OVERLAP`) to populate `details` with the conflicting tween id. The plumbing is now there but only the validation-error paths use it. Each tool would benefit but that's a separate sweep.
- Did not surface `details` through the editor UI's error toasts; that surface still reads `message`/`hint` only.

## Footgun: editor consumes a *copy* of `src/`, not a live symlink

`apps/editor` depends on the engine via `"davidup": "file:../.."`. Bun materialises that as a real directory at `node_modules/.bun/davidup@root/node_modules/davidup` — not a symlink. So edits to `src/mcp/errors.ts` do not appear under `davidup/mcp` for the editor until `bun install` re-syncs the snapshot.

**Why this matters:** First typecheck after the edit failed with `Module '"davidup/mcp"' has no exported member 'MCPIssue'`, even though the export was right there in `src/mcp/index.ts`. Ran `bun install` to refresh the snapshot, then the error cleared.

**How to apply:** After any edit under `src/` that the editor imports, run `bun install` before typechecking or running the dev server inside `apps/editor`.

## Open questions

- Should `details` ever be allowed on success envelopes too (e.g. for warnings on a successful apply)? Currently it's error-only. Leaving as-is until there's a concrete need.
