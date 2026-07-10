// Leegt de PureMemory-events-tabel volledig en VACUUMt het bestand, zodat
// verwijderde inhoud (zoals het per ongeluk vastgelegde wachtwoord) ook echt
// van schijf verdwijnt, niet alleen logisch gemarkeerd wordt als verwijderd.
const Database = require('better-sqlite3');
const db = new Database('C:\\Users\\bojan\\Projects\\PureMemory\\collector-agent\\user-memory.db');
const before = db.prepare('SELECT COUNT(*) as n FROM events').get().n;
db.prepare('DELETE FROM events').run();
db.prepare('VACUUM').run();
console.log(`${before} events verwijderd, bestand gecomprimeerd.`);
db.close();
