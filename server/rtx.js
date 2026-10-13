import { comfy, hasNode, missingNodes } from "./comfy.js";
import { gpuKind } from "./hardware.js";
import { nodePack, nodePacks } from "./node-packs.js";

/**
 * RTX video upscaling (docs/rtx-video.md): NVIDIA's RTX Video Super Resolution
 * and Frame Generation through HEISS RTX Video, from HEISS's own node pack.
 * NVIDIA RTX cards only. Seconds where SeedVR2 takes minutes, because it
 * sharpens what is there instead of drawing new detail, so it is the upscaler
 * for video, and SeedVR2 stays the one for pictures.
 *
 * Getting it ready takes two parts, each with the usual install panel:
 *   nodes   - HEISS UI Nodes at a commit with HEISS RTX Video (`heiss`)
 *   package - NVIDIA's nvidia-vfx in ComfyUI's Python (`heissrtx`, ~0.5 GB)
 * (restart  - an old nvidia-vfx that ComfyUI has loaded on Windows, whose files stay
 *             locked until ComfyUI restarts: updating it then would leave it half removed)
 * and the pack's own check (GET /heiss/rtx/status) says whether it runs here.
 */

export const RTX_NODE = "HeissRTXVideo";

/** The two tabs; each aims the short side at its size, at 1x to 4x. */
export const rtxTiers = {
  "2k": { label: "2K", short: 1440 },
  "4k": { label: "4K", short: 2160 }
};
const MAX_SCALE = 4;
const MAX_SIDE = 8192;

/**
 * Fresh frames from a run are clean: the high-bitrate model keeps them that
 * way. A file from the gallery has been through H.264 once: the standard
 * model also clears what the encoder left.
 */
const QUALITY = { run: "HIGHBITRATE_HIGH", file: "HIGH" };

/** The scale for a tier: 2K/4K by the short side, clamped to what VSR does (1x-4x, 8192 per side). */
export function rtxScale(tier, width, height) {
  const target = rtxTiers[tier];
  const w = Number(width) || 0;
  const h = Number(height) || 0;
  if (!target || !w || !h) return 0;
  const byShort = target.short / Math.min(w, h);
  const bySide = MAX_SIDE / Math.max(w, h);
  return Math.round(Math.max(1, Math.min(MAX_SCALE, byShort, bySide)) * 100) / 100;
}

/** Its output, as the node computes it: each side rounded to a multiple of 8. */
export function rtxOutputSize(width, height, scale) {
  const round8 = (value) => Math.max(8, Math.round((Number(value) * scale) / 8) * 8);
  return { width: round8(width), height: round8(height) };
}

/** Smoothing doubles the frames; it takes Frame Generation, an RTX 40-series card or newer. */
export function rtxSmooth(value, frameGeneration) {
  return value && frameGeneration ? 2 : 1;
}

/**
 * Whether this machine can run it and, if not, what's missing. `offered` is
 * false on anything but an NVIDIA card, and then nothing anywhere mentions it.
 * `device` is ComfyUI's /system_stats device; `check` the pack's own answer.
 */
export function rtxStatusFrom({ info = {}, device = null, check = null, nodesReady } = {}) {
  const kind = device ? gpuKind(device) : "";
  const nodes = missingNodes(info, nodePacks.heissrtx.nodes);
  // The pack's version decides when it's known (heiss-nodes.js); node names alone otherwise.
  const nodesInstalled = typeof nodesReady === "boolean" ? nodesReady : !nodes.length;
  const offered = kind === "nvidia" || Boolean(check?.device);
  const base = { offered, nodesInstalled, missingNodes: nodes, packageInstalled: Boolean(check?.nvvfx) && !check?.nvvfxTooOld, ready: false, frameGeneration: Boolean(check?.frameGeneration), device: check?.device || null, torch: check?.torch || "", cuda: check?.cuda || "", reason: "" };
  if (!offered) return { ...base, stage: "unsupported", reason: kind === "apple" ? "RTX upscaling needs an NVIDIA RTX card; Macs don't have one." : "RTX upscaling needs an NVIDIA RTX card." };
  if (!nodesInstalled) return { ...base, stage: "nodes", reason: "ComfyUI needs the newest HEISS UI Nodes for RTX upscaling." };
  if (!check) return { ...base, stage: "checking", reason: "ComfyUI didn't answer the RTX check." };
  if (!check.nvvfx) return { ...base, stage: "package", reason: "NVIDIA's RTX video package isn't installed in ComfyUI yet." };
  // An install from before 0.2 (no ImageEncoding): the package step again, whose pip -r upgrades it.
  if (check.nvvfxTooOld && check.nvvfxLocked) return { ...base, stage: "restart", reason: "NVIDIA's RTX video package is too old, and ComfyUI has it loaded, which keeps its files locked on Windows. Restart ComfyUI, then update it here." };
  if (check.nvvfxTooOld) return { ...base, stage: "package", reason: check.reason || "NVIDIA's RTX video package is too old; 0.2 or newer is needed." };
  if (!check.ready) return { ...base, stage: "error", reason: check.reason || "RTX upscaling can't run here." };
  return { ...base, ready: true, stage: "ready" };
}

