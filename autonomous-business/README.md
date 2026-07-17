# Autonomous Business Framework

Praktische Umsetzung des Plans aus [`../AUTONOMOUS_AI_BUSINESS_PLAN.md`](../AUTONOMOUS_AI_BUSINESS_PLAN.md):
ein Supervisor/Worker-System für ein dauerhaft laufendes, weitgehend autonomes
AI-Business. Modellagnostisch (Claude Code, Codex, …), TypeScript, **null
Runtime-Dependencies** (nur Node ≥ 20).

## Architektur

```
systemd ──▶ SUPERVISOR (dist/supervisor.js, ein Prozess)
              ├─ Worker-Goal-Loop: startet pro Zyklus das Agent-CLI mit
              │    prompts/GOAL.md + OPERATING_RULES.md + aktuellem Zustand
              │    (Ledger-Summen, offene Relay-Requests, Steer-Nachricht)
              ├─ Watchdog: Rate-Limit-Erkennung → exponentieller Backoff +
              │    Auto-Resume; Timeout-Kill für hängende Zyklen; Crash → Restart
              ├─ Telegram-Nervensystem: /steer /status /assists /resolve
              │    /reject /verify + Tagesreport
              └─ Dashboard (nur 127.0.0.1): Ledger, Zyklen, offene Assists

Agent-CLI im Zyklus ──▶ dist/cli.js
              ├─ ledger add …     (jede Einnahme/Ausgabe, append-only JSONL,
              │                    Einnahmen starten IMMER als "unverified")
              ├─ relay request …  (Human-in-the-loop: Accounts, API-Keys, KYC,
              │                    Spend-Approvals — Agent blockiert nie darauf)
              └─ notify …         (wichtige Ereignisse an Telegram)
```

Kernideen aus den beiden Experimenten, hier eingebaut:

- **Goal-Loop + Selbstheilung kombiniert:** Sols produktiver Dauerlauf, aber mit
  Fables Restart-Fähigkeit — Rate-Limits und Crashes führen zu Backoff+Resume
  statt stillem Stillstand.
- **Anti-Halluzination:** Der Agent kann Einnahmen nur als *unverifiziert*
  buchen; verifizieren (`/verify <id>`) kann nur der Mensch nach Abgleich mit
  Stripe/Wallet/Marktplatz.
- **Spend-Guard:** Ausgaben über dem Schwellwert werden vom CLI abgelehnt und
  automatisch als Approval-Request an Telegram eskaliert.
- **Relay:** strukturierte Human-Requests statt Betteln im Chatverlauf; der
  Agent arbeitet währenddessen weiter.
- **Zeitzone, Budget, tägliche Distribution** sind in Config und Prompts fest
  verankert.
- **Dreistufiges Modell-Routing:** Frontier-Modell denkt, Mittelklasse führt
  aus, und ein optionales **lokales Modell** (Ollama, z. B. `gemma3:4b-it-qat`)
  übernimmt mechanische Massenarbeit, um Rate-Limits zu strecken und ein
  kleineres Abo zu ermöglichen. Wegen der höheren Halluzinationsrate kleiner
  Modelle gilt: kein Tool-Zugriff, niedrige Temperatur, Ausgaben sind immer
  ungeprüfte Entwürfe, nie Geld/Entscheidungen/Außenkommunikation
  (Delegations-Regeln in `prompts/OPERATING_RULES.md`).

## Lokal ausprobieren (ohne Accounts, ohne Secrets)

```bash
cd autonomous-business
npm install && npm run build
npm run smoke                            # Komponententests (Ledger, Relay)

# Ohne Telegram-Token laufen Meldungen ins Log; als Worker tut ein Dummy:
WORKER_CMD='echo "cycle done"' MAX_CYCLES=2 CYCLE_PAUSE_SECONDS=1 npm start
# Dashboard: http://127.0.0.1:8788

# Agenten-CLI von Hand testen:
node dist/cli.js ledger add income 4 task-market "telegram forwarder bounty"
node dist/cli.js relay request api-key "Need FAL_KEY in .env"
node dist/cli.js ledger list
```

