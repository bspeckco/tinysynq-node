import { describe, test, expect } from 'vitest';
import { getConfiguredDb, removeDb } from './utils.js';
import { TinySynqOperation } from '../src/lib/types.js';

describe('CRUD', () => {
  describe('applyChangesToLocalDB', () => {
    test('UPDATE is applied correctly', () => {
      const sq = getConfiguredDb({useDefault: true});
      const filePath = sq.dbPath;

      // Simulate UPDATE
      const changes = [
        { 
          id: 1,
          table_name: 'items',
          row_id: 'fakeId0',
          operation: TinySynqOperation.UPDATE,
          data: JSON.stringify({item_id: 'fakeId0', name: "Updated Item" }),
          modified: sq.utils.utcNowAsISO8601(),
          source: sq.deviceId!,
          vclock: {[sq.deviceId!]: 2}
        },
      ];
      changes[0].modified = new Date().toISOString();
      sq.applyChangesToLocalDB({changes});

      // Verify update was applied
      const item:any = sq.getById({table_name: 'items', row_id: 'fakeId0'});
      removeDb({filePath});
      expect(item.name).toBe('Updated Item');
    });

    test('DELETE is applied correctly', () => {
      const sq = getConfiguredDb({useDefault: true});
      const filePath = sq.dbPath;

      const existing:any = sq.getById({table_name: 'items', row_id: 'fakeId1'});
      expect(existing).toBeTruthy();
 
      const existingMeta = sq.getRecordMeta({table_name: 'items', row_id: existing.item_id});
      const vclock = JSON.parse(existingMeta.vclock);
      vclock[sq.deviceId!] = vclock[sq.deviceId!] + 1;

      // Simulate DELETE
      const changes = [
        { 
          id: 2,
          table_name: 'items',
          row_id: 'fakeId1',
          operation: TinySynqOperation.DELETE,
          data: JSON.stringify({ name: "Updated Item" }),
          modified: sq.utils.utcNowAsISO8601(),
          source: sq.deviceId!,
          vclock: {[sq.deviceId!]: 2},
        },
      ];
      changes[0].modified = new Date().toISOString();
      sq.applyChangesToLocalDB({changes});

      // Verify item deletion was applied
      const deleted:any = sq.db.prepare('SELECT * FROM items WHERE item_id = ?').get('fakeId1');
      removeDb({filePath});
      expect(deleted).toBeFalsy();
    });

    test('INSERT is applied correctly', () => {
      const sq = getConfiguredDb({useDefault: true});
      const filePath = sq.dbPath;
      // Simulate INSERT
      const changes = [
        {
          id: 3,
          table_name: 'items',
          row_id: 'fakeId2',
          operation: TinySynqOperation.INSERT,
          data: JSON.stringify({ item_id: 'fakeId2', name: "Inserted Item" }),
          modified: sq.utils.utcNowAsISO8601(),
          source: sq.deviceId!,
          vclock: {[sq.deviceId!]: 1}
        },
      ];
      changes[0].modified = new Date().toISOString();
      sq.applyChangesToLocalDB({changes});

      // Verify item insert were applied
      const inserted:any = sq.db.prepare('SELECT * FROM items WHERE item_id = ?').get('fakeId2');

      removeDb({filePath});
      expect(inserted).toBeTruthy();
      expect(inserted.item_id).toBe('fakeId2');
    });
  });
});
