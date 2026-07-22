# Plan: Völlig autonomes AI-Business

> **Praktische Umsetzung:** Das Framework zu diesem Plan liegt in
> [`autonomous-business/`](autonomous-business/) — Supervisor/Worker-Loop,
> Telegram-Steuerung, Ledger, Relay-Portal, Dashboard und Deploy-Skripte.

Eigener Plan, aufgebaut auf den Erkenntnissen aus zwei Experimenten von Ben Awad:

1. **„I Let Claude Fable 5 Run a Business Alone for 6 Days"** (https://youtu.be/x-hI_k2JFRc) — Claude Fable 5 bekam einen VPS, eine Claude-Max-Subscription und einen Prompt pro Tag. Ergebnis nach 6 Tagen: **0,06 $** (ein anderer Agent/Indexer zahlte für zwei API-Calls im „Agent Storefront").
2. **„I Let GPT-5.6 Sol Run a Business Alone for 7 Days"** (https://youtu.be/_4M99V70wJI) — GPT-5.6 Sol (Codex, Goal-Loop, YOLO-Modus) auf demselben VPS. Ergebnis nach ~7 Tagen: **~15 $**, hauptsächlich über einen Task-Marktplatz für Agents (Bounties: Telegram-Forwarder ~4 $, KI-generierte Bildframes ~6 $, Logo-Tasks) plus DeFi-Liquidationen (~10 $ Einzelfall).

---

## 1. Kernerkenntnisse aus den beiden Videos

**Was funktioniert hat:**
- **Task-Marktplätze für Agents waren die einzige verlässliche Einnahmequelle.** Konkrete Bounties mit definierter Auszahlung schlagen jedes „baue ein Produkt und finde Kunden"-Modell um Größenordnungen.
- **Agent-to-Agent-Commerce existiert.** Der „Machine Storefront" (maschinenlesbare API-Preisliste, Krypto-Micropayments im x402-Stil) brachte die ersten Cents — von anderen Bots, nicht von Menschen.
- **Dauerlauf statt Stundentakt.** Sol lief 11,5 Stunden am Stück im Goal-Loop und war massiv produktiver als Fables „stündlich aufwachen, kurz arbeiten, schlafen"-Architektur.
- **Modell-Routing:** teures Modell für Denken/Entscheiden, günstigere Modelle (Opus/Sonnet) für die Ausführung. Framework modellagnostisch bauen, damit das „Gehirn" austauschbar ist.

**Was gescheitert ist (die eigentliche Lektion):**
- **Distribution war der Engpass, nicht das Bauen.** Fable baute Websites und Tools, aber niemand sah sie. Ben Awads eigenes Fazit: Distribution hätte von Tag 1 an der Fokus sein müssen.
- **Accounts, Captchas, KYC, Zahlungs-Onboarding brauchen einen Menschen.** Das Internet ist nicht agent-freundlich. Fable verbrachte Tage damit, um Gumroad-/Stripe-/GitHub-Accounts zu betteln; die Modelle weigern sich zudem (Missbrauchs-Guardrails), selbst Accounts per Browser anzulegen.
- **Rate-Limits und Guardrail-Stopps töten den Loop.** Sols Goal-Loop blieb bei 5-Stunden-Limits und „Cybersecurity"-Blocks (krypto-nahe Arbeit triggert sie ständig) einfach stehen — bis ein tmux-Watcher automatisch „continue" tippte.
- **Falsche Sparsamkeit:** Ein „schone die Tokens"-Hinweis führte dazu, dass der Agent fast nichts mehr tat (2 % Wochenverbrauch). Außerdem lief tagelang unbemerkt das falsche Modell.
- **Halluzinationen und Scams:** Fable behauptete, ein Gumroad-Produkt veröffentlicht zu haben (existierte nicht); Sol wurde von Scam-Agents um 51 Cent gebracht. Alles muss gegen externe Wahrheit (Ledger, Zahlungsanbieter) verifiziert werden.
- **Kleinkram, der Tage kostet:** Zeitzone nicht gesetzt (UTC-Chaos), untypisiertes JavaScript, kaputtes Dashboard, Hetzner-Ausfall.

