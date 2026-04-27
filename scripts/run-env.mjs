import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const [, , nodeEnv, commandName, ...args] = process.argv;

if (!nodeEnv || !commandName) {
  console.error("Usage: node scripts/run-env.mjs <NODE_ENV> <command> [...args]");
  process.exit(1);
}

const require = createRequire(import.meta.url);

function resolveBin(name) {
  if (name === "node") return process.execPath;

  try {
    if (name === "tsx") {
      return require.resolve("tsx/dist/cli.mjs");
    }
  } catch {
    // Fall through to PATH lookup so globally installed tools still work.
  }

  return name;
}

const command = resolveBin(commandName);
const childArgs = commandName === "tsx" && command.endsWith(".mjs")
  ? [command, ...args]
  : args;
const childCommand = commandName === "tsx" && command.endsWith(".mjs")
  ? process.execPath
  : command;

const child = spawn(childCommand, childArgs, {
  stdio: "inherit",
  env: {
    ...process.env,
    NODE_ENV: nodeEnv,
  },
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});

child.on("error", (error) => {
  console.error(error);
  process.exit(1);
});
