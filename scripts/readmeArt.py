"""Draws the README artwork into docs/images. Run: python3 scripts/readmeArt.py docs/images"""
import os
import sys

out = sys.argv[1]
os.makedirs(out, exist_ok=True)

INK, PAPER, GREEN, MUTED, RAISED, LINE = '#101513', '#F1EFE8', '#2BD67B', '#B6B4AA', '#1B231F', '#2E3832'
FONT = "'Space Grotesk','Inter','Segoe UI',Helvetica,Arial,sans-serif"


def write(name, text):
    with open(os.path.join(out, name), 'w') as f:
        f.write(text.strip() + '\n')


def mark(x, y, size):
    s = size / 256
    return f'''<g transform="translate({x} {y}) scale({s})">
<rect width="256" height="256" rx="56" fill="{INK}" stroke="{LINE}" stroke-width="3"/>
<rect x="96" y="44" width="64" height="60" rx="12" fill="{PAPER}"/>
<rect x="76" y="62" width="104" height="68" rx="20" fill="{PAPER}" stroke="{INK}" stroke-width="8"/>
<rect x="58" y="86" width="140" height="132" rx="26" fill="{PAPER}" stroke="{INK}" stroke-width="8"/>
<path d="M128 114V162" stroke="{INK}" stroke-width="18" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M100 138L128 166L156 138" stroke="{INK}" stroke-width="18" stroke-linecap="round" stroke-linejoin="round"/>
<rect x="98" y="186" width="60" height="12" rx="6" fill="{GREEN}"/>
</g>'''


write('logo.svg', f'<svg width="256" height="256" viewBox="0 0 256 256" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Fetchdeck logo">{mark(0, 0, 256)}</svg>')


def segments(width, top, height, gap, fills):
    n = len(fills)
    seg = (width - gap * (n - 1)) / n
    parts = []
    for i, (fill, steal) in enumerate(fills):
        x = i * (seg + gap)
        parts.append(f'<rect x="{x:.1f}" y="{top}" width="{seg:.1f}" height="{height}" rx="{height / 2}" fill="{RAISED}"/>')
        if fill > 0:
            parts.append(f'<rect x="{x:.1f}" y="{top}" width="{seg * fill:.1f}" height="{height}" rx="{height / 2}" fill="{GREEN}"/>')
        if steal:
            parts.append(f'<rect x="{x + seg * steal:.1f}" y="{top}" width="{seg * (1 - steal):.1f}" height="{height}" rx="{height / 2}" fill="{PAPER}" opacity="0.9"/>')
    return '\n'.join(parts)


# (downloaded share, where the part taken over by a finished connection starts); the first connection is the slow one
FILLS = [(0.38, 0.69), (1, 0), (0.92, 0), (1, 0), (0.84, 0), (1, 0), (0.96, 0), (0.78, 0)]

write('banner.svg', f'''
<svg width="1280" height="400" viewBox="0 0 1280 400" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Fetchdeck: a parallel download manager for desktop and browser">
<rect width="1280" height="400" rx="24" fill="{INK}"/>
<rect x="1" y="1" width="1278" height="398" rx="23" stroke="{LINE}" stroke-width="2"/>
{mark(80, 70, 132)}
<text x="244" y="148" font-family="{FONT}" font-size="76" font-weight="700" fill="{PAPER}" letter-spacing="-1.5">Fetchdeck</text>
<text x="246" y="196" font-family="{FONT}" font-size="28" fill="{MUTED}">A parallel download manager for your desktop and your browser.</text>
<g transform="translate(80 270)">
{segments(1120, 0, 22, 10, FILLS)}
</g>
<text x="80" y="342" font-family="{FONT}" font-size="20" fill="{MUTED}">8 connections per file</text>
<text x="1200" y="342" text-anchor="end" font-family="{FONT}" font-size="20" fill="{GREEN}">a finished connection takes over what a slow one has left</text>
</svg>
''')

