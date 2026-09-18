// "Reveal" / "Play" a render file with the platform's own file manager and
// default player (v1.1 S29 — was macOS-only).
//
//   macOS    reveal → `open -R <file>` (Finder, file selected)
//            play   → `open -a "QuickTime Player" <file>`
//   Windows  reveal → `explorer /select,<file>` (Explorer, file selected)
//            play   → `explorer <file>` (default app for the extension)
//   Linux &  reveal → `xdg-open <dir>` (there is no portable "select this
//   others            file", so the containing folder opens)
//            play   → `xdg-open <file>`
//
// Pure: returns the argv to spawn so the mapping is unit-testable without
// actually launching anything.

import { dirname } from 'node:path'

export type ShellAction = 'reveal' | 'play'

export interface ShellCommand {
  command: string
  args: string[]
}

export function shellCommandFor(
  platform: NodeJS.Platform,
  action: ShellAction,
  target: string
): ShellCommand {
  if (platform === 'darwin') {
    return action === 'reveal'
      ? { command: 'open', args: ['-R', target] }
      : { command: 'open', args: ['-a', 'QuickTime Player', target] }
  }
  if (platform === 'win32') {
    // explorer takes `/select,<path>` as ONE argument.
    return action === 'reveal'
      ? { command: 'explorer', args: [`/select,${target}`] }
      : { command: 'explorer', args: [target] }
  }
  return action === 'reveal'
    ? { command: 'xdg-open', args: [dirname(target)] }
    : { command: 'xdg-open', args: [target] }
}
