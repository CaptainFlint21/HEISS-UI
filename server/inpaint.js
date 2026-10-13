import { bytesForReference, uploadBufferToComfy } from "./reference-assets.js";
import { loadSharp } from "./sharp-loader.js";

/**
 * Inpainting: change only the part of a reference image the user painted.
 *
 * The model never sees the whole picture. HEISS crops the painted area with a
 * band of context around it, the graph regenerates that crop with a latent
 * noise mask (so only the painted part is repainted), and ImageCompositeMasked
 * lays the result back onto the original pixels as ComfyUI loaded them. The
 * rest of the image is never VAE encoded or decoded, so it stays exact.
 */

// The nodes every inpaint graph needs on top of the family's own; all are ComfyUI core.
export const inpaintNodes = ["SetLatentNoiseMask", "LoadImageMask", "ImageScale", "ImageCompositeMasked", "RepeatImageBatch", "RepeatLatentBatch", "SplitSigmasDenoise"];

// HEISS UI Nodes' stitch: lines the result up and matches its colour on the ring around the
// mask before it goes back in. Without it the stitch is ComfyUI's plain ImageCompositeMasked.
export const inpaintStitchNode = "HeissInpaintStitch";

const maxMaskBytes = 16 * 1024 * 1024;
// Below this a painted pixel is a stray brush edge, not part of the mask.
const maskThreshold = 26;
const contextFactor = 1.6;
const minContext = 512;
const snap = 16;
// Past this share of the picture, cropping saves nothing: work on the whole image.
const wholeImageShare = 0.7;

/** The painted pixels' bounding box in a one-channel buffer, or null when nothing was painted. */
export function maskBounds(data, width, height, threshold = maskThreshold) {
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    for (let x = 0; x < width; x += 1) {
      if (data[row + x] < threshold) continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }
  return right < 0 ? null : { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
}

function snapUp(value, step = snap) {
  return Math.ceil(value / step) * step;
}

/**
 * Where to crop and how big to sample. The box is the painted area grown by a
 * band of context, at least `minContext` a side, kept inside the image; its
 * size snaps to 16 so model and mask stay aligned. The working size is the box
 * scaled to the pixel count the user picked, also on the 16 grid.
 */
export function inpaintGeometry({ imageWidth, imageHeight, bounds, targetPixels }) {
  const sideFor = (painted, limit) => {
    const grown = Math.max(painted * contextFactor, Math.min(minContext, limit));
    return Math.min(limit, snapUp(grown));
  };
  let width = sideFor(bounds.width, imageWidth);
  let height = sideFor(bounds.height, imageHeight);
  const whole = width * height >= imageWidth * imageHeight * wholeImageShare;
  if (whole) {
    width = imageWidth;
    height = imageHeight;
  }
  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + bounds.height / 2;
  const x = whole ? 0 : Math.round(Math.min(Math.max(0, centerX - width / 2), imageWidth - width));
  const y = whole ? 0 : Math.round(Math.min(Math.max(0, centerY - height / 2), imageHeight - height));
  const pixels = Math.max(256 * 256, Number(targetPixels) || 1024 * 1024);
  const scale = Math.sqrt(pixels / (width * height));
  const workWidth = Math.max(snap * 16, Math.round(width * scale / snap) * snap);
  const workHeight = Math.max(snap * 16, Math.round(height * scale / snap) * snap);
  return { box: { x, y, width, height }, work: { width: workWidth, height: workHeight } };
}

/**
 * How far the repainted area reaches past the paint, and how wide the seam is,
 * in image pixels, from the painted area's size and the 0–1 "edge softness"
 * setting (after Krita AI's defaults: a feather of 10 % of the painted area's
 * diagonal, at least 32 px, and a grow of 4 px plus half of it). The seam sits
 * entirely on repainted pixels, outside the paint, so the paint itself is
 * always fully replaced.
 */
export function inpaintEdges(bounds, softness) {
  const feather = Math.max(0.1 * Math.hypot(bounds.width, bounds.height), 32);
  const grow = Math.round(4 + feather / 2);
  const blend = Math.round(grow * 1.25 * Math.min(1, Math.max(0, Number(softness) || 0)));
  return { grow, blend };
}

/**
 * A square max filter of a one-channel buffer by `radius` pixels (van Herk /
 * Gil-Werman: a few comparisons a pixel whatever the radius). Outside the
 * buffer counts as 0.
 */
export function dilateMask(data, width, height, radius) {
  const r = Math.max(0, Math.round(radius));
  if (!r) return Uint8Array.from(data);
  const k = 2 * r + 1;
  const longest = Math.max(width, height);
  const padded = new Uint8Array(longest + 2 * r);
  const ahead = new Uint8Array(padded.length);
  const behind = new Uint8Array(padded.length);
  const line = (read, write, n) => {
    padded.fill(0);
    for (let i = 0; i < n; i += 1) padded[i + r] = read(i);
    const m = n + 2 * r;
    for (let i = 0; i < m; i += 1) ahead[i] = i % k === 0 ? padded[i] : Math.max(ahead[i - 1], padded[i]);
    for (let i = m - 1; i >= 0; i -= 1) behind[i] = (i + 1) % k === 0 || i === m - 1 ? padded[i] : Math.max(behind[i + 1], padded[i]);
    for (let i = 0; i < n; i += 1) write(i, Math.max(behind[i], ahead[i + 2 * r]));
  };
  const rows = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) line((x) => data[y * width + x], (x, v) => { rows[y * width + x] = v; }, width);
  const out = new Uint8Array(width * height);
  for (let x = 0; x < width; x += 1) line((y) => rows[y * width + x], (y, v) => { out[y * width + x] = v; }, height);
  return out;
}

