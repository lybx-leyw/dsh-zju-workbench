"""Generate static outlined SVG artwork for the workbench brand.

This is a one-off design utility, not a dependency of the application build.
Only the resulting vector paths ship; no font files or remote assets ship.

The mark is a blackboard outline; the wordmark pairs it with the product name.
Glyph outlines are traced from a local UI font so the assets render identically
without shipping a font. Point `--font` at any font that covers the name; the
default is the Windows UI font the artwork was originally drawn with.

    python scripts/generate-brand.py --font /path/to/font.ttc

Regeneration is only needed when the product name changes -- which is exactly
why the previous artwork (which spelled the old name in vector paths) could not
be kept as-is: text baked into paths cannot be renamed by editing strings.
"""
from argparse import ArgumentParser
from pathlib import Path

from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen

PRODUCT_NAME = 'ZJU Workbench'
# Only the wordmark carries the name; the square marks stay a plain blackboard,
# because the name does not fit legibly inside a 96 px screen.
WORDMARK_TEXT = PRODUCT_NAME

parser = ArgumentParser(description=__doc__)
parser.add_argument('--font', default='C:/Windows/Fonts/msyhbd.ttc', help='TTF/TTC that covers the product name')
parser.add_argument('--font-number', type=int, default=0, help='face index inside a .ttc')
args = parser.parse_args()

root = Path(__file__).resolve().parent.parent
target = root / 'packages/client/ui-shared/src/assets'
target.mkdir(parents=True, exist_ok=True)
font = TTFont(args.font, fontNumber=args.font_number)
glyphs = font.getGlyphSet()
cmap = font.getBestCmap()
units = font['head'].unitsPerEm


def outline(text, size, x, baseline):
    pen = SVGPathPen(glyphs)
    for character in text:
        name = cmap[ord(character)]
        scale = size / units
        glyphs[name].draw(TransformPen(pen, (scale, 0, 0, -scale, x, baseline)))
        x += font['hmtx'][name][0] * scale
    return pen.getCommands()


def text_width(text, size):
    scale = size / units
    return sum(font['hmtx'][cmap[ord(c)]][0] * scale for c in text)


screen = '<rect x="5" y="5" width="86" height="56" rx="15" fill="none" stroke="currentColor" stroke-width="5"/><path d="M29 62 26 73M67 62 70 73" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round"/>'
compact_screen = '<rect x="5" y="5" width="54" height="56" rx="13" fill="none" stroke="currentColor" stroke-width="5"/><path d="M22 62 20 73M42 62 44 73" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round"/>'
# The screen keeps a short abbreviation inside it, as the original artwork did;
# only the old product word is gone, so the mark still reads as a blackboard.
letters = f'<path fill="currentColor" d="{outline("ZJU", 29, 21, 47)}"/>'
icon = screen + letters
wordmark_text = f'<path fill="currentColor" d="{outline(WORDMARK_TEXT, 30, 108, 52)}"/>'
wordmark = icon + wordmark_text
wordmark_width = round(108 + text_width(WORDMARK_TEXT, 30) + 6)


def svg(content, width, color):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} 78" fill="none" '
            f'color="{color}" role="img" aria-label="{PRODUCT_NAME}">{content}</svg>\n')


for name, content, width, color in [
    ('zw-mark.svg', icon, 96, 'inherit'),
    ('zw-mark-compact.svg', compact_screen, 64, 'inherit'),
    ('zw-mark-blue.svg', wordmark, wordmark_width, '#00479d'),
    ('zw-mark-white.svg', wordmark, wordmark_width, '#ffffff'),
]:
    (target / name).write_text(svg(content, width, color), encoding='utf-8')
print(f'Generated four outlined brand assets for {PRODUCT_NAME!r}.')
