// RFC 6901 JSON Pointer evaluation.
//
// A pointer is either the empty string (the whole document) or a sequence of
// "/"-prefixed reference tokens. Inside a token, "/" is escaped as "~1" and
// "~" is escaped as "~0". Decoding MUST replace "~1" first, then "~0", or the
// substitution is ambiguous (e.g. the literal "~1" → "~01" must round-trip).

export class JsonPointerError extends Error {
  override readonly name = "JsonPointerError";
}

export function evaluatePointer(root: unknown, pointer: string): unknown {
  if (pointer === "") return root;
  if (!pointer.startsWith("/")) {
    throw new JsonPointerError(
      `JSON pointer must be empty or start with "/": got ${JSON.stringify(pointer)}`,
    );
  }
  const tokens = pointer.slice(1).split("/").map(decodeToken);
  let cur: unknown = root;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;
    if (Array.isArray(cur)) {
      if (!/^(0|[1-9]\d*)$/.test(token)) {
        throw new JsonPointerError(
          `invalid array index ${JSON.stringify(token)} at /${tokens.slice(0, i + 1).map(encodeToken).join("/")}`,
        );
      }
      const idx = Number(token);
      if (idx >= cur.length) {
        throw new JsonPointerError(
          `array index ${idx} out of range (length ${cur.length}) at /${tokens.slice(0, i + 1).map(encodeToken).join("/")}`,
        );
      }
      cur = cur[idx];
    } else if (isPlainObject(cur)) {
      if (!Object.prototype.hasOwnProperty.call(cur, token)) {
        throw new JsonPointerError(
          `key ${JSON.stringify(token)} not found at /${tokens.slice(0, i + 1).map(encodeToken).join("/")}`,
        );
      }
      cur = cur[token];
    } else {
      throw new JsonPointerError(
        `cannot descend into non-container at /${tokens.slice(0, i).map(encodeToken).join("/")}`,
      );
    }
  }
  return cur;
}

function decodeToken(token: string): string {
  return token.replace(/~1/g, "/").replace(/~0/g, "~");
}

function encodeToken(token: string): string {
  return token.replace(/~/g, "~0").replace(/\//g, "~1");
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
