# API contract

Backend: Express on `http://<mac-mini>:4000` (`BACKEND_PORT`). Types: [`shared/src/api-types.ts`](../shared/src/api-types.ts).
Status column: **Live** = implemented and tested in `backend/`; **Phase 2** = designed, not implemented.

## Conventions

- **Envelope:** success `{ "ok": true, "data": … }`; failure `{ "ok": false, "error": { "code", "message", "details?" } }`.
- **Auth:** `Authorization: Bearer <Firebase ID token>` on every endpoint except `/api/health` and signed media URLs.
  401 `unauthenticated` when missing/invalid/expired, 403 `forbidden` when the role is insufficient.
- **IDs** are Firestore document IDs (strings). **Times** are ISO-8601 strings.
- **CORS:** only origins in `FRONTEND_ORIGIN`; credentials allowed. Exposed headers: `Content-Range`, `Content-Length`,
  `Accept-Ranges`, `Content-Disposition`.
- **Pagination:** cursor based (`?limit=24&cursor=<nextCursor>`), because Firestore pages by cursor, not offset.
- **No filesystem paths** are ever returned; media is reached through `urls.*`.
- **Signed media URLs:** `GET /api/media/:id/{preview|thumbnail|download}?exp=<unix>&sig=<hmac>` — HMAC-SHA256 over
  `mediaId|variant|uid|exp` with a server secret, valid ~15 minutes. Needed because `<video>`, `<img>` and download
  links cannot send Authorization headers.

## Endpoints

| Method | Path | Role | Status | Purpose |
| --- | --- | --- | --- | --- |
| GET | `/api/health` | public | **Live** | `{ server, storage: up/down, firestore, time }`; 503 when the SSD is unavailable |
| GET | `/api/storage/status` | viewer | Phase 2 | Drive name, mounted, total/used/free bytes, % used, library byte totals, job counts, last backup (`StorageStatusDto`) |
| POST | `/api/media/upload` | editor | Phase 2 | Streamed upload (body = raw file) |
| GET | `/api/media` | viewer | Phase 2 | Library list with filters (`MediaQuery`) → `MediaPageDto` |
| GET | `/api/media/:mediaId` | viewer | Phase 2 | One `MediaDto` incl. jobs and signed URLs |
| GET | `/api/media/:mediaId/preview` | signed URL | Phase 2 | Stream the proxy (video/audio) or the image, with Range |
| GET | `/api/media/:mediaId/download` | signed URL | Phase 2 | `?variant=original|proxy`; attachment with the original filename, Range supported |
| GET | `/api/media/:mediaId/thumbnail` | signed URL | Phase 2 | JPEG thumbnail, cacheable |
| PATCH | `/api/media/:mediaId` | editor | Phase 2 | Edit `title`, `description`, `category`, `tags`, `folderId` |
| DELETE | `/api/media/:mediaId` | admin | Phase 2 | Soft delete (`deletedAt`); original stays on the SSD |
| GET | `/api/folders` | viewer | Phase 2 | All folders, flat, with `childCount`/`mediaCount` |
| POST | `/api/folders` | editor | Phase 2 | `{ name, parentFolderId?, description? }` |
| PATCH | `/api/folders/:folderId` | editor | Phase 2 | Rename / move / describe (cycle and depth ≤ 8 checks) |
| DELETE | `/api/folders/:folderId` | editor | Phase 2 | Only empty folders; 409 `folder_not_empty` otherwise |
| GET | `/api/search` | viewer | Phase 2 | Same as `GET /api/media` (kept for clarity) |
| GET | `/api/jobs` | viewer | Phase 2 | `?status=&limit=` newest first |
| GET | `/api/jobs/:jobId` | viewer | Phase 2 | One `JobDto` |
| POST | `/api/jobs/:jobId/retry` | editor | Phase 2 | Re-queue a failed job (used by the existing detail modal) |
| GET | `/api/tags` | viewer | Phase 2 | Tags and categories in use (filters, autocomplete) |
| GET | `/api/users` | admin | Phase 2 | List users |
| POST | `/api/users` | admin | Phase 2 | Create user (Firebase Auth + claims + `users` doc) |
| PATCH | `/api/users/:uid` | admin | Phase 2 | Change role / deactivate (revokes sessions) |
| GET | `/api/settings` | viewer | Phase 2 | Upload limits, accepted types |
| GET / POST | `/api/backups` | admin | Phase 2 | Backup history / run a Firestore export to the SSD now |

Validated against the existing frontend: every screen's current calls map onto this list. Additions beyond the
proposed contract (`/api/jobs/:id/retry`, `/api/tags`, `/api/backups`, `PATCH/POST /api/users`) are used by
existing UI elements. The legacy `/api/auth/*` routes disappear (Firebase handles sign-in in the browser).

## Upload: `POST /api/media/upload`

Request: body is the raw file (`Content-Type: application/octet-stream`), streamed; never parsed as multipart in memory.

| Header | Required | Meaning |
| --- | --- | --- |
| `Content-Length` | yes | Exact size; upload rejected if more/less data arrives |
| `X-File-Name` | yes | URI-encoded original filename (metadata only) |
| `X-Folder-Id` | no | Target folder |
| `X-Category` | no | URI-encoded category |
| `X-Tags` | no | URI-encoded, comma-separated |

Flow: auth (editor) → size limit (`MAX_UPLOAD_BYTES`) → SSD available + free space (`STORAGE_RESERVE_BYTES`) →
`StorageAdapter.receiveUpload` (stream to `uploads-temp`, SHA-256, first 4 KB) → content type check →
Firestore transaction on `mediaChecksums/{sha256}` → `saveOriginal` (no overwrite) → `media` doc + `probe` job.

Responses: `201 { status: "created", media }`; `409 { status: "duplicate", media }` (existing item, nothing overwritten);
`200 { status: "restored", media }` (previously soft-deleted). Errors: `411 length_required`, `413 file_too_large`,
`415 unsupported_type`, `503 storage_unavailable`, `507 insufficient_storage`, `400 upload_interrupted`.

## Range streaming

`preview` and `download` honour a single `Range: bytes=start-end` (also `start-` and `-suffix`): `206` with
`Content-Range`, `416` when unsatisfiable, `200` without Range. Files are streamed in 1 MiB chunks from the SSD;
nothing is loaded into memory. Implementation: `shared/src/http-range.ts` + `StorageAdapter.get*`.

## Error codes

`unauthenticated` 401 · `forbidden` 403 · `not_found` 404 · `invalid_json` / `invalid_body` / `invalid_query` 400 ·
`folder_not_empty` / `duplicate` / `file_exists` 409 · `payload_too_large` / `file_too_large` 413 ·
`unsupported_type` 415 · `range_not_satisfiable` 416 · `storage_unavailable` 503 · `insufficient_storage` 507 ·
`internal_error` 500 (details only in server logs).
