# SSD storage

## Hardware and filesystem (checked 19 November 2026)

| Item | Value |
| --- | --- |
| Drive | SanDisk Extreme SSD, 2 TB, mounted at `/Volumes/Extreme SSD` |
| Filesystem | **exFAT** (no journal, no Unix permissions) |
| Connection | USB-C, 10 Gb/s link; measured write ≈ 888 MB/s (was 41 MB/s on a USB 2.0 hub) |
| Free space | ≈ 443 GB (the drive also holds ~1.4 TB of existing, unrelated files) |
| TMH root | `/Volumes/Extreme SSD/TMH-Media` (configurable: `MEDIA_STORAGE_ROOT`) |

Existing files on the drive (DCIM, Movies, Terence, …) are **never touched, moved or indexed** by TMH. Importing
existing footage is a separate, opt-in task (see ROADMAP).

## Layout

```
TMH-Media/
├── .tmh-storage          marker file: proves this is the real TMH folder (see "Safety")
├── originals/
│   ├── videos/YYYY/MM/<mediaId>.<ext>
│   ├── audio/YYYY/MM/<mediaId>.<ext>
│   └── images/YYYY/MM/<mediaId>.<ext>
├── proxies/
│   ├── videos/YYYY/MM/<mediaId>.mp4      720p H.264/AAC, faststart
│   └── audio/YYYY/MM/<mediaId>.m4a       AAC 128 kbps
├── thumbnails/YYYY/MM/<mediaId>.jpg      640 px wide
├── uploads-temp/         <uuid>.part during upload; work-* files during FFmpeg runs
├── database-backups/     daily Firestore JSON exports (and legacy MySQL dumps)
├── metadata/             reserved (sidecar exports)
└── logs/                 worker logs (worker-YYYY-MM.log)
```

`YYYY/MM` keeps directories small. Filenames are generated from the media ID; the client's filename is kept only
in Firestore (`originalFileName`) and used for the download name.

## Storage keys

Firestore stores **relative keys** (`originals/videos/2026/11/<mediaId>.mov`), never absolute paths. The backend
resolves a key with `LocalSsdStorageAdapter.resolveKey()`, which rejects absolute paths, `..`, backslashes, NUL bytes
and hidden segments, and verifies the result stays inside the root. Moving the drive or renaming the volume only
requires changing `MEDIA_STORAGE_ROOT`.

## Storage adapter

`backend/src/storage/storage-adapter.ts` defines the provider-independent interface; the MVP implementation is
`LocalSsdStorageAdapter`. Mapping to the operations named in the brief:

| Operation | Method |
| --- | --- |
| verifyStorageAvailability() | `verifyStorageAvailability()` — exists, marker present, writable; never creates the root |
| getStorageStatus() | `getStorageStatus()` — real `statfs` capacity figures |
| saveOriginal() | `receiveUpload()` (stream → temp, size checks, SHA-256, head bytes) then `saveOriginal()` (rename into `originals/`, **no overwrite**) |
| getOriginal() | `getOriginal(key, range?)` — streaming read with byte range |
| saveProxy() / getProxy() | `createWorkFile()` → FFmpeg writes → `saveProxy()`; `getProxy(key, range?)` |
| saveThumbnail() / getThumbnail() | `createWorkFile()` → `saveThumbnail()`; `getThumbnail(key, range?)` |
| deleteMedia() | `deleteMedia(keys, { includeOriginal })` — removes proxy/thumbnail; the original only with an explicit `includeOriginal: true` |
| (housekeeping) | `cleanupTemp(maxAgeMs)` — removes only `*.part` / `work-*` files it created |

A future S3/R2 adapter implements the same interface; `createStorage()` refuses `CLOUD_STORAGE_ENABLED=true` until one exists.

## Safety rules (enforced in code, covered by tests)

1. **No silent fallback.** If `/Volumes/Extreme SSD` is unmounted, macOS would let a program create an empty
   folder with that name on the internal disk. The adapter never creates the root and requires the `.tmh-storage`
   marker before any write, so an unplugged drive produces `503 storage_unavailable`.
2. **Free space reserve.** Uploads are refused (`507`) if they would leave less than `STORAGE_RESERVE_BYTES` free.
3. **Never overwrite originals.** `saveOriginal` refuses if the target exists (`409`). Temp writes use `wx`.
4. **Atomic moves.** Temp files live on the same drive, so moving into `originals/` is a rename, not a copy.
5. **Interrupted uploads** delete their partial file (after the stream has fully closed); abandoned temp files older
   than 24 h are removed by `cleanupTemp`.
6. **Processing never touches originals.** FFmpeg reads the original and writes to a work file; failures leave the original intact.
7. **exFAT `._*` files** (macOS metadata twins) are ignored and cleaned up alongside our temp files.

## Initial setup / new drive

```bash
scripts/setup/init-storage.sh                          # uses MEDIA_STORAGE_ROOT from .env
scripts/setup/init-storage.sh "/Volumes/New SSD/TMH-Media"
```
Creates the folders and marker only; never deletes or moves anything.

## Operational guidance

- Always **Eject** the drive before unplugging; exFAT has no journal and can be corrupted by an unclean unplug.
- Connect it directly to a USB-C/Thunderbolt port (not a USB 2.0 hub). `npm run check:env` warns about 480 Mb/s links.
- A UPS for the Mac mini and SSD is recommended.
- **The SSD is primary storage, not a backup.** Database exports on the same drive protect against database mistakes,
  not drive failure. A second physical drive (or off-site copy) is required for real protection.
- Reformatting to APFS (journaled) would be safer but erases the drive; only with a full copy of the 1.4 TB elsewhere
  and explicit approval.
