// Inpainting eval: runs each case through HEISS UI's own /api/generate (the
// request the Generate button sends), then the exact A/B: the same ComfyUI
// prompt queued again with HEISS Inpaint Stitch's align and color_match off,
// so ComfyUI reuses the cached sample and only the stitch changes.
//
//   node evals/inpaint/run.mjs --profile <profile id> [--case id,...] [--seeds 101,102] [--out dir]
//        [--feather 0.4] [--strength 0.8] [--count 1] [--size 1024] [--image file] [--hidden]
//
// HEISS_URL (default http://127.0.0.1:8790) and COMFY_URL (http://127.0.0.1:8188).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const here = path.dirname(fileURLToPath(import.meta.url));
const heiss = process.env.HEISS_URL || "http://127.0.0.1:8790";
const comfy = process.env.COMFY_URL || "http://127.0.0.1:8188";
const args = Object.fromEntries(process.argv.slice(2).join(" ").split(/\s*--/).filter(Boolean).map((part) => {
  const [key, ...rest] = part.split(" ");
  return [key, rest.join(" ") || "true"];
}));
const spec = JSON.parse(fs.readFileSync(path.join(here, "cases.json"), "utf8"));
const wanted = args.case ? args.case.split(",") : spec.cases.map((item) => item.id);
const seeds = (args.seeds || "101").split(",").map(Number);
const size = Number(args.size || spec.size);
const out = path.resolve(args.out || path.join(here, "..", "..", "artifacts", "inpaint-verify", "runs"));
fs.mkdirSync(out, { recursive: true });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// --hidden: Hidden's unlock cookie, sent with every HEISS request.
let cookie = "";

async function json(url, options = {}) {
  const headers = { ...(options.headers || {}), ...(cookie && url.startsWith(heiss) ? { cookie } : {}) };
  const response = await fetch(url, { ...options, headers });
  const set = response.headers.getSetCookie?.() || [];
  if (set.length) cookie = set.map((line) => line.split(";")[0]).join("; ");
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); } catch { body = { raw: text }; }
  if (!response.ok) throw new Error(`${options?.method || "GET"} ${url}: ${response.status} ${body.error || text.slice(0, 300)}`);
  return body;
}

/** The case's mask: white ellipse on black, at the image's own size, saved next to the cases. */
async function maskFor(item, width, height) {
  const { cx, cy, rx, ry } = item.mask;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="black"/><ellipse cx="${cx * width}" cy="${cy * height}" rx="${rx * width}" ry="${ry * height}" fill="white"/></svg>`;
  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  fs.mkdirSync(path.join(here, "masks"), { recursive: true });
  fs.writeFileSync(path.join(here, "masks", `${item.id}.png`), png);
  return png;
}

async function upload(file) {
  const form = new FormData();
  form.append("image",new Blob([fs.readFileSync(file)], { type: file.endsWith(".png") ? "image/png" : "image/jpeg" }), path.basename(file));
  // The studio's own header: HEISS takes multipart posts only from its page.
  return (await json(`${heiss}/api/reference-assets/upload`, { method: "POST", body: form, headers: { "x-heiss": "1" } })).asset;
}

async function comfyLogSince(marker) {
  const { entries } = await json(`${comfy}/internal/logs/raw`);
  const text = entries.map((entry) => entry.m).join("");
  const at = marker ? text.lastIndexOf(marker) : -1;
  return at >= 0 ? text.slice(at + marker.length) : text;
}

async function historyFor(match) {
  const all = await json(`${comfy}/history?max_items=40`);
  return Object.entries(all).map(([id, entry]) => ({ id, ...entry })).reverse().find(match) || null;
}

async function images(entry) {
  const found = [];
  for (const output of Object.values(entry.outputs || {})) {
    for (const image of output.images || []) {
      const query = new URLSearchParams({ filename: image.filename, subfolder: image.subfolder || "", type: image.type || "output" });
      found.push(Buffer.from(await (await fetch(`${comfy}/view?${query}`)).arrayBuffer()));
    }
  }
  return found;
}

async function waitForPrompt(id, timeoutMs = 20 * 60 * 1000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const entry = (await json(`${comfy}/history/${id}`))[id];
    if (entry?.status?.completed || entry?.status?.status_str === "error") return entry;
    await sleep(1500);
  }
  throw new Error(`ComfyUI prompt ${id} didn't finish`);
}

