# Kit — a lightweight Claude Code workflow

One command, `/flow`, carries a task from idea to shipped HTML journey doc.
No roadmaps, no agent armies, no config — one state file per task is the
entire machinery. For multi-week, multi-phase projects use a heavyweight
system (GSD/LPL); this is the 80% path for everything else.

## The loop

```
/flow plan <task>     ground a plan in the real code   ┐
/flow build           implement, log decisions         │  state:
/flow review          adversarial diff-vs-plan review  │  .flow/<slug>.md
/flow ship            verify fresh → HTML journey doc  ┘
/flow <task>          all four in one session (S/M tasks)
/flow                 status of everything in flight
```

The state file — not the conversation — is the source of truth. Every phase
reads it first and leaves it resumable, so a context reset or a new session
costs nothing. Four rules make it work (full text in `skills/flow/SKILL.md`):

1. **Resume test** — after every write, the file alone lets a stranger continue.
2. **The file never lies** — plan diverges? Amend it before coding on.
3. **Evidence over claims** — acceptance boxes only tick with command + result.
4. **Ceremony scales with size** — S tasks get 15-line plans, not theater.

## What's in this folder

| Path | What it is |
|---|---|
| `skills/flow/` | The workflow: SKILL.md (router + state contract) + `phases/{plan,build,review,ship}.md` |
| `skills/to-doc/` | Rich standalone HTML renderer (docs + slide decks) with embedded AI-readable markdown |
| `skills/extract-md/` | Pull the markdown back out of a to-doc HTML file |
| `.claude-plugin/plugin.json` | Inert here; makes this folder lift-and-ship as a plugin (below) |

Generated at runtime, committable (gitignore `.flow/` if you'd rather not):

- `.flow/<slug>.md` — one state file per task (plan → build log → review → outcome)
- `.flow/memory.md` — durable project facts earned across tasks, read by every phase
- `docs/flow/<slug>.html` — the shipped journey docs

## Reusing this in all your projects (plugin)

This folder is already plugin-shaped. To make it a plugin named `kit`:

```bash
mkdir -p ~/claude-kit && cp -R .claude/. ~/claude-kit/    # skills/ + .claude-plugin/
mkdir -p ~/claude-kit-marketplace/.claude-plugin
cat > ~/claude-kit-marketplace/.claude-plugin/marketplace.json <<'EOF'
{
  "name": "narcis",
  "owner": { "name": "Narcis Brindusescu" },
  "plugins": [{ "name": "kit", "source": "~/claude-kit" }]
}
EOF
claude plugin marketplace add ~/claude-kit-marketplace
claude plugin install kit@narcis --scope user
```

Plugin skills are namespaced, so the commands become `/kit:flow`,
`/kit:to-doc`, `/kit:extract-md` everywhere. To try a change without
installing: `claude --plugin-dir ~/claude-kit`. Rename the plugin by editing
one field in `plugin.json`. Once installed as a plugin, delete the
project-local copies of the skills to avoid duplicates.
