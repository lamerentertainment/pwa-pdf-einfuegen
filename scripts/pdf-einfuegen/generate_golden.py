#!/usr/bin/env python3
"""
Erzeugt tests/fixtures/pdf-einfuegen-golden.json: Referenzergebnisse der Python-Umsetzung
von pdf-einfuegen (courtapi/converters.py), gegen die tests/rules.test.js die JavaScript-
Umsetzung in src/process/rules.js Zeichen für Zeichen prüft.

Aufruf:  python3 scripts/pdf-einfuegen/generate_golden.py ../pdf-einfuegen

Drei Fehler des Originals sind in der JavaScript-Umsetzung behoben. Damit die Referenz
dieselbe Logik beschreibt, werden genau diese drei Korrekturen hier als Patch auf den
Original-Code angewendet (jeder Patch muss genau passen, sonst bricht das Skript ab).
Zum Vergleich hält die Datei auch das Ergebnis des unveränderten Originals fest.

1. OCR-Ersetzung ohne Wortgrenze: "ln " wurde auch am Ende von Wörtern ersetzt
   ("handeln" → "handeIn", "Regeln" → "RegeIn", "Milch" → "MiIch"). Jetzt nur am Wortanfang.
2. Absturz (IndexError), wenn auf ein Verb im Präteritum direkt ein Satzzeichen folgt
   ("Ich ging."). groups[i][-1] wird zu groups[i][-1:].
3. Fehlendes Leerzeichen, wenn der Satzteil mit "und"/"oder" endet: "Ich ging nach Hause und
   schlief" ergab "nach Hause  gegangenund", jetzt "nach Hause gegangen und". Der Zweig war
   trotz Kommentar ("müssen die Leerzeichen anders gesetzt werden") gleich wie der Else-Zweig.
"""
import json
import sys
import types
from pathlib import Path

source = Path(sys.argv[1]).resolve()
sys.path.insert(0, str(source))
from courtapi import dict_db  # noqa: E402

PATCHES = [
    # 2. leere Gruppe ohne IndexError
    ("groups[0][-1].isdigit()", "groups[0][-1:].isdigit()"),
    ("groups[2][-1].isdigit()", "groups[2][-1:].isdigit()"),
    # 3. Leerzeichen vor "und"/"oder" am Satzteilende (Zweig ohne Hervorhebung)
    ('            elif groups[1] in ["und", "oder"]:\n'
     '                text = text.replace(match.group(0), f"{verbersetzung}{groups[0]} {hilfsverb}{groups[1]}',
     '            elif groups[1] in ["und", "oder"]:\n'
     '                text = text.replace(match.group(0), f"{verbersetzung}{groups[0]}{hilfsverb} {groups[1]}'),
    # 1. OCR-Ersetzung nur am Wortanfang (Zweig ohne Hervorhebung)
    ('            textstelle = textstelle.replace(ausgangswort + " ", ersetzung + " ")\n'
     '            textstelle = textstelle.replace(ausgangswort.capitalize() + " ", ersetzung.capitalize() + " ")',
     '            textstelle = re.sub(r"(?<!\\w)" + re.escape(ausgangswort + " "), lambda m: ersetzung + " ", textstelle)\n'
     '            textstelle = re.sub(r"(?<!\\w)" + re.escape(ausgangswort.capitalize() + " "), lambda m: ersetzung.capitalize() + " ", textstelle)'),
]


def load(patched):
    code = (source / 'courtapi/converters.py').read_text(encoding='utf-8')
    code = code.replace('from .dict_db import', 'from courtapi.dict_db import')
    if patched:
        for old, new in PATCHES:
            count = code.count(old)
            if count == 0:
                sys.exit(f'Patch passt nicht mehr auf converters.py: {old[:60]!r}')
            code = code.replace(old, new)
    module = types.ModuleType('converters_patched' if patched else 'converters_original')
    exec(compile(code, 'converters.py', 'exec'), module.__dict__)
    return module


fixed = load(True)
original = load(False)

