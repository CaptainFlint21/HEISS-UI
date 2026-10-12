import assert from "node:assert/strict";
import test from "node:test";
import { comfyOutputName, embedRtxVideo, planRunRtx, rtxOutputSize, rtxScale, rtxStatusFrom, rtxVideoGraph } from "./rtx.js";
import { nodePacks } from "./node-packs.js";
import { packInstallPlan } from "./node-install.js";
import { pairRunOutputs } from "./run-upscale.js";

const nvidia = { type: "cuda", name: "cuda:0 NVIDIA GeForce RTX 4070 : cudaMallocAsync" };
const rtxNodes = { HeissRTXVideo: {}, HeissRTXUpscale: {} };
const check = (patch = {}) => ({ torch: "2.9.1+cu130", cuda: "13.0", nvvfx: "0.2.0.0", device: { name: "NVIDIA GeForce RTX 4070", capability: [8, 9] }, frameGeneration: true, ready: true, reason: "", ...patch });

test("2K and 4K aim the short side, within 1x to 4x and 8192 per side", () => {
  assert.equal(rtxScale("2k", 832, 480), 3);
  assert.equal(rtxScale("4k", 832, 480), 4); // 4.5x wanted, 4x is VSR's most
  assert.equal(rtxScale("2k", 1920, 1080), 1.33);
  assert.equal(rtxScale("4k", 3840, 2160), 1); // already there: cleaned, not shrunk
  assert.equal(rtxScale("4k", 2400, 1000), 2.16);
  assert.equal(rtxScale("4k", 4000, 1000), 2.05); // 8192 per side wins over the short side
  assert.equal(rtxScale("8k", 832, 480), 0);
  assert.equal(rtxScale("2k", 0, 480), 0);
  assert.deepEqual(rtxOutputSize(832, 480, 3), { width: 2496, height: 1440 });
  assert.deepEqual(rtxOutputSize(830, 470, 1.5), { width: 1248, height: 704 });
});

test("it is offered on NVIDIA cards only, and says which part is missing", () => {
  assert.equal(rtxStatusFrom({ device: { type: "mps", name: "mps" } }).offered, false);
  assert.match(rtxStatusFrom({ device: { type: "mps", name: "mps" } }).reason, /Mac/);
  assert.equal(rtxStatusFrom({ device: { type: "cuda", name: "cuda:0 AMD Radeon RX 7900 XTX" } }).offered, false);
  assert.equal(rtxStatusFrom({ device: nvidia, info: {} }).stage, "nodes");
  assert.equal(rtxStatusFrom({ device: nvidia, info: rtxNodes, check: null }).stage, "checking");
  assert.equal(rtxStatusFrom({ device: nvidia, info: rtxNodes, check: check({ nvvfx: null, ready: false }) }).stage, "package");
  const broken = rtxStatusFrom({ device: nvidia, info: rtxNodes, check: check({ ready: false, reason: "NvVFX_Load failed" }) });
  assert.deepEqual([broken.stage, broken.ready, broken.reason], ["error", false, "NvVFX_Load failed"]);
  const ready = rtxStatusFrom({ device: nvidia, info: rtxNodes, check: check() });
  assert.deepEqual([ready.stage, ready.ready, ready.frameGeneration, ready.cuda], ["ready", true, true, "13.0"]);
  // A 30-series card: upscaling yes, smoothing no.
  assert.equal(rtxStatusFrom({ device: nvidia, info: rtxNodes, check: check({ frameGeneration: false }) }).frameGeneration, false);
});

test("NVIDIA's package installs from the same pack, from NVIDIA's own index, and only there", () => {
  const plan = packInstallPlan(nodePacks.heissrtx, "/opt/ComfyUI", "linux");
  assert.match(plan.commands[0].command, /pip install -r ComfyUI-HEISS-UI-Nodes\/requirements-rtx\.txt --extra-index-url https:\/\/pypi\.nvidia\.com/);
  assert.equal(nodePacks.heissrtx.commit, nodePacks.heiss.commit);
  // The plain pack keeps plain requirements.txt, which never pulls NVIDIA's package onto a Mac.
  assert.doesNotMatch(packInstallPlan(nodePacks.heiss, "/opt/ComfyUI", "darwin").commands[0].command, /rtx|nvidia/);
  assert.ok(nodePacks.heiss.nodes.includes("HeissRTXVideo"));
});

