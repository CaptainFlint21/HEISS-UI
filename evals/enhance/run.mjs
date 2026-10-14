#!/usr/bin/env node
// Prompt-enhance eval (RUBRIC.md): base prompts through the app's own enhancer,
// the way /api/enhance runs them (enhancePlan → runEnhance → finishPrompt),
// into results/<name>/: runs.jsonl (every run with its timing) and outputs.md
// (base and enhanced side by side, for reading).
//
//   node evals/enhance/run.mjs [--name baseline] [--families krea2,pony] [--cases office,motel]
//                              [--repeat 2] [--model <file>] [--creativity 0.7] [--seed random]
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
// The enhancer reads its settings from the data folder; the eval keeps out of the app's own.
process.env.HEISS_DATA_DIR ||= path.join(here, "results", ".data");
const { comfyUrl } = await import("../../server/comfy.js");
const { enhanceDefaults, enhanceModel, enhancePlan, finishPrompt, runEnhance } = await import("../../server/prompt-enhance.js");

const args = {};
process.argv.slice(2).forEach((arg, i, all) => { if (arg.startsWith("--")) args[arg.slice(2)] = all[i + 1]?.startsWith("--") ? "1" : all[i + 1] ?? "1"; });
const list = (value) => (value ? value.split(",") : null);

const cases = JSON.parse(fs.readFileSync(path.join(here, args.file || "cases.json"), "utf8"));
const families = list(args.families) || Object.keys(cases.families);
const only = list(args.cases);
const settings = { ...enhanceDefaults, creativity: args.creativity ? Number(args.creativity) : enhanceDefaults.creativity };
const info = await fetch(`${comfyUrl}/object_info/CLIPLoader`).then((r) => r.json());
const model = args.model || enhanceModel(info, settings);
if (!model) throw new Error("ComfyUI lists no enhancer model.");

const name = args.name || new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
const out = path.join(here, "results", name);
fs.mkdirSync(out, { recursive: true });
const jsonl = path.join(out, "runs.jsonl");
const vram = () => { try { return Number(execFileSync("nvidia-smi", ["--query-gpu=memory.used", "--format=csv,noheader,nounits"], { encoding: "utf8" }).trim()); } catch { return null; } };

const jobs = families.flatMap((key) => [...cases.shared, ...(cases.own[key] || [])]
  .filter((item) => !only || only.includes(item.id))
  .flatMap((item) => Array.from({ length: Number(args.repeat) || 1 }, (_, i) => ({ key, item, take: i + 1 }))));
console.log(`${jobs.length} runs · ${model} · creativity ${settings.creativity} → results/${name}`);

for (const [index, { key, item, take }] of jobs.entries()) {
  const fam = cases.families[key];
  const plan = enhancePlan({ kind: "image", family: fam.family, variant: fam.variant, text: item.prompt }, settings);
  // Fixed per case unless asked otherwise, so a change to the enhancer is compared on the same seeds.
  const seed = args.seed === "random" ? crypto.randomInt(0, 2 ** 31) : crypto.createHash("sha1").update(`${key}/${item.id}/${take}`).digest().readUInt32BE(0) >>> 1;
  const at = {};
  let stats = null;
  let raw = "";
  let error;
  const vramBefore = vram();
  const t0 = performance.now();
  try {
    raw = await runEnhance({ model, ...plan, seed }, {
      emit: (event) => { at[event.type] ??= Math.round(performance.now() - t0); if (event.stats) stats = event.stats; }
    });
  } catch (failure) {
    error = failure.message;
  }
  const output = finishPrompt(plan.target, raw, fam.family);
  const run = {
    family: key, case: item.id, take, nsfw: item.nsfw, shape: item.shape, target: plan.target, base: item.prompt, output, raw: raw !== output ? raw : undefined, error,
    words: output.split(/\s+/).filter(Boolean).length,
    telemetry: {
      model, seed, temperature: plan.temperature, maxTokens: plan.maxTokens, systemChars: plan.system.length,
      queuedMs: at.queued, startMs: at.loading, firstTextMs: at.text, totalMs: Math.round(performance.now() - t0),
      tokens: stats?.tokens, nodeSeconds: stats?.seconds, tokensPerSecond: stats?.tokens ? +(stats.tokens / stats.seconds).toFixed(1) : undefined,
      hitCap: stats?.tokens >= plan.maxTokens - 1, vramBefore, vramAfter: vram()
    },
    at: new Date().toISOString()
  };
  fs.appendFileSync(jsonl, `${JSON.stringify(run)}\n`);
  const t = run.telemetry;
  console.log(`[${index + 1}/${jobs.length}] ${key}/${item.id} ${run.words}w ${t.tokens ?? "?"}tok ${t.tokensPerSecond ?? "?"}/s first ${t.firstTextMs ?? "?"}ms total ${t.totalMs}ms${t.hitCap ? " CAP" : ""}${error ? ` ERROR ${error}` : ""}`);
}

// For reading: every run of this name so far, by family.
const runs = fs.readFileSync(jsonl, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
const md = [`# ${name}`, "", `${model} · creativity ${settings.creativity}`, ""];
for (const key of [...new Set(runs.map((run) => run.family))]) {
  md.push(`## ${cases.families[key].label}`, "");
  for (const run of runs.filter((r) => r.family === key)) {
    const t = run.telemetry;
    md.push(`### ${run.case}${run.take > 1 ? ` (take ${run.take})` : ""} · ${run.shape}${run.nsfw ? " · nsfw" : ""} · ${run.target}`, "", `> ${run.base}`, "", run.error ? `**Error:** ${run.error}` : run.output, "", `<sub>${run.words} words · ${t.tokens} tokens · ${t.tokensPerSecond} tok/s · first words ${t.firstTextMs} ms · ${t.totalMs} ms${t.hitCap ? " · hit token cap" : ""}</sub>`, "");
  }
}
fs.writeFileSync(path.join(out, "outputs.md"), md.join("\n"));
process.exit(0);
