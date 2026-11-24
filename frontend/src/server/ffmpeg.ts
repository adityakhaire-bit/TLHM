import { spawn } from "node:child_process";
import { getEnv } from "./env";

export type ProbeResult = {
  duration: number | null;
  width: number | null;
  height: number | null;
  videoCodec: string | null;
  audioCodec: string | null;
  frameRate: number | null;
  bitRate: number | null;
  rotation: number;
  hasVideo: boolean;
  hasAudio: boolean;
  raw: unknown;
};

type RunOptions = { timeoutMs: number; onProgressSeconds?: (seconds: number) => void };

/** Runs a binary with arguments (never through a shell), with a hard timeout. */
function run(bin: string, args: string[], { timeoutMs, onProgressSeconds }: RunOptions): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${bin.split("/").pop()} timed out after ${Math.round(timeoutMs / 1000)}s`));
    }, timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      if (onProgressSeconds) {
        // `-progress pipe:1` prints key=value lines, including out_time_us.
        const match = text.match(/out_time_us=(\d+)/g);
        if (match) onProgressSeconds(Number(match[match.length - 1].split("=")[1]) / 1_000_000);
      } else if (stdout.length < 5_000_000) stdout += text;
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-8000);
    });
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(lastLines(stderr) || `${bin.split("/").pop()} exited with code ${code}`));
    });
  });
}

const lastLines = (text: string) => text.trim().split("\n").slice(-3).join(" | ").slice(0, 900);

function parseRate(rate: string | undefined): number | null {
  if (!rate || rate === "0/0") return null;
  const [num, den] = rate.split("/").map(Number);
  const value = den ? num / den : num;
  return Number.isFinite(value) && value > 0 ? Math.round(value * 1000) / 1000 : null;
}

type FfprobeStream = {
  codec_type?: string; codec_name?: string; width?: number; height?: number;
  avg_frame_rate?: string; r_frame_rate?: string; disposition?: { attached_pic?: number };
  tags?: { rotate?: string }; side_data_list?: { rotation?: number }[];
};

export async function probe(file: string): Promise<ProbeResult> {
  const { stdout } = await run(getEnv().FFPROBE_PATH, ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", file], { timeoutMs: 120_000 });
  const data = JSON.parse(stdout) as { format?: { duration?: string; bit_rate?: string }; streams?: FfprobeStream[] };
  const streams = data.streams ?? [];
  // Cover art inside audio files is reported as a video stream; ignore it.
  const video = streams.find((s) => s.codec_type === "video" && !s.disposition?.attached_pic);
  const audio = streams.find((s) => s.codec_type === "audio");
  const duration = data.format?.duration ? Number(data.format.duration) : null;
  const rotation = Number(video?.side_data_list?.find((s) => s.rotation !== undefined)?.rotation ?? video?.tags?.rotate ?? 0);
  const rotated = Math.abs(rotation) % 180 === 90;
  return {
    duration: duration && Number.isFinite(duration) ? Math.round(duration * 1000) / 1000 : null,
    width: video ? (rotated ? video.height : video.width) ?? null : null,
    height: video ? (rotated ? video.width : video.height) ?? null : null,
    videoCodec: video?.codec_name ?? null,
    audioCodec: audio?.codec_name ?? null,
    frameRate: video ? parseRate(video.avg_frame_rate) ?? parseRate(video.r_frame_rate) : null,
    bitRate: data.format?.bit_rate ? Number(data.format.bit_rate) : null,
    rotation,
    hasVideo: Boolean(video),
    hasAudio: Boolean(audio),
    raw: { format: data.format, streams: streams.map(({ codec_type, codec_name, width, height, avg_frame_rate }) => ({ codec_type, codec_name, width, height, avg_frame_rate })) },
  };
}

/** Thumbnail: a frame ~10% in (never in the last half-second), 640px wide JPEG, aspect ratio kept. */
export async function makeThumbnail(input: string, output: string, durationSeconds: number | null, isImage: boolean) {
  const args = ["-hide_banner", "-nostdin", "-y"];
  if (!isImage && durationSeconds && durationSeconds > 1) {
    const at = Math.min(durationSeconds * 0.1, Math.max(0, durationSeconds - 0.5));
    args.push("-ss", at.toFixed(3));
  }
  args.push("-i", input, "-frames:v", "1", "-vf", "scale='min(640,iw)':-2:flags=lanczos", "-q:v", "3", "-f", "image2", output);
  await run(getEnv().FFMPEG_PATH, args, { timeoutMs: 120_000 });
}

// Fit inside 1280x720 (landscape) or 720x1280 (portrait); never upscale; even dimensions for H.264.
const SCALE_720 =
  "scale=w='if(gte(iw,ih),min(1280,iw),min(720,iw))':h='if(gte(iw,ih),min(720,ih),min(1280,ih))'" +
  ":force_original_aspect_ratio=decrease:force_divisible_by=2,format=yuv420p";

/**
 * 720p H.264/AAC MP4 proxy with fast-start. Tries Apple VideoToolbox hardware encoding first,
 * then falls back to libx264 (CRF 23) if hardware encoding fails.
 */
export async function makeVideoProxy(input: string, output: string, durationSeconds: number | null, hasAudio: boolean, onProgress: (percent: number) => void) {
  const common = (encoder: string[]) => [
    "-hide_banner", "-nostdin", "-y", "-i", input,
    "-map", "0:v:0", ...(hasAudio ? ["-map", "0:a:0"] : []),
    "-vf", SCALE_720, ...encoder,
    ...(hasAudio ? ["-c:a", "aac", "-b:a", "128k", "-ac", "2"] : ["-an"]),
    "-movflags", "+faststart", "-map_metadata", "-1", "-sn", "-dn",
    "-progress", "pipe:1", "-nostats", "-f", "mp4", output,
  ];
  const timeoutMs = Math.max(15 * 60_000, (durationSeconds ?? 0) * 4000);
  const progress = (seconds: number) => {
    if (durationSeconds) onProgress(Math.min(99, Math.round((seconds / durationSeconds) * 100)));
  };
  try {
    await run(getEnv().FFMPEG_PATH, common(["-c:v", "h264_videotoolbox", "-b:v", "2500k", "-maxrate", "3500k", "-bufsize", "7000k", "-profile:v", "high", "-allow_sw", "1"]), { timeoutMs, onProgressSeconds: progress });
    return "h264_videotoolbox";
  } catch (hardwareError) {
    console.warn(`[ffmpeg] VideoToolbox encode failed, falling back to libx264: ${(hardwareError as Error).message}`);
    await run(getEnv().FFMPEG_PATH, common(["-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-profile:v", "high"]), { timeoutMs: timeoutMs * 2, onProgressSeconds: progress });
    return "libx264";
  }
}

// Fit inside 640x360 (landscape) or 360x640 (portrait) for AI analysis; never upscale.
const SCALE_360 =
  "fps=2,scale=w='if(gte(iw,ih),min(640,iw),min(360,iw))':h='if(gte(iw,ih),min(360,ih),min(640,ih))'" +
  ":force_original_aspect_ratio=decrease:force_divisible_by=2,format=yuv420p";

/**
 * Small temporary copy for AI analysis: 360p, 2 frames per second, mono speech-quality audio.
 * Gemini only looks at about 1 frame per second, so this loses nothing it would use, and is
 * roughly 10x smaller than the 720p preview, so it uploads to Google much faster.
 */
export async function makeAnalysisClip(input: string, output: string, durationSeconds: number | null, hasAudio: boolean) {
  const common = (encoder: string[]) => [
    "-hide_banner", "-nostdin", "-y", "-i", input,
    "-map", "0:v:0", ...(hasAudio ? ["-map", "0:a:0"] : []),
    "-vf", SCALE_360, ...encoder,
    ...(hasAudio ? ["-c:a", "aac", "-b:a", "48k", "-ac", "1", "-ar", "22050"] : ["-an"]),
    "-movflags", "+faststart", "-map_metadata", "-1", "-sn", "-dn", "-f", "mp4", output,
  ];
  const timeoutMs = Math.max(10 * 60_000, (durationSeconds ?? 0) * 2000);
  try {
    await run(getEnv().FFMPEG_PATH, common(["-c:v", "h264_videotoolbox", "-b:v", "350k", "-allow_sw", "1"]), { timeoutMs });
  } catch {
    await run(getEnv().FFMPEG_PATH, common(["-c:v", "libx264", "-preset", "ultrafast", "-crf", "30"]), { timeoutMs: timeoutMs * 2 });
  }
}

/** Audio proxy: AAC 128 kbps stereo in an M4A container with fast-start. */
export async function makeAudioProxy(input: string, output: string, durationSeconds: number | null, onProgress: (percent: number) => void) {
  await run(getEnv().FFMPEG_PATH, [
    "-hide_banner", "-nostdin", "-y", "-i", input, "-vn", "-map", "0:a:0",
    "-c:a", "aac", "-b:a", "128k", "-ac", "2", "-movflags", "+faststart", "-map_metadata", "-1",
    "-progress", "pipe:1", "-nostats", "-f", "mp4", output,
  ], {
    timeoutMs: Math.max(10 * 60_000, (durationSeconds ?? 0) * 2000),
    onProgressSeconds: (seconds) => { if (durationSeconds) onProgress(Math.min(99, Math.round((seconds / durationSeconds) * 100))); },
  });
}
