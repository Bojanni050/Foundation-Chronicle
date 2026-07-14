# Kernprincipe

**Registreren en archiveren.** Dat is de taak van Chronicle. Niet meer.

Lees dit eerst — vóór je iets nieuws bouwt, ongeacht of dat via Claude,
Claude Code, of een andere sessie gebeurt.

## Wat dat betekent

- **Registreren**: iets komt binnen (chatgesprek, activiteit, document,
  notitie) en wordt vastgelegd.
- **Archiveren**: het is geordend, getagd, en later terug te vinden.

Alles daarbuiten — interpretatie, suggesties, persona's, proactieve AI — is
een laag *op* het archief, niet het archief zelf.

## De toetssteen

Bij elke nieuwe feature, vóór je begint te bouwen:

> **Breekt dit de kernloop, of hangt het er alleen aan?**

- **Breekt de kernloop** = maakt registreren of archiveren trager,
  ingewikkelder of minder betrouwbaar → heroverwegen, of in elk geval
  bewust kiezen.
- **Hangt er alleen aan** = kan losstaan zonder dat registreren/archiveren
  kapot gaat → prima, mag blijven, maar wordt nooit een randvoorwaarde
  voor de kernloop.

## Huidige indeling (stand 13 juli 2026)

**Kern — registreren**
- Browser-extensie (`extension/`, "Chronicle Chat Sender")
- Native UIA-capture (`src-tauri/src/uia_capture.rs`, opt-in, off by default)
- ChatGPT-import (`server/chatgptImportManager.js`)
- WordPress-connector (`server/connectors/wordpress.js`)

**Kern — archiveren**
- IndexedDB + repository-pattern (`frontend/src/repositories/`)
- `ObjectList` / `ObjectDetail` / `TagEditor`
- Inbox → `pollInbox()`-pipeline (`inboxStore.js`, `App.js`)

**Erbovenop — mag blijven, is niet de taak zelf**
- Persona's / Pulse (`routes/persona/`)
- AI Weave / related-suggesties (`services/weave.js`)
- Screenpipe ambient sync (los, extern proces)
- Diagnostic board / Token Telemetry
- Developer Timeline Demo Seeder

## Waarom dit is opgeschreven

Er zijn vijf Chronicle-mappen ontstaan (`Chronicle`, `Chronicle_1`,
`Chronicle-PIH`, `ChronicleBEAM`, `Foundation-Chronicle`) doordat de
architectuur bij elke sessie opnieuw werd uitgevonden, zonder dat er een
vast anker lag. Dit document is dat anker.

Foundation-Chronicle (deze repo) is de actieve versie. De andere vier
mappen zijn eerdere iteraties — behandel ze als archief, niet als basis
om vanuit verder te bouwen.