/** The run's own prompt again, stitch corrections off, saved as previews (temp) so nothing lands in output/. */
async function stitchOff(entry) {
  const graph = structuredClone(entry.prompt[2]);
  const stitch = Object.values(graph).find((node) => node.class_type === "HeissInpaintStitch");
  if (!stitch) return null;
  stitch.inputs.align = false;
  stitch.inputs.color_match = false;
  for (const node of Object.values(graph)) {
    if (/^SaveImage/.test(node.class_type)) {
      node.class_type = "PreviewImage";
      node.inputs = { images: node.inputs.images };
    }
  }
  const marker = `[eval ${Date.now()}]`;
  const startedAt = Date.now();
  const queued = await json(`${comfy}/prompt`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt: graph, client_id: "heiss-inpaint-eval" }) });
  const done = await waitForPrompt(queued.prompt_id);
  const executed = (done.status?.messages || []).filter(([type]) => type === "execution_cached").flatMap(([, data]) => data.nodes || []);
  return { entry: done, seconds: (Date.now() - startedAt) / 1000, cachedNodes: executed.length, totalNodes: Object.keys(graph).length, marker, stitch: { x: stitch.inputs.x, y: stitch.inputs.y } };
}

/** Both results side by side, cropped around the paint and drawn at 2x. */
async function sideBySide(onBuffer, offBuffer, item, file) {
  const meta = await sharp(onBuffer).metadata();
  const { cx, cy, rx, ry } = item.mask;
  const pad = 1.35;
  const left = Math.max(0, Math.round((cx - rx * pad) * meta.width));
  const top = Math.max(0, Math.round((cy - ry * pad) * meta.height));
  const width = Math.min(meta.width - left, Math.round(2 * rx * pad * meta.width));
  const height = Math.min(meta.height - top, Math.round(2 * ry * pad * meta.height));
  const scale = Math.min(2, 900 / Math.max(width, height) * 1);
  const panel = async (buffer) => sharp(buffer).extract({ left, top, width, height }).resize(Math.round(width * scale), Math.round(height * scale), { kernel: "nearest" }).png().toBuffer();
  const [a, b] = await Promise.all([panel(onBuffer), panel(offBuffer)]);
  const w = Math.round(width * scale);
  const h = Math.round(height * scale);
  const label = (text) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="28"><rect width="100%" height="100%" fill="black"/><text x="8" y="20" font-family="Arial" font-size="16" fill="white">${text}</text></svg>`);
  await sharp({ create: { width: w * 2 + 8, height: h + 28, channels: 3, background: "#808080" } })
    .composite([{ input: label("stitch on (align + colour)"), left: 0, top: 0 }, { input: a, left: 0, top: 28 }, { input: label("stitch off (plain blend)"), left: w + 8, top: 0 }, { input: b, left: w + 8, top: 28 }])
    .png().toFile(file);
}

async function compareOutside(sourceFile, resultBuffer) {
  // Pixels outside the painted area's whole repaint box must be the original's exactly; checked outside the box only.
  const src = await sharp(sourceFile).rotate().removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const res = await sharp(resultBuffer).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  if (src.info.width !== res.info.width || src.info.height !== res.info.height) return { sizeMatch: false, source: `${src.info.width}x${src.info.height}`, result: `${res.info.width}x${res.info.height}` };
  return { sizeMatch: true, data: { src, res } };
}

async function runOne(item, seed, profile) {
  const file = path.join(here, "images", args.image || item.image);
  const meta = await sharp(file).rotate().metadata();
  const mask = await maskFor(item, meta.width, meta.height);
  const asset = await upload(file);
  const body = {
    kind: "image",
    workflow: profile.workflow,
    profileId: profile.id,
    prompt: item.prompt,
    negative: "",
    width: size,
    height: size,
    seed: String(seed),
    count: Number(args.count || 1),
    referenceAssets: [{ slot: "reference", assetId: asset.id }],
    referenceRole: "edit",
    inpaint: { mask: `data:image/png;base64,${mask.toString("base64")}`, feather: Number(args.feather ?? 0.4), ...(args.strength ? { strength: Number(args.strength) } : {}) },
    privateVault: Boolean(args.hidden),
    clientJobId: `eval-${item.id}-${seed}-${Date.now()}`
  };
  const startedAt = Date.now();
  const started = await json(`${heiss}/api/generate`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  let job;
  for (;;) {
    await sleep(2000);
    job = await json(`${heiss}/api/jobs/${started.jobId}`);
    if (["done", "error", "missing"].includes(job.status)) break;
    if (Date.now() - startedAt > 30 * 60 * 1000) throw new Error("HEISS job timed out");
  }
  const seconds = (Date.now() - startedAt) / 1000;
  const result = { case: item.id, seed, profile: profile.id, status: job.status, error: job.error || "", seconds, notice: started.notice || "" };
  if (job.status !== "done") return result;
  const entry = await historyFor((candidate) => candidate.prompt?.[3]?.client_id === started.jobId);
  if (!entry) return { ...result, error: "no ComfyUI history for the job" };
  const log = (await comfyLogSince("")).split("\n").filter((line) => line.includes("[HEISS Inpaint Stitch]") || line.includes("[HEISS] Inpaint"));
  result.console = log.slice(-Math.max(1, body.count)).join(" | ");
  // The picture's details as the gallery keeps them: the Seam line and the box HEISS cropped.
  const gallery = (await json(`${heiss}/api/${args.hidden ? "hidden/gallery" : "gallery"}?limit=12`)).items || [];
  const saved = gallery.find((entryItem) => entryItem.jobId === started.jobId) || gallery[0];
  result.seam = saved?.settings?.inpaintSeam || "";
  const box = saved?.settings?.inpaint?.box;
  result.graphTail = Object.values(entry.prompt[2]).map((node) => node.class_type).filter((type) => /Stitch|Composite|ImageScale/.test(type));
  const onImages = await images(entry);
  const base = `${profile.family || "model"}-${item.id}-s${seed}`;
  onImages.forEach((buffer, index) => fs.writeFileSync(path.join(out, `${base}-on${index ? `-${index}` : ""}.png`), buffer));
  const outside = await compareOutside(file, onImages[0]);
  if (outside.sizeMatch) {
    const { src, res } = outside.data;
    const { x: x0 = 0, y: y0 = 0, width: bw = 0, height: bh = 0 } = box || {};
    let changed = 0;
    let maxDiff = 0;
    const channels = src.info.channels;
    for (let y = 0; y < src.info.height; y += 1) {
      for (let x = 0; x < src.info.width; x += 1) {
        if (x >= x0 && x < x0 + bw && y >= y0 && y < y0 + bh) continue;
        const i = (y * src.info.width + x) * channels;
        const d = Math.max(Math.abs(src.data[i] - res.data[i]), Math.abs(src.data[i + 1] - res.data[i + 1]), Math.abs(src.data[i + 2] - res.data[i + 2]));
        if (d) changed += 1;
        if (d > maxDiff) maxDiff = d;
      }
    }
    result.outsideBox = { box: { x: x0, y: y0, width: bw, height: bh }, changedPixels: changed, maxDiff };
  } else {
    result.outsideBox = outside;
  }
  if (!args.noab) {
    const ab = await stitchOff(entry);
    if (ab) {
      const offImages = await images(ab.entry);
      offImages.forEach((buffer, index) => fs.writeFileSync(path.join(out, `${base}-off${index ? `-${index}` : ""}.png`), buffer));
      const abLog = (await comfyLogSince("")).split("\n").filter((line) => line.includes("[HEISS Inpaint Stitch]") || line.includes("Prompt executed in"));
      result.ab = { seconds: ab.seconds, cached: `${ab.cachedNodes}/${ab.totalNodes}`, executedIn: abLog.filter((line) => line.includes("Prompt executed in")).slice(-1)[0]?.trim() || "", console: abLog.filter((line) => line.includes("[HEISS Inpaint Stitch]")).slice(-1)[0]?.trim() || "" };
      if (offImages[0]) await sideBySide(onImages[0], offImages[0], item, path.join(out, `${base}-ab.png`));
    }
  }
  return result;
}

if (args.hidden) {
  // A password for this eval's own HEISS data folder only: set it up the first time, unlock after.
  const password = process.env.EVAL_HIDDEN_PASSWORD || "heiss-inpaint-eval-only";
  const status = await json(`${heiss}/api/privacy/status`);
  const route = status.enabled ? "unlock" : "setup";
  await json(`${heiss}/api/privacy/${route}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password }) });
}
const { workflows } = await json(`${heiss}/api/workflows`);
const profile = workflows.find((item) => item.id === args.profile);
if (!profile) throw new Error(`No profile ${args.profile}`);
const results = [];
for (const id of wanted) {
  const item = spec.cases.find((entry) => entry.id === id);
  for (const seed of seeds) {
    let result;
    try {
      result = await runOne(item, seed, profile);
    } catch (error) {
      result = { case: id, seed, profile: profile.id, status: "harness-error", error: error.message };
    }
    console.log(JSON.stringify(result));
    results.push(result);
    fs.appendFileSync(path.join(out, "results.jsonl"), `${JSON.stringify({ at: new Date().toISOString(), args, ...result })}\n`);
  }
}
