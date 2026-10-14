import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

// A ComfyUI of our own, before the modules read where it is.
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "heiss-nodes-"));
process.env.HEISS_COMFY_ROOT = path.join(scratch, "ComfyUI");
process.env.HEISS_DATA_DIR = path.join(scratch, "data");
test.after(() => fs.rmSync(scratch, { recursive: true, force: true }));

const { heissFeatures, heissNodesStatusFrom, localHeissCopy } = await import("./heiss-nodes.js");
const { nodePacks } = await import("./node-packs.js");
const { packInstallPlan } = await import("./node-install.js");
const { packInstallState, packVersionOnDisk, startPackInstall } = await import("./pack-installer.js");

const root = path.join(scratch, "ComfyUI");
const folder = path.join(root, "custom_nodes", nodePacks.heiss.folder);
const nodes = (...names) => Object.fromEntries(names.map((name) => [name, {}]));
const allNodes = nodes(...nodePacks.heiss.nodes);
const report = (version) => ({ pack: "heiss-ui-nodes", version, commit: "", nodes: [] });
const writeCopy = (version, { git = false } = {}) => {
  fs.rmSync(folder, { recursive: true, force: true });
  fs.mkdirSync(folder, { recursive: true });
  if (version) fs.writeFileSync(path.join(folder, "heiss_info.py"), `"""docs"""\n\nPACK_VERSION = ${version}\n`);
  if (git) {
    fs.mkdirSync(path.join(folder, ".git"));
    fs.writeFileSync(path.join(folder, ".git", "HEAD"), `${nodePacks.heiss.commit}\n`);
  }
};

test("every feature on the pack needs a version the pinned pack has", () => {
  for (const feature of heissFeatures) {
    assert.ok(feature.version <= nodePacks.heiss.version, feature.id);
    for (const node of feature.nodes) assert.ok(nodePacks.heiss.nodes.includes(node), `${feature.id}: ${node}`);
  }
  // The pin may be newer than every feature needs: pack 9 only improves Rapid's pictures, and older copies keep Rapid.
  assert.ok(Math.max(...heissFeatures.map((feature) => feature.version)) <= nodePacks.heiss.version);
});

test("install, update, restart and ready, from what ComfyUI loaded and what's on disk", () => {
  const fresh = heissNodesStatusFrom({ info: {}, local: { present: false, git: false, head: "", version: 0 } });
  assert.equal(fresh.state, "install");
  assert.ok(fresh.features.every((feature) => !feature.ready));

  // A Rapid-only copy from before the version route: Rapid still runs, RTX, the inpaint stitch and prompt enhance wait for the update.
  const old = heissNodesStatusFrom({ info: nodes("HeissRapid", "HeissRapidGuidance"), report: null, local: { present: true, git: true, head: "abc", version: 0 } });
  assert.deepEqual([old.state, old.loadedVersion], ["update", 2]);
  assert.deepEqual(old.features.map((feature) => [feature.id, feature.ready]), [["rapid", true], ["rtx", false], ["inpaint", false], ["enhance", false]]);
  assert.equal(heissNodesStatusFrom({ info: nodes("HeissRapid"), local: null }).loadedVersion, 1);

  // Updated on disk, ComfyUI not restarted yet.
  const waiting = heissNodesStatusFrom({ info: nodes("HeissRapid", "HeissRapidGuidance"), local: { present: true, git: true, head: nodePacks.heiss.commit, version: nodePacks.heiss.version } });
  assert.deepEqual([waiting.state, waiting.local.onPin], ["restart", true]);

  const ready = heissNodesStatusFrom({ info: allNodes, report: report(nodePacks.heiss.version), local: null });
  assert.equal(ready.state, "ready");
  assert.ok(ready.features.every((feature) => feature.ready));
  // A newer pack than HEISS knows (someone updated it) is fine.
  assert.equal(heissNodesStatusFrom({ info: allNodes, report: report(nodePacks.heiss.version + 1) }).state, "ready");
  // ComfyUI elsewhere: nothing on disk to look at, the loaded nodes decide.
  assert.equal(heissNodesStatusFrom({ info: {}, local: null }).state, "install");
});

