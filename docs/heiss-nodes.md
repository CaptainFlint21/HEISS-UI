# HEISS UI Nodes: installing and keeping the pack current

HEISS's own ComfyUI pack ([ComfyUI-HEISS-UI-Nodes](https://github.com/tristmeister/ComfyUI-HEISS-UI-Nodes)) carries every feature that needs custom nodes: Rapid, Rapid Guidance, RTX video upscale and the inpaint stitch so far. People install it once, the first time they touch one of those features, and HEISS offers an update whenever a newer HEISS needs a newer pack.

## The pieces

| Where | What |
|---|---|
| Pack: `heiss_info.py` | `PACK_VERSION`, one integer that goes up whenever HEISS needs something new from the pack. `GET /heiss/nodes` returns `{ version, commit, nodes }`. |
| `server/node-packs.js` (`heiss`) | The reviewed `commit` HEISS installs, and its `version`. Both ship with HEISS, so a release zip and a git clone of HEISS ask for the same pack. |
| `server/heiss-nodes.js` | `heissFeatures`: each feature, its nodes and the pack version it needs. The pack's state comes from what ComfyUI loaded and what's on disk. |
| `GET /api/heiss-nodes` | That state, the features and the install panel. `/api/rapid/status` and RTX's nodes stage read from it. |
| `src/app/heissNodes.ts` | `requireHeissNodes(feature, then)`: runs `then` when the feature is ready, else opens the dialog and runs it once the feature is. |
| `src/app/HeissNodesDialog.tsx` | The dialog: Install (or Update) → Restart → Ready, with what the pack brings. |
| Settings › Features › HEISS UI Nodes | The version ComfyUI runs, and Set up / Update / Details. |
| `POST /heiss/models/rescan` (pack 8) | Drops ComfyUI's cached model lists, so a model HEISS just downloaded is listed on drives whose folders never change their modified time (exFAT). Prompt enhance's setup calls it ([prompt-enhance.md](prompt-enhance.md)). |

## States

- **ready**: loaded, at the version HEISS needs or newer. Someone who updated the pack themselves is fine.
- **restart**: the right version is on disk, but ComfyUI hasn't restarted yet.
- **update**: loaded or on disk, but older. Features the older pack has keep working. Packs from before version 3 had no version route, so their nodes tell them apart (Rapid only = 1, with Rapid Guidance = 2).
- **install**: not there.

## How each install situation is handled

| Situation | What happens |
|---|---|
| ComfyUI on this computer, no pack | One click: clone at the reviewed commit and install `requirements.txt` with ComfyUI's Python, PyTorch held. Then the ComfyUI restart. |
| Older git checkout | One click: fetch, then check out the reviewed commit. Left alone if it has local edits (it says so) or is already past the pin. |
| Older copy without git (a zip, Manager's registry) | One click: it's renamed to `ComfyUI-HEISS-UI-Nodes-v<N>-<time>.disabled`, which ComfyUI skips, and installed fresh. Nothing is deleted. |
| ComfyUI on another computer | The terminal command for that machine. It works whether an older copy is there or not: clone if missing, fetch, check out the pin, pip. |
| Installed by hand or in Manager while the dialog is open | The dialog checks every 4 s and moves on by itself. |
| Restart | ComfyUI-Manager's restart, or "restart it yourself"; the dialog waits for the new version to load. |

Tested end to end against a real ComfyUI and the real pack on GitHub: a fresh install, an update from a version 2 git checkout, an update from a version 2 copy without git, each through restart to ready.

## Adding a feature that needs nodes

1. Add the node to the pack, and raise `PACK_VERSION` in `heiss_info.py`.
2. Push it to the pack's `main`. Pin that commit and the new `version` in `node-packs.js` (`heiss`, and `heissrtx`, which shares the folder).
3. Add the feature to `heissFeatures`, with its nodes and that version.
4. In the app, call `requireHeissNodes('<id>', then)` wherever the feature is first used.

Anyone on an older pack gets the Update dialog the first time they touch the new feature, and only then.
