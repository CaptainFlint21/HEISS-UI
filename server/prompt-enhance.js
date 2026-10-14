import crypto from "node:crypto";
import path from "node:path";
import { comfy, comfyUrl, optionsFor } from "./comfy.js";
import { cancelPrompt, promptTracker } from "./comfy-queue.js";
import { enhancerDownloads } from "./family-catalog.js";
import { dataDir } from "./gallery-store.js";
import { readJsonFile, writeJsonFile } from "./json-store.js";
import { sexTermNotes, sexTerms } from "./prompt-terms.js";

// Act tags that put a man in the picture (missionary, cowgirl position, paizuri…), from the terms table.
const manActs = new Set(sexTerms.filter((term) => /\bhetero\b/.test(term.tags)).map((term) => term.tags.split(",")[0].trim().toLowerCase()));

/**
 * Prompt enhance (docs/prompt-enhance.md): a local vision LLM turns a few
 * words into the prompt the selected model wants, or reads a picture into one.
 * It runs inside ComfyUI, on HEISS Prompt Enhance (HEISS UI Nodes 8) over the
 * CLIP loader's LLM text encoders, so it shares ComfyUI's memory management
 * with the picture and video models instead of fighting them for VRAM, and
 * nothing extra is installed. The node streams the text while it is written;
 * this file picks what to ask for, builds the graph and relays the stream.
 */

/* ------------------------------------------------------------ What to ask for */

// Families whose text encoder is CLIP: about 75 words reach the model, so prompts stay short.
const clipFamilies = new Set(["sd15", "sd2", "sdxl"]);
// Families trained on Danbooru tags.
const tagFamilies = new Set(["anima"]);
const tagVariants = { pony: "score_9, score_8_up, score_7_up", anime: "masterpiece, best quality, amazing quality, very aesthetic" };
// Families that hear sound as well (LTX-2): the soundscape belongs in the prompt.
const audioFamilies = new Set(["ltx"]);
// Families with long LLM encoders that use a long, exact prompt well.
const longFamilies = new Set(["flux2_dev", "flux2_klein_4b", "flux2_klein_9b", "hidream", "qwen_image", "qwen_image_21", "krea2", "ideogram4", "mage_flow", "ernie", "ltx", "ltxv", "minimax_h3"]);

/**
 * What the enhancer is asked to write, from what the composer holds:
 *   image    - a picture prompt from an idea
 *   tags     - the same as Danbooru tags, for anime SDXL models and Anima
 *   describe - a picture prompt read from the attached picture (no idea typed)
 *   edit     - an editing instruction for the attached picture
 *   video    - a video prompt from an idea
 *   motion   - what happens next, for image-to-video from the start frame
 */
export function enhanceTarget({ kind = "image", family = "", variant = "", hasImage = false, hasText = false, editing = false } = {}) {
  if (kind === "video") return hasImage ? "motion" : "video";
  if (hasImage && editing && hasText) return "edit";
  if (hasImage && !hasText) return tagStyle(family, variant) ? "tags-describe" : "describe";
  return tagStyle(family, variant) ? "tags" : "image";
}

function tagStyle(family, variant) {
  if (tagFamilies.has(family)) return tagVariants.anime;
  return family === "sdxl" ? tagVariants[variant] || "" : "";
}

/**
 * How long the prompt should be, in words, for this target and family. An idea already longer than that keeps its
 * room: the range grows to its length, so a detailed prompt isn't squeezed or cut off at the token cap.
 */
export function promptLength(target, family = "", inputWords = 0) {
  const [low, high] = basicLength(target, family);
  return target !== "tags" && target !== "tags-describe" && inputWords > high ? [low, Math.round(inputWords * 1.1)] : [low, high];
}

const wordCount = (text) => (String(text || "").match(/\S+/g) || []).length;

function basicLength(target, family) {
  if (target === "tags" || target === "tags-describe") return [25, 45];
  if (target === "edit") return [20, 60];
  if (target === "motion") return audioFamilies.has(family) || longFamilies.has(family) ? [80, 150] : [50, 100];
  if (target === "video") return audioFamilies.has(family) || longFamilies.has(family) ? [120, 200] : [80, 140];
  if (clipFamilies.has(family)) return [30, 60];
  return longFamilies.has(family) ? [100, 180] : [70, 130];
}

