"""
Writes src/theme-light.css and src/theme-dark.css - the two palettes of the
Luxury Explorers design system.

    python scripts/gen-theme.py

Every screen is drawn with Tailwind's colour utilities, and in Tailwind 4 each
shade is a CSS variable. So a theme is a set of values for those variables:
no component names a colour of its own, and changing a palette here changes
every screen at once.

The brand (the user, 22 Nov 2026): midnight navy and a refined gold.

  - Light: a calm, slightly cool page (#F3F5F8) under white cards, ink in
    navy (#172438) rather than black, secondary text #59697D, borders
    #E2E7EE. The greys (slate) carry the navy hue. The primary colour (blue)
    is the brand navy-blue, #244A73 at its 700. Status colours keep their
    meaning but lose some of their shout.
  - Dark: layered midnight navy, not black. The page #111C2D, cards
    #1B2A3E, raised surfaces #223249, borders #304158, text #E8EDF4 /
    #B0BDCE / #8E9DB1. Colours keep their hue and are quieted: pale badge
    backgrounds become dark navy tints, strong text colours muted pastels.
    The interactive blue is #4A85D4.
  - gold is a family of its own (#C6A15B), for the brand's few marks - the
    logo, the active screen in the menu - never for every button.

Replaces gen-dark-theme.py (graphite, 16 Nov 2026).
"""
import math, re

src = open('node_modules/tailwindcss/theme.css', encoding='utf-8').read()
vals = dict(re.findall(r'--color-([a-z]+-\d+):\s*([^;]+);', src))
STEPS = ['50', '100', '200', '300', '400', '500', '600', '700', '800', '900', '950']
NEUTRAL = {'slate', 'gray', 'zinc', 'neutral', 'stone', 'mauve', 'olive', 'mist', 'taupe'}
fams = sorted({k.rsplit('-', 1)[0] for k in vals})


def oklch(v):
    m = re.match(r'oklch\(([\d.]+)%\s+([\d.]+)\s+([\d.]+)\)', v)
    return (float(m.group(1)) / 100, float(m.group(2)), float(m.group(3))) if m else None


def fmt(l, c, h):
    return f'oklch({l * 100:.1f}% {c:.3f} {h:.1f})'


# ── the greys and the primary, step by step: (lightness, chroma) ──────────────
NAVY_H = 257.0
LIGHT_SLATE = {'50': (.969, .005), '100': (.945, .008), '200': (.926, .011), '300': (.860, .017),
               '400': (.560, .034), '500': (.500, .037), '600': (.440, .040), '700': (.360, .042),
               '800': (.300, .042), '900': (.259, .042), '950': (.200, .038)}
LIGHT_BLUE = {'50': (.970, .012), '100': (.935, .025), '200': (.870, .045), '300': (.760, .070),
              '400': (.640, .090), '500': (.530, .100), '600': (.450, .095), '700': (.402, .082),
              '800': (.350, .070), '900': (.300, .058), '950': (.230, .045)}
GOLD_H = 80.0
LIGHT_GOLD = {'50': (.975, .020), '100': (.950, .035), '200': (.900, .060), '300': (.830, .080),
              '400': (.770, .095), '500': (.728, .099), '600': (.657, .097), '700': (.580, .090),
              '800': (.500, .075), '900': (.420, .060), '950': (.320, .045)}

# Dark: CHARCOAL (the user, 22 Nov 2026, from a reference they liked -
# replaces Deep Steel). Neutral greys with no tint at all, close to black but
# never black: page #111111, sidebar #141414, cards #1A1A1A, raised #262626,
# borders #2E2E2E; text near-white, secondary #A3A3A3, muted #8F8F8F (5.4:1
# on a card). One strong blue (#2563EB) for the primary action and the
# chosen thing - drawn on buttons by index.css, white text on it at 5.2:1.
STEEL_H = 0.0
DARK_PAGE, DARK_CARD = .178, .218
DARK_SLATE = {'50': (.178, 0), '100': (.269, 0), '200': (.301, 0), '300': (.400, 0),
              '400': (.650, 0), '500': (.715, 0), '600': (.790, 0), '700': (.860, 0),
              '800': (.920, 0), '900': (.960, 0), '950': (.985, 0)}
