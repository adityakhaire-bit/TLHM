/**
 * Controlled vocabulary for AI metadata. The model's free wording is mapped to canonical values when stored
 * ("tee" → "t-shirt", "navy" → "blue"), and search queries are expanded with the same synonyms, so
 * "Terence in a black tee" finds segments stored as "black t-shirt".
 */

/** canonical → synonyms (all lower-case). The canonical value is what gets stored and shown. */
const SYNONYMS: Record<string, string[]> = {
  // clothing
  "t-shirt": ["tshirt", "t shirt", "tee", "tee shirt", "tees", "t-shirts"],
  shirt: ["button-up shirt", "button-down shirt", "dress shirt", "formal shirt", "shirts"],
  "tank top": ["vest top", "sleeveless top", "singlet"],
  hoodie: ["hooded sweatshirt", "hoody"],
  sweatshirt: ["jumper", "pullover"],
  jacket: ["blazer", "coat", "bomber"],
  jeans: ["denim", "denims", "denim jeans"],
  trousers: ["pants", "slacks", "chinos"],
  "track pants": ["joggers", "sweatpants", "trackpants"],
  shorts: ["short pants"],
  dress: ["gown", "frock"],
  sneakers: ["trainers", "running shoes", "sports shoes", "sneaker"],
  shoes: ["footwear", "formal shoes", "boots", "loafers"],
  cap: ["baseball cap", "hat"],
  sunglasses: ["shades"],
  glasses: ["spectacles", "eyeglasses"],
  microphone: ["mic", "lapel mic", "lavalier", "headset mic", "handheld mic"],
  // colours
  black: ["jet black", "charcoal black"],
  white: ["off-white", "cream", "ivory"],
  grey: ["gray", "charcoal", "silver"],
  blue: ["navy", "navy blue", "denim blue", "sky blue", "light blue", "dark blue"],
  red: ["maroon", "crimson", "burgundy"],
  green: ["olive", "khaki green", "mint"],
  yellow: ["mustard", "golden"],
  orange: ["rust"],
  pink: ["magenta", "rose"],
  purple: ["violet", "lavender"],
  brown: ["tan", "beige", "khaki"],
  // actions
  talking: ["speaking", "talk", "talks", "speak", "speaks", "explaining", "saying", "chatting", "conversation"],
  dancing: ["dance", "dances", "choreography", "performing dance"],
  teaching: ["teach", "teaches", "instructing", "coaching", "training students"],
  walking: ["walk", "walks"],
  running: ["run", "runs", "jogging"],
  sitting: ["sit", "sits", "seated"],
  standing: ["stand", "stands"],
  smiling: ["smile", "smiles"],
  laughing: ["laugh", "laughs"],
  exercising: ["workout", "working out", "exercise", "fitness", "demonstrating exercise", "demonstrating an exercise"],
  pointing: ["point", "points"],
  gesturing: ["gesture", "gestures", "hand gestures"],
  // poses
  "arms raised": ["hands raised", "hands up", "arms up", "raised arms", "arms in the air"],
  "arms crossed": ["folded arms", "arms folded", "crossed arms"],
  "hands on hips": ["hands on waist"],
  "lying down": ["lying", "laying down", "reclining"],
  kneeling: ["on knees", "kneel"],
  crouching: ["squatting", "crouch", "squat"],
  jumping: ["jump", "jumps", "leaping", "leap"],
  "mid-air": ["in the air", "airborne"],
  leaning: ["lean", "leans"],
  // shots and settings
  "close-up": ["closeup", "close up", "tight shot"],
  "extreme close-up": ["extreme closeup", "ecu"],
  "medium shot": ["mid shot", "medium"],
  "wide shot": ["wide", "long shot", "establishing shot"],
  "full-body shot": ["full body", "full shot", "full-length"],
  "dance studio": ["studio", "rehearsal studio", "practice room"],
  stage: ["on stage", "auditorium", "theatre stage"],
  gym: ["fitness studio", "fitness center", "fitness centre"],
};

const LOOKUP = new Map<string, string>();
for (const [canonical, words] of Object.entries(SYNONYMS)) {
  LOOKUP.set(canonical, canonical);
  for (const word of words) if (!LOOKUP.has(word)) LOOKUP.set(word, canonical);
}

/** Lower-case, trimmed, single-spaced, capped. */
export function clean(value: unknown, max = 120): string {
  return typeof value === "string" ? value.toLowerCase().replace(/[_]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "";
}

/** Maps a value to its canonical form when we know one ("Navy Blue" → "blue"); otherwise returns it cleaned. */
export function canonical(value: unknown, max = 120): string {
  const text = clean(value, max);
  return LOOKUP.get(text) ?? LOOKUP.get(text.replace(/s$/, "")) ?? text;
}

/** Words that carry no meaning in a footage search. */
const STOP_WORDS = new Set([
  "a", "an", "the", "in", "on", "at", "of", "with", "and", "or", "is", "are", "was", "who", "where", "while", "his", "her",
  "their", "wearing", "wears", "wear", "dressed", "shot", "shots", "clip", "clips", "video", "videos", "footage", "showing",
  "show", "shows", "some", "someone", "person", "people", "find", "me", "to", "into", "from", "by", "for",
]);

/**
 * Splits a search into groups of alternatives. Every group must match; any word in a group may match.
 * Multi-word phrases we know ("black t shirt", "close up") are joined first.
 */
export function expandQuery(query: string): string[][] {
  let text = ` ${clean(query, 200).replace(/[^a-z0-9\- ]/g, " ")} `;
  // Join known multi-word phrases before splitting (longest first).
  const phrases = [...LOOKUP.keys()].filter((key) => key.includes(" ")).sort((a, b) => b.length - a.length);
  const joined: string[] = [];
  for (const phrase of phrases) {
    if (text.includes(` ${phrase} `)) {
      joined.push(LOOKUP.get(phrase)!);
      text = text.replaceAll(` ${phrase} `, " ");
    }
  }
  const words = [...joined, ...text.split(/\s+/).filter((word) => word.length > 1 && !STOP_WORDS.has(word))];
  const groups: string[][] = [];
  for (const word of words.slice(0, 8)) {
    const main = LOOKUP.get(word) ?? LOOKUP.get(word.replace(/s$/, "")) ?? word;
    const alternatives = new Set([main, word]);
    for (const [synonym, target] of LOOKUP) if (target === main && synonym.length > 2) alternatives.add(synonym);
    groups.push([...alternatives]);
  }
  return groups;
}
