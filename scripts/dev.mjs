// One-command development startup: frontend (Next.js, :3000) + backend (Express, :4000).
//   npm run dev
import { spawn } from "node:child_process";

const services = [
  { name: "frontend", args: ["run", "dev", "-w", "@tmh/frontend"] },
  { name: "backend ", args: ["run", "dev", "-w", "@tmh/backend"] },
];

let stopping = false;
const children = services.map(({ name, args }) => {
  const child = spawn("npm", args, { stdio: ["ignore", "pipe", "pipe"], env: process.env });
  const forward = (stream, out) => stream.on("data", (chunk) => {
    for (const line of chunk.toString().split("\n")) if (line.trim()) out.write(`[${name}] ${line}\n`);
  });
  forward(child.stdout, process.stdout);
  forward(child.stderr, process.stderr);
  child.on("exit", (code) => {
    if (!stopping) console.log(`[${name}] exited with code ${code}; stopping everything.`);
    shutdown();
  });
  return child;
});

function shutdown() {
  if (stopping) return;
  stopping = true;
  for (const child of children) if (child.exitCode === null) child.kill("SIGTERM");
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
