# RTX video upscale

Upscales videos in seconds on NVIDIA RTX cards with NVIDIA's RTX Video Super Resolution (VSR), and can make them smoother with RTX Frame Generation. Branch: `feature/rapid` (it's a speed feature), with the nodes in ComfyUI-HEISS-UI-Nodes (on its `main`).

**What it is, and isn't.** VSR is a fast per-frame network that sharpens and cleans what's already in a frame: compression blocks, softness, noise. It doesn't draw new detail the way SeedVR2 does. That's why it takes seconds where SeedVR2 takes many minutes. One example: tritant's README shows 464 frames to 2560×3840 in 27 s. So:

- RTX is the upscaler for **video**.
- SeedVR2 stays the one for **pictures**.

Expect "crisper", not "remastered". It won't fix a warped hand, and may make it crisper.

## Who gets it

| Machine | Upscale | Smooth (Frame Generation) |
|---|---|---|
| RTX 40 / 50 series (Ada, Blackwell) | yes | yes |
| RTX 20 / 30 series (Turing, Ampere) | yes | no |
| GTX, older NVIDIA | no | no |
| Mac, AMD, Intel, CPU | no, and never shown | no |

NVIDIA's package also needs Windows or Linux and driver 570 or newer. HEISS decides from facts, not names:

- ComfyUI's device decides whether it's offered at all.
- The pack's own check (`GET /heiss/rtx/status`) reports:
  - the compute capability (7.5+ to upscale, 8.9+ to smooth)
  - ComfyUI's PyTorch and CUDA
  - whether NVIDIA's package is installed
- With `probe=1`, a 64×64 upscale really runs.

## The PyTorch "cu130" question

Comfy-Org's own nodes say "cu130 or higher PyTorch is required". What we found:

- **cu130 isn't exotic any more.** PyTorch has published CUDA 13.0 builds since 2.9, about a year ago. The plain `pip install torch` on PyPI is a cu130 build today (2.14.1, checked while building this). ComfyUI's Windows portable ships PyTorch for CUDA 13.0. Most current installs already have it; older venvs and hand-built setups may be on cu12x.
- **Nothing in our nodes depends on it.** They hand frames to NVIDIA's package through DLPack, which works with any CUDA build of PyTorch. NVIDIA's own requirement is the driver (570+). The cu130 warning people quote seems to be ComfyUI's general "optimized CUDA operations" note, not something VFX needs. **Unverified on hardware**: that's what the probe is for. It runs on the person's machine and says plainly if it doesn't work there.
- **Upgrading PyTorch in a tangled ComfyUI is real hassle.** Other packs pin versions, and xformers is known to pull PyTorch back to cu128. So HEISS never upgrades PyTorch itself; its installs hold torch where it is (`pack-installer.js`).

**How hard to push it:** for most NVIDIA users it's two clicks (the nodes, then NVIDIA's package, about 0.5 GB), so it can be shown confidently to them. It should never be the headline of a release, since Mac and AMD users can't have it. Put it in the release notes and on the site as an NVIDIA bonus. If the probe shows that cu12x installs fail in practice, the copy should say "needs a current ComfyUI" next to it.

## Parts

### 1. The nodes (`ComfyUI-HEISS-UI-Nodes/heiss_rtx.py`)

They draw on both nodes that came before them (both Apache-2.0):

| | Comfy-Org/Nvidia_RTX_Nodes_ComfyUI | tritant/…_VSR_Long_Video | HEISS RTX |
|---|---|---|---|
| Input | IMAGE batch | VIDEO | VIDEO (and IMAGE for pictures) |
| Memory | every frame in and out in RAM (about 6 GB for 5 s at 4×) | one chunk, temp files on disk | one frame, straight to the encoder |
| Frame Generation | separate node | no | in the same pass, at source size before upscaling |
| Pack without NVIDIA | fails to load (imports nvvfx at load) | n/a | loads anywhere: nothing NVIDIA until a node runs |
| Encoder | ComfyUI's | NVENC or error | NVENC when it fits, else libx264, never an error |
| Audio | workflow's job | kept | kept (AAC), cut to the video's length |
| Readiness check | none | none | `/heiss/rtx/status`, with a real probe |

