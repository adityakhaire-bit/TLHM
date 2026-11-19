# Local setup

## Prerequisites

- Node.js 20 or newer and npm.
- A Supabase project for authentication and PostgreSQL.
- Cloudflare R2 credentials before enabling uploads.
- A Gemini API key before enabling AI analysis.

Review the dated provider quota snapshot and data handling caveats in [free-tier.md](./free-tier.md) before configuring external services.

## Start the app

1. Copy `.env.example` to `.env.local` and fill in the Supabase anon/publishable key from Project Settings → API Keys. The Supabase project URL is already set from the host you provided.
2. Apply `supabase/migrations/202611180001_initial_schema.sql` to the Supabase project using the Supabase SQL editor or Supabase CLI. The app connects through Supabase Auth/PostgREST; the database password is not an app runtime variable. If using direct CLI connection, keep the password in a local-only connection string and percent-encode special characters.
3. In Supabase Auth, provision the first administrator account (public sign-up is intentionally disabled). After the account exists, promote it from the SQL editor: `update public.profiles set role = 'admin' where id = '<auth-user-uuid>';`. Restrict this operation to trusted project administrators.
4. Install dependencies with `npm install`.
5. Start with `npm run dev` and open `http://localhost:3000`.

Without Supabase values, the dashboard intentionally shows unavailable metrics and an integration setup notice. No seeded or fabricated counts are displayed.

## Credentials still needed

Supabase anon/publishable key; R2 account ID, access key ID, secret, and bucket name; Gemini API key for the later AI phase. The Supabase service-role key is not currently used. Keep `.env.local` out of source control. Production secrets belong in the hosting provider's secret manager.

### Cloudflare R2 setup for uploads

1. Create a **private** R2 bucket and an API token restricted to that bucket with object read/write permissions.
2. Add the token's Account ID, Access Key ID, Secret Access Key, bucket name, and S3 endpoint to `.env.local` (`R2_S3_ENDPOINT` can be omitted when using the standard account endpoint).
3. In the bucket's Settings → CORS Policy JSON tab, configure the browser upload origin. For local development, use `http://localhost:3000`; add the exact production app origin and do not use `*`:

   ```json
   [
     {
       "AllowedOrigins": ["http://localhost:3000", "https://YOUR-APP-DOMAIN"],
       "AllowedMethods": ["PUT"],
       "AllowedHeaders": ["Content-Type"],
       "MaxAgeSeconds": 3600
     }
   ]
   ```

   Replace `https://YOUR-APP-DOMAIN` with the real origin before saving.
4. Configure an R2 lifecycle rule to abort incomplete multipart uploads after one day. Database upload reservations expire after 24 hours and are released on the next upload attempt; the lifecycle rule cleans up the corresponding uncompleted R2 parts.
5. The database starts with a 9,000,000,000-byte workspace budget. Admins can adjust `workspace_storage_limits.max_bytes` after reviewing R2 usage and billing. This is a conservative app-side guard, not a live R2 billing meter. Soft-deleted assets continue to count until actual R2 deletion is supported.

## Current integration state

The dashboard reads live counts once the initial schema is deployed. Email/password sign-in, folder management routes, and multipart upload routes/UI are implemented. Uploads require the initial schema migration and R2 credentials/CORS/lifecycle configuration; they have not been exercised against your project. Folder grant management UI, media processing, Gemini, global search, approvals review UI, and deployment automation remain to be implemented. Do not treat any external integration as tested until it has been configured and verified.
