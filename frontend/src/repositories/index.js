import { IndexedDBObjectRepository } from "./ObjectRepository";

/**
 * Single app-wide repository instance. To migrate to PostgreSQL later,
 * implement a new class against the ObjectRepository contract and swap the
 * line below — no UI change required.
 */
export const objectRepository = new IndexedDBObjectRepository();
