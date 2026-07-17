# Plan: Völlig autonomes AI-Business

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

## 10. Fazit

Die beiden Experimente zeigen: Der Engpass ist nicht die Intelligenz des Modells, sondern **(1) Distribution, (2) agent-unfreundliche Infrastruktur (Accounts/KYC/Captchas) und (3) Loop-Stabilität** (Rate-Limits, Guardrails). Dieser Plan löst genau diese drei Punkte — Task-Marktplätze als sofortige Einnahmequelle mit eingebauter Distribution, ein Relay-Portal plus Tag-0-Setup gegen den Infrastruktur-Engpass, und ein Supervisor-Watchdog für den Dauerbetrieb. Fable 5 machte 6 Cent, Sol ~15 $ — mit dieser Architektur ist das realistische Ziel für Monat 1, die eigenen Betriebskosten zu verdienen, und ab Monat 3 profitabel zu skalieren.