# The blue as text and tint on charcoal (links, the active filter, a pale
# badge): it rises in lightness like every dark scale. The filled button is
# the brand's #2563EB, set in index.css.
DARK_BLUE = {'50': (.255, .040), '100': (.285, .055), '200': (.330, .075), '300': (.420, .110),
             '400': (.580, .160), '500': (.620, .170), '600': (.680, .150), '700': (.730, .130),
             '800': (.800, .100), '900': (.860, .070), '950': (.920, .040)}
DARK_GOLD = {'50': (.255, .030), '100': (.285, .040), '200': (.330, .050), '300': (.420, .065),
             '400': (.620, .085), '500': (.728, .099), '600': (.760, .090), '700': (.800, .080),
             '800': (.850, .060), '900': (.900, .040), '950': (.930, .030)}
STEEL_FAMILIES = set()
# Every other colour in the dark: (lightness, share of its own chroma).
DARK_TINT = {'50': (DARK_CARD + .030, .20), '100': (DARK_CARD + .055, .24), '200': (DARK_CARD + .095, .28),
             '300': (DARK_CARD + .190, .36), '400': (.640, .48), '500': (.705, .50), '600': (.760, .46),
             '700': (.800, .40), '800': (.860, .32), '900': (.900, .22), '950': (.930, .14)}
# In the light, how much of its strength a status colour keeps.
LIGHT_SHARE = {'50': .90, '100': .90, '200': .88, '300': .85, '400': .82, '500': .82, '600': .82,
               '700': .84, '800': .86, '900': .88, '950': .90}
# The 600 and 700 of every colour are what its text is set in. Tailwind's
# yellows, ambers, oranges and greens are light at those steps - amber-600 on
# white read at 3.2:1 - so in the light they are capped here, which brings
# every one of them past 4.5:1 on a white card. Hue and chroma are kept.
# (the user, 22 Nov 2026: put back after being held while the light theme
# was frozen for the Deep Steel work.)
LIGHT_TEXT_CAP = {'600': .530, '700': .470, '800': .410}


def light_lines():
    out = []
    for s in STEPS:
        out.append(f'  --color-gold-{s}: {fmt(*LIGHT_GOLD[s], GOLD_H)};')
    for f in fams:
        for s in STEPS:
            k = f'{f}-{s}'
            if k not in vals:
                continue
            if f in NEUTRAL:
                out.append(f'  --color-{k}: {fmt(*LIGHT_SLATE[s], NAVY_H)};')
            elif f == 'blue':
                out.append(f'  --color-{k}: {fmt(*LIGHT_BLUE[s], 253.0)};')
            else:
                l, c, h = oklch(vals[k])
                l = min(l, LIGHT_TEXT_CAP.get(s, l))
                out.append(f'  --color-{k}: {fmt(l, c * LIGHT_SHARE[s], h)};')
    return out


def dark_lines():
    out = ['  color-scheme: dark;',
           f'  --color-white: {fmt(DARK_CARD, 0, STEEL_H)};',
           f'  --color-black: {fmt(.985, 0, STEEL_H)};']
    for s in STEPS:
        out.append(f'  --color-gold-{s}: {fmt(*DARK_GOLD[s], GOLD_H)};')
    for f in fams:
        base = oklch(vals.get(f'{f}-500', '')) or (0, 0, 0)
        for s in STEPS:
            k = f'{f}-{s}'
            if k not in vals:
                continue
            if f in NEUTRAL:
                out.append(f'  --color-{k}: {fmt(*DARK_SLATE[s], STEEL_H)};')
            elif f == 'blue' or f in STEEL_FAMILIES:
                out.append(f'  --color-{k}: {fmt(*DARK_BLUE[s], 262.0)};')
            else:
                l, share = DARK_TINT[s]
                out.append(f'  --color-{k}: {fmt(l, base[1] * share, base[2])};')
    return out


