# Development guide

## Requirements

- macOS on Apple Silicon (the Mac mini), Node.js 20+ (tested with 26.13), npm 11
- Homebrew FFmpeg with VideoToolbox: `brew install ffmpeg`
- The Extreme SSD connected (USB-C) with `TMH-Media` initialised
- Firebase project `tlmh-c9120` (Phase 2: Firestore enabled, Email/Password sign-in enabled, service-account key)

Check everything (read-only):

```bash
npm run check:env
```

## First-time setup

```bash
npm install                           # installs all workspaces from the repository root
cp .env.example .env                  # only if .env does not exist yet; then fill in values
scripts/setup/init-storage.sh         # creates TMH-Media folders + marker on the SSD (non-destructive)
```

`frontend/.env` is a link to the root `.env`, so there is one configuration file.

## Running

```bash
npm run dev            # frontend (http://localhost:3000) + backend (http://localhost:4000)
npm run dev:frontend   # Next.js only
npm run dev:backend    # Express only (auto-reload)
curl http://localhost:4000/api/health
```

Phase 1 note: the frontend pages still use the **legacy MySQL API routes** inside `frontend/`, which need a MySQL
password in `DATABASE_URL`. Without it, pages show "database not reachable" states. Phase 2 points the frontend
at the Express backend (`NEXT_PUBLIC_API_BASE_URL=http://localhost:4000`) and Firebase sign-in.

## Checks

```bash
npm run typecheck   # frontend + backend TypeScript
npm run lint        # frontend ESLint (Next.js rules)
npm test            # frontend + backend unit tests (Vitest)
npm run build       # Next.js production build + backend typecheck
```

## Workspaces

| Package | Path | Notes |
| --- | --- | --- |
| `@tmh/shared` | `shared/` | Pure TS (no Node or DOM APIs). Imported as `@tmh/shared/<file>`. |
| `@tmh/frontend` | `frontend/` | Next.js 15 + React 19 + Tailwind 4. `@/*` → `frontend/src/*`. |
| `@tmh/backend` | `backend/` | Express 5 + TS, run with `tsx` (dev: `tsx watch`). |

Add a dependency to one workspace: `npm install <pkg> -w @tmh/backend`.
Install scripts are allow-listed in the root `package.json` (`allowScripts`); review before approving new ones.

## Conventions

- Validate every request body/query with zod; return the shared JSON envelope.
- Never log tokens, passwords, service-account contents or request bodies.
- Never return absolute filesystem paths; use storage keys server-side and signed URLs client-side.
- Never write to the SSD except through the `StorageAdapter`.
- Tests that need storage use a temporary folder with a marker file, never the real SSD.

## Legacy code (to be removed in Phase 2 with approval)

| Path | What it is |
| --- | --- |
| `frontend/src/app/api/**` | Next.js API routes backed by MySQL/Prisma |
| `frontend/src/server/**` | Prisma client, auth (MySQL sessions), uploads, jobs, FFmpeg, backups, stats |
| `frontend/prisma/`, `frontend/prisma.config.ts` | MySQL schema (no migration has been run) |
| `frontend/scripts/` | MySQL worker, create-user, mysqldump backup/restore, dev launcher |
| `frontend/deploy/launchd/` | launchd templates for the legacy web+worker |
| `frontend/src/middleware.ts` | cookie redirect for the legacy session |
| deps `@prisma/client`, `@prisma/adapter-mariadb`, `prisma` | |
| `.env` keys `DATABASE_URL`, `MYSQLDUMP_PATH`, `APP_ORIGIN`, `PORT`, `SESSION_SECRET` | |

The MySQL server and the empty `terence_media_hub` database on the Mac are untouched.
