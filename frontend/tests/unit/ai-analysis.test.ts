import { describe, expect, it } from "vitest";
import { normalizeAnalysis, parseModelJson } from "@/server/ai-analysis";
import { canonical, expandQuery } from "@/server/ai-vocabulary";

describe("AI vocabulary", () => {
  it("maps wording variants to canonical values", () => {
    expect(canonical("Tee")).toBe("t-shirt");
    expect(canonical("T Shirt")).toBe("t-shirt");
    expect(canonical("Navy Blue")).toBe("blue");
    expect(canonical("speaking")).toBe("talking");
    expect(canonical("Close Up")).toBe("close-up");
    expect(canonical("sequinned cape")).toBe("sequinned cape"); // unknown values are kept
  });

  it("expands a natural search into groups of alternatives, dropping filler words", () => {
    const groups = expandQuery("Terence talking in a black T shirt");
    const mains = groups.map((group) => group[0]);
    expect(mains).toEqual(["t-shirt", "terence", "talking", "black"]);
    expect(groups.find((group) => group[0] === "talking")).toContain("speaking");
    expect(groups.find((group) => group[0] === "t-shirt")).toContain("tee");
  });

  it("returns nothing for filler-only queries", () => {
    expect(expandQuery("a video of the")).toEqual([]);
  });
});

const sample = {
  summary: "A man talks to camera in a dance studio.",
  suggested_title: "Studio talk",
  language: "English",
  has_speech: true,
  has_music: false,
  indoor_outdoor: "indoor",
  setting: "Dance Studio",
  people_count: 1,
  tags: ["Studio", "talk", "studio"],
  topics: ["fitness"],
  people: [{ label: "person_1", description: "Short dark hair" }],
  segments: [
    {
      start_s: "0:05", end_s: 20, description: "He explains a warm-up.", shot_type: "medium shot", camera_movement: "static", setting: "",
      people: [{ label: "person_1", position: "centre", is_speaking: true, actions: ["Explaining", "gesturing"], clothing: [{ item: "Tee", color: "Black", pattern: "plain", body_region: "upper" }, { item: "mic", color: "black", pattern: "", body_region: "accessory" }] }],
      objects: ["mirror"],
    },
    { start_s: 0, end_s: 5, description: "Intro.", shot_type: "other", camera_movement: "", setting: "", people: [], objects: [] },
  ],
  transcript: [{ start_s: 6, end_s: 9, speaker: "person_1", text: "Let's start with a warm-up." }],
};

describe("normalizeAnalysis", () => {
  it("normalises, sorts and clamps the model output", () => {
    const rows = normalizeAnalysis(parseModelJson(JSON.stringify(sample)), 18);
    expect(rows.segments.map((segment) => [segment.startMs, segment.endMs])).toEqual([[0, 5000], [5000, 18000]]);
    const talk = rows.segments[1];
    expect(talk.attributes).toContainEqual(expect.objectContaining({ category: "clothing", value: "t-shirt", color: "black", pattern: null, bodyRegion: "upper", personLabel: "person_1" }));
    expect(talk.attributes).toContainEqual(expect.objectContaining({ category: "accessory", value: "microphone" }));
    expect(talk.attributes.filter((a) => a.category === "action" && a.value === "talking")).toHaveLength(1); // is_speaking + "explaining" de-duplicated
    expect(talk.setting).toBe("dance studio");
    expect(talk.searchText).toContain("black t-shirt");
    expect(talk.searchText).toContain("warm-up"); // overlapping speech is searchable
    expect(rows.segments[0].shotType).toBeNull();
    expect(rows.tags).toEqual(["studio", "talk"]);
    expect(rows.transcript[0]).toMatchObject({ startMs: 6000, endMs: 9000, speaker: "person_1" });
  });

  it("tolerates missing optional fields", () => {
    const rows = normalizeAnalysis(parseModelJson('```json\n{"summary":"x","segments":[{"start_s":0,"end_s":3,"description":"y"}]}\n```'), null);
    expect(rows.segments).toHaveLength(1);
    expect(rows.transcript).toEqual([]);
    expect(rows.hasSpeech).toBe(false);
  });

  it("reports cut-off JSON as a retryable error", () => {
    expect(() => parseModelJson('{"summary":"x","segments":[{"start_s":0')).toThrow(/cut off/);
  });
});

describe("auto-sort and auto-tags", () => {
  it("stores pose, a category and frequency-ordered auto-tags", () => {
    const json = structuredClone(sample) as typeof sample & { category: string };
    json.category = "Fitness";
    (json.segments[0].people[0] as Record<string, unknown>).pose = "hands up";
    const rows = normalizeAnalysis(parseModelJson(JSON.stringify(json)), 18);
    expect(rows.category).toBe("fitness");
    expect(rows.segments[1].attributes).toContainEqual(expect.objectContaining({ category: "pose", value: "arms raised" }));
    expect(rows.autoTags.slice(0, 3)).toEqual(["fitness", "black t-shirt", "black microphone"]);
    expect(rows.autoTags).toContain("arms raised");
    expect(rows.autoTags).toContain("dance studio");
  });

  it("ignores unknown or 'other' categories", () => {
    const json = { ...sample, category: "documentary" };
    expect(normalizeAnalysis(parseModelJson(JSON.stringify(json)), 18).category).toBeNull();
  });
});

describe("AI filters", () => {
  it("parses attr filters and rejects junk", async () => {
    const { parseAttr } = await import("@/server/search");
    expect(parseAttr("clothing|t-shirt|black")).toEqual({ category: "clothing", value: "t-shirt", color: "black" });
    expect(parseAttr("Clothing||Black")).toEqual({ category: "clothing", value: null, color: "black" });
    expect(parseAttr("pose|sitting|")).toEqual({ category: "pose", value: "sitting", color: null });
    expect(parseAttr("pose||")).toBeNull();
    expect(parseAttr("drop table|x|")).toBeNull();
  });
});
