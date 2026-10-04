"""Smaller copies of the homepage photos, so phones don't download 2400px originals.

Run from the repo root after adding or swapping photos in trip-config.js:

    python tools/photo_sizes.py

For every photo trip-config.js shows on the page (not the full-screen `full:` versions, not the
360px course thumbs), it writes <folder>/sized/<name>-<width>.jpg at 320/480/640/960/1280/1920px (only
widths smaller than the original). Hero photos also get <name>-portrait.jpg: the middle of the
photo at full resolution, which is all a phone held upright ever shows of a full-screen backdrop.
assets/photo-sizes.js lists what exists; script.js reads it and leaves any photo not listed as is.
Needs Pillow (pip install pillow). Existing copies are kept unless the original is newer.
"""
import json
import os
import re
import sys

from PIL import Image, ImageOps

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WIDTHS = [320, 480, 640, 960, 1280, 1920]
QUALITY = 78
# Portrait crop: 3:5 covers every phone held upright (taller screens crop a little more)
PORTRAIT = 3 / 5


def config_photos():
    text = open(os.path.join(ROOT, 'trip-config.js'), encoding='utf-8').read()
    photos, heroes = [], []
    hero = re.search(r"hero:\s*\{.*?images:\s*\[(.*?)\]", text, re.S)
    if hero:
        heroes = re.findall(r"'(assets/[^']+\.jpe?g)'", hero.group(1))
    for key, path in re.findall(r"(\w+):\s*'(assets/[^']+\.jpe?g)'", text):
        if key in ('full', 'thumb') or '/thumbs/' in path:
            continue
        photos.append(path)
    # Also the hero list and anything in a srcs: [...] list
    for block in re.findall(r"srcs:\s*\[(.*?)\]", text, re.S):
        photos += [p for p in re.findall(r"'(assets/[^']+\.jpe?g)'", block) if '/thumbs/' not in p]
    photos += heroes
    seen, out = set(), []
    for p in photos:
        if p not in seen:
            seen.add(p)
            out.append(p)
    return out, set(heroes)


def sized_path(path, suffix):
    folder, name = os.path.split(path)
    return f"{folder}/sized/{os.path.splitext(name)[0]}-{suffix}.jpg"


def save(img, rel, src_mtime):
    out = os.path.join(ROOT, rel)
    if os.path.exists(out) and os.path.getmtime(out) >= src_mtime:
        return False
    os.makedirs(os.path.dirname(out), exist_ok=True)
    img.save(out, 'JPEG', quality=QUALITY, optimize=True, progressive=True)
    return True


def main():
    photos, heroes = config_photos()
    manifest, made = {}, 0
    for rel in photos:
        src = os.path.join(ROOT, rel)
        if not os.path.exists(src):
            print(f'missing: {rel}', file=sys.stderr)
            continue
        mtime = os.path.getmtime(src)
        with Image.open(src) as im:
            im = ImageOps.exif_transpose(im).convert('RGB')
            w, h = im.size
            widths = [x for x in WIDTHS if x < w * 0.9]
            for x in widths:
                made += save(im.resize((x, round(h * x / w)), Image.LANCZOS), sized_path(rel, x), mtime)
            entry = {'w': w, 'sizes': widths}
            if rel in heroes and w / h > PORTRAIT:
                cw = round(h * PORTRAIT)
                left = (w - cw) // 2
                made += save(im.crop((left, 0, left + cw, h)), sized_path(rel, 'portrait'), mtime)
                entry['portrait'] = True
            if widths or entry.get('portrait'):
                manifest[rel] = entry
    rows = [f'    {json.dumps(k)}: {json.dumps(manifest[k])}' for k in sorted(manifest)]
    body = '{\n' + ',\n'.join(rows) + '\n}'
    with open(os.path.join(ROOT, 'assets', 'photo-sizes.js'), 'w', encoding='utf-8', newline='\n') as f:
        f.write('// Made by tools/photo_sizes.py: run it again after changing photos in trip-config.js.\n')
        f.write('// Smaller copies of each photo (<folder>/sized/<name>-<width>.jpg) that script.js offers phones.\n')
        f.write(f'window.BBB_PHOTO_SIZES = {body};\n')
    print(f'{len(manifest)} photos listed, {made} files written')


if __name__ == '__main__':
    main()
