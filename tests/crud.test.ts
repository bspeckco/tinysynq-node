import { describe, test, expect } from 'vitest';
import { getConfiguredDb, removeDb } from './utils.js';

describe('CRUD', () => {
  describe('applyChangesToLocalDB', () => {
    test('UPDATE is applied correctly', () => {
      const db = getConfiguredDb();
      const filename = db.dbName;

      // Simulate changes
      const changes = [
        { id: 1, table_name: 'items', row_id: 'fakeId0', operation: 'UPDATE', data: JSON.stringify({item_id: 'fakeId0', name: "Updated Item" }), modified_at: db.utils.utcNowAsISO8601() },
      ];
      db.applyChangesToLocalDB({changes});

      // Verify changes were applied
      const item:any = db.runQuery<any[]>({sql: 'SELECT * FROM items WHERE item_id = ?', values: ['fakeId0']})[0];
      //console.log(item);
      removeDb({filename});
      expect(item.name).toBe('Updated Item');
    });

    test('DELETE is applied correctly', () => {
      const db = getConfiguredDb();
      const filename = db.dbName;

      const existing:any = db.db.prepare('SELECT * FROM items WHERE item_id = ?').get('fakeId1');
      console.log({existing});
      expect(existing).toBeTruthy();

      // Simulate UPDATE
      const changes = [
        { id: 2, table_name: 'items', row_id: 'fakeId1', operation: 'DELETE', data: JSON.stringify({ name: "Updated Item" }), modified_at: db.utils.utcNowAsISO8601() },
        // Add more changes as needed for testing
      ];

      db.applyChangesToLocalDB({changes});

      // Verify item was deleted were applied
      const deleted:any = db.db.prepare('SELECT * FROM items WHERE item_id = ?').get('fakeId1');
      removeDb({filename});
      expect(deleted).toBeFalsy();
    });

    test('INSERT is applied correctly', () => {
      const db = getConfiguredDb();
      const filename = db.dbName;
      // Simulate INSERT
      const changes = [
        { id: 3, table_name: 'items', row_id: 'fakeId2', operation: 'INSERT', data: JSON.stringify({ item_id: 'fakeId2', name: "Inserted Item" }), modified_at: db.utils.utcNowAsISO8601() },
        // Add more changes as needed for testing
      ];

      db.applyChangesToLocalDB({changes});

      // Verify item was deleted were applied
      const inserted:any = db.db.prepare('SELECT * FROM items WHERE item_id = ?').get('fakeId2');

      removeDb({filename});
      expect(inserted).toBeTruthy();
      expect(inserted.item_id).toBe('fakeId2');
    });
  });
});