function erodeMask(data, width, height, radius) {
  const inverted = dilateMask(data.map((value) => 255 - value), width, height, radius);
  return inverted.map((value) => 255 - value);
}

export function maskBufferFromDataUrl(dataUrl) {
  const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ""));
  if (!match) throw new Error("The painted mask didn’t come through. Paint it again.");
  const buffer = Buffer.from(match[1], "base64");
  if (!buffer.length || buffer.length > maxMaskBytes) throw new Error("The painted mask is too large.");
  return buffer;
}

/**
 * The three files an inpaint run loads, from the source image and the painted
 * mask (any size; it is stretched over the image): the crop at working size,
 * the mask it samples with, and the mask that stitches it back at box size.
 * Null when nothing was painted. Each sharp step runs on its own, since sharp
 * orders the operations in one pipeline its own way.
 */
export async function inpaintFiles(sharp, sourceBuffer, maskBuffer, { targetPixels, feather }) {
  // ComfyUI's LoadImage applies EXIF orientation, and so did the browser the mask was painted in.
  const { data: rgb, info } = await sharp(sourceBuffer, { limitInputPixels: 80_000_000 }).rotate().removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const imageWidth = info.width;
  const imageHeight = info.height;
  const mask = await sharp(maskBuffer)
    .resize(imageWidth, imageHeight, { fit: "fill", kernel: "linear" })
    .extractChannel(0)
    .raw()
    .toBuffer();
  const bounds = maskBounds(mask, imageWidth, imageHeight);
  if (!bounds) return null;
  const { box, work } = inpaintGeometry({ imageWidth, imageHeight, bounds, targetPixels });
  const region = { left: box.x, top: box.y, width: box.width, height: box.height };
  // sharp writes a one-channel input back out as RGB unless told otherwise.
  const gray = (buffer, width, height) => sharp(buffer, { raw: { width, height, channels: 1 } });
  const rawGray = (pipeline) => pipeline.extractChannel(0).raw().toBuffer();
  const pngGray = (pipeline) => pipeline.toColourspace("b-w").png().toBuffer();

  const crop = await sharp(rgb, { raw: { width: imageWidth, height: imageHeight, channels: info.channels } })
    .extract(region)
    .resize(work.width, work.height, { fit: "fill", kernel: "lanczos3" })
    .png()
    .toBuffer();
  const boxMask = await rawGray(gray(mask, imageWidth, imageHeight).extract(region));
  const { grow, blend } = inpaintEdges(bounds, feather);
  // Sampling: hard, the paint grown by `grow`. A soft sampling mask (differential
  // diffusion) gives its edge only the last step or two, which few-step and edit models
  // leave half-denoised: grey grain and a ghost of the original. Softness belongs to the stitch.
  const repainted = dilateMask(boxMask.map((value) => (value >= maskThreshold ? 255 : 0)), box.width, box.height, grow);
  const samplingMask = await pngGray(gray(Buffer.from(repainted), box.width, box.height).resize(work.width, work.height, { fit: "fill" }).threshold(128));
  // Stitching, at the box's own size: the repainted area shrunk by most of the seam's
  // width, then blurred, so the soft band lies on repainted pixels and ends where they
  // do; never below the paint, which is always fully replaced.
  const compositeRaw = Buffer.from(boxMask);
  if (blend >= 1) {
    const core = erodeMask(repainted, box.width, box.height, Math.round(blend * 0.8));
    const soft = await rawGray(gray(Buffer.from(core), box.width, box.height).blur(Math.max(0.3, blend / 2.5)));
    for (let index = 0; index < compositeRaw.length; index += 1) compositeRaw[index] = Math.max(boxMask[index], soft[index]);
  }
  const compositeMask = await pngGray(gray(compositeRaw, box.width, box.height));
  return { box, work, crop, samplingMask, compositeMask, edges: { grow, blend }, image: { width: imageWidth, height: imageHeight } };
}

