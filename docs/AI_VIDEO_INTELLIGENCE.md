# AI Video Intelligence: architecture proposal (for approval)

Status: **PROPOSAL. No code has been written.** Date: 2026-11-19.

Goal: **upload once → analyse automatically → store metadata permanently → search the database anytime.**
Example: an editor searches "Terence talking in a black T-shirt" and gets the exact segments, with timestamps.

---

## 1. What exists today (checked in the repo and on the Mac)

| Area | Today | Reuse? |
|---|---|---|
| Upload | Streams to the SSD. Checks magic bytes and size. SHA-256 duplicate check (409). Refuses if the SSD is missing. Same-volume temp files, no-overwrite moves. | Yes. Batch upload already works one file at a time. Add a batch record and a free-space pre-check for the whole batch. |
| Storage | `/Volumes/Extreme SSD/TMH-Media`: originals, proxies, thumbnails, uploads-temp. Paths are relative and guarded against traversal. | Yes. Add `analysis-temp/`. |
| Database | MySQL 8.4 via Prisma 7. Tables: `media_files`, `tags`, `media_tags`, `folders`, `processing_jobs`, `storage_locations`, `users`, `sessions`, `backups`. | Yes. All new tables are additive. |
| Jobs | DB-backed queue in `processing_jobs` (`probe → thumbnail + proxy`). Atomic claim, 2 attempts, `runAfter` backoff. Interrupted jobs are requeued on worker start. One worker process (`frontend/scripts/worker.ts`). | Yes. Extend it with new job types, checkpoints and per-type concurrency. |
| FFmpeg | 720p H.264 proxy (VideoToolbox) and a thumbnail at 10%. Available filters: `scdet`, `select`, `silencedetect`, `blackdetect`, `freezedetect`. | Yes. Use for shot detection, the analysis proxy and audio extraction. |
| Search | Prisma `LIKE` over title, filename, description and tags, plus category, folder, date and duration filters. Works on whole files, not segments. | Extend to segment-level search. |
| Auth | Firebase email and Google sign-in into server sessions. Roles: admin, editor, viewer. | Unchanged. |
| Hardware | Apple **M6**, 12 cores, **24 GB RAM**. SSD: **443 GB free of 1.8 TB (77% used)**. Internal disk: 62 GB free. | Local AI (Whisper, face embeddings) is realistic on this machine. |
| Python | System Python 3.9 only. No Whisper installed. | A modern Python is needed (installed by `uv`, kept inside the project). |

Not present yet: AI analysis of any kind, segments, transcripts, person profiles, batch tracking, processing logs.

---

## 2. Key findings that shape the design

Gemini facts are from the official docs, read today. Those pages moved to `aistudio.google.com/docs/...`. Prices change soon (see §2.2), so **model names and prices go in `.env` and config, never in code.**

### 2.1 Gemini video understanding
- **Input:** video goes through the **Files API**. Limit: 2 GB per file, 20 GB per project, files auto-deleted after **48 h**, the API itself is free. Inline upload only suits small clips. Formats: mp4, mov, mpeg, avi, webm, wmv, flv, 3gpp.
- **Sampling:** **1 frame per second by default.** Configurable from just above 0 up to 24 fps. Clipping uses `start_offset`/`end_offset`, and **only the clipped interval is billed.**
  - The docs warn that fast action and quick cuts can lose detail at 1 fps.
- **Tokens:** about **70 tokens per frame** at low or medium resolution (280 at high), plus **25 tokens per second of audio** (media-resolution page, Gemini 3 and 4). The older video page says 66/258 and 32. **We will measure real numbers in the benchmark.**
- **Length:** a 1M-token context holds about 3 h of video at low resolution, or 1 h at high.
- **Output:** timestamps in `MM:SS`. Structured JSON output (`response_schema`) is supported.
- **Privacy:** on the **free tier, Google may use your data to improve its products.** On the paid tier, it says "No". **We must use a paid (billing-enabled) key.**
- **Batch API:** half price, but turnaround is up to 24 h. Good for back-catalogue imports, not for same-day batches.
- **Limits:** Tier 1 has a rolling **$10 spend cap per 10 minutes** (429 when exceeded) and a $250 billing cap. These are per project, not per key.

### 2.2 Candidate models and their prices (USD per 1M tokens, paid tier, read today)

| Model | Input | Output | Notes |
|---|---|---|---|
| `gemini-3.5-flash-lite` | 0.30 | 2.50 | Cheapest stable. Good first candidate. |
| `gemini-3.8-flash` | 0.75 (1.50 from Jan 1, 2027) | 3.75 (7.50 from Jan 1, 2027) | Stable mid tier. |
| `gemini-4-hydrogen` | 1.50 | 7.50 | Used in Google's video examples. Supports "agentic" long-video mode. |
| `gemini-4-carbon` | 2.00 (4.00 from Dec 1, 2026) | 10.00 (20.00 from Dec 1, 2026) | Top tier. Probably not needed. |