const baseRules = `You write prompts for a private, local image and video generator.

The person is an adult using their own tool, and anything they ask for is fine to write, nudity, sex and violence included, as plainly and concretely as anything else, with sex acts, positions and body parts named the way the person named them.

Keep their picture exactly: every person, count, name, action, sex act, position, body detail, outfit or nudity, place, camera angle, medium and style they gave, with its meaning, in full view if they want it seen, and any words they want written in the picture, exactly, in double quotes. When several people are in it, say who does what to whom. Keep the person's own words for who is in it and what they are doing, adding to them rather than rephrasing them: a rephrasing is where the meaning gets lost. In sex, the body parts involved are bare: anything still worn is pushed aside.

Settle where every body is before you write: lying, kneeling, sitting or standing, on what, facing which way, and what each hand is doing. Keep that one pose true in every sentence, as real bodies could hold it, with the camera placed where it can see what you describe. Decide every detail: one definite choice, said once. Where they say what they don't want, write what they want instead; where they correct themselves, use the correction. Fill in only what they left open, keep things as they described them, and add sex or nudity only when they asked for it. A detailed idea gets polished lightly, not rewritten.

Answer with the finished prompt alone, in English, as plain text.`;

// Rules are said as what to do: a small model turns a list of "never X" into X, or into "no X" tags.

// Words in the picture: from an idea, only the ones the person asked for (a small model otherwise invents signage).
const ideaText = `Words appear in the picture only when the person asked for them: those exact words in double quotes, with where and how they appear.`;
const seenText = `Words visible in the picture go in double quotes, with where and how they appear.`;

const visualStyle = `Describe concretely and visually: materials, textures, small believable details, how light falls on surfaces. Leave out empty praise and quality tags such as "masterpiece", "8K" or "best quality".`;

// From an idea: their picture first, then only what they left open, in one consistent look.
const imageFill = `Start with the subject and what they are doing, then the setting. Then fill in what the picture still needs: framing and camera angle, the light and where it comes from, and the medium. Keep the look they asked for and make the camera, light and medium agree with it and with each other; a painting or drawing gets no camera terms. When no medium is given, choose the one that suits the idea best, a photograph for anything real.`;

// One worked example shows a small model the register better than more rules do: their picture kept, the
// gaps filled to fit one look, the sound quietly gone, nothing about what isn't there. Its subject is
// deliberately ordinary.
const imageExample = `For example, the idea "old man feeding pigeons, rainy day, church bells ringing, phone pic" becomes: An old man in a brown wool coat and flat cap sits on a wet park bench, tossing breadcrumbs to a crowd of pigeons at his feet; one pigeon has hopped onto the bench beside him. His hands are knobbly and red from the cold. Grey drizzle, puddles on the gravel path, bare trees behind. An everyday phone snapshot from a few steps away at standing height, flat overcast light, everything in focus, slightly muted colours.`;

// From a picture: everything that is there, in this order.
const imageOrder = `most important first: the subject and what makes them specific (appearance, clothing, expression, pose, action), then the setting and background, then composition and camera (shot size, angle, lens, depth of field), then lighting (source, direction, quality, colour), then colour palette, mood and the medium or style, such as "35mm film photograph", "oil painting" or "3D render".`;

function tagRules(quality) {
  return `Write Danbooru-style tags, comma-separated, lowercase, short tags rather than sentences. Start with these quality tags: ${quality}. Then who is in it: a tag for each person (1girl, 1boy, 2girls), solo only when there is just one, and none when no one is in the picture; sex with a partner always gets a tag for the partner (1boy and hetero for a man, 2girls and yuri for two women), even when the person doesn't mention them, and the act. Then any character and series names, appearance, clothing or nudity, expression, pose and action, setting, camera angle, lighting, and a style only if the person gave one. Only what can be seen. End the list once the picture is covered. Put a comma and a space between every two tags. For example:
"fox girl at a shrine at night" becomes: ${quality}, 1girl, solo, fox ears, fox tail, long hair, red kimono, smile, looking at viewer, standing, shrine, torii, night, paper lanterns, from below
"redhead getting fucked from behind on the bed" becomes: ${quality}, 1girl, 1boy, hetero, sex, sex from behind, red hair, nude, on bed
"castle on a cliff at sunset" becomes: ${quality}, no humans, scenery, castle, cliff, ocean, sunset, orange sky, clouds, birds, wide shot`;
}

