"""Render the ORIGINAL facade texture (and the skyline) to PNGs for comparison."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from scene import textures

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'reference')


def save(texture, name):
    image = texture._texture  # noqa: SLF001
    # Ursina Texture wraps a Panda texture; use the stored PIL image when present.
    pil = getattr(texture, 'image', None)
    if pil is None:
        from PIL import Image
        import io
        png = io.BytesIO()
        texture._texture.write(png, 'png')  # noqa: SLF001
        png.seek(0)
        pil = Image.open(png)
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, name)
    pil.save(path)
    pixels = list(pil.convert('RGB').getdata())
    avg = sum(sum(p) / 3 for p in pixels) / len(pixels)
    mx = max(sum(p) / 3 for p in pixels)
    print(f'{name}: {pil.size} avg={avg:.1f} max={mx:.1f}')


def main():
    save(textures.facade_texture(), 'facade_py.png')
    save(textures.wood_texture(), 'wood_py.png')
    save(textures.city_skyline_texture(), 'skyline_py.png')


if __name__ == '__main__':
    main()
