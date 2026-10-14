#!/usr/bin/env node
// Flags prose outputs whose bodies can't all be true at once, for reading by eye (RUBRIC.md): a finder, not a
// score. node evals/enhance/consistency.mjs <run> [<run> …]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

// Each check: two things said of the same scene that can't both hold. `unless` excuses the usual way out.
export const checks = [
  { name: "on her back + from behind / face down", a: /\b(lies|lying|laid) (flat )?on her back\b|\bon her back\b/i, b: /\bfrom behind\b|\bface[- ]down\b|\bon her (stomach|belly)\b|\bhands and knees\b|\ball fours\b|\bbent over\b/i },
  { name: "face down / facing away + eye contact", a: /\bface[- ]down\b|\bfacing away\b|\bback to the camera\b|\bher back (is )?(to|toward) (the camera|the viewer)\b/i, b: /\blook(s|ing)? (directly )?(at|into) (the camera|the lens|the viewer)\b|\beye contact\b/i, unless: /\bover (her|his) shoulder\b|\blooks? back\b|\blooking back\b|\bturn(s|ed|ing)? her head\b/i },
  { name: "astride / riding + lying on her back", a: /\b(astride|straddl\w+|riding|rides)\b/i, b: /\b(she|woman|girl)[^.]{0,40}\b(lies|lying) on her back\b/i },
  { name: "kneeling + lying (same person, same sentence)", a: /\bknee(l|ls|ling)\b[^.]{0,60}\b(lies|lying)\b|\b(lies|lying)\b[^.]{0,60}\bknee(l|ls|ling)\b/i, b: /./ },
  { name: "standing + lying (same sentence)", a: /\bstand(s|ing)\b[^.]{0,50}\b(lies|lying) (on|down)\b|\b(lies|lying) (on|down)\b[^.]{0,50}\bstand(s|ing)\b/i, b: /./ },
  { name: "behind her + front-only act", a: /\b(he|man|guy)[^.]{0,40}\b(stands?|kneels?|is|positioned) behind her\b/i, b: /\bbetween her breasts\b|\bin(to)? her mouth\b|\bface to face\b|\bher lips\b/i },
  { name: "hands and knees + legs wrapped around him", a: /\bhands and knees\b|\ball fours\b/i, b: /\blegs (are )?wrapped around (his|him|the man)/i },
  { name: "missionary + from behind", a: /\bmissionary\b/i, b: /\bfrom behind\b/i },
  { name: "nude / naked + worn clothing not pulled aside", a: /\b(fully |completely )?(nude|naked)\b/i, b: /\bwear(s|ing)\b(?![^.]{0,40}\b(pulled|nothing|no)\b)[^.]{0,40}\b(tank top|shorts|jeans|panties|bra|leggings|pants|dress|top)\b/i, unless: /\bexcept\b|\bonly\b/i },
  { name: "POV + the viewer's own body doing her act", a: /\bpov\b|first[- ]person/i, b: /\b(the viewer'?s own|your own) (mouth|breasts|pussy)\b/i },
  { name: "hedge (X or Y about the bodies, perhaps, depending on)", a: /\b(perhaps|possibly|maybe|if any|depending on)\b|\b(thighs|hips|shoulders|closed|on his|her own|standing|sitting|kneeling|bra|robe|underwear)\b[^.,;]{0,12}\bor\b[^.,;]{0,25}\b(hips|thighs|half-lidded|upper|kneeling|sitting|standing|lying|panties|underwear|shorts|robe)\b/i, b: /./ },
  { name: "both hands busy + a third task", a: /\bone hand\b[^.]*\bthe other( hand)?\b[^.]*\b(holding|holds|grips|gripping)\b[^.]*\b(phone|camera)\b/i, b: /\bboth hands\b/i }
];

/** The checks a prose output fails. */
export const flagsFor = (text) => checks.filter((check) => check.a.test(text) && check.b.test(text) && !(check.unless && check.unless.test(text))).map((check) => check.name);

const runs = import.meta.url === pathToFileURL(process.argv[1]).href ? process.argv.slice(2) : [];
let total = 0;
let flagged = 0;
for (const name of runs) {
  const file = path.join(here, "results", name, "runs.jsonl");
  for (const run of fs.readFileSync(file, "utf8").trim().split("\n").map((line) => JSON.parse(line))) {
    if (run.target === "tags" || !run.output) continue;
    total += 1;
    const hits = checks.filter((check) => check.a.test(run.output) && check.b.test(run.output) && !(check.unless && check.unless.test(run.output)));
    if (!hits.length) continue;
    flagged += 1;
    console.log(`\n## ${name} ${run.family}/${run.case}/${run.take} — ${hits.map((hit) => hit.name).join("; ")}\n> ${run.base}\n${run.output}`);
  }
}
console.log(`\n${flagged} of ${total} prose outputs flagged`);
