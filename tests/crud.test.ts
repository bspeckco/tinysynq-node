import { describe, test, expect } from 'vitest';
import { getConfiguredDb, removeDb } from './utils.js';

describe.only('CRUD', () => {
  describe.only('applyChangesToLocalDB', () => {
    test('UPDATE is applied correctly', () => {
      const sq = getConfiguredDb({useDefault: true});
      const filename = sq.dbName;

      // Simulate changes
      const changes = [
        { 
          id: 1,
          table_name: 'items',
          row_id: 'fakeId0',
          operation: 'UPDATE',
          data: JSON.stringify({item_id: 'fakeId0', name: "Updated Item" }),
          modified_at: sq.utils.utcNowAsISO8601(),
          vclock: {[sq.deviceId!]: 2}
        },
      ];
      sq.applyChangesToLocalDB({changes});

      // Verify changes were applied
      const item:any = sq.runQuery<any[]>({sql: 'SELECT * FROM items WHERE item_id = ?', values: ['fakeId0']})[0];
      //console.log(item);
      removeDb({filename});
      expect(item.name).toBe('Updated Item');
    });

    test.only('DELETE is applied correctly', () => {
      const sq = getConfiguredDb({useDefault: true});
      const filename = sq.dbName;

      const existing:any = sq.db.prepare('SELECT * FROM items WHERE item_id = ?').get('fakeId1');
      expect(existing).toBeTruthy();

      const existingMeta = sq.getRecordMeta({table_name: 'items', row_id: existing.item_id});
      const vclock = JSON.parse(existingMeta.vclock);
      vclock[sq.deviceId!] = vclock[sq.deviceId!] + 1;

      // Simulate UPDATE
      const changes = [
        { 
          id: 2,
          table_name: 'items',
          row_id: 'fakeId1',
          operation: 'DELETE',
          data: JSON.stringify({ name: "Updated Item" }),
          modified_at: sq.utils.utcNowAsISO8601(),
          vclock,
        },
      ];

      sq.applyChangesToLocalDB({changes});

      // Verify item was deleted were applied
      const deleted:any = sq.db.prepare('SELECT * FROM items WHERE item_id = ?').get('fakeId1');
      removeDb({filename});
      expect(deleted).toBeFalsy();
    });

    test('INSERT is applied correctly', () => {
      const sq = getConfiguredDb({useDefault: true});
      const filename = sq.dbName;
      // Simulate INSERT
      const changes = [
        {
          id: 3,
          table_name: 'items',
          row_id: 'fakeId2',
          operation: 'INSERT',
          data: JSON.stringify({ item_id: 'fakeId2', name: "Inserted Item" }),
          modified_at: sq.utils.utcNowAsISO8601(),
          vclock: {[sq.deviceId!]: 1}
        },
      ];

      sq.applyChangesToLocalDB({changes});

      // Verify item was deleted were applied
      const inserted:any = sq.db.prepare('SELECT * FROM items WHERE item_id = ?').get('fakeId2');

      removeDb({filename});
      expect(inserted).toBeTruthy();
      expect(inserted.item_id).toBe('fakeId2');
    });
  });
});
