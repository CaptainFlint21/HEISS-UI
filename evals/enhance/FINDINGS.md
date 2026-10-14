# Findings

## Baseline (2026-10-14, results/baseline)

Qwen3-VL 4B, creativity 0.7, the prompts in `server/prompt-enhance.js` as merged in PR #12. 60 runs, 12 per family.

**Verdict:** the vocabulary is fine (it isn't censoring: pussy, cock, cum and penetration come through), but the prompts are built from one template, the camera and look are incoherent, and NSFW scenes lose their logic: who is doing what to whom, in which position, and what's visible. None would sit comfortably next to the Civitai references.

### Everything (prose families: Krea 2, Qwen-Image 2.1, Flux.1, SDXL)

1. **One template, every slot filled with the same defaults.** Subject → setting → "shot from a low angle, wide-angle lens, shallow depth of field" → "harsh overhead fluorescent light" → "Color palette: …" → "Style: 35mm film photograph". Shallow depth of field turns up in nearly every output, including oil paintings, a white-seamless studio shot and an infographic. "Low angle" appears even where the person said "shot from above" (Flux motel: "directly above, low angle"). "35mm film photograph" is stamped on phone selfies and on a Polaroid. The references only mention camera details when they matter, and then specifically (24mm phone lens from the floor, Kodak Gold 200). Cause: `imageOrder` lists every slot, so a 4B model fills every one.
2. **Camera and look don't agree.** "Amateur iPhone photo" next to "wide shot, shallow depth of field, amber haze"; "raw phone shot, 10mm lens"; "low-angle shot from above"; "85mm" and "wide-angle" in one sentence; a Polaroid "rendered as a 35mm film photograph".
3. **Non-visual content gets through.** "Loud music and pounding on the door echo through the walls" survived in every prose family (and as tags on Pony). Also "static crackling faintly", "howling", "creaking", "tension palpable", "making everything feel sweaty and urgent", "evoking dread".
4. **Invented text.** "LANTERN ROOM" glowing on a lighthouse, "NIMUE" etched on Nimue's chest, a record labelled "HEADLIGHTS". Cause: `visualStyle` tells it to put words in the picture in quotes, and it reads that as "add words".
5. **Decay and clutter nobody asked for**, sometimes changing the request: the cooling cherry pie becomes "a half-eaten slice", a cabinet door hangs off its hinges, a broken mirror, a cracked headboard, a rusted industrial washing machine, crumbs on the floor. Everything is grimy, with sickly yellow light.

### NSFW logic (the real failures)

- **motel:** "missionary" became "receives deep penetration from behind" (Krea, Qwen). No man appears in any family. SDXL and Flux dressed her in "a torn lace bra and panties" while cum drips from her pussy.
- **milf-dildo:** on Krea and SDXL she holds the dildo in her hand while wearing a lace bra and panties. She isn't riding it, and she's clothed. Only Qwen has her riding.
- **office:** Krea's "bare skin visible from mid-torso up" never says topless. SDXL drops topless entirely. Qwen folds her arms across her chest, the opposite of "showing her tits off". "No panties visible" says the opposite of what was meant. The negation ("don't make her look slutty, nervous") was handled well.
- **purple-bed:** "he's pushing her head into the mattress" became "his head is buried in the mattress beside hers".
- **thighgap:** "lower body pic" framed "from mid-thigh up to the top of her head".
- **altgirl:** a photo request came back as "hyperrealistic 3D", "like a cinematic still from a gritty adult film".
- **pink-cuffs:** "arms spread wide, wrists bound behind her back", cuffs that "dangle from her shoulders", a neon glow under the mattress, and "3D digital painting".
- **futa-pool:** "her uncut cock is erect and visible beneath the halter".

### Pony

- **"1girl, solo" in everything**, copied from the example in `tagRules`: the lighthouse painting with no person in it, a sex scene, and the kitchen ("1girl, solo … no_humans"). No 1boy, hetero or penis tag in any partnered scene.
- **"no_x" tags survive.** `finishPrompt` drops tags that start with "no " but not with "no_". Office and kitchen ended in runs of no_shadow_artifacts, no_feminine_gear and the like, hit the 155-token cap, and were cut mid-tag.
- **Sentences as tags,** including a leaked instruction ("only visual elements as requested"), plus "focus on body and action", "barely fitting" and "people banging on door". Hyphenated tags (catra) and underscores are mixed.
- **"anime style" / "realistic anime style" added** where nobody asked; many references are photoreal Pony.
- **Good:** the score tags, and the main act and body tags are mostly right.

### SDXL 1.0

Length is right (about 65 words) and the rambles get distilled well. It has the same template stamp, and in the NSFW cases it dropped the topless part and added underwear.

### What works

- **Rambles:** the visual details survive, filler and the corrected-away cake are dropped, and the pie is kept.
- **Explicit vocabulary:** it comes through.
- **Never refuses or talks.**
- **Speed:** once the model is held in VRAM, about 40 tokens/s and 3.5–6 s per prompt.

### Telemetry (runs 8–60, model resident; runs 1–7 were streamed at about 8 tok/s, see below)

| family | median words | tokens | tok/s | first words | total | hit cap |
|---|---|---|---|---|---|---|
| Krea 2 | 161 | 218 | 43 | 2.1 s | 6.0 s | 0/5 |
| SDXL | 65 | 93 | 31 | 1.6 s | 3.5 s | 1/12 |
| Pony | 50 | 155 | 39 | 1.5 s | 4.1 s | 6/12 |
| Flux.1 | 114 | 156 | 39 | 1.5 s | 4.3 s | 0/12 |
| Qwen 2.1 | 166 | 215 | 44 | 2.0 s | 5.4 s | 0/12 |

Speed depends on VRAM residency, not on the code. With `--reserve-vram 2 --vram-headroom 1`, ComfyUI's dynamic VRAM kept only about 2.5 GB of the 4.8 GB model resident and streamed the rest every token (about 8 tok/s). When another app freed about 650 MB at 23:18, residency rose to about 3.5 GB and speed went to about 40 tok/s. The first words take about 1.5–2 s, mostly prefill of the roughly 1,700-character system prompt.

### First things to change

1. **Image task:** the person's picture first and exact (people, act, position, what's visible, clothing state, viewpoint, medium they gave). Fill only the gaps, and make camera, light and medium fit the look instead of filling every slot. Name the common contradictions (a phone photo is sharp throughout; "from above" is a high angle; POV shows the viewer's own body).
2. **Quotes only for words the person asked for.**
3. **Only what's visible:** no sounds, music, noise, smells, thoughts, or anything off-frame. Objects stay as described.
4. **Sex scenes:** every partner present, who does what to whom, in the position named; nudity as stated, never underwear added.
5. **Pony:** an example with a partnered scene (1girl, 1boy, hetero); person tags only when there are people; no style tags not asked for; `finishPrompt` drops no_/without_ tags and sentence-length tags and normalises hyphens.
