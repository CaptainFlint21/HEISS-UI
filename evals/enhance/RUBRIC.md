# Reading enhanced prompts

Editorial notes for judging enhancer output by eye, against the Civitai reference set. Not a checklist: the reference set is full of prompts that break "rules" and still work (quality tags in prose, "Create an image of…", a closing mood line, Markdown labels, sentences in Pony prompts, the explicit part at the end, SDXL prompts far past 75 tokens). The question is always: would this get the picture the person meant, and would someone who writes prompts like the references be happy with it?

## Real failures

- It changed what was asked: another act, pose, person count, setting or style; something named is gone; a self-correction ignored ("actually make it a pie").
- It softened or censored: euphemism where the person was explicit, clothing they didn't ask for, the explicit part watered down or missing.
- It added what wasn't asked for: sex into a clean idea, extra people, a younger look.
- It talks instead of writing (preface, refusal, question), or stops mid-sentence.
- The wrong kind of prompt for the model: a paragraph of prose for Pony, a bare tag dump for Krea or Qwen.

## What good ones do (taste, not rules)

- **Keep the person's picture and make it specific.** Vague input gets the obvious best reading filled in; detailed input gets tidied, not reinvented. A ramble keeps all its visual details and loses the filler.
- **Concrete and physical.** Poses you could direct, what the camera sees, what's near and far, real materials. Specific beats generic ("chipped black nail polish" over "stunning").
- **NSFW in plain words.** The references name acts and anatomy the way people say them; that's what the model was prompted with and what works.
- **A believable camera and light** that match the look: phone flash, 24mm from the floor, Kodak Gold, low sun through blinds. Amateur stays amateur.
- **Mostly what can be seen.** Sounds, thoughts, backstory and off-frame action waste words; a line of mood or aesthetic at the end is normal and fine. "People banging on the door" is the kind of thing that should quietly go.
- **Fits the model.** Krea 2, Qwen-Image and Flux: prose, long is fine when it's all picture. SDXL: short phrases and tags, photo cues up front. Pony: score tags, count tag, then tags for act, body, outfit, expression, camera, setting.

## The reference set

`civitai_prompts_all.md` (Downloads): top-collected prompts per base model, mostly NSFW, some weak outliers to ignore.
