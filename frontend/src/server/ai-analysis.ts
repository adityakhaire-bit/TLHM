import { z } from "zod";
import { canonical, clean } from "./ai-vocabulary";
import { prisma } from "./db";
import { getEnv } from "./env";
import { deleteFile, GeminiError, generateJson, uploadFile, type GenerateResult } from "./gemini";
import { mkdir } from "node:fs/promises";
import { makeAnalysisClip } from "./ffmpeg";
import { checkStorage, removeQuietly, resolveStoragePath } from "./storage";

/** Bump when the prompt or the stored structure changes, so old analyses can be found and redone. */
export const PIPELINE_VERSION = 2;

const SHOT_TYPES = ["extreme close-up", "close-up", "medium close-up", "medium shot", "full-body shot", "wide shot", "over-the-shoulder", "aerial", "other"];
const BODY_REGIONS = ["upper", "lower", "full", "feet", "head", "accessory"];

const S = (description?: string) => ({ type: "STRING", ...(description ? { description } : {}) });
const N = (description?: string) => ({ type: "NUMBER", ...(description ? { description } : {}) });
const B = () => ({ type: "BOOLEAN" });
const A = (items: object) => ({ type: "ARRAY", items });
const O = (properties: Record<string, object>, required = Object.keys(properties)) => ({ type: "OBJECT", properties, required });

/** Gemini response schema (OpenAPI subset). Mirrors `analysisSchema` below. */
export const RESPONSE_SCHEMA = O({
  summary: S("2-4 sentence factual summary of the whole video"),
  suggested_title: S("short descriptive title, max 80 characters"),
  language: S("main spoken language, or 'none'"),
  has_speech: B(),
  has_music: B(),
  indoor_outdoor: { type: "STRING", enum: ["indoor", "outdoor", "mixed", "unknown"] },
  setting: S("main location, e.g. dance studio, stage, gym, podcast studio, office, home, street"),
  people_count: { type: "INTEGER" },
  tags: A(S()),
  topics: A(S("topics discussed in speech")),
  people: A(O({ label: S("person_1, person_2... consistent across the video, or a name ONLY if spoken or shown on screen"), description: S("appearance: hair, build, distinguishing features, overall outfit") })),
  segments: A(O({
    start_s: N("segment start in seconds"),
    end_s: N("segment end in seconds"),
    description: S("what is visible and happening, one or two sentences"),
    shot_type: { type: "STRING", enum: SHOT_TYPES },
    camera_movement: S("static, pan, tilt, zoom, handheld, tracking, gimbal"),
    setting: S(),
    people: A(O({
      label: S(),
      position: S("left, centre, right, foreground, background"),
      is_speaking: B(),
      actions: A(S("-ing verb, e.g. talking, dancing, teaching, sitting, smiling, pointing")),
      clothing: A(O({ item: S("e.g. t-shirt, shirt, jacket, jeans, trousers, sneakers, cap, microphone"), color: S("simple colour name"), pattern: S("plain, striped, checked, printed, logo"), body_region: { type: "STRING", enum: BODY_REGIONS } }, ["item", "color", "body_region"])),
    }, ["label", "actions", "clothing"])),
    objects: A(S("notable objects / props / furniture")),
  }, ["start_s", "end_s", "description", "shot_type", "people"])),
  transcript: A(O({ start_s: N(), end_s: N(), speaker: S(), text: S() }, ["start_s", "end_s", "text"])),
});

// Lenient validation: models sometimes omit or mistype optional fields, which must not fail the whole video.
const str = z.preprocess((value) => (value == null ? "" : String(value)), z.string());
const num = z.preprocess((value) => {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parts = value.trim().split(":").map(Number);
    if (parts.every((part) => Number.isFinite(part))) return parts.reduce((total, part) => total * 60 + part, 0);
  }
  return 0;
}, z.number());
const bool = z.preprocess((value) => value === true || value === "true", z.boolean());
const list = <T extends z.ZodTypeAny>(item: T) => z.preprocess((value) => (Array.isArray(value) ? value : []), z.array(item));