/**
 * Turns the job's painted mask into what the graph loads and stages it in
 * ComfyUI. Returns null when nothing was painted, so the run goes ahead as a
 * plain edit.
 */
export async function prepareInpaint(req, body) {
  const reference = body.referenceAssets?.[0];
  if (!body.inpaint?.mask || !reference?.assetId || !reference.comfyName) return null;
  const sharp = await loadSharp();
  if (!sharp) throw new Error("Inpainting needs image resizing, which is off: sharp could not load. Run `npm install --omit=dev` in the HEISS UI folder, then restart.");
  const source = await bytesForReference(req, reference.assetId);
  const files = await inpaintFiles(sharp, source.buffer, maskBufferFromDataUrl(body.inpaint.mask), {
    targetPixels: Number(body.width) * Number(body.height),
    feather: body.inpaint.feather
  });
  if (!files) return null;
  // A Hidden image's crop gets its own name, so cleaning up after the run never touches another job's input.
  const unique = Boolean(body.privateVault) || String(reference.assetId).startsWith("vault:");
  const upload = (buffer, name) => uploadBufferToComfy({ buffer, mime: "image/png", name }, { unique });
  const crop = await upload(files.crop, "inpaint-crop.png");
  const mask = await upload(files.samplingMask, "inpaint-mask.png");
  const composite = await upload(files.compositeMask, "inpaint-stitch.png");
  return {
    original: reference.comfyName,
    crop: crop.comfyName,
    mask: mask.comfyName,
    composite: composite.comfyName,
    box: files.box,
    work: files.work,
    // The whole picture's size and where it came from, so the live preview can draw on top of it.
    image: files.image,
    referenceId: String(reference.assetId),
    strength: body.inpaint.strength,
    feather: body.inpaint.feather,
    stitchNode: Boolean(body.inpaint.stitchNode)
  };
}

/** The staged file names an inpaint run adds, for cleanup after Hidden runs. */
export function inpaintInputNames(inpaint) {
  return inpaint ? [inpaint.crop, inpaint.mask, inpaint.composite].filter(Boolean) : [];
}

/**
 * What HEISS Inpaint Stitch did to a run's pictures, from its report, in a few
 * words for the picture's details ("Lined up 4 px · colour matched"), or "".
 */
export function seamSummary(results) {
  const list = Array.isArray(results) ? results : [];
  if (!list.length) return "";
  const aligned = list.map((result) => result?.align).filter((align) => align?.aligned);
  const matched = list.some((result) => result?.color?.matched);
  const parts = [];
  if (aligned.length) {
    const moved = Math.max(...aligned.map((align) => Math.hypot(Number(align.shift?.[0]) || 0, Number(align.shift?.[1]) || 0)));
    const zoom = Math.max(...aligned.map((align) => Math.abs((Number(align.scale?.[0]) || 1) - 1)));
    parts.push(`Lined up ${Math.round(moved * 10) / 10} px${zoom >= 0.005 ? `, ${Math.round(zoom * 1000) / 10}% zoom` : ""}`);
  }
  if (matched) parts.push(parts.length ? "colour matched" : "Colour matched");
  return parts.length ? parts.join(" · ") : "Nothing to correct";
}