INPUTS = [
    # Zeilen zusammenfügen, Worttrennungen, Formatierungen
    "Ich habe das Fahr-\nzeug am Montag ab-\ngeholt.",
    "Die Parteien schlossen einen Ver-\ngleich über CHF 5'000.00 und\nverzichteten auf weitere Ansprüche.",
    "Er sagte: «Ich komme morgen.»\nDanach ging er nach Hause.",
    "Wir müssen handeln und die Regeln beachten.\nDie Milch war sauer.",
    "lch war an diesem Abend nicht dort.\nlhr Auto stand vor dem Haus.",
    "Die Jung- geselle-Party fand im Hotel statt,  und  zwar  spät.",
    "Er hat ,,nein\" gesagt und 50 o/o bezahlt.",
    "Zeile mit Leerzeichen am Ende   \nnächste Zeile\n\nneuer Absatz",
    "Der Vertrag über 1-2 Jahre wurde am 08.08.2001 unterzeichnet.",
    # Indirekte Rede: Präsens
    "Ich bin unschuldig.",
    "Ich habe nichts damit zu tun. Ich weiss nicht, wer das war.",
    "Meine Frau ist an diesem Abend bei ihrer Mutter gewesen.",
    "Wir wohnen seit zwei Jahren in Luzern. Unsere Kinder gehen hier zur Schule.",
    "Er hat mich angerufen und mir gesagt, dass ich kommen soll.",
    "Ich kann mich nicht daran erinnern.",
    # Indirekte Rede: Präteritum
    "Ich war zu Hause.",
    "Ich ging.",
    "Ich trank Milch und ass.",
    "Ich ging nach Hause und schlief sofort ein.",
    "Ich bezahlte Fr. 200.-- für das Velo.",
    "Ich kaufte das Auto ca. 2019 und verkaufte es wieder.",
    "Am 08.08.2001 fuhr ich nach Zürich.",
    "Ich bekam Kost und Logis und arbeitete dafür.",
    "Ich kam nach und nach dahinter, was passiert war.",
    "Ich wusste nicht, dass er eine Waffe hatte.",
    "Wir trafen uns im Restaurant Löwen, wo wir etwas tranken.",
    "Ich sah ihn, als er das Haus verliess.",
    # Fragen, Ausrufe, Strichpunkte
    "Ich fragte ihn: Warum bist du hier? Er antwortete nicht.",
    "Ich rief laut! Niemand kam; ich war allein.",
    # Weibliche Form
    "Ich habe meinen Mann gestern zum letzten Mal gesehen.",
    "Ich war mit meiner Schwester im Kino und wir assen danach Pizza.",
    # Getrennte Verben (Zusammenfügung)
    "Er hat mich zurück gehalten und dann an gerufen.",
    # Mehrzeilige Aussage aus einem PDF
    "Ich habe die Tür ge-\nöffnet und bin hineingegangen. Dort sah ich\nmeinen Bruder, der am Boden lag.",
]


def run(module, mode, text):
    try:
        if mode == 'einfuegen':
            return module.von_pdf_einfuegen(text)
        return module.als_aussage_formatieren(text, 'm' if mode == 'mann' else 'w')
    except Exception as err:  # noqa: BLE001
        return f'ABSTURZ: {type(err).__name__}: {err}'


cases = []
for text in INPUTS:
    for mode in ('einfuegen', 'mann', 'frau'):
        expected = run(fixed, mode, text)
        if expected.startswith('ABSTURZ'):
            sys.exit(f'Auch die korrigierte Fassung stürzt ab: {mode} {text!r}: {expected}')
        cases.append({'modus': mode, 'eingabe': text, 'erwartet': expected, 'original': run(original, mode, text)})

out = Path(__file__).resolve().parents[2] / 'tests/fixtures/pdf-einfuegen-golden.json'
out.write_text(json.dumps({'quelle': 'pdf-einfuegen courtapi/converters.py mit 3 Korrekturen (siehe generate_golden.py)',
                           'faelle': cases}, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
differ = sum(c['erwartet'] != c['original'] for c in cases)
print(f'{out}: {len(cases)} Fälle, davon {differ} mit abweichendem Original (Fehlerkorrekturen)')
