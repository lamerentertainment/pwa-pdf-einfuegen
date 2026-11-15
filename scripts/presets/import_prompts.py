#!/usr/bin/env python3
"""
Übernimmt die bestätigten Prompts aus der promptlibrary als Presets für Stufe 3
(src/llm/presets.json). Die Prompts bleiben wortgleich, mit zwei technischen Anpassungen:
- Zeilen {{MODEL:"…"}} (Modellwahl des früheren Werkzeugs) fallen weg,
- {{CLIPBOARD}} bzw. {{anontext}} werden zum Platzhalter {{INPUT}} für den Eingabetext.

Aufruf:  python3 scripts/presets/import_prompts.py ../promptlibrary
"""
import json
import re
import subprocess
import sys
from pathlib import Path

source = Path(sys.argv[1]).resolve()

# Vom Nutzer einzeln bestätigt (Gruppen «Indirekte Rede», «Fragen und Vorhalte», «Zusammenfassen»)
PRESETS = [
    ('aussage-m', 'aussagekonvertierung-mannlich.txt', 'Indirekte Rede', 'Aussage (Mann)', 'Aussage eines Mannes in die indirekte Rede, mit Belegstelle (Ziff. ).'),
    ('aussage-w', 'aussagekonvertierung-weiblich.txt', 'Indirekte Rede', 'Aussage (Frau)', 'Aussage einer Frau in die indirekte Rede, mit Belegstelle (Ziff. ).'),
    ('einvernahme-m', 'einvernahmekonvertierung-mannlich', 'Indirekte Rede', 'Einvernahme: Frage und Antwort (Mann)', 'Nummerierte Frage und Antwort eines Mannes in die indirekte Rede.'),
    ('einvernahme-w', 'einvernahmekonvertierung-weiblich.txt', 'Indirekte Rede', 'Einvernahme: Frage und Antwort (Frau)', 'Nummerierte Frage und Antwort einer Frau in die indirekte Rede.'),
    ('frage-m', 'fragekonvertierung-mannlich', 'Fragen und Vorhalte', 'Frage als Vorhalt (Mann)', 'Frage an einen Mann als Vorhalt: «Ob er … habe:».'),
    ('frage-w', 'fragekonvertierung-weiblich', 'Fragen und Vorhalte', 'Frage als Vorhalt (Frau)', 'Frage an eine Frau als Vorhalt: «Ob sie … habe:».'),
    ('frage-aussage-m', 'frage-und-aussagekonvertierung-mannlich.txt', 'Fragen und Vorhalte', 'Frage und Aussage (Mann)', 'Frage und Aussage eines Mannes gemeinsam in die indirekte Rede.'),
    ('frage-aussage-w', 'frage-und-aussagekonvertierung-weiblich.txt', 'Fragen und Vorhalte', 'Frage und Aussage (Frau)', 'Frage und Aussage einer Frau gemeinsam in die indirekte Rede.'),
    ('dokument', 'dokument-zusammenfassen.txt', 'Zusammenfassen', 'Dokument zusammenfassen', '«Mit [Dokumenttyp] vom [Datum] legte [Verfasser] dar …», höchstens 6 Sätze.'),
    ('aussagen', 'aussagen-zusammenfassen.txt', 'Zusammenfassen', 'Aussagen zusammenfassen', 'Standpunkt der einvernommenen Person zu den Vorwürfen, knapp für ein Urteil.'),
    ('anklage', 'anklage-zusammenfassen.txt', 'Zusammenfassen', 'Anklage zusammenfassen', '«Die Anklage wirft der beschuldigten Person vor, …»'),
    ('sachbeweise', 'sachbeweise-zusammenfassen.txt', 'Zusammenfassen', 'Sachbeweise zusammenfassen', 'Strukturierte Liste der Sachbeweise aus Rapporten und Verzeichnissen.'),
]

commit = subprocess.run(['git', '-C', str(source), 'log', '-1', '--format=%h %ad', '--date=short'],
                        capture_output=True, text=True).stdout.strip()

presets = []
for pid, filename, group, title, description in PRESETS:
    text = (source / 'prompts' / filename).read_text(encoding='utf-8')
    text = re.sub(r'^\s*\{\{MODEL:[^}]*\}\}\s*\n', '', text, flags=re.M)
    text, n = re.subn(r'\{\{(CLIPBOARD|anontext)\}\}', '{{INPUT}}', text)
    if n != 1:
        sys.exit(f'{filename}: erwartet genau einen Platzhalter, gefunden {n}')
    presets.append({'id': pid, 'group': group, 'title': title, 'description': description,
                    'source': f'promptlibrary/prompts/{filename}', 'prompt': text.strip() + '\n'})

out = Path(__file__).resolve().parents[2] / 'src/llm/presets.json'
out.write_text(json.dumps({'quelle': f'promptlibrary ({commit})', 'presets': presets}, ensure_ascii=False, indent=2) + '\n',
               encoding='utf-8')
print(f'{out}: {len(presets)} Presets aus promptlibrary {commit}')