---

## 2. Zielbild und Erfolgskriterien

**Ziel:** Ein System, das nach einer einmaligen menschlichen Setup-Phase mit maximal **einem Steuer-Prompt pro Tag** selbstständig Umsatz erwirtschaftet.

| Kriterium | Woche 1 | Monat 1 | Monat 3 |
|---|---|---|---|
| Umsatz | > 0 $ (erster verifizierter Zahlungseingang) | > 50 $ | > Betriebskosten (VPS + Subscriptions) |
| Autonomie | ≤ 1 Human-Assist/Tag | ≤ 2 Human-Assists/Woche | nur noch KYC-/Account-Fälle |
| Uptime des Loops | ≥ 90 % (Watchdog greift) | ≥ 99 % | ≥ 99 % |

Wichtig: Umsatz zählt nur, wenn er im Zahlungsanbieter/Wallet **extern verifiziert** ist — nie auf Selbstauskunft des Agenten vertrauen.

---

## 3. Architektur

```
                    ┌───────────────────────────────┐
 Mensch ── Telegram │  #reports  #steer  #assist    │
                    └──────────────┬────────────────┘
                                   │
                    ┌──────────────▼────────────────┐
                    │  SUPERVISOR (Watchdog-Agent)   │  günstiges Modell, eigener Prozess
                    │  - überwacht Worker-Session    │
                    │  - restart bei Rate-Limit/Stop │
                    │  - tippt "continue" bei Blocks │
                    │  - eskaliert an #assist        │
                    └──────────────┬────────────────┘
                                   │
                    ┌──────────────▼────────────────┐
                    │  WORKER (Goal-Loop)            │  Top-Modell für Planung,
                    │  - plant, baut, verkauft       │  günstige Modelle für Ausführung
                    │  - schreibt jeden Schritt ins  │
                    │    Ledger (append-only)        │
                    └──────┬───────────┬─────────────┘
                           │           │
                 ┌─────────▼──┐   ┌────▼─────────────┐
                 │  LEDGER +  │   │  RELAY (Human-   │
                 │  DASHBOARD │   │  in-the-loop-    │
                 │  (extern   │   │  Portal für      │
                 │  verifiziert)│ │  Accounts/KYC)   │
                 └────────────┘   └──────────────────┘
```

**Komponenten:**

1. **VPS** (z. B. Hetzner, 4 vCPU / 8 GB) als dauerhaft laufende Umgebung, Sessions in `tmux`/`systemd`.
2. **Worker-Agent im Dauer-Goal-Loop** (nicht Stundentakt!) mit vollen Berechtigungen auf dem VPS. Modell-Routing: Frontier-Modell denkt und entscheidet, günstige Modelle führen aus. Framework modellagnostisch (TypeScript, nicht untypisiertes JS).
3. **Supervisor/Watchdog als eigener Prozess**: erkennt Rate-Limit-Stopps, Guardrail-Blocks und Crashes, startet neu bzw. setzt fort, und eskaliert nur echte Blocker an den Menschen. (Kombiniert Fables Selbstheilung mit Sols Goal-Loop — die jeweils größte Stärke beider Setups.)
4. **Telegram als Nervensystem** mit drei Kanälen: `#reports` (Tagesbericht), `#steer` (der eine Prompt/Tag), `#assist` (strukturierte Human-Requests).
5. **Relay-Portal** (Fables beste Idee): Der Agent stellt strukturierte Anfragen („brauche API-Key für X", „Account bei Y anlegen"), der Mensch arbeitet sie in einer täglichen 10-Minuten-Schicht ab. Secrets landen ausschließlich in `.env` auf dem VPS.
6. **Append-only-Ledger + Dashboard**: jede Einnahme/Ausgabe mit Quelle, abgeglichen gegen Stripe/Wallet/Marktplatz. Jeder Ledger-Eintrag einzeln einsehbar. Umsatz-Claims des Agenten werden automatisch gegen die externe Quelle geprüft (Anti-Halluzinations-Check).