write('segments.svg', f'''
<svg width="900" height="230" viewBox="0 0 900 230" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Illustration: eight connections download one file; when one finishes, it takes over half of the slowest connection's remaining bytes">
<rect width="900" height="230" rx="16" fill="{INK}"/>
<rect x="1" y="1" width="898" height="228" rx="15" stroke="{LINE}" stroke-width="2"/>
<text x="40" y="48" font-family="{FONT}" font-size="20" font-weight="600" fill="{PAPER}">One file, eight connections</text>
<g transform="translate(40 76)">
{segments(820, 0, 22, 8, FILLS)}
</g>
<g font-family="{FONT}" font-size="16">
<rect x="40" y="132" width="14" height="14" rx="4" fill="{GREEN}"/><text x="62" y="145" fill="{MUTED}">downloaded</text>
<rect x="170" y="132" width="14" height="14" rx="4" fill="{RAISED}"/><text x="192" y="145" fill="{MUTED}">still to do</text>
<rect x="290" y="132" width="14" height="14" rx="4" fill="{PAPER}"/><text x="312" y="145" fill="{MUTED}">taken over by a finished connection</text>
</g>
<text x="40" y="190" font-family="{FONT}" font-size="16" fill="{MUTED}">Each connection writes at its own offset into one file, so nothing is merged at the end.</text>
</svg>
''')


def icon(name, label, body):
    write(f'icon-{name}.svg', f'''
<svg width="72" height="72" viewBox="0 0 72 72" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="{label}">
<rect width="72" height="72" rx="18" fill="{INK}"/>
<rect x="1" y="1" width="70" height="70" rx="17" stroke="{LINE}" stroke-width="2"/>
<g stroke-linecap="round" stroke-linejoin="round" stroke-width="4">
{body}
</g>
</svg>
''')


icon('parallel', 'Parallel connections', f'''
<path d="M20 24H52" stroke="{GREEN}"/><path d="M20 34H44" stroke="{PAPER}"/><path d="M20 44H50" stroke="{PAPER}"/><path d="M20 54H38" stroke="{PAPER}"/>''')
icon('pause', 'Pause and resume', f'''
<path d="M26 22V50" stroke="{PAPER}"/><path d="M46 22V50" stroke="{PAPER}"/><path d="M20 58H52" stroke="{GREEN}"/>''')
icon('queue', 'Queue', f'''
<rect x="19" y="20" width="34" height="9" rx="4.5" stroke="{GREEN}"/><rect x="19" y="32" width="34" height="9" rx="4.5" stroke="{PAPER}"/><rect x="19" y="44" width="34" height="9" rx="4.5" stroke="{PAPER}"/>''')
icon('recovery', 'Crash recovery', f'''
<path d="M50 26A18 18 0 1 0 54 38" stroke="{PAPER}"/><path d="M52 16V28H40" stroke="{GREEN}"/><path d="M30 37L35 42L43 32" stroke="{GREEN}"/>''')
icon('browser', 'Browser extension', f'''
<rect x="16" y="18" width="40" height="32" rx="6" stroke="{PAPER}"/><path d="M16 26H56" stroke="{PAPER}"/><path d="M36 31V45" stroke="{GREEN}"/><path d="M30 40L36 46L42 40" stroke="{GREEN}"/><path d="M26 58H46" stroke="{GREEN}"/>''')
icon('login', 'Downloads that need a login', f'''
<rect x="20" y="33" width="32" height="22" rx="6" stroke="{PAPER}"/><path d="M27 33V27A9 9 0 0 1 45 27V33" stroke="{GREEN}"/><path d="M36 41V47" stroke="{GREEN}"/>''')
icon('shield', 'Private by design', f'''
<path d="M36 16L54 23V36C54 46 46 53 36 57C26 53 18 46 18 36V23Z" stroke="{PAPER}"/><path d="M28 36L34 42L45 30" stroke="{GREEN}"/>''')