**HEISS RTX Video** (`HeissRTXVideo`):
- Inputs: `video`, `scale`, `quality`, `strength`, `cleanup` (deblur/denoise first), `smooth` (1–4) and `filename_prefix`.
- It's an output node: it saves the MP4 itself and reports what it did (`ui.heiss_rtx`).
- Load Video's file is decoded straight from disk. Trimmed or cropped videos, and Create Video's frames, come through ComfyUI's own components.
- A stopped run leaves no partial file.

**HEISS RTX Upscale** (`HeissRTXUpscale`): IMAGE → IMAGE, for pictures. Not used by HEISS yet.

**Install:**
- `requirements.txt` stays empty, so Rapid installs anywhere.
- NVIDIA's package is in `requirements-rtx.txt`, from `https://pypi.nvidia.com`. PyPI only has a stub that fetches from there while installing.

**Tests** (`tests/test_rtx.py`, 17) run the whole pipeline against a stand-in for `nvvfx`, including ComfyUI's own Load Video and Create Video classes:
- frame order with smoothing
- sizes
- audio on long videos (this caught a real bug: the audio track has to exist before the encoder's first packet)
- streaming from a file without decoding it whole
- trims, cleanup on stop, effects released
- the pack loading without NVIDIA

### 2. Server (`server/rtx.js`)

- `node-packs.js`:
  - `heiss` is pinned at the RTX commit and lists the RTX nodes, so an older copy gets the update panel.
  - `heissrtx` is the same folder and commit, installing `requirements-rtx.txt` from NVIDIA's index (`requirements`, `pipIndex` and `noRestart` are new pack fields, honoured by `node-install.js` and `pack-installer.js`).
- `rtxStatusFrom`: `offered`, then the stage (`nodes` → `package` → `ready`, or `error` with the probe's reason), `frameGeneration`, the device, and PyTorch/CUDA.
- **Tiers:** 2K and 4K aim the short side at 1440 and 2160, clamped to 1×–4× and 8192 per side. A 480p Wan clip becomes 3× (2K) or 4× (4K, 1920 short side).
- **Quality model:**
  - In a run, frames come fresh from the decoder, so `HIGHBITRATE_HIGH`.
  - From the gallery, the file has been through H.264 once, so `HIGH`.
- **Gallery upscale** (`/api/upscale` with a video):
  - Load Video reads ComfyUI's own copy as `name [output]`, so nothing is uploaded. Checked against a real ComfyUI.
  - It runs through the same job runner as SeedVR2's arrow: progress, stop, time learned under quality `rtx`, with work counted as pixels × frames.
- **In a run** (`rtxVideo: { tier, smooth }`):
  - HEISS RTX Video sits next to every Save Video and takes the same VIDEO, so the original is saved first and kept if the upscale stops or fails.
  - The video and its upscale pair up as Smart upscale's pictures do.
- **Not for Hidden yet**, in a run or from the gallery: a Hidden video is sealed as it's made, and its upscale would leave ComfyUI's plaintext copy behind.

### 3. App

- `src/app/rtx.ts` asks once per page whether it's offered and ready, shared by every place that shows it.
- **Videos** get the upscale arrow (2K, or 4K when that's the video tier picked), flip between versions like pictures do, and the viewer plays whichever version is shown.
- **Video models** get the size menu's tabs, titled "RTX upscale". They're shown only on NVIDIA machines, with Smart upscale on.
- **Settings › Features › Smart upscale › Videos (NVIDIA RTX):**
  - where setup stands, with the install panel for the missing part
  - what this machine runs (card, PyTorch for CUDA x)
  - Check again (runs the probe)
  - the Smoother video switch, off and explained on cards before the 40 series

## Not done yet

1. **Run it on real RTX cards**, a 30-series and a 40/50-series:
   - the probe
   - a gallery upscale and a run with 2K/4K, and smoothing
   - NVENC vs libx264 times
   - whether a cu12x PyTorch works
2. Quality defaults on real Wan, Hunyuan and H3 output: `HIGHBITRATE_HIGH` vs `HIGH`, and whether a light `DEBLUR` first pass helps soft AI video, which community reports suggest.
3. The phone's create sheet has no video tabs yet (the gallery arrow works on phones).
4. After NVIDIA's package installs, the install panel still suggests a restart, which isn't needed.
5. Installing the nodes themselves goes through the HEISS Nodes dialog (docs/heiss-nodes.md).
6. Hidden videos.
7. An optional "Quick" picture upscale on NVIDIA with HEISS RTX Upscale.
