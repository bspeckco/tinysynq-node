import { describe, test, expect } from 'vitest';
import { getConfiguredDb, removeDb } from './utils.js';
import { TinySynqOperation } from '../src/lib/types.js';

describe('Core', () => {

  test('setupDatabase creates necessary tables and triggers', () => {
    const db = getConfiguredDb({useDefault: true});
    const tables = db.runQuery({
      sql:`SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '${db.synqPrefix}_%'`
    });
    const expectedTables = ['changes', 'meta', 'record_meta', 'pending', 'dump'];
    expectedTables.forEach(expectedTable => {
      expect(tables.some((table: any) => table.name === `${db.synqPrefix}_${expectedTable}`)).toBe(true);
    });

    // Check for the existence of triggers
    const triggers = db.runQuery({
      sql: `SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE '${db.synqPrefix}_%'`
    });
    expect(triggers.length).toBeGreaterThan(0);
    
    const deviceId = db.getDeviceId();
    removeDb({filePath: db.dbPath});
    expect(deviceId).toBeTruthy();
  });

  test('sets meta data and change for table row update', () => {
    const db = getConfiguredDb({useDefault: true});
    const filePath = db.dbPath;
    const vclock = {[db.deviceId!]: 1};
    const updates = [
      { 
        id: 1,
        table_name: 'items',
        row_id: 'fakeId0',
        operation: TinySynqOperation.UPDATE,
        data: JSON.stringify({item_id: 'fakeId0', name: "Changed Item" }),
        modified: db.utils.utcNowAsISO8601(),
        vclock,
        source: db.deviceId!,
      },
    ];
    db.applyChangesToLocalDB({changes: updates});
    const res =  db.getRecordMeta({table_name: 'items', row_id: 'fakeId0'});
    const changes = db.getFilteredChanges();

    removeDb({filePath});
    expect(res).toBeTruthy();
    expect(changes).toHaveLength(2);
    expect(changes[0].vclock).toMatch(JSON.stringify(vclock));
    expect(changes[0].source).toMatch(db.deviceId!);
    expect(changes[1].vclock).toMatch(JSON.stringify(vclock));
    expect(changes[1].source).toMatch(db.deviceId!);
  });

  test('getChangesSinceLastSync retrieves all changes', () => {
    const db = getConfiguredDb({useDefault: true});
    const changes:any[] = db.getChangesSinceLastSync();    
    removeDb({ filePath: db.dbPath });
    expect(changes.length).toBe(2);
    expect(changes[0].row_id).toBe('fakeId0');
  });
  
  test('getChangesSinceLastSync retrieves all changes', () => {
    const db = getConfiguredDb({useDefault: true});
    const changes:any[] = db.getFilteredChanges();  
    removeDb({ filePath: db.dbPath });
    expect(changes.length).toBe(2);
    expect(changes[0].row_id).toBe('fakeId0');
  });
});