import { describe, test, expect } from 'vitest';
import { getConfiguredDb, removeDb, wait } from './utils.js';
import { TinySynqOperation } from '@bspeckco/tinysynq-lib';
import { testCreateTableEntry, testCreateTableJournal } from './test-data/journal.data.js';

describe('CRUD', () => {
  describe('applyChangesToLocalDB', () => {
    test('UPDATE is applied correctly', async () => {
      const sq = getConfiguredDb({useDefault: true});
      const filePath = sq.dbPath;

      // Simulate UPDATE
      await wait({ms: 50});
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
      changes[0].modified = sq.utils.utcNowAsISO8601();
      sq.applyChangesToLocalDB({changes});

      // Verify update was applied
      const item:any = sq.getById({table_name: 'items', row_id: 'fakeId0'});
      removeDb({filePath});
      expect(item.name).toBe('Updated Item');
    });

    test('DELETE is applied correctly', async () => {
      const sq = getConfiguredDb({useDefault: true});
      const filePath = sq.dbPath;

      const existing:any = sq.getById({table_name: 'items', row_id: 'fakeId1'});
      expect(existing).toBeTruthy();
 
      const existingMeta = sq.getRecordMeta({table_name: 'items', row_id: existing.item_id});
      const vclock = JSON.parse(existingMeta.vclock);
      vclock[sq.deviceId!] = vclock[sq.deviceId!] + 1;

      // Simulate DELETE
      await wait({ms: 50});
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
      changes[0].modified = sq.utils.utcNowAsISO8601();
      sq.applyChangesToLocalDB({changes});

      // Verify item deletion was applied
      const deleted:any = sq.db.prepare('SELECT * FROM items WHERE item_id = ?').get('fakeId1');
      removeDb({filePath});
      expect(deleted).toBeFalsy();
    });

    test('INSERT is applied correctly', async () => {
      const sq = getConfiguredDb({useDefault: true});
      const filePath = sq.dbPath;
      
      // Simulate INSERT
      await wait({ms: 50});
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
      sq.applyChangesToLocalDB({changes});

      // Verify item insert were applied
      const inserted:any = sq.db.prepare('SELECT * FROM items WHERE item_id = ?').get('fakeId2');

      removeDb({filePath});
      expect(inserted).toBeTruthy();
      expect(inserted.item_id).toBe('fakeId2');
    });

    test('INSERT SAMPLE is applied correctly', async () => {
      const sq = getConfiguredDb({
        useDefault: false,
        config: {
          preInit: [testCreateTableJournal, testCreateTableEntry],
          tables: [
            {name: 'journal', id: 'journal_id', editable: ['journal_name']},
            {name: 'entry', id: 'entry_id', editable: ['entry_text', 'entry_title', 'entry_content', 'entry_date']} 
          ],
          logOptions: {
            minLevel: 2
          }
        }
      });
      const filePath = sq.dbPath;
      // Simulate INSERT
      await wait({ms: 50});
      const now = sq.utils.utcNowAsISO8601();
      const changes = [
        {
          id: 1,
          table_name: 'journal',
          row_id: 'L1SE23J9006-L_AP',
          data: `{"journal_id":"L1SE23J9006-L_AP","journal_name":"test","journal_created":"${now}"}`,
          operation: TinySynqOperation.INSERT,
          source: 'db#1@660656',
          vclock: {"db#1@660656":1},
          modified: now
        },
      ];
      sq.applyChangesToLocalDB({changes});

      // Verify item insert were applied
      const inserted:any = sq.getById({table_name: 'journal', row_id: 'L1SE23J9006-L_AP'});

      removeDb({filePath});
      expect(inserted).toBeTruthy();
      expect(inserted.journal_id).toBe('L1SE23J9006-L_AP');
    });
  });
});
