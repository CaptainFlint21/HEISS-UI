# Prompt enhance

The spark in the prompt bar (Ctrl+E, ⌘E on a Mac). A local vision model turns a few words into the prompt the selected model wants, reads an attached picture into one, or writes the motion for an image-to-video start frame. The new prompt is written into the box word by word; Undo puts your words back, and Try again writes another take from them.

It runs inside ComfyUI, so nothing leaves the computer, and ComfyUI's memory management swaps it in and out with the picture and video models. It is uncensored.

## What it writes

What the composer holds decides the task (`enhanceTarget` in `server/prompt-enhance.js`):

| Composer | Writes |
|---|---|
| Image model, words | One paragraph in natural language: the subject first, then setting, camera, light, palette and medium. |
| Pony, Illustrious/NoobAI (SDXL) or Anima, words | Danbooru tags with the right quality tags, one of each, with negative tags removed. |
| Image model, a picture, no words | The prompt that would make that picture again (tags for the anime models). Words added say what to focus on. |
| Edit model, a picture and words | One editing instruction: what changes, and what stays the same. |
| Video model, words | One continuous shot, in order, with the camera. LTX-2 also gets its soundscape, and speech in quotes. |
| Video model, a start frame | What happens next: the motion and the camera, without describing the picture again. |

Length follows the model: about 30–60 words for CLIP-based SDXL and SD 1.5, 70–130 for most models, and 100–200 for the long LLM encoders (Qwen-Image, Flux.2, Krea 2, LTX). The rules come from the model makers' own prompt rewriters (Qwen-Image, FLUX.2, Wan 2.2, LTX-2, Z-Image), shortened for a 4B model: keep every subject, count, name and quoted text; never answer the idea, only rewrite it; output the prompt alone.

How the system prompt is written follows what a 4B model actually does with it (`evals/enhance/FINDINGS.md`):
- **The person's picture comes first and stays theirs:** who does what to whom, in their own words; then only the gaps are filled, in one consistent look. A list of every slot to fill made every prompt the same ("low angle, shallow depth of field, 35mm film").
- **Rules say what to do.** A small model turns "never X" into X, or into `no_x` tags, so the system prompt has no lists of what to avoid.
- **One worked example per task** carries the register better than more rules.
- **`finishPrompt` cleans up what the model still does:** negative and sentence-length tags, "solo" beside a second person, prose sentences that only say what's absent.

`evals/enhance` runs base prompts through this exact code (`enhancePlan` → `runEnhance` → `finishPrompt`) with timing for each run, for reading against reference prompts.

Settings › Features › Prompt enhance sets the model, the style (Faithful, Balanced, Bold; the sampling temperature), and standing instructions added to every request.

## The models

All three are uncensored (abliterated or Heretic) builds in ComfyUI's single-file format. They go in `models/text_encoders` and load with ComfyUI's CLIP loader:

| Model | Size | On an RTX 3070 (8 GB) |
|---|---|---|
| Qwen3-VL 4B, huihui abliterated, INT8 ConvRot (default) | 5.1 GB | First words in about 1.5 s; a full prompt in 3–5 s once loaded, about 9 s from cold. |
| Qwen3.5 4B, HauhauCS uncensored, INT8 ConvRot | 5.5 GB | Reads actions best (who does what), but copies the tag examples more readily, and its first words take about 2.7 s. 25–37 tokens/s when the card has the room; when other programs hold VRAM it streams its weights and drops to about 6. |
| Qwen3.5 2B, Heretic, INT8 ConvRot | 3.1 GB | About 50 tokens/s. Simpler wording, and weaker at reading pictures. |

The model has to fit in VRAM whole. If it doesn't, ComfyUI's dynamic VRAM streams the weights in for every token and speed collapses, which is why fp8 files are left out: on cards before Ada, ComfyUI upcasts fp8 to 16-bit (the fp8 Qwen3-VL-4B loads as 8.4 GB). INT8 ConvRot stays INT8.

## How it runs

1. `POST /api/enhance` checks setup, uploads a picture at about 0.4 MP (enough for a 4B model, a fraction of the vision tokens), and answers with server-sent events.
2. It queues a three-node graph at the front of ComfyUI's queue: `CLIPLoader` → `HeissPromptEnhance` (+ `LoadImage`). A render already running finishes first; the island says "Waiting for the current render".
3. HEISS Prompt Enhance (HEISS UI Nodes 8) runs ComfyUI's own `generate()` and sends the text so far on ComfyUI's websocket as `heiss.enhance`, about 20 times a second. HEISS relays it, and the composer writes it into the box.
4. The run's history entry is deleted afterwards. A Hidden picture's upload is removed too.

Why a node of its own rather than ComfyUI's Generate Text:
- ComfyUI's default Qwen3-VL template ends with an empty think block, which the Instruct models never saw in training. They then talk about the prompt instead of writing one.
- Generate Text has no way to report its text while writing.
- Its output is not in the history, so it would need a second node to read it back.

## Setup

Pressing the spark before it is set up opens the setup dialog: HEISS UI Nodes 8 (install or update, then a ComfyUI restart), then a choice of model and its download through the usual download queue (resumable, SHA-256 checked). When it is ready, "Enhance my prompt" runs what was waiting.

ComfyUI only rescans a model folder when the folder's modified time changes, and exFAT never changes it, so a model downloaded there stayed invisible until a restart. Pack 8 adds `POST /heiss/models/rescan`, which drops ComfyUI's cached lists. `/api/enhance/status` calls it when a catalog model is on disk but not listed.

## Content checks

None yet. The system prompt is the base prompt alone; a content check (an API-based one, run on the idea and on the text as it is written) is to be built on it before release.
