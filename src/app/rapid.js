// HEISS Rapid in the composer (docs/rapid.md): what the next run asks for, and
// what the composer says about it. Rapid is two parts, switched on and off on
// their own: the half-size start (HeissRapid) and Rapid Guidance
// (HeissRapidGuidance: CFG only while the noise is high). Plain JavaScript so
// `node --test` can check it without a build step; types in rapid.d.ts.
//
// Both change how a seed comes out, so a fixed seed and Rapid only go together
// when the seed came from a picture made with Rapid ("Use settings"): then the
// same picture comes back. A seed you typed, or one from a picture made
// without Rapid, makes the run without it. A random seed always gets it.

/**
 * @param {{ capabilities?: Record<string, boolean> } | null | undefined} profile
 * @param {{ rapidAll?: boolean, rapid?: boolean, rapidGuidance?: boolean }} prefs (rapidAll: the whole of Rapid)
 * @param {string} seed the composer's seed ("" is random)
 * @param {string} rapidSeed the seed "Use settings" restored from a Rapid picture, or ""
 * @param {{ kind?: string, startImage?: boolean, inpaint?: boolean, cfg?: number }} [run]
 * @returns {{ use: boolean, guidance: boolean, status: string }}
 */
export function rapidState(profile, prefs, seed, rapidSeed, run = {}) {
  const capabilities = profile?.capabilities || {};
  const off = (status) => ({ use: false, guidance: false, status });
  if (run.kind === "video" || (!capabilities.rapid && !capabilities.rapidGuidance && !capabilities.rapidInstall)) return off("model");
  if (!capabilities.rapid && !capabilities.rapidGuidance) return off("install");
  if (prefs?.rapidAll === false) return off("off");
  const startOn = Boolean(capabilities.rapid) && prefs?.rapid !== false;
  const guidanceOn = Boolean(capabilities.rapidGuidance) && prefs?.rapidGuidance !== false;
  if (!startOn && !guidanceOn) return off("parts");
  const fixed = String(seed || "").trim();
  if (fixed && fixed !== String(rapidSeed || "").trim()) return off("seed");
  // A start picture or a mask sets the layout itself; guidance only saves where there is CFG to save.
  const use = startOn && !run.startImage && !run.inpaint;
  // Guidance too only from noise: a low-strength start image would begin below its cut-off.
  const guidance = guidanceOn && Number(run.cfg ?? 2) > 1 && !run.startImage && !run.inpaint;
  if (use || guidance) return { use, guidance, status: "on" };
  if ((startOn || guidanceOn) && (run.startImage || run.inpaint)) return off("image");
  // What's left is guidance at CFG 1: say so, unless the half-size start would have applied but is switched off.
  return off(capabilities.rapid && prefs?.rapid === false && !run.startImage && !run.inpaint ? "parts" : "idle");
}

/** The composer's word for it. */
export function rapidLabel(status) {
  return {
    on: "On",
    off: "Off",
    seed: "Off while the seed is fixed",
    image: "Off with a start image",
    idle: "Nothing to speed up at CFG 1",
    parts: "Its parts are off in Settings",
    install: "Needs the HEISS UI Nodes",
    model: "Not for this model"
  }[status] || "";
}

/** The seed "Use settings" should remember for Rapid: the picture's own, when Rapid made it. */
export function rapidSeedFrom(settings, { vary = false } = {}) {
  if (vary || !(settings?.rapid || settings?.rapidGuidance)) return "";
  const seed = String(settings.seed || "").trim();
  return /^\d+$/.test(seed) ? seed : "";
}

const SPEED_LABELS = { careful: "Careful", faster: "Faster" };
const level = (value) => Number(value).toFixed(2).replace(/0$/, "");

/**
 * The details panel's Rapid section: whether each part ran on this picture and
 * with which settings, as [label, value] rows (empty when Rapid had no part in it).
 * @param {Record<string, unknown> | null | undefined} settings the picture's recorded settings
 * @returns {Array<[string, string]>}
 */
export function rapidDetails(settings) {
  const s = settings || {};
  /** @type {Array<[string, string]>} */
  const rows = [];
  if (s.rapid && Number(s.rapidCache) > 0) {
    // Step reuse (ComfyUI's EasyCache) instead of the half-size start, for the models that one breaks.
    rows.push(["Step reuse", Number(s.rapidCacheFrom) > 0 ? `From ${Math.round(Number(s.rapidCacheFrom) * 100)}% of the steps` : "On"]);
  } else if (s.rapid) {
    const small = Number(s.rapidSmallSteps);
    const full = Number(s.rapidFullSteps);
    // From the node's own report where there is one; older pictures only have what was asked for.
    rows.push(["Half-size start", small > 0 && full >= 0 ? `${small} of ${small + full} steps at half size` : "On"]);
    const at = Number(s.rapidSwitchNoise) || Number(s.rapidAt);
    if (at > 0) rows.push(["Switched at", `noise ${level(at)}${s.rapidSwitchNoise && s.rapidAt && level(s.rapidSwitchNoise) !== level(s.rapidAt) ? ` (asked ${level(s.rapidAt)})` : ""}`]);
    if (typeof s.rapidSmooth === "boolean") rows.push(["Smoothing step", s.rapidSmooth ? "On" : "Off"]);
  } else if (s.rapidSkipped) {
    rows.push(["Half-size start", `Skipped: ${s.rapidSkipped}`]);
  }
  if (s.rapidGuidance) {
    const until = Number(s.rapidCfgUntil);
    rows.push(["Lighter guidance", Number.isFinite(until) && s.rapidCfgUntil !== undefined && s.rapidCfgUntil !== null ? `CFG until noise ${level(until)}` : "On"]);
  }
  if (rows.length && (s.rapid || s.rapidGuidance)) rows.push(["Speed", SPEED_LABELS[String(s.rapidSpeed)] || "Balanced"]);
  return rows;
}
