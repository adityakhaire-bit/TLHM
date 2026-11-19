/**
 * Create a user or reset a password from the terminal (passwords are typed hidden, never shown or logged).
 *   npm run user:create
 *   npm run user:create -- --username anita --role editor
 * Roles: admin (everything, incl. deleting media and backups), editor (upload, edit, folders), viewer (browse, preview, download).
 */
import "./load-env";
import readline from "node:readline";
import { prisma } from "@/server/db";
import { hashPassword, validatePasswordStrength } from "@/server/passwords";

const ROLES = ["admin", "editor", "viewer"] as const;

function arg(name: string) {
  const index = process.argv.indexOf(`--${name}`);
  return index > -1 ? process.argv[index + 1] : undefined;
}

function ask(question: string, hidden = false): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) {
      const output = rl as unknown as { _writeToOutput: (text: string) => void; output: NodeJS.WriteStream };
      output._writeToOutput = (text: string) => { if (text.includes(question)) output.output.write(text); };
    }
    rl.question(question, (answer) => {
      rl.close();
      if (hidden) process.stdout.write("\n");
      resolve(answer.trim());
    });
  });
}

async function main() {
  const username = (arg("username") ?? (await ask("Username (letters, numbers, . _ -): "))).toLowerCase();
  if (!/^[a-z0-9._-]{2,64}$/.test(username)) throw new Error("Username must be 2-64 characters: letters, numbers, dot, underscore or dash");
  const role = (arg("role") ?? (await ask("Role [admin/editor/viewer] (default editor): "))) || "editor";
  if (!ROLES.includes(role as (typeof ROLES)[number])) throw new Error(`Role must be one of ${ROLES.join(", ")}`);
  const displayName = arg("name") ?? (await ask("Display name (optional): "));

  const password = await ask("Password (hidden, min 10 characters): ", true);
  const problem = validatePasswordStrength(password);
  if (problem) throw new Error(problem);
  if ((await ask("Repeat password: ", true)) !== password) throw new Error("Passwords do not match");

  const passwordHash = await hashPassword(password);
  const existing = await prisma.user.findUnique({ where: { username } });
  if (existing) {
    await prisma.user.update({ where: { username }, data: { passwordHash, role: role as (typeof ROLES)[number], isActive: true, ...(displayName ? { displayName } : {}) } });
    await prisma.session.deleteMany({ where: { userId: existing.id } });
    console.log(`Updated user "${username}" (role ${role}); existing sessions were signed out.`);
  } else {
    await prisma.user.create({ data: { username, role: role as (typeof ROLES)[number], displayName: displayName || username, passwordHash } });
    console.log(`Created user "${username}" with role ${role}.`);
  }
}

main()
  .catch((error) => { console.error(`Error: ${(error as Error).message}`); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