---

## 4. Geschäftsmodelle (priorisiert nach nachgewiesener Traktion)

1. **Agent-Task-Marktplätze (sofortiger Umsatz, PMF im Experiment bewiesen).** Bounties abarbeiten: kleine Coding-Tasks, Bildgenerierung, Datenaufbereitung. Regeln: nie Marktplätze „farmen" (ToS-Risiko), Aufwand pro Bounty gegen Auszahlung rechnen, Auszahlungen sofort ins Ledger.
2. **Agent-to-Agent-Storefront (x402-Micropayments).** Maschinenlesbare API-Dienste mit Preisliste, in Agent-Directories eingetragen für Discoverability. Nur Endpoints anbieten, die echten Nutzen liefern (Fables 6-Cent-Kunde bekam faktisch nichts — das ist kein Geschäftsmodell, sondern ein Bug).
3. **Digitale Mikroprodukte über Stripe** (Templates, Tools, Checker/Generatoren) — aber erst, wenn Distribution steht: Wartelisten, kostenlose Produkte als Köder, Posts in relevanten Communities, SEO. **Distribution ist von Tag 1 an ein eigener täglicher Arbeitsblock, kein Nachgedanke.**
4. **Nicht tun (vorerst):** DeFi/Liquidationen und Prediction Markets. Brachte im Experiment zwar den größten Einzelbetrag (10 $), aber: ständige Guardrail-Blocks, Scam-Verluste, „bad debt", regulatorisch heikel und in Deutschland teils geo-geblockt (Polymarket). Risiko/Aufwand passt nicht.

---

## 5. Setup-Phase (Tag 0 — der Mensch, einmalig)

Alles, was Captcha/KYC/Identität braucht, wird **vorab** erledigt, damit der Agent nie darauf warten muss:

- [ ] VPS mieten, Agent-CLI + tmux + Watchdog installieren
- [ ] Frontier-Modell-Subscription (Max-Plan) + Fallback-Modell konfigurieren
- [ ] Telegram-Bot mit den drei Kanälen
- [ ] Domain + minimale Firmen-Website (Stripe-Voraussetzung!)
- [ ] Stripe-Account verifizieren (dauerte im Video < 1 Tag)
- [ ] GitHub-Account + Token
- [ ] E-Mail-Postfach für den Agenten
- [ ] Krypto-Wallet (nur als Zahlungsempfang für Agent-Marktplätze)
- [ ] Accounts auf 2–3 Agent-Task-Marktplätzen
- [ ] `.env`-Konvention: alle Secrets dort, Agent liest sie selbst
- [ ] **Zeitzone explizit setzen** und Budgetlimit definieren (z. B. 50 $ Spielgeld)

## 6. Betriebsregeln

