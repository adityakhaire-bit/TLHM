"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { LoaderCircle, Mic, RotateCcw, Sparkles } from "lucide-react";
import { api, errorMessage } from "@/lib/client";

type Attribute = { category: string; value: string; color: string | null; pattern: string | null; bodyRegion: string | null; personLabel: string | null };
type Segment = { id: number; startMs: number; endMs: number; description: string; shotType: string | null; cameraMovement: string | null; setting: string | null; attributes: Attribute[] };
type Line = { startMs: number; endMs: number; speaker: string | null; text: string };
type Analysis = {
  model: string; createdAt: string; summary: string; suggestedTitle: string | null; setting: string | null; indoorOutdoor: string | null;
  language: string | null; hasSpeech: boolean; hasMusic: boolean; peopleCount: number | null; tags: string[]; topics: string[];
  speechType: string | null; speechSummary: string | null; spokenTopics: string[] | null;
  people: { label: string; description: string }[]; inputTokens: number; outputTokens: number; elapsedMs: number;
  segments: Segment[]; transcript: Line[];
};
type State = {
  configured: boolean; supported: boolean;
  job: { id: number; status: "queued" | "running" | "completed" | "failed"; attempts: number; errorMessage: string | null; runAfter: string } | null;
  analysis: Analysis | null;
};

export function timecode(ms: number) {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
  return `${h ? `${h}:` : ""}${h ? String(m).padStart(2, "0") : m}:${String(s).padStart(2, "0")}`;
}

function label(attribute: Attribute) {
  return [attribute.color, attribute.pattern, attribute.value].filter(Boolean).join(" ");
}

const CHIP: Record<string, string> = {
  clothing: "bg-violet-50 text-violet-800",
  accessory: "bg-violet-50 text-violet-800",
  action: "bg-amber-50 text-amber-800",
  shot: "bg-sky-50 text-sky-800",
  setting: "bg-emerald-50 text-emerald-800",
  topic: "bg-rose-50 text-rose-800",
  object: "bg-slate-100 text-slate-700",
  person: "bg-slate-100 text-slate-700",
};

