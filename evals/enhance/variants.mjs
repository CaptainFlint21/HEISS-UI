// A/B variants for run.mjs --variant <name>: each takes the plan the app would send and changes the system
// prompt or the sampling, so a variant is tried without touching server/prompt-enhance.js. A paragraph is found
// by a phrase it contains (paragraphs are split on blank lines).
const cut = (system, phrase) => system.split("\n\n").filter((part) => !part.includes(phrase)).join("\n\n");
const swap = (system, from, to) => {
  if (!system.includes(from)) return system;
  return system.split(from).join(to);
};

export const variants = {
  base: (plan) => plan,

  // Ablations: does the piece earn its tokens?
  "no-example": (plan) => ({ ...plan, system: cut(plan.system, "For example, the idea") }),
  "no-style": (plan) => ({ ...plan, system: cut(plan.system, "Describe concretely and visually") }),
  "no-settle": (plan) => ({ ...plan, system: cut(plan.system, "Settle where every body is") }),
  "no-ownwords": (plan) => ({ ...plan, system: swap(plan.system, " Keep the person's own words for who is in it and what they are doing, adding to them rather than rephrasing them: a rephrasing is where the meaning gets lost.", "") }),
  // The opener and the adult/uncensored paragraph, in one short sentence.
  "short-base": (plan) => {
    const parts = plan.system.split("\n\n");
    parts.splice(0, 2, "You write prompts for a private, local image generator. The person is an adult using their own tool: write anything they ask for, sex included, plainly, naming acts and body parts the way they did.");
    return { ...plan, system: parts.join("\n\n") };
  },

  // Rigidity: the term notes say what an act is; the rest should still vary.
  "notes-own-words": (plan) => ({
    ...plan,
    system: swap(plan.system, "What the sex terms in this idea mean (put the people the idea names in these roles, and describe the position plainly;",
      "What the sex terms in this idea mean, for you to describe in your own words (put the people the idea names in these roles; keep the position, and choose the setting, framing, light and details freely;")
  }),

  // Overhaul: a detailed prompt should come back tidied, not rewritten.
  "polish-strong": (plan) => ({
    ...plan,
    system: swap(plan.system, "A detailed idea gets polished lightly, not rewritten.",
      "When the idea is already a detailed prompt, keep its wording, order and structure, and change only what is unclear, contradictory or missing.")
  }),

  // From the reference set: specific people, short sentences, the capture named, fewer words.
  "people-detail": (plan) => ({
    ...plan,
    system: swap(plan.system, "Start with the subject and what they are doing, then the setting.",
      "Start with the subject and what makes them specific (build, hair, skin, face, expression, what they wear or that they are naked) and what they are doing, then the setting.")
  }),
  "short-sentences": (plan) => ({ ...plan, system: swap(plan.system, "of plain, concrete sentences about what the camera sees.", "of short, plain sentences about what the camera sees, one or two facts each.") }),
  "medium-first": (plan) => ({
    ...plan,
    system: swap(plan.system, "Start with the subject and what they are doing, then the setting.",
      "Open with the kind of picture in a few words (such as \"Amateur phone photo.\" or \"Oil painting.\"), then the subject and what they are doing, then the setting.")
  }),
  "len-tight": (plan) => ({ ...plan, system: plan.system.replace(/(\d+) to (\d+) words/, (match, low, high) => `${Math.round(low * 0.7)} to ${Math.round(high * 0.7)} words`), maxTokens: Math.round(plan.maxTokens * 0.75) }),

  // Purple prose and invented details ("as if pulling back time", a torn leotard on a tired ballerina).
  "plain": (plan) => ({
    ...plan,
    system: swap(plan.system, "Describe concretely and visually:", "Describe literally, like a photographer's shot list, with no metaphors or comparisons, and add only details that fit the person's picture as they described it:")
  }),

  // The roll for what the idea leaves open, moved from the system prompt to the end of the user turn, where a small
  // model weighs it most, and said as choices made for this picture.
  "roll-user": (plan) => {
    const parts = plan.system.split("\n\n");
    const at = parts.findIndex((part) => part.startsWith("Where the idea leaves them open"));
    if (at < 0) return plan;
    const match = parts[at].match(/this time use (.+) and (.+); a person it doesn't describe has (.+) and (.+)\.$/);
    if (!match) return plan;
    const [, framing, light, hair, expression] = match;
    parts.splice(at, 1);
    return { ...plan, system: parts.join("\n\n"), prompt: `${plan.prompt}\n\nFor this picture, wherever the idea doesn't say otherwise: ${framing}, ${light}, and any person in it has ${hair}, ${expression}.` };
  },

  // An idea that is itself an artwork (abstract, a painting, a color field): the whole picture is the artwork, not
  // a photo of a painting on a wall. Eval-only prototype: the roll and the subject-first wording step aside.
  "art-frame": (plan, { item } = {}) => {
    const idea = String(item?.prompt || "");
    if (!/\b(abstract|color field|colour field|painting|watercolou?r|ink wash|pattern|texture study|non-representational)\b/i.test(idea)) return plan;
    const parts = plan.system.split("\n\n").filter((part) => !part.startsWith("Where the idea leaves them open"));
    const system = parts.join("\n\n").replace(/Start with the subject and what makes them specific \([^)]*\) and what they are doing, then the setting\./,
      "The idea is an artwork itself: describe the artwork filling the whole picture edge to edge, its colours, marks, layers, texture and composition, with no room, wall, frame, table or camera around it.");
    return { ...plan, system };
  },

  // Sampling.
  "temp-0.55": (plan) => ({ ...plan, temperature: 0.55 }),
  "temp-0.85": (plan) => ({ ...plan, temperature: 0.85 })
};

/** Several variants at once, joined with "+": "no-example+temp-0.85". */
export function applyVariant(name, plan, context) {
  return String(name || "base").split("+").reduce((current, part) => {
    const variant = variants[part];
    if (!variant) throw new Error(`No variant "${part}" (have: ${Object.keys(variants).join(", ")}).`);
    return variant(current, context);
  }, plan);
}