## Lokales Modell aktivieren (optional)

```bash
curl -fsSL https://ollama.com/install.sh | sh
ollama pull gemma3:4b-it-qat          # ~4 GB RAM, läuft auf dem 8-GB-VPS
# in .env: LOCAL_MODEL=gemma3:4b-it-qat
node dist/cli.js local "Fasse zusammen:" < irgendein.log   # manueller Test
```

Der Worker bekommt die Verfügbarkeit im Zyklus-Prompt mitgeteilt und delegiert
dann selbstständig nach den Regeln in `OPERATING_RULES.md`. Größere Varianten:
`12b-it-qat` braucht einen 16-GB-VPS, `27b-it-qat` ist CPU-only nicht sinnvoll
(GPU-Server nötig — rechnet sich erst, wenn man nachweislich am Rate-Limit
hängt). Die QAT-Varianten sind quantisierungsrobust trainiert und brauchen
~3× weniger RAM bei nahezu gleicher Qualität.

## Deployment (Tag 0)

Was **du** einmalig tust (alles, was Captcha/KYC/Identität braucht):

1. VPS mieten (z. B. Hetzner, 4 vCPU/8 GB), `deploy/setup-vps.sh <repo-url>` ausführen.
2. Agent-CLI für den `business`-User installieren und einloggen
   (z. B. `npm i -g @anthropic-ai/claude-code`, einmal interaktiv anmelden).
3. Telegram-Bot bei @BotFather anlegen; Token + deine Chat-ID in `.env`.
4. Stripe-Account + Domain + Mini-Website (Stripe-Voraussetzung), GitHub-Account,
   E-Mail-Postfach, Wallet, Accounts auf 2–3 Agent-Task-Marktplätzen —
   Keys/Tokens alle in `.env`.
5. `systemctl start autonomous-business` — ab jetzt läuft der Loop; du steuerst
   mit **einem `/steer` pro Tag** und arbeitest offene `/assists` in einer
   täglichen 10-Minuten-Schicht ab.

## Sicherheit & Compliance

- Dashboard bindet nur an `127.0.0.1` — Zugriff via SSH-Tunnel.
- Secrets nur in `.env` (gitignored); der Agent darf sie nie ausgeben.
- Hard Rules in `prompts/OPERATING_RULES.md`: kein Marktplatz-Farming, keine
  Geo-Block-/Captcha-Umgehung, keine DeFi-Trades, ToS respektieren.
- `WORKER_CMD` läuft standardmäßig mit vollen Rechten auf dem VPS
  (`--dangerously-skip-permissions`) — deshalb: eigener VPS ohne private Daten,
  eigener Unix-User, Budgetlimits bei allen Zahlungsanbietern.

## Dateien

| Pfad | Zweck |
|---|---|
| `src/supervisor.ts` | Hauptprozess: Loop, Watchdog, Telegram, Report, Dashboard |
| `src/worker.ts` | Zyklus: Prompt-Bau, Agent-CLI-Spawn, Rate-Limit-Klassifikation |
| `src/cli.ts` | Agenten-CLI: Ledger, Relay, Notify (mit Spend-Guard) |
| `src/ledger.ts` | Append-only-Ledger (JSONL), Verifikations-Flag |
| `src/relay.ts` | Human-in-the-loop-Request-Queue |
| `src/telegram.ts` | Bot-API-Client (Long-Polling, ohne Dependencies) |
| `src/localllm.ts` | Ollama-Client für die lokale Modell-Stufe |
| `src/dashboard.ts` | Read-only-Konsole auf localhost |
| `prompts/GOAL.md` | Geschäftsziel + Prioritäten (Task-Marktplätze zuerst) |
| `prompts/OPERATING_RULES.md` | Hard Rules: Wahrheitspflicht, Spend-Guard, Secrets, ToS |
| `deploy/` | systemd-Unit + VPS-Setup-Skript |
