# Chronicle als Native Hermes Provider

## Inleiding
Chronicle wordt geïmplementeerd als een native Hermes memory provider voor gestructureerd, temporeel en cross-agent geheugen, in plaats van Hermes' kerncode te verbouwen. Dit maakt gebruik van de bestaande providerinterface met lifecycle-hooks.

## Provider Model
Een Chronicle-provider volgt dit model in Hermes:

```python
class ChronicleMemoryProvider:
    def initialize(self, session_id, platform):
        ...

    def prefetch(self, user_message):
        ...

    def sync(self, user_message, assistant_message):
        ...

    def handle_tool_call(self, tool_name, arguments):
        ...

    def on_session_end(self, messages):
        ...

    def shutdown(self):
        ...
```

Deze architectuur ondersteunt initialisatie, tools, synchronisatie na berichten, sessie-einde en shutdown. 

## Chronicle Tools
De tools die de provider registreert sluiten aan op het model dat Hermes nu al voor Hindsight gebruikt:
- `chronicle_recall`
- `chronicle_retain`
- `chronicle_reflect`
- `chronicle_timeline`
- `chronicle_hypothesize`

Relevante context kan automatisch vóór antwoorden worden opgehaald, en gesprekken kunnen na een beurt worden gesynchroniseerd.

## Verhouding met MCP
MCP blijft nuttig en bruikbaar, maar niet als primaire geheugenverbinding. De scheiding in verantwoordelijkheden is als volgt:

**Memory Provider = wat Gaia automatisch moet weten en onthouden**
- voor antwoord → relevante context ophalen
- na antwoord → beurt verwerken
- einde sessie → geheugen consolideren
- periodiek → reflecteren

**MCP = wat Gaia doelgericht in Chronicle kan doen**
- zoek documenten
- inspecteer volledige tijdlijn
- open project
- maak rapport
- vergelijk hypotheses
- beheer geheugen
- toon provenance
- wijzig entiteiten

Beide systemen bestaan naast elkaar met verschillende verantwoordelijkheden.

## Geheugenbeleid: Voorkomen van dubbel geheugen
Omdat Hermes' ingebouwde geheugen altijd actief blijft, moet worden voorkomen dat informatie ongecontroleerd in `USER.md`, `state.db`, en Chronicle tegelijk terechtkomt.

- `state.db` bewaart het ruwe gesprek.
- `Chronicle` bewaart de gestructureerde betekenis.
- `USER.md` bevat alleen de minimale, altijd benodigde kern.

| Informatie | USER/MEMORY | state.db | Chronicle |
| :--- | :--- | :--- | :--- |
| Ruwe chatberichten | nee | ja | eventueel bronverwijzing |
| Stabiele kernvoorkeur | compact | ja | ja |
| Gebeurtenis | nee | ja | ja |
| Relatie tussen personen | nee | impliciet | ja |
| Hypothese | nee | ja | ja |
| Skill | nee | eventueel gesprek | nee, blijft bij Gaia |
| Skillmetadata | nee | eventueel | optioneel register |

## Definitief Ontwerpbesluit
De resulterende opzet is schoon en maakt gebruik van de uitbreidingspunten die Hermes al biedt, in plaats van Hermes-memory te vervangen:

```text
Gaia
├── Hermes identity
├── Hermes skills
├── Hermes session archive
├── minimal prompt memory
├── Chronicle Memory Provider
└── Chronicle MCP client
```

- **Gaia**: Blijft een normale Hermes-agent en behoudt Hermes' ingebouwde skillsysteem, sessiearchief en beperkte prompt memory.
- **Chronicle**: Wordt een native Hermes memory provider.
- **MCP**: Blijft beschikbaar voor expliciete Chronicle-handelingen, maar is niet de automatische geheugenlaag.
- **Skills**: Blijven uitsluitend bij Gaia/Hermes.
