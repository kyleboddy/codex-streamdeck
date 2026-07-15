import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const pluginRoot = join(root, "com.driveline.codex-command-center.sdPlugin");
const profileManifestPath = join(
  root,
  "profile-src",
  "B70D27A4-6A71-4C7A-942D-2A90FA660C2A.sdProfile",
  "Profiles",
  "3E0895BC-6AE2-49C1-BBBD-8D856C4D390C",
  "manifest.json",
);

const json = async (path) => JSON.parse(await readFile(path, "utf8"));
const hash = async (path) => createHash("sha256").update(await readFile(path)).digest("hex");

test("the installed profile is six direct buttons, two blanks, and two dials", async () => {
  const profile = await json(profileManifestPath);
  const keypad = profile.Controllers.find(({ Type }) => Type === "Keypad").Actions;
  const encoders = profile.Controllers.find(({ Type }) => Type === "Encoder").Actions;

  assert.deepEqual(
    Object.entries(keypad).map(([position, action]) => [position, action.UUID.split(".").at(-1)]),
    [
      ["0,0", "new-task"],
      ["1,0", "review"],
      ["2,0", "approve"],
      ["3,0", "decline"],
      ["0,1", "stop"],
      ["1,1", "fork"],
      ["2,1", "blank1"],
      ["3,1", "blank2"],
    ],
  );
  assert.deepEqual(
    Object.entries(encoders).map(([position, action]) => [position, action.UUID.split(".").at(-1)]),
    [
      ["0,0", "reasoning"],
      ["1,0", "model"],
    ],
  );
});

test("all marketplace actions have unique production artwork", async () => {
  const manifest = await json(join(pluginRoot, "manifest.json"));
  assert.equal(manifest.Actions.length, 12);
  assert.equal(manifest.Actions.filter(({ Controllers }) => Controllers.includes("Encoder")).length, 2);
  assert.equal(manifest.Actions.filter(({ Controllers }) => Controllers.includes("Keypad")).length, 10);

  const imageHashes = [];
  for (const action of manifest.Actions) {
    for (const base of [action.Icon, action.States[0].Image]) {
      await readFile(join(pluginRoot, `${base}.png`));
      await readFile(join(pluginRoot, `${base}@2x.png`));
    }
    imageHashes.push(await hash(join(pluginRoot, `${action.States[0].Image}.png`)));
  }
  assert.equal(new Set(imageHashes).size, manifest.Actions.length);
});

test("the GPT Image source artwork contains thirteen distinct compositions", async () => {
  const generatedRoot = join(root, "assets", "generated");
  const files = (await readdir(generatedRoot)).filter((name) => name.endsWith(".png")).sort();
  assert.equal(files.length, 13);
  const hashes = await Promise.all(files.map((name) => hash(join(generatedRoot, name))));
  assert.equal(new Set(hashes).size, files.length);
});