const motionRules = `Describe only what is seen and how it moves. Every moving thing gets a clear, physically plausible motion, in the order it happens; use "as", "then" and "while". Say how the camera frames the shot and moves: name a move such as "slow push in", "tracking shot" or "handheld", or say it stays still. One continuous shot: no cuts, scene changes or timestamps. Present tense.`;

const soundRules = `Weave the sound in alongside the action, not at the end: ambient sound, effects, music, and any speech in double quotes with how it is said.`;

/**
 * What a short idea leaves open gets a fresh roll each time: left to itself the model writes its single likeliest
 * version ("portrait of a woman" came back as the same centered, dark-haired woman in 4 of 4 takes), and Try again
 * changed nothing. Anything the idea says wins over the roll.
 */
const openChoices = {
  framing: ["a close-up", "a medium shot from the waist up", "a full-length shot", "a wide shot that shows the surroundings", "a high angle looking down", "a low angle looking up", "a candid side view", "an over-the-shoulder view"],
  light: ["soft window light", "golden-hour sun", "flat overcast daylight", "hard midday sun", "a single warm lamp", "neon and street light", "blue-hour dusk light", "direct on-camera flash", "candlelight", "soft studio light"],
  // For a person the idea doesn't describe: the model's default was long dark hair and a neutral face, every time.
  hair: ["short curly hair", "a sleek red bob", "long blonde waves", "black braids", "a buzz cut", "silver hair pinned up", "auburn hair in a loose ponytail", "messy brown bangs", "shoulder-length black hair", "a platinum pixie cut"],
  expression: ["laughing", "a sly half-smile", "looking away, lost in thought", "a serious, direct stare", "eyes closed", "mid-sentence, mouth slightly open", "a shy smile", "a raised eyebrow"]
};

/** A choice from `list` for this roll; `salt` keeps the picks for different lists independent. */
export function rolled(list, roll = 0, salt = 0) {
  let x = (Math.floor(Math.abs(roll)) ^ Math.imul(salt + 1, 0x9e3779b1)) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b) >>> 0;
  x = (x ^ (x >>> 16)) >>> 0;
  return list[x % list.length];
}

// Only for a short idea: a detailed prompt already chose its framing and light, or meant to leave them.
const rollFor = (text, roll) => (wordCount(text) > 40 ? "" : `Where the idea leaves them open, this time use ${rolled(openChoices.framing, roll, 1)} and ${rolled(openChoices.light, roll, 2)}; a person it doesn't describe has ${rolled(openChoices.hair, roll, 3)} and ${rolled(openChoices.expression, roll, 4)}.`);

/** The system prompt for one target, family, the idea (for the sex terms it uses), the roll for what it leaves open, and the person's own standing instructions. */
export function systemPrompt(target, { family = "", variant = "", instructions = "", text = "", roll = 0 } = {}) {
  const [low, high] = promptLength(target, family, wordCount(text));
  const words = `${low} to ${high} words`;
  const sound = audioFamilies.has(family) ? `\n\n${soundRules}` : "";
  // Said in the task itself, where a small model can't miss it.
  const clip = audioFamilies.has(family) ? "video with sound" : "silent video";
  const quality = tagStyle(family, variant) || tagVariants.anime;
  const task = {
    image: `Turn the person's idea into one image prompt: ${words} of plain, concrete sentences about what the camera sees. ${imageFill}\n\n${visualStyle}\n\n${imageExample}${rollFor(text, roll) ? `\n\n${rollFor(text, roll)}` : ""}`,
    tags: `Turn the person's idea into an image prompt for an anime model. ${tagRules(quality)}\n\nUse ${low} to ${high} tags.`,
    describe: `Look at the picture and write the prompt that would make it again: a single flowing paragraph of ${words} in natural sentences, ${imageOrder}\n\nDescribe only what is there, and name the medium and style exactly. Describe people's visible appearance, clothing or nudity, and pose plainly and accurately. If the person adds words, they say what to focus on or change.\n\n${visualStyle} ${seenText}`,
    "tags-describe": `Look at the picture and write the tags that would make it again with an anime model. ${tagRules(quality)}\n\nUse ${low} to ${high} tags; describe only what is there.`,
    edit: `The picture is what exists now; the person says how to change it. Write one precise editing instruction of ${words}: what changes and exactly how it should look, then what must stay the same (identity, face, pose, framing, lighting, background). Refer to things as they appear in the picture. Turn "don't change X" into "keep X".`,
    video: `Turn the person's idea into one prompt for a ${clip}: a single paragraph of ${words} describing one shot as it unfolds. Start with the subject and the setting, then the action step by step, then lighting, atmosphere and style.\n\n${motionRules}${sound}\n\n${visualStyle} ${ideaText}`,
    motion: `The picture is the first frame of a ${clip}. Write what happens next, in a single paragraph of ${words}: what moves, how, and in what order, and what the camera does. Name the subjects so the motion is clear, but do not describe again what is already visible, and never contradict the picture. If the person gave no idea, invent natural motion that suits the picture and brings it to life.\n\n${motionRules}${sound}`
  }[target];
  const terms = sexTermNotes(text, { tags: isTagTarget(target), roll });
  const own = String(instructions || "").trim();
  return `${baseRules}\n\n${task}${terms ? `\n\n${terms}` : ""}${own ? `\n\nThe person's standing instructions, which win over the above where they differ:\n${own}` : ""}`;
}

