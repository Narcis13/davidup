#!/usr/bin/env bun
// Entrypoint for the `davidup` CLI installed via `npm install -g davidup`
// or invoked through `npx davidup`. Stays as thin as possible: parse argv,
// dispatch to `runCli`, propagate the exit code.

import { runCli } from "./cli.js";

const deps = {
  io: {
    log: (msg: string) => process.stdout.write(`${msg}\n`),
    error: (msg: string) => process.stderr.write(`${msg}\n`),
  },
  cwd: process.cwd(),
};

runCli(process.argv.slice(2), deps)
  .then((code) => {
    if (code !== 0) process.exit(code);
  })
  .catch((err) => {
    process.stderr.write(
      `davidup: unexpected error — ${err?.stack ?? err}\n`,
    );
    process.exit(1);
  });
