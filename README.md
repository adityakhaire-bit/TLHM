# Terence Media Hub

Internal media asset management for a creative studio: upload raw footage, audio and images; organise them in
folders with tags; search; preview lightweight proxies; download originals. Runs on the office **Mac mini** with
media on an external **Extreme SSD**, and uses **Firebase** (Authentication + Firestore) for users and metadata.

> **Status: Phase 1 (restructuring + architecture) complete.** The frontend UI is complete; the Express backend has
> its foundation (config, health check, SSD storage adapter, tests). The Firebase-backed API is Phase 2 —
> see [docs/ROADMAP.md](docs/ROADMAP.md).

## Repository

| Path | Contents |
| --- | --- |
| [`frontend/`](frontend) | Next.js 15 app: dashboard, library, upload centre, folders, storage page, login |
| [`backend/`](backend) | Express + TypeScript API: storage adapter, health check (Phase 2: Firebase, uploads, FFmpeg worker) |
| [`shared/`](shared) | Types and pure helpers used by both |
| [`firebase/`](firebase) | Firestore security rules and indexes (not deployed yet) |
| [`scripts/`](scripts) | `dev.mjs`, `setup/init-storage.sh`, `diagnostics/check-environment.sh` |
| [`docs/`](docs) | [Architecture](docs/ARCHITECTURE.md) · [API](docs/API.md) · [Firebase](docs/FIREBASE.md) · [Storage](docs/STORAGE.md) · [Development](docs/DEVELOPMENT.md) · [Roadmap](docs/ROADMAP.md) |

## Quick start on the Mac mini

```bash
npm run check:env        # read-only check: Node, FFmpeg, SSD, ports, Firebase config
npm install
cp .env.example .env     # first time only, then edit values (never commit .env)
scripts/setup/init-storage.sh
npm run dev              # frontend http://localhost:3000, backend http://localhost:4000
```

Verify the backend: `curl http://localhost:4000/api/health`.

## Access from other computers (Tailscale)

The app is published inside the team's private Tailscale network with a real HTTPS certificate:
`tailscale serve --bg 3000` on the Mac mini (persists across restarts; `tailscale serve --https=443 off` to stop).
Team members install Tailscale, join the tailnet, and open `https://<mac-name>.<tailnet>.ts.net`.
HTTPS is required for Google sign-in; add that host name in Firebase → Authentication → Settings → Authorized domains.
Plain `http://<mac-ip>:3000` on the office network works for username/password sign-in only.

## Checks

```bash
npm run typecheck && npm run lint && npm test && npm run build
```

## Important rules

- Media files live only on the SSD under `MEDIA_STORAGE_ROOT`; never in Firebase, never in git.
- If the SSD is disconnected, uploads stop with a clear error. The app never falls back to the internal disk.
- Originals are never overwritten, re-encoded or deleted by processing.
- `.env`, Firebase service-account keys and private keys are never committed.
- The SSD is primary storage, not a backup. Keep a second copy on another drive.