test("a gallery video is read from ComfyUI's output folder by name, never from a path", () => {
  assert.equal(comfyOutputName("/comfy/view?filename=video_00001_.mp4&subfolder=heiss-ui&type=output"), "heiss-ui/video_00001_.mp4 [output]");
  assert.equal(comfyOutputName("/comfy/view?filename=a.mp4&type=output"), "a.mp4 [output]");
  assert.equal(comfyOutputName("/comfy/view?filename=..%2Fsecret.mp4&type=output"), "");
  assert.equal(comfyOutputName("/comfy/view?filename=a.mp4&subfolder=..%2F..&type=output"), "");
  assert.equal(comfyOutputName("/comfy/view?filename=a.mp4&type=models"), "");
  assert.equal(comfyOutputName("/library/file/abc"), "");
});

test("the gallery upscale graph: Load Video, then HEISS RTX Video with the file model", () => {
  const { graph, plan } = rtxVideoGraph({ source: "heiss-ui/v_00001_.mp4 [output]", tier: "2k", width: 832, height: 480, frames: 81, smooth: 2 });
  assert.equal(graph["1"].class_type, "LoadVideo");
  assert.equal(graph["1"].inputs.file, "heiss-ui/v_00001_.mp4 [output]");
  assert.equal(graph["2"].class_type, "HeissRTXVideo");
  assert.deepEqual(graph["2"].inputs.video, ["1", 0]);
  assert.equal(graph["2"].inputs.quality, "HIGH");
  assert.equal(graph["2"].inputs.smooth, 2);
  assert.equal(graph["2"].inputs.filename_prefix, "heiss-ui/upscale");
  assert.deepEqual([plan.estimatedWidth, plan.estimatedHeight, plan.frames, plan.quality, plan.model], [2496, 1440, 161, "rtx", "rtx-vsr+fg"]);
  assert.throws(() => rtxVideoGraph({ source: "", tier: "2k", width: 832, height: 480 }), /no longer has/);
  assert.throws(() => rtxVideoGraph({ source: "a.mp4 [output]", tier: "2k", width: 0, height: 0 }), /size is unknown/);
});

const videoRun = () => ({
  "7": { class_type: "CreateVideo", inputs: { images: ["6", 0], fps: 16 } },
  "8": { class_type: "SaveVideo", inputs: { video: ["7", 0], filename_prefix: "heiss-ui/video", format: "mp4", codec: "h264" } }
});

test("in a run it rides next to Save Video, so the original is saved either way", () => {
  const embedded = embedRtxVideo(videoRun(), { tier: "4k", width: 832, height: 480, frames: 81, smooth: 1 }, { phase: "Upscaling to 4K" });
  assert.deepEqual(embedded.pairs, [{ base: "8", upscale: "heiss_rtx0" }]);
  const node = embedded.graph.heiss_rtx0;
  assert.deepEqual(node.inputs.video, ["7", 0]);
  assert.equal(node.inputs.quality, "HIGHBITRATE_HIGH");
  assert.equal(node.inputs.scale, 4);
  assert.equal(node._meta.heissPhase, "Upscaling to 4K");
  assert.equal(embedded.graph["8"].class_type, "SaveVideo");
  assert.equal(embedRtxVideo({ "9": { class_type: "SaveImage", inputs: { images: ["1", 0] } } }, { tier: "2k", width: 832, height: 480 }), null);
});

test("a run plans it only when this machine is ready, and smooths only with Frame Generation", () => {
  const ready = { ready: true, frameGeneration: false };
  const body = { rtxVideo: { tier: "2k", smooth: true }, width: 832, height: 480, frames: 81 };
  const planned = planRunRtx(videoRun(), body, ready);
  assert.equal(planned.graph.heiss_rtx0.inputs.smooth, 1);
  assert.equal(planned.label, "2K");
  assert.equal(planRunRtx(videoRun(), body, { ...ready, frameGeneration: true }).graph.heiss_rtx0.inputs.smooth, 2);
  assert.deepEqual(planRunRtx(videoRun(), body, { ready: false, reason: "NVIDIA's RTX video package isn't installed" }), { skipped: "NVIDIA's RTX video package isn't installed", quality: "rtx" });
  assert.equal(planRunRtx(videoRun(), { rtxVideo: null }, ready), null);
});

test("the run's video and its upscale pair up like Smart upscale's pictures", () => {
  const outputs = {
    "8": { images: [{ filename: "video_00001_.mp4", subfolder: "heiss-ui", type: "output" }], animated: [true] },
    heiss_rtx0: { images: [{ filename: "upscale_00001_.mp4", subfolder: "heiss-ui", type: "output" }], animated: [true], heiss_rtx: [{ frames: 81 }] }
  };
  const [result] = pairRunOutputs(outputs, [{ base: "8", upscale: "heiss_rtx0" }]);
  assert.equal(result.output.type, "video");
  assert.equal(result.upscale.type, "video");
  assert.match(result.upscale.url, /upscale_00001_\.mp4/);
});
