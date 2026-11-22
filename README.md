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
   Mit Layoutmodell lassen sich unter «Bereiche bearbeiten» die erkannten Bereiche nachträglich
   bearbeiten, ohne neue Texterkennung: einzeln (Klick im PDF) oder nach Typ für das ganze Dokument
   ein- und ausschalten, die Lesereihenfolge ändern (Pfeile oder «Reihenfolge per Klick»), Bereiche
   über Seitengrenzen zu einem Absatz verbinden oder nebeneinanderliegende Bereiche (Bezeichnung und
   Wert eines Formulars) zusammenlegen ([`src/capture/layoutRegions.js`](src/capture/layoutRegions.js)).
   Tabellen entstehen auf solchen Seiten nur in den Bereichen, die das Modell als Tabelle erkennt,
   dort aber schon ab 2 Spalten (ohne Layoutmodell: ab 3 Spalten). Auf Wunsch werden Dokument- und
   Abschnittstitel zu Überschriften (`#`, `##`), Fussnoten gesammelt ans Dokumentende gestellt oder
   als Markdown-Fussnoten (`[^1]` an der Fundstelle) ausgegeben und Bilder, Diagramme und Stempel als
   Platzhalter ausgegeben, Bilder samt Bildunterschrift (`[Abbildung: Abb. 1 …]`, `[Stempel: Eingegangen …]`). Beide Modelle lassen sich auf
   der Startseite unabhängig von der Installation aktivieren und deaktivieren; der Browser merkt sich
   die Wahl.
2. **Verarbeiten** – regelbasiert, ohne Modell: Zeilen zusammenfügen, Worttrennungen und typische
   OCR-Fehler korrigieren, Umwandlung in indirekte Rede («Ich bin unschuldig» → «Er sei unschuldig»).
   Regeln und Wortlisten stammen aus «PDF einfügen» ([`src/process/rules.js`](src/process/rules.js),
   [`src/process/wordlists.json`](src/process/wordlists.json)). Die Tests prüfen das Ergebnis Zeichen für
   Zeichen gegen die ursprüngliche Python-Umsetzung; fünf Fehler des Originals sind dabei behoben
   (siehe [`scripts/pdf-einfuegen/generate_golden.py`](scripts/pdf-einfuegen/generate_golden.py)).
   Änderungen werden im Ergebnis hervorgehoben; beim Darüberfahren zeigt ein Hinweis, welche Regel
   ein Wort verändert hat, bei Wortlisten mit dem Eintrag («Pronomen: ich → er»), auch über mehrere
   Regeln hinweg ([`src/process/herkunft.js`](src/process/herkunft.js)). Ein Klick auf ein Wort
   erlaubt, die verantwortliche Regel zu entfernen oder für das Wort eine neue Regel anzulegen; ist
   eine eingebaute Konvertierung gewählt, wird dafür eine eigene angelegt (mit «Rückgängig»). Die einzelnen Schritte von «Zeilen zusammenfügen»
   (Zeilenumbrüche, Worttrennungen, Leerzeichen, Anführungszeichen, Frankenbeträge, OCR-Korrekturen)
   lassen sich an- und abwählen. Neben den eingebauten Konvertierungen in die indirekte Rede (Mann/Frau)
   lassen sich eigene anlegen, etwa für Rechtsschriften («ich» → «der Beschuldigte»): Sie speichern nur
   ihre Abweichungen von einer Grundlage, bleiben im Browser und lassen sich als .json exportieren und
   importieren ([`src/process/konvertierungen.js`](src/process/konvertierungen.js)).
