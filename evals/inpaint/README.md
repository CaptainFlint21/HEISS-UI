# Inpainting eval set

Real photos where strong lines cross the painted area, for checking HEISS's inpaint stitch on every release.

| Case | Image | What crosses the paint | Request |
|---|---|---|---|
| collar-necklace | portrait-collar-1600.png | two thin necklaces, both lapels | one thick silver chain necklace |
| flag-border | portrait-collar-1600.png | flag stripes and stars; touches the left border | a dark green velvet curtain |
| sign-text | sign-text-1600.png | carved letters, wood grain | GRAND TAHOE instead of GRAND TETON |
| beach-horizon | beach-horizon-1600.png | the horizon and the surf line | a large white sailing ship |
| astronaut-patches | portrait-astronaut-1600.png | zipper, collar, patch edges | a single gold star badge |

The masks are in `cases.json` (an ellipse in 0–1 image coordinates). `run.mjs` draws them to `masks/` at the image's size.

## Running it

Start HEISS UI against a ComfyUI with HEISS UI Nodes 5 or newer, then for each model:

```
node evals/inpaint/run.mjs --profile "<profile id from /api/workflows>" --seeds 101,102,103 --out artifacts/inpaint-verify/matrix
```

Options: `--case id,id`, `--feather 0..1`, `--strength 0.05..1`, `--count 2`, `--size 1024`, `--image <file in images/>`, `--hidden`, `--noab`.
`HEISS_URL` (default http://127.0.0.1:8790) and `COMFY_URL` (default http://127.0.0.1:8188).

Each run goes through `POST /api/generate`, the request the Generate button sends. Then the exact A/B: the run's own prompt from ComfyUI's `/history` is queued again with HeissInpaintStitch's `align` and `color_match` off. ComfyUI reuses the cached sample, so only the stitch changes. Outputs per run:

- `<family>-<case>-s<seed>-on.png` / `-off.png`: the stitched result and the plain blend
- `-ab.png`: both side by side, cropped around the paint
- `results.jsonl`: status, time, the `[HEISS Inpaint Stitch]` console line, HEISS's Seam line, the A/B timing, and the count of pixels that changed outside the repaint box (must be 0)

## Sources

All public domain, from Wikimedia Commons; the `-1600.png` working copies are resized from them.

- portrait-collar: [Official portrait of Allison Clements, FERC](https://commons.wikimedia.org/wiki/File:Official_portrait_of_Allison_Clements,_Federal_Energy_Regulatory_Commission.jpg) (US government work)
- portrait-astronaut: [Megan McArthur, official portrait (2020)](https://commons.wikimedia.org/wiki/File:Megan_McArthur,_official_portrait_(2020).jpg) (NASA)
- sign-text: [Grand Teton National Park entrance sign](https://commons.wikimedia.org/wiki/File:Grand_Teton_National_Park_entrance_sign_(53043768020).jpg) (NPS). The full 7796×5200 original is the 4000 px+ case; it isn't kept in the repo (20 MB), so download it from that page.
- beach-horizon: [Grand Isle beach](https://commons.wikimedia.org/wiki/File:Grand_Isle_beach_(4930658162).jpg) (USFWS)
