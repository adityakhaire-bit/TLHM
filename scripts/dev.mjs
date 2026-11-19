// One-command development startup: web app (Next.js) + media worker, with prefixed output.
//   npm run dev:all
import { spawn } from "node:child_process";

const processes = [
  { name: "web   ", cmd: "npx", args: ["next", "dev"] },
  { name: "worker", cmd: "npx", args: ["tsx", "watch", "--clear-screen=false", "scripts/worker.ts"] },
];

const children = processes.map(({ name, cmd, args }) => {
  const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], env: process.env });
  const prefix = (stream, out) => stream.on("data", (chunk) => {
    for (const line of chunk.toString().split("\n")) if (line.trim()) out.write(`[${name}] ${line}\n`);
  });
  prefix(child.stdout, process.stdout);
  prefix(child.stderr, process.stderr);
  child.on("exit", (code) => {
    console.log(`[${name}] exited with code ${code}; stopping everything.`);
    shutdown();
  });
  return child;
});

let stopping = false;
function shutdown() {
  if (stopping) return;
  stopping = true;
  for (const child of children) if (child.exitCode === null) child.kill("SIGTERM");
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
