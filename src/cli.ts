#!/usr/bin/env bun
import { run } from "./commands";
import { formatUnknownError, isShopiError } from "./errors";

try {
  await run({
    argv: process.argv.slice(2),
    cwd: process.cwd(),
    env: process.env,
    stdout: process.stdout,
    stderr: process.stderr,
    stdin: process.stdin
  });
} catch (error) {
  const exitCode = isShopiError(error) ? error.exitCode : 1;
  process.stderr.write(`shopi: ${formatUnknownError(error)}\n`);
  if (isShopiError(error) && error.details && process.env.SHOPI_DEBUG) {
    process.stderr.write(`${JSON.stringify(error.details, null, 2)}\n`);
  }
  process.exit(exitCode);
}