/** Asks the pack itself; null when ComfyUI doesn't have it (yet) or doesn't answer. */
export async function rtxCheck({ probe = false } = {}) {
  try {
    return await comfy(`/heiss/rtx/status${probe ? "?probe=1" : ""}`, { signal: AbortSignal.timeout(probe ? 60_000 : 8000) });
  } catch {
    return null;
  }
}

/** ComfyUI's address for a file it saved, from a gallery item's /comfy/view URL: "sub/name.mp4 [output]". */
export function comfyOutputName(url = "") {
  const query = String(url).split("?")[1] || "";
  const params = new URLSearchParams(query);
  const filename = params.get("filename") || "";
  if (!filename || /[\\/]|\.\./.test(filename)) return "";
  const subfolder = (params.get("subfolder") || "").replace(/\\/g, "/");
  if (subfolder.split("/").some((part) => part === "..")) return "";
  const type = params.get("type") || "output";
  if (!["output", "input", "temp"].includes(type)) return "";
  return `${subfolder ? `${subfolder}/` : ""}${filename} [${type}]`;
}

function rtxInputs({ video, scale, quality, smooth }) {
  return { video, scale, quality, strength: 1, cleanup: "none", smooth, filename_prefix: "heiss-ui/upscale", smooth_mode: "MEDIUM", cleanup_strength: 1 };
}

/** The plan both kinds of run share: what comes out, for the tile and the time estimate. */
function planFor({ tier, width, height, frames = 0, smooth = 1, quality }) {
  const scale = rtxScale(tier, width, height);
  const size = rtxOutputSize(width, height, scale);
  return { quality: "rtx", tier, scale, smooth, rtxQuality: quality, model: `rtx-vsr${smooth > 1 ? "+fg" : ""}`, estimatedWidth: size.width, estimatedHeight: size.height, frames: frames ? (frames - 1) * smooth + 1 : 0 };
}

/** A gallery video's upscale: Load Video reads ComfyUI's own copy, HEISS RTX Video writes the result. */
export function rtxVideoGraph({ source, tier = "2k", width, height, frames = 0, smooth = 1 }) {
  if (!source) throw new Error("ComfyUI no longer has this video's file, so it can't be upscaled.");
  const plan = planFor({ tier, width, height, frames, smooth, quality: QUALITY.file });
  if (!plan.scale) throw new Error("This video's size is unknown, so it can't be upscaled.");
  const graph = {
    "1": { class_type: "LoadVideo", inputs: { file: source } },
    "2": { class_type: RTX_NODE, inputs: rtxInputs({ video: ["1", 0], scale: plan.scale, quality: QUALITY.file, smooth }), _meta: { title: "RTX upscale", heissUpscale: true } }
  };
  return { graph, plan };
}

/**
 * RTX upscaling inside a video run, like Smart upscale for pictures: HEISS RTX
 * Video takes the same VIDEO each Save Video gets, so the original is saved
 * first and a stopped or failed upscale still leaves it. Returns the graph and
 * which save each upscale belongs to, or null when the run saves no video.
 */
export function embedRtxVideo(graph, { tier, width, height, frames = 0, smooth = 1 }, { phase = "" } = {}) {
  const saves = Object.entries(graph || {}).filter(([, node]) => node?.class_type === "SaveVideo" && Array.isArray(node.inputs?.video));
  if (!saves.length) return null;
  const plan = planFor({ tier, width, height, frames, smooth, quality: QUALITY.run });
  if (!plan.scale) return null;
  const next = { ...graph };
  const pairs = saves.map(([saveId, save], index) => {
    const id = `heiss_rtx${index}`;
    next[id] = { class_type: RTX_NODE, inputs: rtxInputs({ video: save.inputs.video, scale: plan.scale, quality: QUALITY.run, smooth }), _meta: { title: "RTX upscale", heissUpscale: true, ...(phase ? { heissPhase: phase } : {}) } };
    return { base: saveId, upscale: id };
  });
  return { graph: next, pairs, plan };
}

/**
 * What a video run asked for (`rtxVideo: { tier, smooth }`) checked against
 * what this machine can do: the run's own `{ skipped }` reason, or the embed.
 */
export function planRunRtx(graph, body, status) {
  const tier = rtxTiers[body.rtxVideo?.tier] ? body.rtxVideo.tier : "";
  const label = tier ? rtxTiers[tier].label : "";
  if (!tier) return null;
  if (!status?.ready) return { skipped: status?.reason || "RTX upscaling isn't ready", quality: "rtx" };
  const smooth = rtxSmooth(body.rtxVideo.smooth, status.frameGeneration);
  const embedded = embedRtxVideo(graph, { tier, width: body.width, height: body.height, frames: Number(body.frames || 0), smooth }, { phase: `Upscaling to ${label}` });
  if (!embedded) return { skipped: "This workflow saves no video for RTX upscaling to work on", quality: "rtx" };
  return { ...embedded, quality: "rtx", label };
}

export { nodePack };

/** True when ComfyUI's node list has HEISS RTX Video, whatever NVIDIA's package says. */
export function hasRtxNode(info) {
  return hasNode(info, RTX_NODE);
}
