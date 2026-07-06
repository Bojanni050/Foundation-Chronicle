import { openDB } from "idb";

const DB_NAME = "chronicle";
const DB_VERSION = 1;
export const OBJECT_STORE = "objects";

let dbPromise = null;

export function getDB() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(OBJECT_STORE)) {
          const store = db.createObjectStore(OBJECT_STORE, { keyPath: "id" });
          store.createIndex("type", "type");
          store.createIndex("updatedAt", "updatedAt");
        }
      },
    });
  }
  return dbPromise;
}
