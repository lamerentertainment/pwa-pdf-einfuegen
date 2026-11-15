#!/usr/bin/env python3
"""
Zieht die Wortlisten aus pdf-einfuegen (courtapi/dict_db.py) maschinell in
src/process/wordlists.json – keine Abschrift von Hand.

Aufruf:  python3 scripts/pdf-einfuegen/extract_wordlists.py ../pdf-einfuegen

Python-Dicts behalten bei doppelten Schlüsseln den letzten Wert an der Position des
ersten Vorkommens; der Import über Python übernimmt genau diese Regel. Die Listen
werden als [Schlüssel, Wert…]-Paare gespeichert, damit die Reihenfolge, in der die
Regeln angewendet werden, sichtbar und eindeutig bleibt.
"""
import json
import subprocess
import sys
from pathlib import Path

source = Path(sys.argv[1]).resolve()
sys.path.insert(0, str(source))
from courtapi import dict_db as d  # noqa: E402

commit = subprocess.run(['git', '-C', str(source), 'log', '-1', '--format=%h %ad', '--date=short', '--', 'courtapi/dict_db.py'],
                        capture_output=True, text=True).stdout.strip()

data = {
    'quelle': f'pdf-einfuegen, courtapi/dict_db.py ({commit})',
    # Pronomen: [Ausgangswort, Ersetzung]; die Drittpersonen stehen bewusst zuerst
    'pronomenMann': [[k, v[0]] for k, v in d.pronomen_ersetzungen_m.items()],
    'pronomenFrau': [[k, v[0]] for k, v in d.pronomen_ersetzungen_w.items()],
    'ocr': [[k, v] for k, v in d.ocr_ersetzungen.items()],
    'praesens': [[k, v] for k, v in d.verben_ersetzung_praesens.items()],
    # Präteritum: [Verb, Ersetzung, Hilfsverb ans Satzteilende]
    'praeteritum': [[k, v[0], v[1]] for k, v in d.verben_ersetzung_praeteritum.items()],
    'zusammenfuegung': [[k, v] for k, v in d.verben_zusammenfuegung.items()],
}

out = Path(__file__).resolve().parents[2] / 'src/process/wordlists.json'
# Ein Eintrag pro Zeile: gut lesbar und in Diffs nachvollziehbar
lines = ['{', f'  "quelle": {json.dumps(data["quelle"], ensure_ascii=False)},']
lists = [k for k in data if k != 'quelle']
for i, key in enumerate(lists):
    entries = ',\n'.join('    ' + json.dumps(e, ensure_ascii=False) for e in data[key])
    lines.append(f'  "{key}": [\n{entries}\n  ]' + (',' if i < len(lists) - 1 else ''))
lines.append('}')
out.write_text('\n'.join(lines) + '\n', encoding='utf-8')
print(f'{out}: ' + ', '.join(f'{k} {len(v)}' for k, v in data.items() if isinstance(v, list)))