/** The user turn: the idea as data, so a small model rewrites it instead of answering it. */
export function userTurn(target, text = "") {
  const idea = String(text || "").trim();
  if (target === "describe" || target === "tags-describe") return idea ? `Write the prompt for this picture. Focus: ${idea}` : "Write the prompt for this picture.";
  if (target === "motion" && !idea) return "Write what happens next in this picture.";
  if (target === "edit") return `Change requested: ${idea}`;
  return `Idea: ${idea || "something beautiful and surprising"}`;
}

export const isTagTarget = (target) => target === "tags" || target === "tags-describe";

/** Room for the answer: a word takes about 1.5 tokens, a tag about 3; the cap stays near what is asked so a run can't ramble. */
export function tokenBudget(target, family = "", inputWords = 0) {
  const [, high] = promptLength(target, family, inputWords);
  return isTagTarget(target) ? high * 3 + 20 : Math.round(high * 1.7) + 40;
}

// A sentence that only says what's absent ("No other people are visible.", "No text or logos.") is a small
// model's tic: it describes nothing, and a negation can pull the very thing into the picture.
const absentSentence = /^(no|nothing|without)\b[^.!?]*\b(other (people|person|objects?)|people|persons?|humans?|figures?|objects?|text|logos?|words|signatures?|watermarks?|filters?|stylization|distractions?|camera (angle|movement))\b[^.!?]*[.!?]?$/i;

// Hedges an image model can't draw: "clothing — if any —", "depending on positioning", "perhaps", "possibly".
const hedges = [/\s*[—–-]+\s*if any\s*[—–-]+\s*/gi, /,?\s*\bif any\b/gi, /,?\s*\bdepending on [^,.;]+/gi, /\b(perhaps|possibly|presumably|maybe) /gi];

// "X or Y" about one thing ("on the steering wheel or dashboard", "her thighs or hips", "gripping or pushing"):
// the first choice stays.
// A noun choice only when the second one ends the phrase, and never inside a negation ("no clothing on her torso
// or legs" means neither).
const phraseEnd = String.raw`(?=[,.;:!?]| and | while | as |$)`;
const eitherOr = [
  [/\b(\w+ing) or \w+ing\b/g, "$1"],
  [new RegExp(String.raw`\b(eyes (?:\w+ )?)([\w-]+) or [\w-]+\b${phraseEnd}`, "gi"), "$1$2"],
  [new RegExp(String.raw`\b(on|onto|against|around|over|across|near|beside|under) ((?:the |her |his |their )?[\w-]+) or (?:the |her |his |their )?[\w-]+\b${phraseEnd}`, "gi"), "$1 $2"],
  [new RegExp(String.raw`\b(her|his|their) ([\w-]+) or (?:her |his |their )?[\w-]+\b${phraseEnd}`, "gi"), "$1 $2"]
];
const negated = /\b(no|not|without|neither|never)\b[^,.;]*$/i;
const collapseEitherOr = (text) => eitherOr.reduce((result, [pattern, keep]) => result.replace(pattern, (match, ...groups) => {
  const offset = groups[groups.length - 2];
  if (negated.test(result.slice(Math.max(0, offset - 40), offset))) return match;
  return keep.replace(/\$(\d)/g, (_, index) => groups[Number(index) - 1]);
}), text);

