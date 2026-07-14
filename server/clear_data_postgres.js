// Verwijdert alle gecaptureerde/afgeleide data uit Postgres, behoudt
// persona_instelling (dat is configuratie: drempels/dispositie, geen data).
const { Pool } = require('pg');
require('dotenv').config({ path: 'C:\\Users\\bojan\\Projects\\Foundation-Chronicle\\server\\.env' });
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

(async () => {
  await pool.query(`
    TRUNCATE
      object_chunk,
      object_embedding,
      persona_kenmerk_gebruik,
      persona_kenmerk,
      persona_pulse_cache
    CASCADE
  `);
  console.log('Postgres-data verwijderd. persona_instelling (configuratie) blijft ongemoeid.');
  await pool.end();
})();
