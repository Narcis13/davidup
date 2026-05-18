// Shared filesystem-path guard for any surface that accepts a user-supplied
// project directory.
//
// The HTTP controller (POST /api/project, POST /api/projects) and the MCP
// project tools (open_project, create_project) both receive a path that
// eventually flows into `ProjectStore#load` or `scaffoldProject`. The audit
// rationale lives on the original controller copy; this module is the single
// source of truth so the two surfaces can't drift.

import { isAbsolute, normalize, resolve, sep } from 'node:path'

export const SENSITIVE_PREFIXES: ReadonlyArray<string> = [
  '/etc',
  '/proc',
  '/sys',
  '/dev',
  '/root',
  '/private/etc',
  '/private/var/db',
  '/Library/Keychains',
  '/System',
  'C:\\Windows',
  'C:\\Program Files',
  'C:\\Program Files (x86)',
]

export type GuardFailureCode = 'E_BAD_REQUEST' | 'E_FORBIDDEN_PATH'

export type GuardResult =
  | { ok: true; directory: string }
  | { ok: false; code: GuardFailureCode; message: string }

export function guardProjectDirectory(input: unknown): GuardResult {
  if (typeof input !== 'string' || input.length === 0) {
    return { ok: false, code: 'E_BAD_REQUEST', message: 'Body `directory` (string) is required' }
  }
  if (input.length >= 4096) {
    return { ok: false, code: 'E_BAD_REQUEST', message: 'Directory path is too long' }
  }
  if (/[\x00-\x1f]/.test(input)) {
    return {
      ok: false,
      code: 'E_BAD_REQUEST',
      message: 'Directory path contains control characters',
    }
  }
  const normalized = normalize(input)
  const segments = normalized.split(/[\\/]/)
  if (segments.includes('..')) {
    return {
      ok: false,
      code: 'E_FORBIDDEN_PATH',
      message: 'Directory path may not contain `..` segments',
    }
  }
  const directory = resolve(input)
  for (const prefix of SENSITIVE_PREFIXES) {
    if (
      directory === prefix ||
      directory.startsWith(prefix + sep) ||
      directory.startsWith(prefix + '/')
    ) {
      return {
        ok: false,
        code: 'E_FORBIDDEN_PATH',
        message: `Directory path is in a protected system location (${prefix})`,
      }
    }
  }
  if (!isAbsolute(directory)) {
    return {
      ok: false,
      code: 'E_BAD_REQUEST',
      message: 'Directory path did not resolve to an absolute path',
    }
  }
  return { ok: true, directory }
}
