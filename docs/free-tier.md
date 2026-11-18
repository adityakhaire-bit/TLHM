# Free-tier constraints checked 18 November 2026

These published allowances are snapshots, not guarantees. Providers can revise quotas, eligible models, availability, billing rules, and regional access. Check the provider pages again before launch and monitor actual project usage.

| Service | Current published free allowance | Practical limit for this product |
| --- | --- | --- |
| Supabase Free | 500 MB database per project, 1 GB file storage, 5 GB uncached and 5 GB cached egress, 50,000 monthly active users; free projects pause after one week inactive; at most two active projects. | R2 should hold video binaries. The database, egress, inactivity pause, and lack of automatic backups make this a development tier, not a production durability promise. |
| Cloudflare R2 Standard | 10 GB-month storage, 1 million Class A requests/month, 10 million Class B requests/month; egress is free. Infrequent Access is excluded from these free allowances. | A media archive can exceed 10 GB quickly. Usage above the allowance is billed. |
| Gemini Developer API | Free access is limited to selected models with model-specific rate limits. | The free tier's submitted content may be used to improve Google products. Do not send confidential or unreleased company media through free-tier analysis. Prefer a paid tier for production data after reviewing terms and budget. |

The app currently has no usage meters or quota-based pause controls. R2 and Gemini operations are not implemented or activated. Before those features ship, add per-service usage tracking, hard limits or safe pause behavior, and an administrator-visible usage warning. Avoid automatic plan upgrades.

Sources: [Supabase pricing](https://supabase.com/pricing), [Cloudflare R2 pricing](https://developers.cloudflare.com/r2/pricing/), [Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing), [Gemini API billing](https://ai.google.dev/gemini-api/docs/billing).
