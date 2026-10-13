import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

process.env.COMFY_OUTPUT_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "heiss-output-"));
process.env.HEISS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "heiss-data-"));
const { upscaleResult } = await import("./upscale-jobs.js");

// ComfyUI's history of an RTX upscale (rtxVideoGraph): Load Video, then HEISS RTX Video.
const loaded = { images: [{ filename: "video_00002_.mp4", subfolder: "heiss-ui", type: "input" }], animated: [true] };

test("an RTX upscale finishes with the upscaled video, not the source Load Video lists", () => {
  const entry = { status: { status_str: "success", completed: true }, outputs: { 1: loaded, 2: { images: [{ filename: "upscale_00011_.mp4", subfolder: "heiss-ui", type: "output" }], animated: [true] } } };
  assert.match(upscaleResult(entry, true).url, /filename=upscale_00011_\.mp4&subfolder=heiss-ui&type=output$/);
});

test("a run ComfyUI stopped with an error fails with ComfyUI's message, though Load Video left its source behind", () => {
  const entry = {
    status: { status_str: "error", completed: false, messages: [["execution_start", {}], ["execution_error", { node_type: "HeissRTXVideo", exception_message: "type object 'VideoSuperRes' has no attribute 'ImageEncoding'" }]] },
    outputs: { 1: loaded }
  };
  assert.throws(() => upscaleResult(entry, true), /has no attribute 'ImageEncoding'/);
});

test("a run that made nothing says so", () => {
  assert.throws(() => upscaleResult({ status: { status_str: "success" }, outputs: { 1: loaded } }, true), /ended without a video/);
});