3. **Transformieren** – mit einem lokalen Sprachmodell nach einem Prompt umformen, etwa in die
   indirekte Rede oder als Zusammenfassung. Das Modell läuft im Browser auf der Grafikkarte
   (WebGPU, [transformers.js](https://huggingface.co/docs/transformers.js)), ohne Internet. Zur Wahl
   stehen Gemma 3 1B (0,8 GB), Gemma 4 E2B (3,1 GB, empfohlen) und Gemma 4 E4B (4,9 GB); installiert
   wird nur, was man auf der Seite *Modelle/Programmupdate* auswählt. Die 10 Prompts stammen aus der promptlibrary
   ([`src/llm/presets.json`](src/llm/presets.json), übernommen mit
   [`scripts/presets/import_prompts.py`](scripts/presets/import_prompts.py)) und lassen sich vor dem
   Ausführen ansehen und anpassen. In der *Promptbibliothek* (Zahnrad neben der Auswahl) lassen sich
   eigene Prompts anlegen, eingebaute als Vorlage verwenden oder ausblenden; eigene bleiben im Browser
   und lassen sich als .json exportieren und importieren ([`src/llm/promptBibliothek.js`](src/llm/promptBibliothek.js)).
   Markiert man im Eingabefeld einen Teil des Texts, wendet «Nur auf markierten Bereich anwenden» den
   Prompt nur darauf an; das Ergebnis ersetzt die Stelle im sonst unveränderten Text und ist im
   Ergebnisfeld markiert ([`src/llm/auswahl.js`](src/llm/auswahl.js)).
   Das Ergebnis ist ein Entwurf und muss geprüft werden.

## Zum Ausprobieren

Unter *Erfassen* öffnet «Beispiel öffnen» neben «PDF auswählen» eines von zwei Beispieldokumenten
(auch zum Herunterladen, in [`public/beispiele/`](public/beispiele/)):

- **Gescannte Einvernahme** (9 Seiten) – ein Scan mit fehlerhafter Textebene des Scanners
  («lch», «lhnen»), zeigt die Texterkennung und die Prüfansicht. Dafür unter *Modelle* die
  Texterkennung installieren.
- **Fiktiver Entscheid** (5 Seiten, digitales PDF) – eingebetteter Text mit Silbentrennung am
  Zeilenende, Inhaltsverzeichnis, Fussnoten, Tabellen, Listen sowie Kopf- und Fusszeilen.
  Erzeugt aus [`scripts/beispiele/entscheid.html`](scripts/beispiele/entscheid.html).

Alle Personen, Orte und Geschäftsnummern in den Beispielen sind frei erfunden.

## Wann die App ins Internet geht

| Modus | Netzwerk | Wofür |
|---|---|---|
| **Lokal** (Standard, nach jedem Start) | keine einzige Anfrage | Erfassen, Prüfen, Verarbeiten |
| **Verbunden** (nur auf Knopfdruck, endet automatisch) | nur Abrufe, nur zu dieser Website und zu Hugging Face; im Intranet zusätzlich die interne KI | App-Update, Modelle laden, interne KI |

So ist das umgesetzt, und hier lässt es sich nachprüfen:

- **Torwächter** ([`public/sw.js`](public/sw.js)): Ein Service Worker beantwortet jede Anfrage der
  App aus dem Browser-Speicher oder entscheidet nach den Regeln in
  [`public/sw-policy.js`](public/sw-policy.js). Im Modus Lokal wird alles blockiert, im Modus Verbunden
  sind nur `GET`-Abrufe zu freigegebenen Zielen erlaubt. Die App sendet keine Daten, mit einer
  Ausnahme (siehe *Interne KI*).
- **Content Security Policy** ([`csp.js`](csp.js)): Der Browser selbst verbietet Verbindungen zu
  allen anderen Servern, unabhängig vom Code der App.
- **Verbindungsprotokoll**: Jede Netzwerkanfrage, ob erlaubt oder blockiert, erscheint in der App
  unter *Internetverbindung*.
- **Updates nur auf Wunsch**: Die App sucht nicht selbst nach Updates. Eine neue Version, die der
  Browser von sich aus findet, wird verworfen und protokolliert.
- **Modelle** ([`models/catalog.json`](models/catalog.json)): Feste Revision, Grösse, Lizenz und
  SHA-256 für jede Datei (für die Sprachmodelle festgelegt mit
  [`scripts/models/pin-llm.mjs`](scripts/models/pin-llm.mjs)). Die Prüfsumme wird beim Herunterladen
  laufend berechnet; stimmt sie nicht, wird die Datei sofort gelöscht. Auf der Seite *Modelle/Programmupdate*
  lassen sich Modelle laden, nachprüfen und löschen.
- **Sprachmodelle ohne Netz** ([`src/llm/llm.worker.js`](src/llm/llm.worker.js)): transformers.js
  erhält eine eigene Abruffunktion, die nur aus dem geprüften Modellspeicher liest. Selbst im Modus
  Verbunden kann das Sprachmodell nichts nachladen; die ONNX Runtime kommt aus `/vendor`, nicht vom CDN.
  Diese Laufzeit (27 MB) gehört nicht zur App, die beim ersten Aufruf gespeichert wird: Sie steht als
  gemeinsamer Bestandteil mit SHA-256 im Modellkatalog
  ([`scripts/models/pin-runtime.mjs`](scripts/models/pin-runtime.mjs), der Build prüft die Übereinstimmung),
  kommt mit dem ersten Sprachmodell und geht mit dem letzten.
- **Interne KI** ([`src/llm/intranet.js`](src/llm/intranet.js)): Im Intranet bietet die App in
  Stufe 3 zusätzlich `gemma4:31b` auf dem internen OpenWebUI (`aiacoder-v001.kt.lunet.ch`) an. Im
  Modus Verbunden prüft die Seite *Modelle/Programmupdate*, ob der Server erreichbar ist (`/health`,
  ohne Key); ausserhalb des Intranets scheitert diese Anfrage einfach. Aktiv wird die interne KI erst,
  wenn man dort den eigenen API-Key einträgt (OpenWebUI → Einstellungen → Konto → API-Schlüssel); er
  bleibt in diesem Browser. Die App liefert keinen Key mit. Wer sie wählt und «Umformen» drückt,
  schickt den Eingabetext an diesen Server: Der Torwächter erlaubt dafür `POST` an genau
  `/api/chat/completions`, sonst nur `GET` an `/health` und `/api/models`, und alles nur im Modus
  Verbunden. Der Server muss die Origin der App per CORS zulassen. Weil der Server im lokalen Netz
  steht, verlangt Chrome die Berechtigung «Lokales Netzwerk» und fragt danach nur bei Anfragen einer
  Seite, nie bei solchen eines Service Workers. Deshalb lässt der Torwächter die Prüfung `GET /health`
  (nur sie, nur im Modus Verbunden) direkt von der Seite ins Netz und protokolliert sie; nach der
  einmaligen Erlaubnis gehen alle weiteren Anfragen wieder über ihn.
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
