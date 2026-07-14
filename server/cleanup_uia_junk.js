// Verwijdert alleen de drie geïdentificeerde UIA-capture rommelobjecten
// ("Arrow keys move the tile..." herhaald, tot 2MB per chunk) uit de
// Postgres-zoekindex (object_chunk + object_embedding).
//
// Dit haalt ze NIET uit IndexedDB (de echte archiefbron) — verwijder ze
// daar ook zelf even in de Chronicle-app zelf als je ze helemaal kwijt wilt,
// anders blijven ze gewoon in je lijst staan, alleen niet meer doorzoekbaar.
//
// Run vanuit server/: node cleanup_uia_junk.js
require("dotenv").config();
const { pool } = require("./db");

const JUNK_OBJECT_IDS = ["obj_mrgnjz2j_gosb1v", "obj_mrgzvhxw_7vuwq2", "obj_mrgyqutw_tz25ll"];

(async () => {
  for (const objectId of JUNK_OBJECT_IDS) {
    const r1 = await pool.query("DELETE FROM object_chunk WHERE object_id = $1", [objectId]);
    const r2 = await pool.query("DELETE FROM object_embedding WHERE object_id = $1", [objectId]);
    console.log(`${objectId}: ${r1.rowCount} chunk(s) + ${r2.rowCount} embedding(s) verwijderd`);
  }
  process.exit(0);
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
