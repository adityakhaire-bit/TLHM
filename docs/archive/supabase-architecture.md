# Architecture

Terence Media Hub is a Next.js App Router application. Route handlers and server components are the trusted boundary for business logic. Supabase Auth identifies users, PostgreSQL stores logical folders and searchable asset metadata, Cloudflare R2 stores file bytes, and a background worker processes media and Gemini jobs.

## Data flow

1. An authenticated user requests an upload session from a server route.
2. The route checks the profile role and folder grants, then creates a unique R2 object key and a pending asset row.
3. The browser uploads directly to R2 using a short-lived presigned URL; large objects use multipart upload.
4. A completion route verifies object metadata before marking the asset for processing.
5. A worker uses FFprobe/FFmpeg for technical metadata and thumbnails, then optionally submits eligible media to Gemini.
6. Approval rules decide whether an asset is visible as approved. All access remains mediated by database policy and signed object URLs.

## Data model

The initial migration provides profiles and roles, teams, dynamic collections, a self-referencing folder tree, per-user/team folder grants, universal assets, tags, approval requests, AI jobs, transcripts, and activity events. Logical folders never map to physical R2 folders; `object_key` is unique and generated server-side. Folder depth is limited to eight levels, cycles are rejected, and parent deletion is restricted while children exist. Assets use soft deletion.

The migration enables RLS on all tables. It is an initial foundation; production review is still required, especially around role assignment, permission inheritance, audit retention, and background-worker credentials. Do not expose the Supabase service role key in browser code.

## Services and credentials

- Supabase project URL and public anon key: browser-safe project connection; auth and RLS still apply.
- Supabase service role key: server-only administrative tasks, when unavoidable.
- Cloudflare R2 account ID, access key, secret, bucket, S3 endpoint: server-only object operations.
- Gemini API key: server-only AI analysis requests.

No credential is included in source. See [setup.md](./setup.md).
