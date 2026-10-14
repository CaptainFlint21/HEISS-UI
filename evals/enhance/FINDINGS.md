# Findings

## Round 2 (2026-10-14)

- **Already-good prompts in** (Civitai Krea #13, Qwen #12, Flux #5 used as input; results/refs-in): they come back nearly verbatim, tidied, every detail kept. The Flux one's Markdown sheet became clean prose with all its placements. The only additions were the habitual "shallow depth of field, no filters" on phone shots.
- **Decay habit** (r2-control vs r2-cond): rewording the style line to keep things "in the condition the person gave" changed nothing (58 vs 59 wear words in 16 runs). The wear comes from "70s / vintage / grandma's", and is mostly a fair reading; only the half-baked pie is a real error. Reverted.
- **Sounds from the user turn** (r2-turn): ending the user turn with "Write the image prompt: only what the camera sees." left the party ramble's music and door-banging in 6 of 6 takes. That's the fourth mechanism tried; this model keeps whatever the person explicitly wrote. Reverted.

## Round 1: v1–v8 (2026-10-14)

Targeted runs on the cases each change touched (results/v1 … v8, fid-*, v6-holdout, v7-holdout, video-check, model-*), then a full re-run (results/v8-full) against the baseline. Held-out prompts (`cases-holdout.json`) were never tuned on; they only checked that a change generalises, and it did.

### What changed, and why

1. **Their picture first, then only the gaps.** The baseline's slot list (shot, angle, lens, depth of field, light, palette, mood, medium) made a 4B model fill every slot with the same defaults. The image task now starts with the subject and the action, then fills in only what the picture still needs, in one consistent look ("make the camera, light and medium agree"; a painting or drawing gets no camera terms).
2. **Rules said as what to do.** Every negated list in the system prompt came back. "Never add ages, drugs, violence…" and "no sounds, smells…" turned into `no_age, no_drugs, no_sound` tags on Pony and "No text or logos" sentences in prose. Naming smells, even to forbid them, produced "the air smells of cinnamon". The rules are now short and positive; the system prompt contains no "never".
3. **Who does what to whom, in their own words.** "Keep the person's own words for who is in it and what they are doing": rephrasing is where "pushing her head into the mattress" became "his head is buried in the mattress".
4. **One worked example per task.** A prose example (an ordinary scene, a sound in the idea quietly dropped, a coherent phone-photo look) and three tag examples (one person, a couple having sex, no people) did more than any rule. They fixed "1girl, solo" on everything, the missing 1boy, and "no humans" for scenery. The sex example is the main Pony use case per the references; SFW Pony prompts (held-out librarian elf, surfing corgi) stayed clean.
5. **Words in the picture only when asked**, inside the keep-list rather than as their own rule, which was producing invented signage and "No text" lines.
6. **Deterministic cleanup** in `finishPrompt`. Tags: `no_x` / `no-x` tags (keeping "no humans"), tags of more than five words, "danbooru tags", "solo" beside a second person, "no humans" beside people, and hyphen-strung tags. Prose: sentences that only say what's absent ("No other people are visible.") go, while sentences that mean something ("No clothing on her.") stay.

### Full re-run against the baseline (60 runs each)

| | baseline | v8 |
|---|---|---|
| "shallow depth of field" (48 prose) | 46 | 13 |
| "35mm film" | 22 | 0 |
| "low angle" | 29 | 15 |
| "Color palette:" label | 16 | 0 |
| Pony partnered scenes with 1boy (of 5) | 0 | 4 |
| Pony partnered scenes with "solo" (of 5) | 4 | 2 |
| Pony with no_x tags | 2 | 0 |
| hit the token cap | 7 | 1 |
| median prose words | 146 | 119 |
| median time per prompt | 4.3 s | 4.0 s |

By eye: topless, missionary (mostly), "a man fucking her" and the person's crude wording now survive; the look is coherent (Kodak Gold becomes grain and low contrast; a graphic-novel style gets no lens); text appears exactly where asked ("How Espresso Works" as five labelled panels) and is no longer invented.

### Tried and dropped

- **Temperature.** At 0.5 and 0.7 (3 takes each) the same cases fail the same way, so the misreads are systematic, not sampling noise. The 0.7 default stays.
- **A phone-photo rule** ("sharp throughout, lit by the flash") was copied verbatim into prompts that never asked for a phone.
- **Splitting tags to one-to-three words** broke phrases into single words ("skirt, pulled, up").
- **Spelling out what to leave out** (sounds, music, smells), three wordings: each primed the thing it named.

### Known limits of the 4B model (not patched, to avoid tuning to the eval)

- Some act vocabulary: "giving a handjob… his cock in her fist" gives the woman the cock; "spitroasting" becomes spitting; "missionary with legs up by her head" sometimes becomes "from behind".
- A sound the person mentions still comes through about half the time (the party ramble), and storms get thunder.
- Decay it adds by habit: the cooling pie is "half-baked", the kitchen grimy.
- Filler such as "no filters or stylization, just raw detail".

### The other enhancer models

- **Qwen3.5 4B (HauhauCS uncensored fine-tune):** reads act vocabulary better (handjob, missionary, the whole pie), never refused, and on this PC ran at 25–37 tok/s (the 6 tok/s in the docs was measured with less VRAM free). But it copies examples (the Pony office scene came back as the doggystyle example word for word), and its first words take 2.7 s against 1.5 s. Qwen3-VL 4B stays the default.
- **Qwen3.5 2B:** the fastest (50–65 tok/s) and clearly weaker: it invents subjects (a grandma in the empty kitchen) and dresses nude scenes.

### Video (out of scope, checked so nothing broke)

LTX-2 still weaves in sound and speech, and Wan stays silent. Two old flaws remain: LTX invents dialogue nobody asked for, and on silent Wan a spoken line ("come here") becomes on-screen text.

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
