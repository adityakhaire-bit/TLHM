import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { getEnv } from "./env";

/**
 * Minimal Google Gemini REST client (no SDK): Files API upload + structured generateContent.
 * The API key is sent in a header, never in URLs or logs.
 */
const BASE = "https://generativelanguage.googleapis.com";

/** Errors worth retrying later (overload, rate limit, network). */
export class GeminiError extends Error {
  constructor(message: string, readonly status: number, readonly retryable: boolean) {
    super(message);
  }
}

function apiKey() {
  const key = getEnv().GEMINI_API_KEY.replace(/^"|"$/g, "");
  if (!key) throw new GeminiError("AI analysis is switched off: GEMINI_API_KEY is empty in .env", 0, false);
  return key;
}

export function geminiConfigured() {
  return Boolean(getEnv().GEMINI_API_KEY);
}

async function request(url: string, init: RequestInit & { duplex?: "half" } = {}, timeoutMs = 120_000): Promise<Response> {
  try {
    return await fetch(url, { ...init, headers: { "x-goog-api-key": apiKey(), ...init.headers }, signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    if (error instanceof GeminiError) throw error;
    throw new GeminiError(`Could not reach Google Gemini (${(error as Error).message})`, 0, true);
  }
}

async function failure(response: Response, what: string): Promise<GeminiError> {
  const body = (await response.json().catch(() => ({}))) as { error?: { message?: string } };
  const message = body.error?.message?.slice(0, 300) ?? response.statusText;
  const retryable = response.status === 429 || response.status >= 500;
  return new GeminiError(`${what} failed (${response.status}): ${message}`, response.status, retryable);
}

export type GeminiFile = { name: string; uri: string; mimeType: string; state: string };

/** Uploads a local file to the Gemini Files API (streamed; files auto-expire after 48 h) and waits until it is ready. */
export async function uploadFile(file: string, mimeType: string, displayName: string): Promise<GeminiFile> {
  const size = (await stat(file)).size;
  const start = await request(`${BASE}/upload/v1beta/files`, {
    method: "POST",
    headers: {
      "X-Goog-Upload-Protocol": "resumable",
      "X-Goog-Upload-Command": "start",
      "X-Goog-Upload-Header-Content-Length": String(size),
      "X-Goog-Upload-Header-Content-Type": mimeType,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ file: { display_name: displayName.slice(0, 120) } }),
  });
  if (!start.ok) throw await failure(start, "Upload to Gemini");
  const uploadUrl = start.headers.get("x-goog-upload-url");
  if (!uploadUrl) throw new GeminiError("Gemini did not return an upload address", start.status, true);

  const body = Readable.toWeb(createReadStream(file)) as ReadableStream;
  const done = await request(uploadUrl, {
    method: "POST",
    headers: { "Content-Length": String(size), "X-Goog-Upload-Offset": "0", "X-Goog-Upload-Command": "upload, finalize" },
    body,
    duplex: "half",
  }, 30 * 60_000);
  if (!done.ok) throw await failure(done, "Upload to Gemini");
  let info = ((await done.json()) as { file: GeminiFile }).file;

  const deadline = Date.now() + 10 * 60_000;
  while (info.state === "PROCESSING") {
    if (Date.now() > deadline) throw new GeminiError("Gemini took too long to prepare the video", 0, true);
    await new Promise((resolve) => setTimeout(resolve, 3000));
    const check = await request(`${BASE}/v1beta/${info.name}`);
    if (!check.ok) throw await failure(check, "Checking the Gemini upload");
    info = (await check.json()) as GeminiFile;
  }
  if (info.state !== "ACTIVE") throw new GeminiError(`Gemini could not read the video (state ${info.state})`, 0, false);
  return info;
}

/** Deletes an uploaded file from Gemini. Never throws (files expire after 48 h anyway). */
export async function deleteFile(name: string) {
  await request(`${BASE}/v1beta/${name}`, { method: "DELETE" }, 30_000).catch(() => null);
}

export type GenerateResult = { text: string; model: string; inputTokens: number; outputTokens: number; finishReason: string };

/** Asks a model about an uploaded video and returns its JSON text. Uses a response schema when the model accepts one. */
export async function generateJson(model: string, file: GeminiFile, prompt: string, schema: object, maxOutputTokens = 32_768): Promise<GenerateResult> {
  const call = (withSchema: boolean) => request(`${BASE}/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ fileData: { fileUri: file.uri, mimeType: file.mimeType } }, { text: prompt }] }],
      generationConfig: { responseMimeType: "application/json", ...(withSchema ? { responseSchema: schema } : {}), temperature: 0.2, maxOutputTokens },
    }),
  }, 15 * 60_000);

  let response = await call(true);
  if (response.status === 400) {
    const error = await failure(response, "Gemini analysis");
    if (!/schema/i.test(error.message)) throw error;
    response = await call(false); // older/other models: plain JSON mode, validated by us afterwards
  }
  if (!response.ok) throw await failure(response, "Gemini analysis");

  const data = (await response.json()) as {
    candidates?: { finishReason?: string; content?: { parts?: { text?: string; thought?: boolean }[] } }[];
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
    promptFeedback?: { blockReason?: string };
  };
  if (data.promptFeedback?.blockReason) throw new GeminiError(`Gemini refused this video (${data.promptFeedback.blockReason})`, 200, false);
  const candidate = data.candidates?.[0];
  const text = (candidate?.content?.parts ?? []).filter((part) => !part.thought).map((part) => part.text ?? "").join("");
  const finishReason = candidate?.finishReason ?? "UNKNOWN";
  if (!text) throw new GeminiError(`Gemini returned no result (${finishReason})`, 200, finishReason !== "SAFETY");
  return {
    text,
    model,
    finishReason,
    inputTokens: data.usageMetadata?.promptTokenCount ?? 0,
    outputTokens: (data.usageMetadata?.candidatesTokenCount ?? 0) + (data.usageMetadata?.thoughtsTokenCount ?? 0),
  };
}