// The model's sign-off ("no filters or stylization", "no CGI"): it says nothing an image model can use.
const filler = /\s*[,;—–]?\s*(?:with )?no (?:filters?|stylization|stylized effects|cgi|smoothing|polish|retouching|editing|glamorization)\b(?:\s*(?:,|or|and|—)\s*(?:no )?(?:filters?|stylization|stylized effects|cgi|smoothing|polish|retouching|editing|effects|idealization|glamorization)\b)*/gi;

function finishProse(text = "") {
  const sentences = String(text).trim().match(/[^.!?]+(?:[.!?]+["”’)]?|$)\s*/g) || [];
  const kept = sentences.filter((sentence) => !absentSentence.test(sentence.trim()));
  const prose = (kept.length ? kept.join("") : String(text)).trim();
  const plain = collapseEitherOr(prose.replace(filler, ""));
  return hedges.reduce((result, hedge) => result.replace(hedge, (match) => (/^\s*[—–-]/.test(match) ? " " : "")), plain).replace(/ {2,}/g, " ").replace(/ ([,.;])/g, "$1").replace(/([,;])\s*([.!?])/g, "$2").replace(/—\s*([.!?])/g, "$1")
    .replace(/(^|[.!?]\s+)([a-z])/g, (match, before, letter) => before + letter.toUpperCase());
}

/**
 * The prompt as it goes into the composer. Prose: without sentences about what's absent. Tags: one of each, no "no X" tags
 * (a prompt can't forbid anything, and small models pad with them), at most a
 * few over the asked-for count.
 */
export function finishPrompt(target, text = "", family = "") {
  if (!isTagTarget(target)) return finishProse(text);
  const seen = new Set();
  const tags = String(text).split(/[,\n]/).map((tag) => {
    const clean = tag.trim().replace(/\s+/g, " ");
    // "long-black-hair": words strung with hyphens, where a single hyphen ("t-shirt", "she-ra") is the tag's own.
    return /^[^\s-]+(-[^\s-]+){2,}$/.test(clean) ? clean.replace(/-/g, " ") : clean;
  }).filter((tag) => {
    const key = tag.toLowerCase();
    // "no_x" counts too ("no humans" is a real tag), a "tag" of more than five words is a sentence, and
    // "danbooru tags" is the model talking about its task.
    if (!tag || (/^(no|without|not)(\b|_)/i.test(tag) && !/^no[ _]humans$/i.test(tag)) || tag.split(/[\s_]+/).length > 5 || /danbooru/i.test(tag) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  // "hetero", or an act that takes a man, means he is in it, even when the model forgot to tag him.
  const lower = tags.map((tag) => tag.toLowerCase());
  if (lower.some((tag) => tag === "hetero" || manActs.has(tag)) && !lower.some((tag) => /^(\d\+?boys?|multiple boys)$/.test(tag))) {
    const girl = lower.findIndex((tag) => /^\d\+?girls?$/.test(tag));
    tags.splice(girl >= 0 ? girl + 1 : lower.indexOf("hetero"), 0, "1boy");
  }
  // "solo" beside a second person is a small model copying the example's opening.
  const people = tags.filter((tag) => /^(\d\+?(girl|boy|other)s?|hetero|yuri|yaoi|multiple (girls|boys))$/i.test(tag));
  // Likewise "no humans" tacked onto a picture that has people.
  const kept = tags.filter((tag) => !(people.length > 1 && /^solo$/i.test(tag)) && !(people.length && /^no[ _]humans$/i.test(tag)));
  return kept.slice(0, promptLength(target, family)[1] + 5).join(", ");
}

/**
 * Everything one enhancement asks the node for, from what the composer sent and
 * the saved settings. /api/enhance and evals/enhance both build their runs here,
 * so the eval measures exactly what the app sends.
 */
export function enhancePlan({ kind = "image", family = "", variant = "", text = "", hasImage = false, editing = false, again = false, roll = crypto.randomInt(0, 2 ** 31) } = {}, settings = enhanceDefaults) {
  const target = enhanceTarget({ kind, family, variant, hasImage, hasText: Boolean(String(text).trim()), editing });
  return {
    target,
    system: systemPrompt(target, { family, variant, instructions: settings.instructions, text, roll }),
    prompt: userTurn(target, text),
    maxTokens: tokenBudget(target, family, wordCount(text)),
    // "Again" asks for another take: a little more freedom than the first.
    temperature: Math.min(1.2, settings.creativity + (again ? 0.15 : 0))
  };
}

/* ------------------------------------------------------------ Settings */

const settingsFile = path.join(dataDir, "prompt-enhance.json");
export const enhanceDefaults = { model: "", instructions: "", creativity: 0.7 };

export function cleanEnhanceSettings(value = {}) {
  const creativity = Number(value.creativity);
  return {
    model: typeof value.model === "string" ? path.basename(value.model).slice(0, 255) : "",
    instructions: typeof value.instructions === "string" ? value.instructions.slice(0, 2000) : "",
    creativity: Number.isFinite(creativity) ? Math.min(1.2, Math.max(0, creativity)) : enhanceDefaults.creativity
  };
}

export function loadEnhanceSettings() {
  try {
    return cleanEnhanceSettings({ ...enhanceDefaults, ...readJsonFile(settingsFile) });
  } catch {
    return { ...enhanceDefaults };
  }
}

export function saveEnhanceSettings(value) {
  const settings = cleanEnhanceSettings({ ...loadEnhanceSettings(), ...value });
  writeJsonFile(settingsFile, settings);
  return settings;
}

/* ------------------------------------------------------------ Model */

/** The catalog's enhancer builds, best first, each with its download id. */
export function enhancerChoices() {
  return enhancerDownloads.vision.map((entry, index) => ({ id: `enhancer:vision:${index}`, ...entry }));
}

/**
 * The model to run: the one picked in settings while ComfyUI lists it, else the
 * first catalog build ComfyUI lists. Empty when none is there (setup offers the download).
 */
export function enhanceModel(info, settings = loadEnhanceSettings()) {
  const listed = optionsFor(info, "CLIPLoader", "clip_name");
  if (settings.model && listed.includes(settings.model)) return settings.model;
  return enhancerChoices().map((entry) => entry.file).find((file) => listed.includes(file)) || "";
}

/* ------------------------------------------------------------ Graph and run */

export function enhanceGraph({ model, system, prompt, image = "", maxTokens = 300, temperature = 0.7, seed = 0, streamId = "" }) {
  const graph = {
    clip: { class_type: "CLIPLoader", inputs: { clip_name: model, type: "stable_diffusion", device: "default" } },
    enhance: {
      class_type: "HeissPromptEnhance",
      inputs: { clip: ["clip", 0], system_prompt: system, prompt, max_tokens: maxTokens, temperature, seed, thinking: false, stream_id: streamId }
    }
  };
  if (image) {
    graph.image = { class_type: "LoadImage", inputs: { image } };
    graph.enhance.inputs.image = ["image", 0];
  }
  return graph;
}

/** The node's answer in a history entry: its text, or "" when the run ended without one. */
export function enhanceResult(entry) {
  const text = entry?.outputs?.enhance?.text;
  return Array.isArray(text) ? String(text[0] || "") : "";
}

/** ComfyUI's own words for why the run failed, from a history entry. */
function failureIn(entry) {
  if (entry?.status?.status_str !== "error") return "";
  const message = (entry.status.messages || []).find(([type]) => type === "execution_error")?.[1];
  return String(message?.exception_message || "ComfyUI couldn't run the enhancer.").trim();
}

/**
 * Runs one enhancement and reports it through `emit` as it goes:
 *   { type: "queued" }            - waiting for ComfyUI to finish what it is doing
 *   { type: "loading" }           - started: the model is loading or reading
 *   { type: "text", text }        - the prompt so far
 *   { type: "done", text, stats } - the finished prompt, and the node's own count: { tokens, seconds }
 * Resolves with the finished prompt; throws with a message a person can read.
 * `signal` stops it, and the run in ComfyUI with it.
 */
export async function runEnhance({ model, system, prompt, image = "", maxTokens, temperature, seed }, { emit = () => {}, signal } = {}) {
  const clientId = `heiss-enhance-${crypto.randomUUID()}`;
  const streamId = crypto.randomUUID();
  const graph = enhanceGraph({ model, system, prompt, image, maxTokens, temperature, seed, streamId });
  let socket = null;
  let promptId = "";
  let finished = "";
  let failed = "";
  let phase = "";
  let stats = null;
  // queued, then loading, each said once, whichever of the socket and the queue says it first.
  const step = (type) => { if (phase !== type && phase !== "loading") { phase = type; emit({ type }); } };
  let wake = () => {};
  const woken = () => new Promise((resolve) => { wake = resolve; });
  try {
    socket = new WebSocket(`${comfyUrl.replace(/^http/i, "ws")}/ws?clientId=${encodeURIComponent(clientId)}`);
    await new Promise((resolve) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener("error", resolve, { once: true });
      setTimeout(resolve, 1500);
    });
  } catch {
    socket = null; // still runs, without the live text
  }
  let tracker = null;
  socket?.addEventListener("message", (event) => {
    if (typeof event.data !== "string") return;
    let message;
    try { message = JSON.parse(event.data); } catch { return; }
    tracker?.alive();
    const data = message.data || {};
    if (message.type === "heiss.enhance" && data.id === streamId) {
      if (data.done) finished = String(data.text || "");
      else if (data.text) emit({ type: "text", text: String(data.text) });
      // "executed" follows with the node's token count; it's not worth waiting long for.
      if (data.done) setTimeout(() => wake(), 250);
    } else if (data.prompt_id && data.prompt_id === promptId) {
      if (message.type === "execution_start") step("loading");
      if (message.type === "executed" && data.node === "enhance") {
        stats = { tokens: Number(data.output?.tokens?.[0]) || 0, seconds: Number(data.output?.seconds?.[0]) || 0 };
        if (finished) wake();
      }
      if (message.type === "execution_error") { failed = String(data.exception_message || "").trim() || "ComfyUI couldn't run the enhancer."; wake(); }
      if (message.type === "execution_interrupted") { failed = "Stopped."; wake(); }
    }
  });
  const stop = () => { if (promptId) cancelPrompt(promptId).catch(() => {}); wake(); };
  signal?.addEventListener("abort", stop, { once: true });
  try {
    // At the front of the queue: a run already going finishes first, then this, ahead of anything waiting.
    const queued = await comfy("/prompt", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt: graph, client_id: clientId, front: true }) });
    promptId = String(queued?.prompt_id || "");
    if (!promptId) throw new Error("ComfyUI didn't take the enhancer run.");
    const running = await comfy("/queue").then((queue) => (queue?.queue_running || []).some((item) => item?.[1] === promptId), () => true);
    step(running ? "loading" : "queued");
    tracker = promptTracker(promptId);
    while (!finished && !failed && !signal?.aborted) {
      // The socket says when it is done; the history is asked now and then in case the socket missed it.
      await Promise.race([woken(), new Promise((resolve) => setTimeout(resolve, 2000))]);
      if (finished || failed || signal?.aborted) break;
      const state = await tracker.check();
      if (state.state === "done") {
        failed = failureIn(state.entry);
        finished = failed ? "" : enhanceResult(state.entry);
        if (!failed && !finished) failed = "The enhancer finished without a prompt.";
      }
    }
    if (signal?.aborted) throw Object.assign(new Error("Stopped."), { stopped: true });
    if (failed) throw new Error(friendlyFailure(failed));
    emit({ type: "done", text: finished, stats });
    return finished;
  } finally {
    signal?.removeEventListener("abort", stop);
    try { socket?.close(); } catch { /* already closed */ }
    // Nothing of it is kept in ComfyUI's history: the prompt may be Hidden, and the run is no picture.
    if (promptId) comfy("/history", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ delete: [promptId] }) }).catch(() => {});
  }
}

/** ComfyUI's error, said the way the person can act on it. */
export function friendlyFailure(message = "") {
  if (/out of memory|CUDA error: out of memory|OutOfMemory/i.test(message)) return "Not enough graphics memory for the enhancer right now. Try again when the current render is done.";
  if (/not in \[|value_not_in_list|clip_name/i.test(message)) return "ComfyUI doesn't list the enhancer model yet.";
  return message;
}