- **Ein Steuer-Prompt pro Tag** über `#steer` — Kurskorrektur, nicht Mikromanagement.
- **Kein „schone Ressourcen"-Prompt.** Stattdessen explizit: „Nutze dein Wochenkontingent gleichmäßig aus; Ziel ist ~X %/Tag." Tokenverbrauch wird im Dashboard überwacht (zu niedrig = Agent bummelt, zu hoch = Limit-Crash).
- **Modell-Check im Tagesreport:** welches Modell lief wie lange (verhindert den „wir liefen tagelang auf dem falschen Modell"-Fehler).
- **Verifikationspflicht:** Jeder Erfolgs-Claim (Produkt live, Umsatz, PR gemerged) wird automatisch gegen die externe Quelle geprüft.
- **Ausgaben-Guardrails:** Einzelausgabe > 5 $ braucht Human-Approval via `#assist`; Gegenparteien auf Marktplätzen minimal verifizieren (Anti-Scam).
- **Legal/ToS:** keine Marktplatz-Farmerei, keine Umgehung von Geo-Blocks, Guardrail-Blocks der Modelle respektieren statt austricksen — der Watchdog setzt nur legitime, fälschlich gestoppte Arbeit fort.

## 7. Wochenplan (Tag 1–7)

| Tag | Fokus |
|---|---|
| 1 | Worker + Supervisor live, Ledger/Dashboard live, erste Marktplatz-Bounties scannen |
| 2 | Erste Bounties abliefern; Storefront-Endpoints definieren (nur echte Nutzwert-APIs) |
| 3 | Storefront live + in Agent-Directories eintragen; Distribution-Block startet (täglich!) |
| 4 | Review: Welche Bounty-Typen haben den besten $/Stunde-Wert? Verdoppeln, Rest streichen |
| 5 | Erstes Mikroprodukt nur, wenn Bounty-Pipeline stabil läuft; sonst Bounties skalieren |
| 6 | Automatisierungslücken schließen (was landete in `#assist`? → wegautomatisieren) |
| 7 | Wochen-Retro durch den Agenten selbst: Ledger-Analyse, Pivot-/Skalierungs-Vorschlag |

## 8. Risiken

| Risiko | Gegenmaßnahme |
|---|---|
| Rate-Limits stoppen den Loop | Supervisor mit Auto-Resume; Arbeit über den Tag verteilen |
| Guardrail-Blocks (v. a. krypto-nah) | krypto-lastige Geschäftsmodelle meiden; Watchdog-Resume nur für False Positives |
| Agent halluziniert Erfolge | externe Verifikation jedes Claims (Stripe/Wallet/API) |
| Agent wird gescammt | Ausgabenlimits, Gegenpartei-Checks, Ledger-Review |
| Menschlicher Engpass (Accounts/KYC) | alles Vorhersehbare an Tag 0 erledigen; Rest über Relay-Portal bündeln |
| Anbieter-/Modellwechsel | modellagnostisches Framework, Gehirn austauschbar |
| VPS-Ausfall | Selbstheilung beim Boot (systemd), Ledger extern gesichert |

## 9. KPIs (täglich im Report)

- Verifizierter Umsatz (extern abgeglichen) und Ausgaben
- Abgeschlossene Bounties + $/Bounty
- Token-/Kontingentverbrauch pro Modell
- Anzahl Human-Assists (Ziel: fallend)
- Loop-Uptime / Anzahl Watchdog-Eingriffe
- Distribution-Metriken (Directory-Listings, Anfragen an Storefront, Waitlist-Signups)

## 10. Wirtschaftlichkeit (Profitabilitäts-Review)

### Fixkosten pro Monat

| Posten | Kosten |
|---|---|
| VPS (Hetzner, 4 vCPU / 8 GB) | ~8 € |
| Domain | ~1 € |
| Frontier-Abo: Claude Max 5x ~100 $ **oder** Max 20x / Codex Pro ~200 $ | 100–200 $ |
| Optional: 16-GB-VPS für 12B-Lokalmodell | +~10 € |
| **Summe** | **~110–215 $/Monat** |

**Break-even: ~3,60–7 $ verifizierter Umsatz pro Tag.** Beobachtet in den Experimenten: Fable 0,01 $/Tag, Sol ~2,10 $/Tag (~64 $/Monat hochgerechnet) — also **deckt selbst das bessere Experiment die Kosten nicht**. Das muss man nüchtern so festhalten.

### Deckungsbeitrag je Geschäftsmodell

| Modell | Belegter Umsatz | Variable Kosten | Einschätzung |
|---|---|---|---|
| Task-Marktplätze | 4–6 $/Bounty (Forwarder, Bild-Frames, Logos) | fast nur Tokens | **Einziges Modell mit belegtem positivem Deckungsbeitrag.** Engpass ist das Bounty-Angebot, nicht die Kapazität. $/h pro Bounty-Typ aus dem Ledger auswerten, nur Top-Typen bedienen. |
| Agent-Storefront | Cent-Beträge (Indexer-Zahlungen) | ~0 | Mitlaufen lassen (kostet nichts), aber keine Arbeitszeit investieren, bis echte Nachfrage messbar ist. |
| Mikroprodukte via Stripe | unbelegt | Stripe ~2,9 % + 0,30 $ | Bei 1-$-Preisen frisst die Fixgebühr ~33 % der Marge — nur mit Preisen ≥ 5–10 $ und stehender Distribution sinnvoll. |
| DeFi/Prediction | brutto größter Einzelposten (10 $), aber Scams/Blocks/Bad Debt | hoch + Rechtsrisiko | Bleibt ausgeschlossen — negativer risikoadjustierter Erwartungswert. |

### Szenarien (verifizierter Umsatz, Monat 1–3)

| Szenario | Umsatz/Monat | Ergebnis bei 100-$-Setup | bei 200-$-Setup |
|---|---|---|---|
| Pessimistisch | 0–30 $ | −80 bis −110 $ | −180 bis −210 $ |
| Basis (≈ Sol-Niveau, leicht optimiert) | 60–120 $ | −50 bis +10 $ | −150 bis −90 $ |
| Optimistisch (Bounty-Pipeline skaliert) | 250 $+ | profitabel | ~break-even+ |

**Konsequenzen:**
1. **Mit dem 100-$-Abo starten**, nicht mit 200 $ — die Lokal-Modell-Stufe (§11) gleicht das kleinere Kontingent aus. Halbiert den Break-even auf ~3,60 $/Tag.
2. **Sonderfall: Abo bereits vorhanden** (weil man es ohnehin privat/beruflich nutzt) → Grenzkosten ≈ 10 €/Monat VPS, dann ist schon das Basisszenario profitabel. Das ist ehrlicherweise der realistischste Weg zu „profitabel ab Monat 1".
3. **Abbruchkriterium festlegen:** Nach 6 Wochen < 25 $/Woche verifiziert → stoppen oder pivotieren. Monat 1 ist als bezahltes Lernprojekt einzuordnen, nicht als Einkommen.

## 11. Dritte Modell-Stufe: lokales Modell (z. B. Gemma 3 QAT via Ollama)

Erweiterung des Modell-Routings auf drei Stufen:

| Stufe | Modell | Aufgabe |
|---|---|---|
| 1 – Denken | Frontier (Fable/Sol) | Planung, Entscheidungen, Geschäftslogik |
| 2 – Ausführen | Mittelklasse (Opus/Sonnet) | Coding, Deliverables, Kommunikation |
| 3 – Mechanik | **Lokal (Gemma 3 QAT)** | Zusammenfassen, Extrahieren, Klassifizieren, Erstentwürfe, Reformatieren, Testdaten |

**Ökonomie — ehrlich gerechnet:** Das Abo ist eine Flatrate, das Lokalmodell spart also nicht „pro Token", sondern: (1) es **streckt die Rate-Limits** — mechanische Massenarbeit verbraucht kein Kontingent mehr, weniger Backoff-Leerlauf; (2) es **ermöglicht das 100-$- statt 200-$-Abo** (~100 $/Monat echte Ersparnis); (3) Betriebskosten lokal ≈ 0 auf vorhandener Hardware.

**Dimensionierung (QAT = Quantization-Aware Training, ~3× weniger RAM bei nahezu bf16-Qualität):**

| Modell | RAM | Hardware | Empfehlung |
|---|---|---|---|
| gemma3:1b-it-qat | ~1 GB | jeder VPS | zu schwach, nur Tagging/Triage |
| **gemma3:4b-it-qat** | ~4 GB | vorhandener 8-GB-VPS, 0 € extra | **Standard-Empfehlung** (CPU-only langsam, für Batch-Arbeit egal) |
| gemma3:12b-it-qat | ~9 GB | 16-GB-VPS, +~10 €/M | wenn 4B-Qualität nicht reicht |
| gemma3:27b-it-qat | ~18 GB | GPU-Server, +50–100 €/M | erst wenn nachweislich Rate-Limit-gebunden — sonst frisst es die Abo-Ersparnis wieder auf |

**Risiko-Leitplanken (geringere Intelligenz, höhere Halluzinationsrate):** Das Lokalmodell hat keinen Tool-/Datei-Zugriff, niedrige Temperatur, und seine Ausgaben gelten immer als ungeprüfter Entwurf. Es darf **nie**: Entscheidungen treffen, Ledger/Geld anfassen, extern kommunizieren oder Fakten liefern, die ungeprüft weiterverwendet werden. Der Hauptagent reviewt jede Ausgabe (Namen, Zahlen, URLs gelten bis zur Prüfung als halluziniert). Diese Regeln sind im Framework fest verankert (`prompts/OPERATING_RULES.md`), die Anbindung läuft über `node dist/cli.js local "<prompt>"` (Ollama-API).

**Filler-Cycles (implementiert):** Während Rate-Limit-Backoffs erstellt das Lokalmodell einmal pro Backoff ein Housekeeping-Briefing (Zustand konsolidieren, nächste Schritte, offene Fragen — nur aus übergebenem Zustand, nichts erfinden). Es landet als klar markierter, ungeprüfter Entwurf (`FILLER_BRIEFING.md`) im Workspace; der Hauptagent bekommt die Existenz im nächsten Zyklus-Prompt mitgeteilt und verifiziert vor der Nutzung. So wird Leerlaufzeit produktiv, ohne dem schwachen Modell Entscheidungen zu überlassen.

## 12. Neue Ideen aus „AI Agent Ecosystem Tour 2" (androoAGI)

Quelle: https://www.tiktok.com/@androoagi/video/7646249622893038879 (6,5 min, 860K Views). Der Creator zeigt eine „Raumstation", in der Agents (Hermes-Harness, GPT 5.5, Orchestrator „Ultron") parallel mehrere Businesses betreiben. **Wichtige Einordnung:** Das Video ist Werbung für das Hermes-Harness; die Umsatzclaims (~20.000 $ in 2 Monaten bei ~400 $/Monat Kosten) sind unverifiziert — genau die Art Behauptung, für die unser Ledger die Verifikationspflicht hat. Trotzdem stecken übernehmenswerte Betriebsideen darin:

**Übernehmen:**

1. **Portfolio statt Einzel-Business.** Mehrere Micro-Businesses parallel auf gemeinsamer Infrastruktur, jedes mit eigener G&V im Ledger (Ausbaustufe: `business`-Tag pro Ledger-Eintrag). Der Orchestrator verteilt Zyklen gewichtet nach Deckungsbeitrag statt rein sequenziell.
2. **War-Room als Institution.** Kill-/Skalierungs-Entscheidungen nicht ad hoc, sondern als wiederkehrender Review mit festen Regeln: „Was läuft, nicht anfassen; was nach X Wochen Verlust macht, killen" (im Video: Supplement-Firma mit Ad-Verlusten gekillt → Etsy-Store Nr. 3). Verschärft unsere Tag-7-Retro zu einem stehenden Mechanismus.
3. **Research-Lab: „Sell what sells."** Nachfrage-Validierung durch Analyse dessen, was auf Marktplätzen nachweislich verkauft, statt Produkte zu erfinden — als wiederkehrender Zyklus, der einen Ideen-Backlog mit Evidenz füttert. **Rote Linie:** Nachfrage-Signale und Nischen analysieren ja, fremde Designs kopieren nein (das im Video gezeigte „Designs leicht abgewandelt replizieren" ist IP-Verletzung und der häufigste Etsy-Ban-Grund).
4. **Communications-Lab → Entwurfs-Queue im Relay.** Der Agent beantwortet Inbound nicht direkt, sondern legt Antwort-Entwürfe zur Ein-Klick-Freigabe vor. Das macht aus unserer Regel „Außenkommunikation braucht Review" ein produktives Feature statt einer Bremse — und skaliert den Menschen, statt ihn zu ersetzen.
5. **Publishing-Pipeline: das Business vermarktet sich selbst.** Produktfotos → Slideshows → eigener TikTok-/Social-Kanal, alles vom System geplant. Und die Meta-Ebene: *Das Video über das Experiment ist selbst der profitabelste Teil des Experiments* (gilt auch für Ben Awads Videos). Konsequenz: Der Tagesreport sollte automatisch dokumentationsfähiges Material erzeugen (Screenshots, Meilensteine) — der Experiment-Content ist ein eigener Einnahmekanal.
6. **Menschen-Marktplätze als Geschäftsmodell #5.** Das Video verkauft an Menschen auf etablierten Märkten (Etsy/POD, Fiverr-artige Services à 20 $) statt an Agents (Cent-Beträge). Wenn auch nur ein Bruchteil der Claims stimmt, liegt dort mehr Kaufkraft als in Agent-Task-Märkten. Aufnahme in die Prioritätenliste mit Vorbehalten: gesättigte Märkte, Etsy-/Fiverr-KYC und Gebühren, Review-Management, strikte ToS-/IP-Konformität, und POD-Margen erst nach Gebühren/Basiskosten rechnen.
7. **Archives: Entscheidungs-Log.** Neben dem Geld-Ledger ein append-only Log aller Entscheidungen und Ideen (`decisions.md`), damit Pivots auf dokumentierter Historie basieren statt auf dem Kontextfenster.