test("the copy on disk is read for its version, git or not", () => {
  writeCopy(2);
  assert.deepEqual(localHeissCopy(root), { present: true, git: false, head: "", version: 2 });
  writeCopy(3, { git: true });
  assert.deepEqual(localHeissCopy(root), { present: true, git: true, head: nodePacks.heiss.commit, version: 3 });
  writeCopy(0);
  assert.equal(packVersionOnDisk(folder, nodePacks.heiss), 0);
  fs.rmSync(folder, { recursive: true, force: true });
  assert.equal(localHeissCopy(root).present, false);
  assert.equal(localHeissCopy(""), null);
});

test("the terminal command works with or without an older copy there", () => {
  const remote = packInstallPlan(nodePacks.heiss, "", "linux").commands[0].command;
  assert.match(remote, /\{ \[ -d "ComfyUI-HEISS-UI-Nodes" \] \|\| git clone https:\/\/github\.com\/tristmeister\/ComfyUI-HEISS-UI-Nodes\.git; \} && git -c "safe\.directory=\*" -C ComfyUI-HEISS-UI-Nodes fetch origin && git -c "safe\.directory=\*" -C ComfyUI-HEISS-UI-Nodes checkout --detach [0-9a-f]{40}/);
  const [powershell, cmd] = packInstallPlan(nodePacks.heiss, "", "win32").commands;
  assert.match(powershell.command, /if \(-not \(Test-Path -LiteralPath "ComfyUI-HEISS-UI-Nodes"\)\) \{ git clone /);
  assert.match(cmd.command, /\(if not exist "ComfyUI-HEISS-UI-Nodes" git clone [^)]+\) && git -c "safe\.directory=\*" -C ComfyUI-HEISS-UI-Nodes fetch origin/);
  // A pack that doesn't move with HEISS keeps its plain clone.
  assert.doesNotMatch(packInstallPlan(nodePacks.seedvr2, "", "linux").commands[0].command, /\[ -d/);
});

test("an older copy without git is set aside (never deleted) and the reviewed one installed", { skip: process.platform === "win32" }, async () => {
  // Our own ComfyUI Python, and a `git` that only pretends, so nothing is downloaded.
  const python = path.join(root, ".venv", "bin", "python");
  fs.mkdirSync(path.dirname(python), { recursive: true });
  fs.writeFileSync(python, "#!/bin/sh\necho pip \"$@\"\n", { mode: 0o755 });
  const bin = path.join(scratch, "bin");
  fs.mkdirSync(bin, { recursive: true });
  // HEISS passes "-c safe.directory=<folder>" first (gitArgsIn); the subcommand comes after.
  fs.writeFileSync(path.join(bin, "git"), `#!/bin/sh
while [ "$1" = "-c" ]; do shift 2; done
case "$1" in
  clone) mkdir -p "$4/.git"; echo "${nodePacks.heiss.commit}" > "$4/.git/HEAD"; printf 'PACK_VERSION = 3\\n' > "$4/heiss_info.py" ;;
  rev-parse) echo "${nodePacks.heiss.commit}" ;;
esac
exit 0
`, { mode: 0o755 });
  const before = process.env.PATH;
  process.env.PATH = `${bin}${path.delimiter}${before}`;
  try {
    writeCopy(2);
    fs.writeFileSync(path.join(folder, "mine.txt"), "kept");
    let state = await startPackInstall("heiss");
    for (let i = 0; i < 100 && state.status === "running"; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      state = packInstallState("heiss");
    }
    assert.equal(state.status, "done", state.error);
    const aside = fs.readdirSync(path.join(root, "custom_nodes")).find((name) => name.endsWith(".disabled"));
    assert.match(aside, /^ComfyUI-HEISS-UI-Nodes-v2-\d+\.disabled$/);
    assert.equal(fs.readFileSync(path.join(root, "custom_nodes", aside, "mine.txt"), "utf8"), "kept");
    assert.equal(packVersionOnDisk(folder, nodePacks.heiss), 3);
  } finally {
    process.env.PATH = before;
  }
});
