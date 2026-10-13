// One plain text-to-image run through HEISS, for sanity checks next to the inpaint eval (a model's own
// output quality, Rapid still running after a pack update).
//   node evals/inpaint/t2i-check.mjs <profile id> "<prompt>" <seed> [rapid] [out.png]
import fs from "node:fs";

const heiss = process.env.HEISS_URL || "http://127.0.0.1:8790";
const [profileId, prompt, seed, rapid, out] = process.argv.slice(2);
const { workflows } = await (await fetch(`${heiss}/api/workflows`)).json();
const profile = workflows.find((item) => item.id === profileId);
const body = { kind: "image", workflow: profile.workflow, profileId, prompt, negative: "", width: 1024, height: 1024, seed: String(seed), count: 1, rapid: rapid === "rapid", rapidGuidance: rapid === "rapid" && Number(profile.defaults?.cfg) > 1, referenceAssets: [] };
const startedAt = Date.now();
const started = await (await fetch(`${heiss}/api/generate`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })).json();
if (!started.jobId) throw new Error(JSON.stringify(started));
let job;
do {
  await new Promise((resolve) => setTimeout(resolve, 2000));
  job = await (await fetch(`${heiss}/api/jobs/${started.jobId}`)).json();
} while (!["done", "error", "missing"].includes(job.status));
const { items = [] } = await (await fetch(`${heiss}/api/gallery?limit=8`)).json();
const item = items.find((entry) => entry.jobId === started.jobId);
if (out && item?.url) fs.writeFileSync(out, Buffer.from(await (await fetch(`${heiss}${item.url}`)).arrayBuffer()));
console.log(JSON.stringify({ status: job.status, error: job.error || "", seconds: (Date.now() - startedAt) / 1000, rapid: item?.settings?.rapid, rapidReport: item?.settings?.rapidReport, url: item?.url }));