export const analysisSchema = z.object({
  summary: str,
  suggested_title: str,
  language: str,
  has_speech: bool,
  has_music: bool,
  indoor_outdoor: str,
  setting: str,
  people_count: z.preprocess((value) => (typeof value === "number" ? Math.round(value) : null), z.number().nullable()),
  tags: list(str),
  topics: list(str),
  people: list(z.object({ label: str, description: str })),
  segments: list(z.object({
    start_s: num,
    end_s: num,
    description: str,
    shot_type: str,
    camera_movement: str,
    setting: str,
    people: list(z.object({
      label: str,
      position: str,
      is_speaking: bool,
      actions: list(str),
      clothing: list(z.object({ item: str, color: str, pattern: str, body_region: str })),
    })),
    objects: list(str),
  })),
  transcript: list(z.object({ start_s: num, end_s: num, speaker: str, text: str })),
});

export type AnalysisJson = z.infer<typeof analysisSchema>;

/** Fewest segments we accept for a video of this length (one per ~20 s, or ~45 s in compact mode). */
export function minimumSegments(durationSeconds: number | null, compact = false) {
  return Math.max(1, Math.floor((durationSeconds ?? 0) / (compact ? 45 : 20)));
}

export function buildPrompt(info: { filename: string; duration: number | null; category: string | null }, compact = false, stricter = false) {
  const seconds = Math.round(info.duration ?? 0);
  const minimum = minimumSegments(info.duration, compact);
  return `You are the cataloguing system of Terence Media Hub, a professional footage library for a dance, fitness and entertainment production team. Editors will later search this metadata to find exact moments, e.g. "person talking in a black t-shirt", "dancing on stage", "close-up smiling".

Analyse the attached video (file "${info.filename}", ${seconds} seconds${info.category ? `, category "${info.category}"` : ""}) and return JSON matching the schema.

Rules:
- Segments must cover the whole video in order, without gaps, from 0 to ${seconds} seconds. Start a new segment at every camera cut, scene change, clothing change, location change or clear change of main action or topic. ${compact ? "Keep segments between 10 and 60 seconds." : "Keep segments between 2 and 20 seconds; split long continuous shots into 10-20 second segments by what happens in them."} Return AT LEAST ${minimum} segments.${stricter ? ` Your previous answer had far too few segments: editors need to find exact moments, so describe the video in at least ${minimum} consecutive time ranges.` : ""}
- Times are numbers of seconds from the start of the video (e.g. 75.5), never later than ${seconds}.
- For every visible person in every segment, list ALL clothing items with simple colour names (black, white, grey, blue, red, green, yellow, orange, pink, purple, brown, beige, gold, silver, multicolour), plus accessories (microphone, cap, glasses, watch, jewellery) and footwear if visible.
- Actions are -ing verbs (talking, dancing, teaching, demonstrating exercise, walking, sitting, standing, smiling, laughing, pointing, gesturing, interacting). Mark is_speaking only when the person's lips move with the speech.
- Label people person_1, person_2... and keep the same label for the same person across all segments. Do NOT identify anyone from their face. Use a real name only if it is spoken in the audio or written on screen, and then also mention it in the person's description.
- Describe only what is visible or audible. If unsure, leave a field empty rather than guessing.
- Transcript: ${compact ? "only the key sentences (max 40 lines)" : "every spoken sentence"}, verbatim in the spoken language, with start/end seconds and the speaker label. Empty list if there is no speech.
- Tags: 5 to 15 short lower-case search keywords (content, mood, setting, style). Topics: subjects discussed in the speech.`;
}

/** Person labels keep their underscores ("person_1"). */
function personLabel(value: string) {
  return value.toLowerCase().replace(/\s+/g, "_").trim().slice(0, 40);
}

function ms(seconds: number, maxMs: number) {
  return Math.max(0, Math.min(Math.round(seconds * 1000), maxMs));
}

