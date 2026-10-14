#!/usr/bin/env node
// Prints a run's outputs for reading: node evals/enhance/show.mjs <name> [family-or-case …]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const [name, ...filters] = process.argv.slice(2);
const file = path.join(path.dirname(fileURLToPath(import.meta.url)), "results", name, "runs.jsonl");
for (const run of fs.readFileSync(file, "utf8").trim().split("\n").map((line) => JSON.parse(line))) {
  if (filters.length && !filters.some((f) => f === run.family || f === run.case)) continue;
  const t = run.telemetry;
  console.log(`\n## ${run.family}/${run.case} · ${run.words}w · ${t.tokens}tok${t.hitCap ? " · CAP" : ""}\n> ${run.base}\n${run.error ? `ERROR ${run.error}` : run.output}`);
}
