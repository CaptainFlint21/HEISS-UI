"""Side-by-side sheet: sheet.py OUT.jpg COLS W FILE... (labels from file names). Rows fill left to right."""
import sys, os
from PIL import Image, ImageDraw
out, cols, w = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
files = sys.argv[4:]
tiles = []
for f in files:
    im = Image.open(f).convert("RGB")
    h = int(im.height * w / im.width)
    im = im.resize((w, h), Image.LANCZOS)
    d = ImageDraw.Draw(im)
    label = os.path.basename(os.path.dirname(f)) + "/" + os.path.splitext(os.path.basename(f))[0]
    d.rectangle([0, 0, w, 22], fill=(0, 0, 0))
    d.text((6, 4), label[-60:], fill=(255, 255, 0))
    tiles.append(im)
rows = (len(tiles) + cols - 1) // cols
th = max(t.height for t in tiles)
sheet = Image.new("RGB", (cols * w, rows * th), (30, 30, 30))
for i, t in enumerate(tiles):
    sheet.paste(t, ((i % cols) * w, (i // cols) * th))
sheet.save(out, quality=88)
print(out, sheet.size)
