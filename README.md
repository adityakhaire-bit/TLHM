# Terence Media Hub

An extensible creative asset library foundation built with Next.js, TypeScript, Tailwind CSS, and Supabase. The initial dashboard is database-backed and shows an explicit unavailable state until Supabase is configured.

## Getting started

See [docs/setup.md](./docs/setup.md) for environment variables, database migration, and local development steps. The initial schema is in `supabase/migrations/`.
Provider quotas and current caveats are recorded in [docs/free-tier.md](./docs/free-tier.md), and environment validation status is in [docs/testing.md](./docs/testing.md).

## Status

Implemented: app shell and responsive dashboard, email/password sign-in and sign-out, Supabase session refresh middleware, authenticated folder management UI/API, direct-to-private-R2 multipart upload UI/API with server-side reservations and storage cap, initial PostgreSQL schema for profiles/roles/teams/collections/folders/assets/uploads/approvals/AI jobs/transcripts/activity, RLS policies, unit test cases, and setup/architecture/quota notes.

Not yet implemented or verified: user administration flows, folder grant management UI, media worker, Gemini analysis/chat, global search, approvals review UI, and end-to-end tests. Supabase and R2 connections require credentials and configuration; the upload path has not yet been exercised against the live project.