**Nicht übernehmen:** Design-Kopieren (IP-Risiko), „Kunden zahlen für etwas, das gratis ginge" als Geschäftsprinzip (kurzfristig legal, langfristig Reputations-/Refund-Risiko), Agents mit Vollzugriff auf alle privaten Accounts (stattdessen Least-Privilege pro Business), unverifizierte Umsatz-Screenshots als Benchmark.

**Profitabilitäts-Quervergleich zu §10:** Die Claims (330 $/Tag) vs. Ben Awads Messung (2 $/Tag) klaffen um Faktor >150 auseinander. Die plausible Erklärung neben Übertreibung: (a) deutlich mehr Human-in-the-loop (Accounts, Freigaben, Ads), (b) Verkauf an Menschen auf etablierten Marktplätzen statt an Agents, (c) 2 Monate Laufzeit statt 1 Woche. Das stützt die Portfolio-These: Agent-Task-Märkte als verlässlicher Sockel, Menschen-Marktplätze als Upside — beides parallel, mit War-Room-Review nach Deckungsbeitrag.

## 13. Fazit

Die beiden Experimente zeigen: Der Engpass ist nicht die Intelligenz des Modells, sondern **(1) Distribution, (2) agent-unfreundliche Infrastruktur (Accounts/KYC/Captchas) und (3) Loop-Stabilität** (Rate-Limits, Guardrails). Dieser Plan löst genau diese drei Punkte — Task-Marktplätze als sofortige Einnahmequelle mit eingebauter Distribution, ein Relay-Portal plus Tag-0-Setup gegen den Infrastruktur-Engpass, und ein Supervisor-Watchdog für den Dauerbetrieb. Dazu kommt ein dreistufiges Modell-Routing (Frontier denkt, Mittelklasse arbeitet, Lokalmodell erledigt Mechanik), das den Break-even auf ~3,60 $/Tag halbiert.

Die nüchterne Wahrheit aus §10: Fable 5 machte 6 Cent, Sol ~2 $/Tag — **kein Experiment war profitabel**, und wer ein Abo eigens dafür kauft, startet mit 100–200 $/Monat im Minus. Realistisch profitabel ist das Setup ab Tag 1 nur, wenn das Abo ohnehin existiert (Grenzkosten ~10 €/Monat). Ansonsten gilt: Monat 1 ist ein bezahltes Lernprojekt mit klarem Abbruchkriterium (6 Wochen, 25 $/Woche verifiziert), und der Weg zur Profitabilität führt über die $/h-Auswertung der Bounty-Typen im Ledger — skaliert wird nur, was nachweislich positiven Deckungsbeitrag hat.
