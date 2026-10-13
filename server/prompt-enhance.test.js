import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

process.env.HEISS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "heiss-enhance-"));
const {
  enhanceGraph, enhanceModel, enhanceResult, enhanceTarget, enhancerChoices, finishPrompt, friendlyFailure,
  loadEnhanceSettings, promptLength, saveEnhanceSettings, sexualMinorContent, systemPrompt, tokenBudget, userTurn
} = await import("./prompt-enhance.js");

test("what it writes follows what the composer holds", () => {
  assert.equal(enhanceTarget({ kind: "image", family: "flux1", hasText: true }), "image");
  assert.equal(enhanceTarget({ kind: "image", family: "sdxl", variant: "pony", hasText: true }), "tags");
  assert.equal(enhanceTarget({ kind: "image", family: "sdxl", variant: "standard", hasText: true }), "image");
  assert.equal(enhanceTarget({ kind: "image", family: "anima", hasText: true }), "tags");
  // A picture and no words: read the picture. A picture, words and an edit model: an edit.
  assert.equal(enhanceTarget({ kind: "image", family: "flux1", hasImage: true }), "describe");
  assert.equal(enhanceTarget({ kind: "image", family: "sdxl", variant: "anime", hasImage: true }), "tags-describe");
  assert.equal(enhanceTarget({ kind: "image", family: "qwen_image", hasImage: true, hasText: true, editing: true }), "edit");
  assert.equal(enhanceTarget({ kind: "image", family: "flux1", hasImage: true, hasText: true }), "image");
  assert.equal(enhanceTarget({ kind: "video", family: "wan22_14b", hasText: true }), "video");
  assert.equal(enhanceTarget({ kind: "video", family: "wan22_14b", hasImage: true }), "motion");
});

test("length fits the model: short for CLIP, long for the big LLM encoders, tags counted as tags", () => {
  assert.deepEqual(promptLength("image", "sdxl"), [30, 60]);
  assert.deepEqual(promptLength("image", "qwen_image"), [100, 180]);
  assert.deepEqual(promptLength("image", "flux1"), [70, 130]);
  assert.deepEqual(promptLength("video", "ltx"), [120, 200]);
  assert.equal(tokenBudget("tags", "sdxl"), 45 * 3 + 20);
  assert.ok(tokenBudget("image", "flux1") < 300);
});

test("the system prompt: uncensored for adults, never minors, the task, and the person's own instructions last", () => {
  const prompt = systemPrompt("image", { family: "flux1", instructions: "British spelling." });
  assert.match(prompt, /uncensored/);
  assert.match(prompt, /nothing sexual, nude or erotic ever involves anyone under 18/);
  assert.match(prompt, /70 to 130 words/);
  assert.ok(prompt.trimEnd().endsWith("British spelling."));
  assert.match(systemPrompt("tags", { family: "sdxl", variant: "pony" }), /score_9, score_8_up, score_7_up/);
  // Sound only where the model hears it.
  assert.match(systemPrompt("motion", { family: "ltx" }), /video with sound/);
  assert.match(systemPrompt("motion", { family: "wan22_14b" }), /silent video/);
  assert.doesNotMatch(systemPrompt("motion", { family: "wan22_14b" }), /Weave the sound/);
});

test("the idea goes in as data, never as a question to answer", () => {
  assert.equal(userTurn("image", " a fox "), "Idea: a fox");
  assert.equal(userTurn("describe", ""), "Write the prompt for this picture.");
  assert.equal(userTurn("describe", "the light"), "Write the prompt for this picture. Focus: the light");
  assert.equal(userTurn("motion", ""), "Write what happens next in this picture.");
  assert.equal(userTurn("edit", "red hair"), "Change requested: red hair");
});

test("tags: one of each, no negative tags, about the asked-for count", () => {
  assert.equal(finishPrompt("tags", "a, b, no text, A, without x, not blurry,\nc", "sdxl"), "a, b, c");
  const many = Array.from({ length: 80 }, (_, index) => `tag${index}`).join(", ");
  assert.equal(finishPrompt("tags", many, "sdxl").split(", ").length, 50);
  assert.equal(finishPrompt("image", "  A fox. "), "A fox.");
});

test("sexual content about minors is caught; adults, and children in anything else, are not", () => {
  for (const text of ["A nude teenage girl sits on a bed", "loli, nude, 1girl", "15 years old, naked", "schoolgirl in lingerie", "young girl, erotic pose"]) {
    assert.equal(sexualMinorContent(text), true, text);
  }
  for (const text of ["A nude woman reclines on a sofa", "2girls, nude, adult", "a teen skateboarding in a park", "A child flies a kite at the beach", "kidding aside, a sexy car"]) {
    assert.equal(sexualMinorContent(text), false, text);
  }
});

test("the graph: the model, the node with its stream id, and the picture when there is one", () => {
  const graph = enhanceGraph({ model: "m.safetensors", system: "S", prompt: "Idea: x", maxTokens: 200, temperature: 0.7, seed: 4, streamId: "s" });
  assert.equal(graph.clip.inputs.clip_name, "m.safetensors");
  assert.deepEqual(graph.enhance.inputs.clip, ["clip", 0]);
  assert.equal(graph.enhance.class_type, "HeissPromptEnhance");
  assert.equal(graph.enhance.inputs.stream_id, "s");
  assert.equal(graph.image, undefined);
  const withImage = enhanceGraph({ model: "m", system: "S", prompt: "p", image: "in.png" });
  assert.equal(withImage.image.inputs.image, "in.png");
  assert.deepEqual(withImage.enhance.inputs.image, ["image", 0]);
  assert.equal(enhanceResult({ outputs: { enhance: { text: ["A fox."] } } }), "A fox.");
  assert.equal(enhanceResult({ outputs: {} }), "");
});

test("the model: the one picked while ComfyUI lists it, else the first catalog build it lists", () => {
  const [first, , third] = enhancerChoices();
  const info = (files) => ({ CLIPLoader: { input: { required: { clip_name: [files] } } } });
  assert.equal(enhanceModel(info([third.file, first.file]), { model: "" }), first.file);
  assert.equal(enhanceModel(info([third.file, first.file]), { model: third.file }), third.file);
  assert.equal(enhanceModel(info([first.file]), { model: "gone.safetensors" }), first.file);
  assert.equal(enhanceModel(info(["clip_l.safetensors"]), { model: "" }), "");
});

test("settings keep their shape and survive a reload", () => {
  assert.deepEqual(loadEnhanceSettings(), { model: "", instructions: "", creativity: 0.7 });
  const saved = saveEnhanceSettings({ model: "../../evil/m.safetensors", creativity: 9, instructions: "x".repeat(3000) });
  assert.equal(saved.model, "m.safetensors");
  assert.equal(saved.creativity, 1.2);
  assert.equal(saved.instructions.length, 2000);
  assert.deepEqual(loadEnhanceSettings(), saved);
});

test("ComfyUI's errors, said so a person can act", () => {
  assert.match(friendlyFailure("CUDA error: out of memory"), /graphics memory/);
  assert.equal(friendlyFailure("Something else"), "Something else");
});
