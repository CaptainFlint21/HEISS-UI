#!/usr/bin/env node
// Numbers for comparing A/B runs (variants.mjs), to guide reading them, not to replace it:
//   flags     prose outputs with a consistency flag (consistency.mjs), %
//   variety   how alike the takes of one case are (word-set Jaccard, 0 = nothing shared); lower = more varied
//   sameOpen  cases whose takes open with the same 6 words, %
//   keep      detailed inputs: share of their content words still in the output
//   ratio     detailed inputs: output length / input length
//   words     median words
// node evals/enhance/ab.mjs <run> [<run> …]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { flagsFor } from "./consistency.mjs";

process.env.HEISS_DATA_DIR ||= path.join(path.dirname(fileURLToPath(import.meta.url)), "results", ".data");
// Every run is measured with today's cleanup, so variants run before and after a finishPrompt change compare fairly.
const { finishPrompt } = await import("../../server/prompt-enhance.js");

const here = path.dirname(fileURLToPath(import.meta.url));
const stop = new Set("with from that this they them their there then than into onto over under while where which what when your have been were will would could should about above below after before across along around behind between beyond each every some such only very more most much many other another both also just like".split(" "));
const words = (text) => new Set((String(text).toLowerCase().match(/[a-z][a-z'-]{3,}/g) || []).filter((word) => !stop.has(word)));
const jaccard = (a, b) => { const inter = [...a].filter((word) => b.has(word)).length; return inter / (a.size + b.size - inter || 1); };
const median = (list) => { const sorted = [...list].sort((x, y) => x - y); return sorted[sorted.length >> 1] ?? 0; };
const pct = (part, whole) => (whole ? Math.round((100 * part) / whole) : 0);

const rows = [];
for (const name of process.argv.slice(2)) {
  const runs = fs.readFileSync(path.join(here, "results", name, "runs.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line)).filter((run) => run.output)
    .map((run) => (run.target === "tags" ? run : { ...run, output: finishPrompt(run.target, run.output) }));
  const prose = runs.filter((run) => run.target !== "tags");
  const byCase = new Map();
  for (const run of runs) { const key = `${run.family}/${run.case}`; if (!byCase.has(key)) byCase.set(key, []); byCase.get(key).push(run); }
  const sims = [];
  let same = 0;
  let multi = 0;
  for (const takes of byCase.values()) {
    if (takes.length < 2 || takes[0].shape === "detailed") continue;
    multi += 1;
    const sets = takes.map((run) => words(run.output));
    for (let i = 0; i < sets.length; i += 1) for (let j = i + 1; j < sets.length; j += 1) sims.push(jaccard(sets[i], sets[j]));
    const opens = takes.map((run) => run.output.split(/\s+/).slice(0, 6).join(" ").toLowerCase());
    if (new Set(opens).size === 1) same += 1;
  }
  const detailed = runs.filter((run) => run.shape === "detailed");
  const keep = detailed.map((run) => { const input = words(run.base); const out = words(run.output); return [...input].filter((word) => out.has(word)).length / (input.size || 1); });
  const ratio = detailed.map((run) => run.words / (run.base.split(/\s+/).length || 1));
  rows.push({
    run: name, n: runs.length,
    flags: `${pct(prose.filter((run) => flagsFor(run.output).length).length, prose.length)}%`,
    variety: sims.length ? (sims.reduce((a, b) => a + b, 0) / sims.length).toFixed(2) : "-",
    sameOpen: multi ? `${pct(same, multi)}%` : "-",
    keep: keep.length ? (keep.reduce((a, b) => a + b, 0) / keep.length).toFixed(2) : "-",
    ratio: ratio.length ? median(ratio).toFixed(2) : "-",
    words: median(runs.map((run) => run.words)),
    sec: (median(runs.map((run) => run.telemetry.totalMs)) / 1000).toFixed(1)
  });
}
console.table(rows);
