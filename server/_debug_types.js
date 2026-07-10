const Database = require('better-sqlite3');
const db = new Database('C:\\Users\\bojan\\Projects\\PureMemory\\collector-agent\\user-memory.db', { readonly: true });
const byType = db.prepare(`
  SELECT json_extract(payload, '$.type') as type, COUNT(*) as n
  FROM events GROUP BY type ORDER BY n DESC
`).all();
console.log('per type:', JSON.stringify(byType, null, 2));

// Check a sample of each type's context to see focus_session_id spread
const rows = db.prepare("SELECT payload FROM events ORDER BY created_at ASC").all();
const sessions = new Set();
rows.forEach(r => {
  try {
    const ev = JSON.parse(r.payload);
    sessions.add(ev.focus_session_id || '(leeg)');
  } catch {}
});
console.log('aantal unieke focus_session_id:', sessions.size);
console.log([...sessions]);
db.close();
