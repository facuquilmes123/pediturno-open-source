"""Check actual dark-theme text tokens against their supported surfaces."""
from pathlib import Path
import json, re, sys

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'android/pediturno-servicios/app/src/main/java/com/pediturno/servicios/core/theme/Color.kt'

def luminance(rgb):
    channels = [int(rgb[i:i+2], 16) / 255 for i in (0, 2, 4)]
    linear = [v / 12.92 if v <= .04045 else ((v + .055) / 1.055) ** 2.4 for v in channels]
    return sum(v * weight for v, weight in zip(linear, (.2126, .7152, .0722)))

def main():
    colors = dict(re.findall(r'val\s+(\w+)\s*=\s*Color\(0xFF([0-9A-Fa-f]{6})\)', SOURCE.read_text(encoding='utf-8')))
    checks = []
    for text in ['TextHighEmphasis', 'TextMediumEmphasis', 'TextSubtle']:
        for surface in ['ObsidianCanvas', 'SlateDeep', 'SurfaceLevel1', 'SurfaceLevel2', 'SurfaceLevel3']:
            a, b = sorted([luminance(colors[text]), luminance(colors[surface])])
            ratio = (b + .05) / (a + .05)
            checks.append(dict(text=text, surface=surface, ratio=ratio, passed=ratio >= 4.5))
    for foreground, background in [('OnMintPrimary', 'MintPrimary'), ('OnMintPrimary', 'EmeraldConfirmed'),
                                   ('000000', 'OrangeCta'), ('000000', 'CrimsonCancelled')]:
        a,b=sorted([luminance(colors.get(foreground,foreground)),luminance(colors[background])])
        ratio=(b+.05)/(a+.05)
        checks.append(dict(text=foreground,surface=background,ratio=ratio,passed=ratio>=4.5))
    for icon in ['MintPrimary','SkyAccent','EmeraldConfirmed']:
        for surface in ['SurfaceLevel1','SurfaceLevel2']:
            accent=[int(colors[icon][i:i+2],16) for i in (0,2,4)]
            base=[int(colors[surface][i:i+2],16) for i in (0,2,4)]
            badge=''.join(f'{round(.12*a+.88*b):02X}' for a,b in zip(accent,base))
            a,b=sorted([luminance(colors[icon]),luminance(badge)])
            ratio=(b+.05)/(a+.05)
            checks.append(dict(icon=icon,surface=surface,badgeOpacity=.12,ratio=ratio,minimumRatio=3,passed=ratio>=3))
    result = dict(criterion='WCAG 2.2 1.4.3 text >=4.5:1; 1.4.11 icons >=3:1',
                  scope='Only these opaque theme tokens; not a full screen accessibility audit.',
                  source=str(SOURCE.relative_to(ROOT)), checks=checks,
                  passed=all(check['passed'] for check in checks))
    print(json.dumps(result, indent=2))
    if not result['passed']: sys.exit(1)

if __name__ == '__main__': main()
