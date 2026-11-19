# Roadmap

## Phase 1 — Restructuring and architecture ✅ (19 November 2026)

- Repository audit; Next.js app moved to `frontend/` with history preserved; npm workspaces.
- `shared/` package: API contract types, content-based file type detection, HTTP Range helpers.
- `backend/` Express + TypeScript foundation: validated config, CORS allow-list, security headers, error envelope,
  `GET /api/health`, provider-independent `StorageAdapter` + tested `LocalSsdStorageAdapter`.
- Firestore data model, security rules and indexes (not deployed); Firebase web config in `.env`.
- Setup and diagnostics scripts; documentation set.

## Phase 2 — Firebase backend MVP (precise plan)

Prerequisites from the team (blocking):

1. Firebase Console → **Firestore Database → Create database** (production mode, region `asia-south1` (Mumbai) recommended).
2. **Authentication → Sign-in method → Email/Password → Enable.**
3. **Project settings → Service accounts → Generate new private key**; save it as
   `~/.config/terence-media-hub/firebase-service-account.json` and run `chmod 600` on it. Do not put it in the project folder.
4. Approval to remove the legacy MySQL code listed in [DEVELOPMENT.md](DEVELOPMENT.md#legacy-code-to-be-removed-in-phase-2-with-approval).

Implementation order (each step: build, lint, tests, short report):

| # | Step | Done when |
| --- | --- | --- |
| 1 | `firebase-admin` + `config/firebase.ts`; `middleware/auth.ts` (verifyIdToken with revocation, role from custom claims), `require-role.ts`; Firestore ping in `/api/health` | Health shows `firestore: up`; unauthenticated calls get 401 |
| 2 | Admin bootstrap script (create first admin, set claims) and `/api/users` (list, create, change role, deactivate) | First admin can sign in |
| 3 | Frontend: Firebase JS SDK sign-in (login page), ID token in `api()`, `NEXT_PUBLIC_API_BASE_URL` → backend | Existing pages load through the backend |
| 4 | Repositories (`media`, `folders`, `tags`, `jobs`, `activity`, `backups`) with Timestamp converters | Repository tests against the Firestore Emulator |
| 5 | `POST /api/media/upload` (streaming, content check, checksum transaction, original save, probe job) | Upload of a test clip lands on the SSD + Firestore |
| 6 | Worker in `backend/src/jobs` (port FFmpeg code; Firestore job claiming; progress; retries; temp cleanup) | Probe, thumbnail, 720p proxy generated |
| 7 | `GET /api/media` + `/api/search` (tokens, filters, cursor pagination), `GET/PATCH/DELETE /api/media/:id` | Library and detail modal work |
| 8 | Signed URLs; preview/thumbnail/download streaming with Range | Seeking and both downloads work |
| 9 | Folders API (create, rename, move, delete-empty) | Folders page works |
| 10 | `/api/storage/status`, `/api/jobs`, `/api/tags`, `/api/settings` | Dashboard and storage page show real data |
| 11 | Daily Firestore JSON export to `database-backups/` + restore script + `/api/backups` | Backup appears on the SSD |
| 12 | Deploy rules/indexes (`firebase deploy --only firestore`), emulator rule tests | Rules tests pass |
| 13 | Remove legacy MySQL code (after approval); launchd services for backend + worker + frontend | Clean `git status`, services restart on reboot |
| 14 | End-to-end test with a small synthetic clip: upload → SSD → Firestore → proxy/thumbnail → search → preview/seek → downloads → duplicate → failed-proxy safety → SSD-missing error | All pass; written report |

## Later

- Import existing footage already on the SSD (index in place, opt-in per folder; no moving).
- Collections (cross-folder sets) and sharing within the team.
- Activity log viewer; per-user download history.
- Self-hosted Typesense for substring/fuzzy search if token search is not enough.
- AI modules: transcripts (Whisper, local), scene descriptions, auto-tags, semantic search.
- Second backup drive automation (rsync of `originals/` + nightly exports).
- Optional S3/R2 adapter for off-site proxies.