light = light_lines()
dark = dark_lines()

open('src/theme-light.css', 'w', encoding='utf-8').write(f"""/*
 * Light mode: the Luxury Explorers palette. Generated by scripts/gen-theme.py -
 * edit that script and rerun it, not this file.
 *
 * Unlayered, so these values win over Tailwind's own (which sit in a layer);
 * html.dark, more specific than :root, wins over these in the dark.
 */
:root {{
{chr(10).join(light)}
}}
""")

open('src/theme-dark.css', 'w', encoding='utf-8').write(f"""/*
 * Dark mode: charcoal. Generated by scripts/gen-theme.py - edit
 * that script and rerun it, not this file.
 *
 * Inside an element marked keep-palette (the sign-in page, painted navy by
 * hand) the light palette is kept - except in a panel opened from it
 * (follow-theme), which is a page of its own.
 */
html.dark,
html.dark .keep-palette .follow-theme {{
{chr(10).join(dark)}
}}
html.dark .keep-palette:not(.follow-theme) {{
  color-scheme: light;
  --color-white: #fff;
  --color-black: #000;
{chr(10).join(light)}
}}
""")


# ── the readings that matter, printed so a change can be judged ───────────────
def to_rgb(l, c, h):
    a, b = c * math.cos(math.radians(h)), c * math.sin(math.radians(h))
    l_, m_, s_ = l + .3963377774 * a + .2158037573 * b, l - .1055613458 * a - .0638541728 * b, l - .0894841775 * a - 1.2914855480 * b
    L, M, S = l_ ** 3, m_ ** 3, s_ ** 3
    r = 4.0767416621 * L - 3.3077115913 * M + .2309699292 * S
    g = -1.2684380046 * L + 2.6097574011 * M - .3413193965 * S
    bb = -.0041960863 * L - .7034186147 * M + 1.7076147010 * S
    return [min(max(x, 0), 1) for x in (r, g, bb)]


def lum(lin):
    # to_rgb already gives linear light - no gamma to take off.
    return .2126 * lin[0] + .7152 * lin[1] + .0722 * lin[2]


def contrast(a, b):
    la, lb = sorted([lum(to_rgb(*a)), lum(to_rgb(*b))], reverse=True)
    return (la + .05) / (lb + .05)


W = (1.0, 0, 0)
L = lambda s, t=LIGHT_SLATE: (*t[s], NAVY_H)
card = (DARK_CARD, 0, STEEL_H)
D = lambda s: (*DARK_SLATE[s], STEEL_H)
print('light: slate-900 on white %.1f, 700 %.1f, 500 %.1f, 400 %.1f; 400 on slate-50 %.1f; white on blue-600 %.1f'
      % (contrast(L('900'), W), contrast(L('700'), W), contrast(L('500'), W), contrast(L('400'), W),
         contrast(L('400'), L('50')), contrast(W, (*LIGHT_BLUE['600'], 253.0))))
def fam(f, s):
    l, c, h = oklch(vals[f'{f}-{s}'])
    return (min(l, LIGHT_TEXT_CAP.get(s, l)), c * LIGHT_SHARE[s], h)
print('light text on white: ' + ', '.join(f'{f}-600 %.1f' % contrast(fam(f, '600'), W)
      for f in ('amber', 'orange', 'yellow', 'emerald', 'green', 'red', 'sky', 'teal')))
print('dark: 950 on card %.1f, 600 %.1f, 500 %.1f, 400 %.1f; 400 on page %.1f; white on #2563EB %.1f; blue-600 on card %.1f'
      % (contrast(D('950'), card), contrast(D('600'), card), contrast(D('500'), card), contrast(D('400'), card),
         contrast(D('400'), D('50')), contrast((1.0, 0, 0), (.546, .215, 262.9)), contrast((*DARK_BLUE['600'], 262.0), card)))
