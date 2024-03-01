import { describe, test, expect } from 'vitest';
import { getConfiguredDb, removeDb } from './utils.js';

describe('Sync Module', () => {

  test('setupDatabase creates necessary tables and triggers', () => {
    const db = getConfiguredDb({useDefault: true});
    const tables = db.runQuery({
      sql:`SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '${db.synqPrefix}_%'`
    });
    const expectedTables = ['changes', 'meta', 'record_meta'];
    expectedTables.forEach(expectedTable => {
      expect(tables.some((table: any) => table.name === `${db.synqPrefix}_${expectedTable}`)).toBe(true);
    });

    // Check for the existence of triggers
    const triggers = db.runQuery({
      sql: `SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE '${db.synqPrefix}_%'`
    });
    expect(triggers.length).toBeGreaterThan(0);
    
    const deviceId = db.getDeviceId();
    removeDb({filename: db.dbName});
    expect(deviceId).toBeTruthy();
  });

  test('getRecordMeta retrieves meta data for table row change', () => {
    const db = getConfiguredDb({useDefault: true});
    const filename = db.dbName;
    const updates = [
      { id: 1, table_name: 'items', row_id: 'fakeId0', operation: 'UPDATE', data: JSON.stringify({item_id: 'fakeId0', name: "Changed Item" }), modified: db.utils.utcNowAsISO8601(), vclock: {fakeId1: 1} },
    ];
    db.applyChangesToLocalDB({changes: updates});
    const res =  db.getRecordMeta({table_name: 'items', row_id: 'fakeId0'});

    removeDb({filename});
    expect(res).toBeTruthy();
  });

  test('getChangesSinceLastSync retrieves all changes', () => {
    const db = getConfiguredDb({useDefault: true});
    const changes:any[] = db.getChangesSinceLastSync();
    expect(changes.length).toBe(2);
    expect(changes[0].row_id).toBe('fakeId0');
    removeDb({ filename: db.dbName });
  });
});