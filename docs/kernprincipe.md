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

## Verhouding tot Hindsight (toegevoegd 6 september 2026)

Chronicle is **geen** concurrerende geheugenlaag voor Hermes. Hindsight
vervult die rol al in productie (recall/retain/reflect, hypothese-tracking,
sinds 23 augustus 2026). Een eerder ontwerp (`docs/hermes-chronicle-integratie.md`)
beschreef Chronicle als eigen Hermes memory-provider
(`chronicle_recall`/`retain`/`reflect`/`hypothesize`) — dat spoor is
losgelaten. Chronicle's rol is smaller en concreter: een **ruw archief**
voor content die buiten Gaia/Hermes ontstaat (externe AI-tools, browsers,
documenten), met een MCP-ingang zodat Gaia het kan bevragen. Ruwe tekst
gaat nooit rechtstreeks Hindsight in — alleen bevestigde, gedistilleerde
feiten gaan via `sync_retain` naar Hindsight, net als bij Gaia's eigen
gesprekken.

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

**Update 6 september 2026**: er bleek een zesde, feitelijk de ÁLLEREERSTE
iteratie te bestaan — gebouwd in Google AI Studio, vóór alle hierboven
genoemde mappen, teruggevonden in een lokale zip en ondergebracht in
[`chronicle-archive`](https://github.com/Bojanni050/chronicle-archive)
(privé). Ook dit is archief, geen basis om vanuit te bouwen — maar het
bevat wél twee patronen die het overwegen waard zijn voor de "registreren"
-kern hierboven: (1) een generieke transcript-parser die zowel
markdown-stijl exports als losse JSON-vormen (`{role,content}`,
`{messages:[...]}`, etc.) herkent, breder dan de huidige browser-extensie
die alleen Claude/ChatGPT/Gemini dekt; (2) een eigen MCP-server
(`search_archive`/`semantic_search`/`list_recent_chats`/`list_tags`) als
voorbeeld van hoe een ruw archief bevraagbaar wordt zonder de data naar
Hindsight te hoeven duwen.
