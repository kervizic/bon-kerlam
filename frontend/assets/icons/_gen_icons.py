#!/usr/bin/env python3
"""Genere les icones PNG de la PWA bon.kerlam.fr sans dependance (zlib + struct).

- icon-192 / icon-512 : fond anthracite #2B2B2B, carre orange #FF9300 centre.
- icon-maskable-192 / -512 : fond orange plein (safe-zone maskable respectee),
  carre anthracite centre plus petit.
"""
import os
import struct
import zlib

ANTHRACITE = (0x2B, 0x2B, 0x2B)
ORANGE = (0xFF, 0x93, 0x00)


def write_png(path, size, bg, fg, fg_ratio):
    """Ecrit un PNG RGB carre: fond `bg`, carre centre `fg` occupant `fg_ratio`."""
    inner = int(size * fg_ratio)
    start = (size - inner) // 2
    end = start + inner

    # Lignes brutes: chaque ligne prefixee d'un octet de filtre (0 = None).
    raw = bytearray()
    br, bgc, bb = bg
    fr, fgc, fb = fg
    bg_pixel = bytes((br, bgc, bb))
    fg_pixel = bytes((fr, fgc, fb))
    for y in range(size):
        raw.append(0)  # filtre None
        in_y = start <= y < end
        for x in range(size):
            raw += fg_pixel if (in_y and start <= x < end) else bg_pixel

    def chunk(tag, data):
        out = struct.pack(">I", len(data)) + tag + data
        crc = zlib.crc32(tag + data) & 0xFFFFFFFF
        return out + struct.pack(">I", crc)

    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)  # 8 bits, RGB
    idat = zlib.compress(bytes(raw), 9)
    png = sig + chunk(b"IHDR", ihdr) + chunk(b"IDAT", idat) + chunk(b"IEND", b"")
    with open(path, "wb") as f:
        f.write(png)


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    specs = [
        ("icon-192.png", 192, ANTHRACITE, ORANGE, 0.55),
        ("icon-512.png", 512, ANTHRACITE, ORANGE, 0.55),
        # Maskable: fond orange plein, motif interne dans la safe-zone.
        ("icon-maskable-192.png", 192, ORANGE, ANTHRACITE, 0.45),
        ("icon-maskable-512.png", 512, ORANGE, ANTHRACITE, 0.45),
    ]
    for name, size, bg, fg, ratio in specs:
        write_png(os.path.join(here, name), size, bg, fg, ratio)
        print("ecrit:", name)


if __name__ == "__main__":
    main()