/** AI-generated metadata for a video: summary, people, clothing, actions, timestamped segments and transcript. */
export function MediaAiPanel({ mediaId, canEdit, onSeek }: { mediaId: string; canEdit: boolean; onSeek: (ms: number) => void }) {
  const [state, setState] = useState<State | null>(null);
  const [tab, setTab] = useState<"segments" | "transcript">("segments");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try { setState(await api<State>(`/api/media/${mediaId}/analysis`)); setError(""); }
    catch (cause) { setError(errorMessage(cause, "Could not load AI metadata")); }
  }, [mediaId]);

  useEffect(() => { void load(); }, [load]);

  const active = state?.job?.status === "queued" || state?.job?.status === "running";
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => { if (!document.hidden) void load(); }, 4000);
    return () => clearInterval(timer);
  }, [active, load]);

  async function analyse() {
    setBusy(true); setError("");
    try { setState(await api<State>(`/api/media/${mediaId}/analysis`, { method: "POST" })); }
    catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(false); }
  }

  const analysis = state?.analysis ?? null;
  const wardrobe = useMemo(() => {
    const byPerson = new Map<string, Set<string>>();
    for (const segment of analysis?.segments ?? []) {
      for (const attribute of segment.attributes) {
        if (attribute.category !== "clothing" && attribute.category !== "accessory") continue;
        const person = attribute.personLabel ?? "unknown";
        if (!byPerson.has(person)) byPerson.set(person, new Set());
        byPerson.get(person)!.add(label(attribute));
      }
    }
    return [...byPerson.entries()].map(([person, items]) => ({ person, items: [...items] }));
  }, [analysis]);
  const actions = useMemo(() => [...new Set((analysis?.segments ?? []).flatMap((segment) => segment.attributes.filter((a) => a.category === "action").map((a) => a.value)))], [analysis]);

  if (!state) {
    return <section className="border-t border-slate-100 p-5 text-xs text-slate-500">{error || <span className="inline-flex items-center gap-2"><LoaderCircle size={14} className="animate-spin" />Loading AI metadata…</span>}</section>;
  }
  if (!state.supported) return null;

  const status = state.job?.status;
  const waitingRetry = status === "queued" && state.job?.errorMessage;

  return (
    <section className="border-t border-slate-100 p-5" aria-label="AI metadata">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="inline-flex items-center gap-2 text-sm font-semibold"><Sparkles size={16} className="text-violet-600" />AI metadata</h3>
        <div className="flex items-center gap-3 text-xs">
          {active && <span className="inline-flex items-center gap-1.5 text-blue-700"><LoaderCircle size={13} className="animate-spin" />{status === "running" ? "Analysing with Gemini… (usually 1–3 min)" : waitingRetry ? "Waiting to retry (Google busy)…" : "Queued for analysis…"}</span>}
          {analysis && !active && <span className="text-slate-400">{analysis.model} · {new Date(analysis.createdAt).toLocaleString()}</span>}
          {canEdit && state.configured && !active && (
            <button type="button" disabled={busy} onClick={() => void analyse()} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 font-medium text-slate-700 hover:border-slate-300 disabled:opacity-50">
              {analysis ? <><RotateCcw size={12} />Re-analyse</> : <><Sparkles size={12} />Analyse with AI</>}
            </button>
          )}
        </div>
      </div>

      {!state.configured && <p className="mt-3 text-xs text-slate-500">AI analysis is switched off on this server (no Gemini API key).</p>}
      {status === "failed" && <p role="alert" className="mt-3 rounded-lg border border-red-100 bg-red-50 p-3 text-xs text-red-800">AI analysis failed: {state.job?.errorMessage ?? "unknown error"}. The video itself is fine.</p>}
      {waitingRetry && <p className="mt-3 text-xs text-amber-700">Last attempt: {state.job?.errorMessage}</p>}
      {error && <p role="alert" className="mt-3 text-xs text-red-700">{error}</p>}
      {!analysis && !active && status !== "failed" && state.configured && <p className="mt-3 text-xs text-slate-500">Not analysed yet.{canEdit ? " Click “Analyse with AI” to generate descriptions, clothing, actions, shot types and a transcript." : ""}</p>}

      {analysis && (
        <div className="mt-4 space-y-4">
          <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
            <div className="space-y-3">
              <p className="text-sm leading-6 text-slate-800">{analysis.summary}</p>
              {analysis.speechType && analysis.speechType !== "no speech" && (
                <div className="rounded-lg border border-rose-100 bg-rose-50/50 p-3 text-xs">
                  <p className="inline-flex items-center gap-1.5 font-semibold text-rose-900"><Mic size={13} />Speaking · <span className="capitalize">{analysis.speechType}</span>{analysis.language ? <span className="font-normal text-rose-700">({analysis.language})</span> : null}</p>
                  {analysis.speechSummary && <p className="mt-1 leading-5 text-slate-800">{analysis.speechSummary}</p>}
                  {(analysis.spokenTopics ?? []).length > 0 && (
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <span className="text-slate-500">Talks about:</span>
                      {(analysis.spokenTopics ?? []).map((topic) => (
                        <Link key={topic} href={`/library?attr=${encodeURIComponent(`spoken|${topic}|`)}`} className={`rounded-md px-2 py-0.5 text-[11px] hover:underline ${CHIP.topic}`} title="Find other clips that talk about this">{topic}</Link>
                      ))}
                    </div>
                  )}
                </div>
              )}
              <div className="flex flex-wrap gap-1.5">
                {analysis.tags.map((tag) => <span key={tag} className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-700">#{tag}</span>)}
              </div>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-4">
                <Info label="Setting" value={[analysis.setting, analysis.indoorOutdoor].filter(Boolean).join(" · ") || "—"} />
                <Info label="People" value={analysis.peopleCount != null ? String(analysis.peopleCount) : "—"} />
                <Info label="Speech" value={analysis.hasSpeech ? analysis.language || "yes" : "none"} />
                <Info label="Music" value={analysis.hasMusic ? "yes" : "no"} />
              </dl>
              {analysis.topics.length > 0 && <p className="text-xs text-slate-600"><b className="font-medium text-slate-800">Topics:</b> {analysis.topics.join(", ")}</p>}
              {actions.length > 0 && (
                <div className="flex flex-wrap gap-1.5">{actions.map((action) => <span key={action} className={`rounded-md px-2 py-0.5 text-[11px] ${CHIP.action}`}>{action}</span>)}</div>
              )}
            </div>
            <div className="space-y-2 text-xs">
              {analysis.people.map((person) => {
                const clothes = wardrobe.find((entry) => entry.person === person.label)?.items ?? [];
                return (
                  <div key={person.label} className="rounded-lg border border-slate-100 p-2.5">
                    <p className="font-medium text-slate-800">{person.label}</p>
                    <p className="mt-0.5 text-slate-600">{person.description}</p>
                    {clothes.length > 0 && <div className="mt-1.5 flex flex-wrap gap-1">{clothes.map((item) => <span key={item} className={`rounded-md px-1.5 py-0.5 text-[11px] ${CHIP.clothing}`}>{item}</span>)}</div>}
                  </div>
                );
              })}
            </div>
          </div>

          <div>
            <div className="flex gap-1 border-b border-slate-100 text-xs">
              {(["segments", "transcript"] as const).map((key) => (
                <button key={key} type="button" onClick={() => setTab(key)} className={`-mb-px border-b-2 px-3 py-2 font-medium capitalize ${tab === key ? "border-[#182230] text-slate-900" : "border-transparent text-slate-500"}`}>
                  {key} ({key === "segments" ? analysis.segments.length : analysis.transcript.length})
                </button>
              ))}
            </div>
            <div className="max-h-[420px] overflow-y-auto">
              {tab === "segments" ? analysis.segments.map((segment) => (
                <div key={segment.id} className="flex gap-3 border-b border-slate-50 py-2.5 text-xs">
                  <button type="button" onClick={() => onSeek(segment.startMs)} className="h-fit shrink-0 rounded-md bg-[#182230] px-2 py-1 font-mono text-[11px] text-white" title="Play from here">{timecode(segment.startMs)}</button>
                  <div className="min-w-0 space-y-1.5">
                    <p className="text-slate-800">{segment.description}</p>
                    <div className="flex flex-wrap gap-1">
                      {segment.attributes.filter((a) => a.category !== "person").map((attribute, index) => (
                        <span key={index} className={`rounded-md px-1.5 py-0.5 text-[11px] ${CHIP[attribute.category] ?? CHIP.object}`} title={attribute.personLabel ? `${attribute.category} · ${attribute.personLabel}` : attribute.category}>{attribute.category === "topic" ? `🎙 ${attribute.value}` : label(attribute)}</span>
                      ))}
                      {segment.cameraMovement && <span className={`rounded-md px-1.5 py-0.5 text-[11px] ${CHIP.shot}`}>camera: {segment.cameraMovement}</span>}
                    </div>
                  </div>
                </div>
              )) : analysis.transcript.length ? analysis.transcript.map((line, index) => (
                <button key={index} type="button" onClick={() => onSeek(line.startMs)} className="flex w-full gap-3 border-b border-slate-50 py-2 text-left text-xs hover:bg-slate-50">
                  <span className="shrink-0 font-mono text-[11px] text-slate-400">{timecode(line.startMs)}</span>
                  {line.speaker && <span className="shrink-0 font-medium text-slate-500">{line.speaker}</span>}
                  <span className="text-slate-800">{line.text}</span>
                </button>
              )) : <p className="py-4 text-xs text-slate-500">No speech detected.</p>}
            </div>
          </div>
          <p className="text-[11px] text-slate-400">AI-generated: check important details. People are labelled person_1, person_2… (no face recognition yet). {analysis.inputTokens.toLocaleString()} + {analysis.outputTokens.toLocaleString()} tokens, {Math.round(analysis.elapsedMs / 1000)}s.</p>
        </div>
      )}
    </section>
  );
}

function Info({ label: name, value }: { label: string; value: string }) {
  return <div><dt className="text-slate-400">{name}</dt><dd className="mt-0.5 truncate font-medium capitalize text-slate-800" title={value}>{value}</dd></div>;
}
