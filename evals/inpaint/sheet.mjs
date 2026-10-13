// A contact sheet of one model's A/B pairs, for reviewing a run at a glance.
//   node evals/inpaint/sheet.mjs <runs dir> <family>   ->  <runs dir>/<family>-sheet.png
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const [dir, family] = process.argv.slice(2);
const files = fs.readdirSync(dir).filter((name) => name.startsWith(`${family}-`) && name.endsWith("-ab.png")).sort();
const cell = { width: 900, height: 300 };
const tiles = [];
for (const [index, name] of files.entries()) {
  const image = await sharp(path.join(dir, name)).resize(cell.width, cell.height - 22, { fit: "contain", background: "#202020" }).png().toBuffer();
  const label = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${cell.width}" height="22"><rect width="100%" height="100%" fill="#202020"/><text x="6" y="16" font-family="Arial" font-size="14" fill="#ffd400">${name.replace(`${family}-`, "").replace("-ab.png", "")}</text></svg>`);
  const x = (index % 2) * cell.width;
  const y = Math.floor(index / 2) * cell.height;
  tiles.push({ input: label, left: x, top: y }, { input: image, left: x, top: y + 22 });
}
const rows = Math.ceil(files.length / 2);
await sharp({ create: { width: cell.width * 2, height: rows * cell.height, channels: 3, background: "#202020" } })
  .composite(tiles).png().toFile(path.join(dir, `${family}-sheet.png`));
console.log(`${files.length} pairs -> ${family}-sheet.png`);