/** Turns the model's JSON into normalised rows. Pure function (unit tested). */
export function normalizeAnalysis(json: AnalysisJson, durationSeconds: number | null) {
  const maxMs = durationSeconds ? Math.round(durationSeconds * 1000) : 24 * 3600 * 1000;
  const transcript = json.transcript
    .filter((line) => line.text.trim())
    .map((line) => {
      const startMs = ms(line.start_s, maxMs);
      return { startMs, endMs: Math.max(startMs, ms(line.end_s, maxMs)), speaker: personLabel(line.speaker) || null, text: line.text.trim().slice(0, 5000) };
    })
    .sort((a, b) => a.startMs - b.startMs);

  const segments = json.segments
    .map((segment) => {
      const startMs = ms(segment.start_s, maxMs);
      const endMs = Math.max(startMs + 1, ms(segment.end_s, maxMs));
      const attributes: { category: string; value: string; color: string | null; pattern: string | null; bodyRegion: string | null; personLabel: string | null }[] = [];
      for (const person of segment.people) {
        const label = personLabel(person.label) || null;
        if (label) attributes.push({ category: "person", value: label, color: null, pattern: null, bodyRegion: null, personLabel: label });
        if (person.is_speaking) attributes.push({ category: "action", value: "talking", color: null, pattern: null, bodyRegion: null, personLabel: label });
        for (const action of person.actions) {
          const value = canonical(action);
          if (value) attributes.push({ category: "action", value, color: null, pattern: null, bodyRegion: null, personLabel: label });
        }
        for (const item of person.clothing) {
          const value = canonical(item.item);
          if (!value) continue;
          const pattern = clean(item.pattern, 40);
          attributes.push({
            category: value === "microphone" ? "accessory" : "clothing",
            value,
            color: canonical(item.color, 40) || null,
            pattern: pattern && pattern !== "plain" ? pattern : null,
            bodyRegion: BODY_REGIONS.includes(clean(item.body_region)) ? clean(item.body_region) : null,
            personLabel: label,
          });
        }
      }
      for (const object of segment.objects) {
        const value = canonical(object);
        if (value) attributes.push({ category: "object", value, color: null, pattern: null, bodyRegion: null, personLabel: null });
      }
      const shotType = canonical(segment.shot_type, 40) || null;
      if (shotType && shotType !== "other") attributes.push({ category: "shot", value: shotType, color: null, pattern: null, bodyRegion: null, personLabel: null });
      const setting = canonical(segment.setting || json.setting, 120) || null;
      if (setting) attributes.push({ category: "setting", value: setting, color: null, pattern: null, bodyRegion: null, personLabel: null });

      // De-duplicate identical attributes within the segment.
      const seen = new Set<string>();
      const unique = attributes.filter((attribute) => {
        const key = JSON.stringify(attribute);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      const speech = transcript.filter((line) => line.startMs < endMs && line.endMs >= startMs).map((line) => line.text).join(" ");
      const searchText = [
        segment.description, shotType, clean(segment.camera_movement, 40), setting,
        ...unique.map((attribute) => [attribute.color, attribute.pattern, attribute.value].filter(Boolean).join(" ")),
        speech,
      ].filter(Boolean).join(" | ").toLowerCase().slice(0, 60_000);

      return {
        startMs, endMs,
        description: segment.description.trim().slice(0, 5000) || "(no description)",
        shotType: shotType && shotType !== "other" ? shotType : null,
        cameraMovement: clean(segment.camera_movement, 40) || null,
        setting,
        searchText,
        attributes: unique,
      };
    })
    .sort((a, b) => a.startMs - b.startMs);

  const tags = [...new Set(json.tags.map((tag) => clean(tag, 64)).filter(Boolean))].slice(0, 20);
  const topics = [...new Set(json.topics.map((topic) => clean(topic, 80)).filter(Boolean))].slice(0, 20);
  const people = json.people.map((person) => ({ label: personLabel(person.label), description: person.description.trim().slice(0, 500) })).filter((person) => person.label);
  const searchText = [
    json.summary, json.suggested_title, json.setting, json.indoor_outdoor, ...tags, ...topics,
    ...people.map((person) => person.description),
    ...segments.map((segment) => segment.searchText),
  ].filter(Boolean).join(" | ").toLowerCase().slice(0, 4_000_000);

  return {
    summary: json.summary.trim().slice(0, 5000) || "(no summary)",
    suggestedTitle: json.suggested_title.trim().slice(0, 255) || null,
    language: clean(json.language, 40) || null,
    hasSpeech: json.has_speech || transcript.length > 0,
    hasMusic: json.has_music,
    indoorOutdoor: clean(json.indoor_outdoor, 16) || null,
    setting: canonical(json.setting) || null,
    peopleCount: json.people_count ?? (people.length || null),
    tags, topics, people, segments, transcript, searchText,
  };
}

/** Parses model output; tolerates code fences and a truncated tail is reported as an error. */
export function parseModelJson(text: string): AnalysisJson {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  let data: unknown;
  try {
    data = JSON.parse(trimmed);
  } catch {
    throw new GeminiError("The AI answer was cut off or was not valid JSON", 200, true);
  }
  return analysisSchema.parse(data);
}

/**
 * Full analysis of one video: upload its preview (720p proxy, or the original if there is none) to Gemini,
 * ask for structured metadata, store it, and delete the uploaded copy. The original file is only read.
 */
export async function analyzeMedia(mediaId: string, log: (message: string) => void = console.log) {
  const env = getEnv();
  const media = await prisma.mediaFile.findFirst({ where: { id: mediaId, deletedAt: null } });
  if (!media) throw new GeminiError("Media record no longer exists", 0, false);
  if (media.mediaType !== "video") throw new GeminiError("AI analysis currently supports videos only", 0, false);
  const storage = await checkStorage();
  if (!storage.ok) throw new GeminiError(storage.message, 0, true);

  // Small temporary 360p copy made from the original (read-only), so analysis need not wait for the
  // 720p preview and the upload to Google is ~10x smaller. Deleted as soon as it is uploaded.
  const started = Date.now();
  const tempRelative = `analysis-temp/${media.id}.mp4`;
  const tempPath = resolveStoragePath(tempRelative, storage.root);
  await mkdir(resolveStoragePath("analysis-temp", storage.root), { recursive: true });
  let file;
  try {
    await makeAnalysisClip(resolveStoragePath(media.originalPath, storage.root), tempPath, media.duration, Boolean(media.audioCodec));
    const encoded = Date.now();
    file = await uploadFile(tempPath, "video/mp4", `tmh-${media.id}`);
    log(`analyze ${media.id}: analysis copy made in ${Math.round((encoded - started) / 1000)}s, uploaded in ${Math.round((Date.now() - encoded) / 1000)}s`);
  } finally {
    await removeQuietly(tempPath);
  }
  try {
    const models = [env.GEMINI_MODEL, ...env.GEMINI_FALLBACK_MODELS.split(",").map((model) => model.trim()).filter(Boolean)];
    const info = { filename: media.originalFilename, duration: media.duration, category: media.category };
    let result: GenerateResult | null = null;
    let parsed: AnalysisJson | null = null;
    let lastError: unknown = null;

    // Try models that were overloaded in the last 2 minutes last (saves a wasted request per video).
    const ordered = [...new Set(models)].sort((a, b) => Number(isCoolingDown(a)) - Number(isCoolingDown(b)));
    for (const model of ordered) {
      for (const compact of [false, true]) {
        try {
          result = await generateJson(model, file, buildPrompt(info, compact), RESPONSE_SCHEMA);
          parsed = parseModelJson(result.text);
          // Too coarse to find moments in (e.g. one segment for a 3-minute video): ask once more, more firmly.
          if (parsed.segments.length < minimumSegments(media.duration, compact) / 2) {
            log(`analyze ${media.id}: only ${parsed.segments.length} segment(s), asking for finer segments`);
            const finer = await generateJson(model, file, buildPrompt(info, compact, true), RESPONSE_SCHEMA);
            const finerParsed = parseModelJson(finer.text);
            if (finerParsed.segments.length > parsed.segments.length) {
              finer.inputTokens += result.inputTokens;
              finer.outputTokens += result.outputTokens;
              result = finer;
              parsed = finerParsed;
            }
          }
          break;
        } catch (error) {
          lastError = error;
          const cutOff = error instanceof GeminiError && error.status === 200 && /cut off|MAX_TOKENS/.test(error.message);
          if (!compact && (cutOff || result?.finishReason === "MAX_TOKENS")) { log(`analyze ${media.id}: answer too long, retrying in compact mode`); continue; }
          break;
        }
      }
      if (parsed) break;
      const overloaded = lastError instanceof GeminiError && (lastError.status === 429 || lastError.status >= 500);
      if (!overloaded) break;
      overloadedUntil.set(model, Date.now() + 2 * 60_000);
      log(`analyze ${media.id}: ${model} unavailable (${(lastError as Error).message.slice(0, 80)}), trying next model`);
    }
    if (!parsed || !result) throw lastError instanceof Error ? lastError : new GeminiError("AI analysis failed", 0, true);

    const rows = normalizeAnalysis(parsed, media.duration);
    const elapsedMs = Date.now() - started;
    await prisma.$transaction(async (tx) => {
      await tx.mediaAnalysis.deleteMany({ where: { mediaId: media.id } }); // replaces the previous AI metadata only
      const analysis = await tx.mediaAnalysis.create({
        data: {
          mediaId: media.id, model: result.model, pipelineVersion: PIPELINE_VERSION,
          summary: rows.summary, suggestedTitle: rows.suggestedTitle, setting: rows.setting, indoorOutdoor: rows.indoorOutdoor,
          language: rows.language, hasSpeech: rows.hasSpeech, hasMusic: rows.hasMusic, peopleCount: rows.peopleCount,
          tags: rows.tags, people: rows.people, topics: rows.topics, searchText: rows.searchText,
          inputTokens: result.inputTokens, outputTokens: result.outputTokens, elapsedMs, rawJson: parsed as object,
        },
      });
      for (const segment of rows.segments) {
        await tx.videoSegment.create({
          data: {
            analysisId: analysis.id, mediaId: media.id, startMs: segment.startMs, endMs: segment.endMs,
            description: segment.description, shotType: segment.shotType, cameraMovement: segment.cameraMovement,
            setting: segment.setting, searchText: segment.searchText,
            attributes: {
              create: segment.attributes.map((attribute) => ({
                ...attribute, analysisId: analysis.id, mediaId: media.id, startMs: segment.startMs, endMs: segment.endMs, modelVersion: result.model,
              })),
            },
          },
        });
      }
      if (rows.transcript.length) {
        await tx.transcriptLine.createMany({ data: rows.transcript.map((line) => ({ ...line, analysisId: analysis.id, mediaId: media.id })) });
      }
    }, { timeout: 120_000, maxWait: 30_000 });

    const summary = `${rows.segments.length} segments, ${rows.transcript.length} transcript lines, ${result.inputTokens}+${result.outputTokens} tokens with ${result.model} in ${Math.round(elapsedMs / 1000)}s`;
    log(`analyze ${media.id}: ${summary}`);
    return summary;
  } finally {
    await deleteFile(file.name); // never leave our footage on Google's servers longer than needed
  }
}

const overloadedUntil = new Map<string, number>();
function isCoolingDown(model: string) {
  return (overloadedUntil.get(model) ?? 0) > Date.now();
}

/** Queues AI analysis for a video unless one is already queued or running. */
export async function queueAnalysis(mediaId: string) {
  const existing = await prisma.processingJob.findFirst({ where: { mediaId, jobType: "analyze", status: { in: ["queued", "running"] } } });
  if (existing) return existing;
  await prisma.processingJob.deleteMany({ where: { mediaId, jobType: "analyze", status: { in: ["failed", "completed"] } } });
  return prisma.processingJob.create({ data: { mediaId, jobType: "analyze" } });
}