**Recommendation:** benchmark `gemini-3.5-flash-lite` and `gemini-4-hydrogen` on the same three clips. Pick the cheapest one that gets clothing and actions right. Do not choose from the price sheet alone.

### 2.3 Gemini should not be our face-recognition system
Gemini is a general model. It will not reliably say "this is Terence" across lighting, angles and outfits, and Google's policies limit identifying real people from their faces. Identity must come from a **dedicated face-embedding model running locally on the Mac**:
- Enrol Terence once, with 20–50 reference photos across looks.
- In each video, detect faces about 2 times per second and compute embeddings.
- Match them to the profile and keep confidence scores. **Unknown faces are clustered**, so an admin can name them later (e.g. a co-host).

Then we tell Gemini: "the person on screen 00:12–01:40, position left, is PERSON_TERENCE". Gemini describes; our own system identifies.

**Before we build this:**
- **Consent:** this is biometric data. Get Terence's written consent, and consent for anyone else we enrol (India's DPDP Act).
- **Licences:** some popular face-model weights (e.g. InsightFace's packs) are **non-commercial only**. We will pick a commercially usable model and record its licence.

### 2.4 Speech is cheaper, more accurate and private when done locally
**Whisper** (whisper.cpp or MLX, using the M6's GPU) gives word-level timestamps. It costs nothing per minute, and dialogue never leaves the building. Gemini then gets a **muted** analysis video plus the transcript text. That removes audio tokens and improves the visual answers.

---

## 3. Recommended architecture: hybrid local + Gemini

```
Upload (exists) ─► probe/thumbnail/proxy (exists)
                └► ANALYSIS PIPELINE (new, one job per video, each stage checkpointed)
   1 prepare      FFmpeg: shot list (scdet), silence/black ranges, 16 kHz mono WAV,
                  muted 480p "analysis proxy" (all in analysis-temp/<mediaId>/)
   2 audio        Whisper (local): timestamped transcript (words + sentences), language
   3 faces        Local: decode frames in memory at ~2 fps (piped from FFmpeg, NEVER written to disk)
                  → face detect + embed → match persons → person tracks with time ranges
   4 visual       Gemini: upload analysis proxy (Files API) + shot list + person tracks + transcript
                  → structured JSON per shot/segment: clothing per person, actions, environment,
                    objects, shot type, camera movement, description
   5 validate     zod schema check; map free words to the controlled vocabulary (e.g. "tee" → t-shirt)
                  "unknown" values are logged for review, never silently dropped
   6 index        One DB transaction: segments + detections + transcript; replaces the previous run's rows
   7 cleanup      delete analysis-temp/<mediaId>/ and the Gemini file; original untouched
```

### Why this sampling strategy
- **Every frame to an AI model:** much too expensive, and pointless. Neighbouring frames are nearly identical.
- **Decoding every frame locally:** affordable (VideoToolbox), but only needed for shot detection, which FFmpeg does in one pass.
- **Shot detection + adaptive sampling (chosen):**
  - Every shot boundary becomes a segment edge. Clothing changes, scene changes and angle changes almost always coincide with a cut, so they get caught.
  - Gemini samples **1 fps** by default and **2–4 fps** on shots with high motion (dance), using clipped requests.
- **What 1 fps can still miss:** gestures under about 1 s, a fast spin, a 0.5 s wave. Faces at 2 fps locally cover identity. Short gestures are a known limit, and the benchmark will measure it.
- **The "black T-shirt for 10 s in a 20-min video" case:** at 1 fps that is about 10 frames, and the shot boundary marks its edges. It will be found.

### Storage lifecycle
- **Permanent:**
  - Already stored: original, 720p proxy, thumbnail.
  - New: metadata rows and transcripts in MySQL.
  - Optional: 1 keyframe JPEG per segment (about 30 KB) for result cards. Estimate 300 segments × 30 KB ≈ 9 MB per hour of footage.
- **Temporary** (`TMH-Media/analysis-temp/<mediaId>/`, same SSD):
  - Analysis proxy: about 4–6 MB per minute.
  - WAV: about 2 MB per minute.
  - Peak for a 30-min video: about 250 MB.
  - **No frame images are ever written to disk.**
- **Cleanup rules:**
  - Deletion is allowed **only inside `analysis-temp/`**. It goes through the existing path guard and refuses any path outside that folder.
  - Originals are opened read-only. The checksum is re-verified before and after analysis.
  - On worker start, temp folders left by jobs that no longer exist are removed. Folders of retryable jobs are kept, so a retry can resume.
- **Space checks:** before a batch upload, the browser sends the total size and the server answers "fits / doesn't fit". The existing free-space reserve keeps applying. The analysis temp budget (`ANALYSIS_TEMP_MAX_BYTES`) is checked before each job starts.

---

## 4. Database design (additive Prisma migration; nothing dropped)

`media_files` stays the "videos" table. New tables:

| Table | Purpose / key columns |
|---|---|
| `upload_batches` | id, created_by, file_count, total_bytes, created_at; `media_files.batch_id` (nullable) |
| `analysis_runs` | id, media_id, pipeline_version, visual_model, asr_model, face_model, status, tokens_in/out, cost_usd, started/finished. A re-analysis creates a new run, and search uses the latest completed run. |
| `video_segments` | id, media_id, run_id, start_ms, end_ms, kind (shot/scene), shot_type, camera_movement, camera_angle, environment_term_id, lighting, description (FULLTEXT), keyframe_path |
| `persons` | id, display_name, kind (profile/unknown_cluster), notes, consent_recorded_at |
| `person_face_samples` | id, person_id, embedding (BLOB), source media/time, model_version. Biometric: admin-only access, deletable on request. |
| `person_appearances` | id, media_id, segment_id, person_id, start_ms, end_ms, frame_position, is_speaking, confidence, source, model_version |
| `vocabulary_terms` | id, category (clothing_type, color, pattern, action, environment, object, shot_type, topic…), canonical (e.g. `t-shirt`), parent_id (t-shirt → top) |
| `vocabulary_synonyms` | term_id, phrase (`tee`, `tshirt`, `t shirt`) → also powers the search parser |
| `detections` | **The one generic, extensible table.** id, media_id, segment_id, run_id, person_id?, category, term_id, color_term_id?, pattern_term_id?, body_region (upper/lower/feet/accessory)?, start_ms, end_ms, confidence, source (gemini/face/whisper/ffmpeg/manual), model_version, pipeline_version. Indexes: (category, term_id, person_id), (media_id, start_ms). |
| `transcript_segments` | id, media_id, run_id, start_ms, end_ms, text (FULLTEXT), speaker_label, person_id?, confidence, language |
| `media_topics` | media_id, segment_id?, term_id, confidence |
| `processing_logs` | id, job_id, media_id, level, stage, message, data (JSON), created_at |
| `processing_jobs` (extend) | new job types `analysis`; add `stage`, `checkpoint` (JSON), `last_error_code`, `max_attempts` |

Design rules:
- **Clothing** is a detection row: `category=clothing, term=t-shirt, color=black, body_region=upper, person=Terence, 00:12–01:40`.
- **New metadata categories** need a vocabulary row, not a schema change.
- **Manual corrections** become `source=manual` rows, and they win over AI rows.
- Raw Gemini JSON is kept per run (compressed) for audit and re-parsing only. It is **never** the search source.

---

## 5. Search (database first, AI optional)

1. **Deterministic query parser:** tokenise the query, then match phrases against `persons` names and `vocabulary_synonyms`:
   - "Terence talking in a black T-shirt" → person = Terence, action = talking, clothing = t-shirt + color = black.
   - Words that don't match → transcript and description full-text search.
2. **SQL:** find segments where the person's appearance overlaps the clothing detection, which overlaps the action detection, in time (an interval-overlap join). Rank by match count × confidence. Return the media, start_ms, keyframe, matched attributes and transcript snippet.
3. **Transcript search:** `MATCH … AGAINST` on `transcript_segments` returns the exact sentence and timestamp. "Open at timestamp" seeks the proxy player.
4. **Filters UI:** chips for person, clothing, colour, action, environment and shot type, so editors can refine without typing.
5. **Optional semantic fallback (phase 3):**
   - Embed segment descriptions with a text-embedding model (≈ $0.15 per 1M tokens, negligible). Store vectors as a BLOB and do a cosine scan in Node; that is fine up to ~100k segments.
   - MySQL 8.4 has no vector index. If we outgrow it, add a small vector store later.
   - At most one cheap API call per search to embed the query, and **no re-analysis of videos**.
   - It is used only when the parser finds too little.

---

## 6. Batch processing
- One `analysis` job per video, with its stage checkpoint saved after each step. A retry resumes from the last completed stage, so a finished transcript isn't redone. One failure never blocks the batch.
- **Per-stage concurrency** (configurable in `.env`):
  - FFmpeg prep: 2
  - Whisper: 1 (uses the GPU)
  - Faces: 1
  - Gemini: 3 in flight
- **Gemini error handling:**
  - 429 and 5xx: exponential backoff with jitter (5 s → 10 → 20 … max 10 min).
  - 400: fail with the message.
  - Respect the $10-per-10-minutes Tier 1 cap with a client-side spend governor.
- **Restart safety:** the existing interrupted-job requeue, plus stale Files API uploads re-checked by name.
- **Dashboard:** the batch's totals (queued, processing, done, failed), stage per video, retry buttons, per-video cost. ETA is shown only after we have measured throughput on this Mac (rolling average), never guessed.

---

## 7. Cost estimate (arithmetic from today's prices; to be confirmed by the benchmark)

Muted video at 1 fps, low resolution ≈ 70 tokens per second. Prompt plus shot list plus transcript ≈ 10–20% extra. Output ≈ 3–10k tokens of JSON.

| Video | Video tokens | Flash-Lite (0.30 / 2.50) | Hydrogen (1.50 / 7.50) |
|---|---|---|---|
| 2 min | ~8.4k | ≈ $0.01 | ≈ $0.04 |
| 10 min | ~42k | ≈ $0.03 | ≈ $0.12 |
| 30 min | ~126k | ≈ $0.07 | ≈ $0.30 |

- A batch of 30 ten-minute videos ≈ **$1 (Flash-Lite) to $4 (Hydrogen)**. Whisper and faces are local, so free.
- Higher fps on dance shots raises these numbers proportionally.
- **Timing is not estimated here.** The benchmark measures it.

## 8. Benchmark plan (before any large-scale claims)
- **Clips:** three real Terence clips, 2 min, 10 min and 30 min, including a clothing change and a dance section. I need the user to pick them.
- **Measure:**
  - Upload time.
  - Prep (shots, proxy, WAV).
  - Whisper.
  - Faces.
  - Gemini upload and processing time.
  - Validation and DB insert.
  - Total time.
  - Tokens and cost from the API's usage fields.
  - Peak temp bytes.
- **Accuracy:** hand-label about 20 moments per clip (clothing, action, shot type, who is on screen) and score each model against them. That gives one table that decides the model.

## 9. Alternatives considered
These assessments come from general knowledge and were **not re-verified today**, unlike Gemini. Re-check prices before choosing any of them.

| Option | Strength | Why not primary |
|---|---|---|
| TwelveLabs | Video-native search and embeddings, strong for "find the moment" | Search runs on their platform, which conflicts with "search our own DB". Per-minute indexing cost. Lock-in. Possible later as a semantic layer. |
| Azure AI Video Indexer | Transcripts, OCR, faces, scene and shot detection in one service | Face identification needs Microsoft Limited Access approval. Clothing detail is generic. |
| AWS Rekognition | Mature face collections; strong identity matching | Labels are generic ("Clothing", "Shirt"). Weak on colour and garment detail. Another cloud account and bill. |
| OpenCLIP (local) | Free visual embeddings; "black t-shirt" similarity search | Fuzzy, no structured attributes or timestamps by itself. Good as a phase-3 semantic fallback. |
| Whisper (local) | Accurate, free, private ASR with word timestamps | **Chosen for audio.** |
| FFmpeg / OpenCV | Shots, motion, frames, audio | **Chosen for preparation.** |

## 10. Phases (each one is a separate approval)
1. **Foundation:** migration (tables above), vocabulary seed, analysis job with the prepare and Whisper stages, transcript search, video detail transcript panel, temp lifecycle, batch pre-check. *Useful on its own: spoken-word search with timestamps.*
2. **Visual:** Gemini stage (model from `.env`), validation and normalisation, segments and detections, segment search with the parser and filter chips, the benchmark.
3. **Identity:** Terence profile enrolment (after consent), face matching, unknown-person clusters, person filter.
4. **Polish:** semantic fallback, manual corrections UI, re-analysis on pipeline-version bump, back-catalogue via Batch API.

## 11. Decisions needed from you
1. **Approve this architecture** (hybrid: Whisper + local faces + Gemini; MySQL search). Or change it.
2. **A Gemini API key on a billing-enabled Google Cloud project.** This is required for the data not to be used for training. You put it in `.env` yourself; never paste it in chat.
3. **Terence's consent** for face profiling. Any other people to enrol?
4. **Installing tools on the Mac:** `uv` (manages a project-local Python 3.12), Whisper model weights (~1.5 GB) and face-model weights.
5. **Three benchmark clips** (2, 10, 30 min).
6. **Start with phase 1?**

Note: the pasted brief was cut off in §11 ("Processing speed…"). If later sections (e.g. cost limits, deadlines, export formats) matter, send the rest.
