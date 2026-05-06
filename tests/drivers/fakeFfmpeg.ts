// Fake child_process / Writable surface for the node driver tests.
//
// Captures every byte written to stdin, lets a test trigger backpressure
// (write returns false until a deferred drain), and lets a test choose the
// exit code + stderr emitted on close. Only the methods/events the driver
// actually uses are implemented — anything else throws so accidental coupling
// is caught loudly.

import { EventEmitter } from "node:events";

import type { FfmpegSpawn } from "../../src/drivers/node/index.js";

export interface FakeFfmpegOptions {
  exitCode?: number;
  // Cumulative byte threshold at which write() returns false. Backpressure is
  // released asynchronously so the driver must actually await 'drain'.
  backpressureBytes?: number;
  stderr?: string;
}

export interface FakeSpawnRecord {
  cmd: string;
  args: ReadonlyArray<string>;
  ffmpeg: FakeFfmpeg;
}

export class FakeStdin extends EventEmitter {
  writes: Buffer[] = [];
  ended = false;
  destroyed = false;
  private bytesSinceDrain = 0;
  private readonly backpressureBytes: number | undefined;

  constructor(backpressureBytes: number | undefined) {
    super();
    this.backpressureBytes = backpressureBytes;
  }

  write(chunk: Buffer | Uint8Array): boolean {
    if (this.ended) {
      throw new Error("write after end");
    }
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    this.writes.push(buf);
    this.bytesSinceDrain += buf.length;

    if (
      this.backpressureBytes !== undefined &&
      this.bytesSinceDrain >= this.backpressureBytes
    ) {
      this.bytesSinceDrain = 0;
      // Defer drain so the driver actually has to await it.
      setImmediate(() => this.emit("drain"));
      return false;
    }
    return true;
  }

  end(): void {
    this.ended = true;
    this.emit("finish");
  }

  destroy(err?: Error): void {
    this.destroyed = true;
    if (err) this.emit("error", err);
    this.emit("close");
  }
}

class FakeStderr extends EventEmitter {
  // Real ChildProcess.stderr is a Readable, which has setEncoding. Provide
  // a no-op stub so the driver can call it unconditionally.
  setEncoding(_enc: string): this {
    return this;
  }
}

export class FakeFfmpeg extends EventEmitter {
  readonly stdin: FakeStdin;
  readonly stderr: FakeStderr;
  killed = false;
  exitCode: number | null = null;

  constructor(opts: FakeFfmpegOptions) {
    super();
    this.stdin = new FakeStdin(opts.backpressureBytes);
    this.stderr = new FakeStderr();

    this.stdin.on("finish", () => {
      // Match real ffmpeg's order: stderr text first, then close with code.
      setImmediate(() => {
        if (opts.stderr) this.stderr.emit("data", opts.stderr);
        this.exitCode = opts.exitCode ?? 0;
        this.emit("close", this.exitCode, null);
      });
    });
  }

  kill(signal?: string): boolean {
    if (this.exitCode !== null) return false;
    this.killed = true;
    this.exitCode = -1;
    setImmediate(() => this.emit("close", null, signal ?? "SIGKILL"));
    return true;
  }
}

export interface FakeSpawnHarness {
  spawn: FfmpegSpawn;
  calls: FakeSpawnRecord[];
}

export function makeFakeSpawn(
  opts: FakeFfmpegOptions = {},
): FakeSpawnHarness {
  const calls: FakeSpawnRecord[] = [];
  const spawn: FfmpegSpawn = (cmd, args) => {
    const ffmpeg = new FakeFfmpeg(opts);
    calls.push({ cmd, args, ffmpeg });
    return ffmpeg as unknown as ReturnType<FfmpegSpawn>;
  };
  return { spawn, calls };
}
