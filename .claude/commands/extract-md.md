---
description: Extract markdown from <script type="text/markdown" id="ai-frontmatter"> in an HTML file and save it as a .md file next to the source
argument-hint: <path-to-html-file>
allowed-tools: Bash(python3:*), Bash(test:*), Bash(ls:*)
---

Extract the markdown content embedded inside the `<script type="text/markdown" id="ai-frontmatter">...</script>` block of the HTML file at: `$ARGUMENTS`

Steps:

1. Verify the file exists and is readable. If `$ARGUMENTS` is empty or the file does not exist, stop and tell the user the correct usage: `/extract-md <path-to-html-file>`.

2. Run the following python3 one-liner via the Bash tool to extract the markdown and write it next to the source HTML file (same directory, same basename, `.md` extension). The script must:
   - Locate the script element by `id="ai-frontmatter"` (and `type="text/markdown"`).
   - Capture only the inner content (everything between the opening `<script ...>` and its matching `</script>`).
   - Strip a single leading and trailing newline if present, but otherwise preserve content verbatim.
   - Write to `<same-dir>/<same-basename>.md`.
   - Refuse to overwrite an existing `.md` file unless the user has been informed — print the target path before writing, and abort with a clear message if the file already exists (the user can delete it and rerun).

Use this exact command, substituting the user-provided path:

```bash
python3 - "$ARGUMENTS" <<'PY'
import os, re, sys
src = sys.argv[1]
if not os.path.isfile(src):
    print(f"ERROR: file not found: {src}"); sys.exit(1)
with open(src, "r", encoding="utf-8") as f:
    html = f.read()
pattern = re.compile(
    r'<script\b[^>]*\bid=["\']ai-frontmatter["\'][^>]*>(.*?)</script>',
    re.DOTALL | re.IGNORECASE,
)
m = pattern.search(html)
if not m:
    print('ERROR: no <script ... id="ai-frontmatter"> block found'); sys.exit(2)
content = m.group(1)
if content.startswith("\n"): content = content[1:]
if content.endswith("\n"): content = content[:-1]
base, _ = os.path.splitext(src)
dst = base + ".md"
if os.path.exists(dst):
    print(f"ERROR: target already exists, refusing to overwrite: {dst}"); sys.exit(3)
with open(dst, "w", encoding="utf-8") as f:
    f.write(content + "\n")
print(f"OK: wrote {dst} ({len(content)} chars)")
PY
```

3. Report the resulting `.md` file path to the user in one short sentence. If the script exited with an error, surface that error verbatim and stop — do not attempt fallback extraction.
