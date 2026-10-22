"""Normalize reviewed RGBA sprite sheets and encode runtime WebP atlases.

Development-only: python scripts/build-pet-assets.py --source <review folder>
Requires Pillow; never used by the installed application. Raw masters stay outside the package.
"""
import argparse
import hashlib
import json
from pathlib import Path
from PIL import Image

parser = argparse.ArgumentParser()
parser.add_argument('--source', type=Path, required=True)
args = parser.parse_args()
root = Path(__file__).resolve().parent.parent / 'resources' / 'pets'
source = json.loads((args.source / 'assets.json').read_text(encoding='utf-8'))
durations = {
    'idle': [(0, 4600), (1, 120), (2, 100), (3, 180)],
    'waiting': [(0, 1600), (1, 250), (2, 200), (3, 1600)],
    'pickup': [(0, 200), (1, 300), (2, 130), (3, 150), (4, 150), (5, 150)],
    'enter': [(0, 150), (1, 300), (2, 250), (3, 300)],
    'exit': [(0, 150), (1, 150), (2, 250), (3, 250)],
}
for route in source['routes']:
    target = root / route['id']
    target.mkdir(parents=True, exist_ok=True)
    skin = dict(id=route['id'], name=route['name'], author='Grok Build Desktop contributors' if route['id'] == 'a' else 'ZipZipPipe / PC2005-cloud / nanonocturne-altago; Grok adaptation', license='Original generated artwork' if route['id'] == 'a' else 'Adapted upstream character; see NOTICES.md', clips={})
    for name, clip in route['clips'].items():
        image = Image.open(args.source / clip['file']).convert('RGBA')
        reference = clip['frames'][clip.get('reference', 0)]['bounds']['height']
        scale = 384 / reference
        # Fixed standing-reference scale; never resize each pose to an equal-height box.
        cell_width, cell_height = 576, 480
        count = len(clip['frames'])
        columns = 2
        atlas = Image.new('RGBA', (cell_width * columns, cell_height * ((count + 1)//2)))
        frames = []
        for index, frame in enumerate(clip['frames']):
            b, anchor = frame['bounds'], frame['anchor']
            cropped = image.crop((b['x'], b['y'], b['x']+b['width'], b['y']+b['height']))
            size = (max(1, round(b['width']*scale)), max(1, round(b['height']*scale)))
            cropped = cropped.resize(size, Image.Resampling.LANCZOS)
            ax, ay = (anchor['x']-b['x'])*scale, (anchor['y']-b['y'])*scale
            left, top = round(cell_width/2-ax), round(cell_height-16-ay)
            if left < 0 or top < 0 or left+size[0] > cell_width or top+size[1] > cell_height:
                raise ValueError(f'Frame exceeds fixed canvas: {route["id"]}/{name}/{index}')
            x, y = index%columns*cell_width, index//columns*cell_height
            atlas.alpha_composite(cropped, (x+left, y+top))
            frames.append(dict(x=x, y=y, width=cell_width, height=cell_height, anchorX=cell_width/2, anchorY=cell_height-16, duration=250))
        sequence = durations.get(name) or clip.get('preview', {}).get('frames') or [[i, 250] for i in range(count)]
        runtime_frames = [{**frames[index], 'duration': duration} for index, duration in sequence]
        file = name+'.webp'
        atlas.save(target/file, 'WEBP', quality=83, method=6, exact=True)
        skin['clips'][name] = dict(file=file, width=atlas.width, height=atlas.height, referenceHeight=384, frames=runtime_frames, loop=name in ['idle','waiting','working','sleepy'])
    (target/'skin.json').write_text(json.dumps(skin, ensure_ascii=False, separators=(',', ':'))+'\n', encoding='utf-8')
files = sorted(p for p in root.rglob('*') if p.is_file())
total = sum(p.stat().st_size for p in files)
if total > 8*1024*1024:
    raise ValueError(f'Built-in pet resources exceed 8 MiB: {total}')
print(json.dumps(dict(bytes=total, files=len(files), sha256={str(p.relative_to(root)):hashlib.sha256(p.read_bytes()).hexdigest() for p in files}), indent=2))
