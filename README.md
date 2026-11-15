# PDF einfügen

PDF erfassen und Text weiterverarbeiten, **vollständig lokal im Browser**. Keine Dokumente
verlassen den Rechner, keine API, kein Server, der mitliest.

Die App ist Open Source, damit jede und jeder nachprüfen kann, was sie tut.

## Stufen

1. **Erfassen** – eingebetteter PDF-Text oder lokale Texterkennung (PP-OCRv5) für gescannte
   Seiten, optional mit Layoutmodell (Spalten, Kopf-/Fusszeilen). In der Prüfansicht stehen
   PDF-Seite und erfasster Text nebeneinander: Ein Klick auf eine Zeile im PDF markiert sie im
   Text und umgekehrt, unsicher erkannte Zeilen sind hervorgehoben, der Text lässt sich direkt
   korrigieren, kopieren oder als .txt speichern. Das Dokument lebt nur im Arbeitsspeicher.
2. **Verarbeiten** – regelbasiert, ohne Modell: Zeilen zusammenfügen, Worttrennungen und typische
   OCR-Fehler korrigieren, Umwandlung in indirekte Rede («Ich bin unschuldig» → «Er sei unschuldig»).
   Regeln und Wortlisten stammen aus «PDF einfügen» ([`src/process/rules.js`](src/process/rules.js),
   [`src/process/wordlists.json`](src/process/wordlists.json)). Die Tests prüfen das Ergebnis Zeichen für
   Zeichen gegen die ursprüngliche Python-Umsetzung; zwei Fehler des Originals sind dabei behoben
   (siehe [`scripts/pdf-einfuegen/generate_golden.py`](scripts/pdf-einfuegen/generate_golden.py)).
   Änderungen werden im Ergebnis hervorgehoben.
3. **Transformieren** – mit einem kleinen, lokal geladenen Sprachmodell. *(geplant)*

## Wann die App ins Internet geht

| Modus | Netzwerk | Wofür |
|---|---|---|
| **Lokal** (Standard, nach jedem Start) | keine einzige Anfrage | Erfassen, Prüfen, Verarbeiten |
| **Verbunden** (nur auf Knopfdruck, endet automatisch) | nur Abrufe, nur zu dieser Website und zu Hugging Face | App-Update, Modelle laden |

So ist das umgesetzt, und hier lässt es sich nachprüfen:

- **Torwächter** ([`public/sw.js`](public/sw.js)): Ein Service Worker beantwortet jede Anfrage der
  App aus dem Browser-Speicher oder entscheidet nach den Regeln in
  [`public/sw-policy.js`](public/sw-policy.js). Im Modus Lokal wird alles blockiert, im Modus Verbunden
  sind nur `GET`-Abrufe zu freigegebenen Zielen erlaubt. Die App sendet nie Daten.
- **Content Security Policy** ([`csp.js`](csp.js)): Der Browser selbst verbietet Verbindungen zu
  allen anderen Servern, unabhängig vom Code der App.
- **Verbindungsprotokoll**: Jede Netzwerkanfrage, ob erlaubt oder blockiert, erscheint in der App
  unter *Verbindungen*.
- **Updates nur auf Wunsch**: Die App sucht nicht selbst nach Updates. Eine neue Version, die der
  Browser von sich aus findet, wird verworfen und protokolliert.
- **Modelle** ([`models/catalog.json`](models/catalog.json)): Feste Revision, Grösse, Lizenz und
  SHA-256 für jede Datei. Gespeichert wird erst nach bestandener Prüfsumme. Auf der Seite *Modelle*
  lassen sich Modelle laden, nachprüfen und löschen.
- **Nachvollziehbarer Build**: Veröffentlicht wird nur per [GitHub Action](.github/workflows/deploy.yml)
  aus diesem Repository. Die App zeigt in der Fusszeile den Commit, aus dem sie gebaut wurde.

### Grenzen, ehrlich benannt

- Der Browser prüft `sw.js` von sich aus gelegentlich auf eine neue Version (höchstens etwa einmal
  pro Tag). Das kann keine Web-App unterbinden. Dabei werden keine Nutzerdaten übertragen, und eine
  so gefundene Version wird nicht installiert.
- Ein erzwungenes Neuladen (Shift + Neu laden) umgeht den Service Worker für diesen einen Aufruf.
- Der erste Besuch lädt die App naturgemäss aus dem Netz.

## Entwicklung

```bash
npm install
npm run dev       # Entwicklungsserver (ohne Torwächter)
npm test          # Tests der Regeln, der Konfiguration und der Modellverwaltung
npm run build && npm run preview   # mit Torwächter, wie in Produktion
```

## Lizenz

MIT, siehe [LICENSE](LICENSE). Die Modelle haben ihre eigenen Lizenzen (siehe Katalog).
