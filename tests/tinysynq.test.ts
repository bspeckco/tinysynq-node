import { afterAll, describe, expect, test } from "vitest";
import { TinySynq } from "../src/lib/tinysynq.class.js";
import { Change, TINYSYNQ_SAFE_ISO8601_REGEX, TinySynqOperation } from "@bspeckco/tinysynq-lib";
import { getConfiguredDb, getRandomdbPath, removeDb } from "./utils.js";
import { type RunResult } from "better-sqlite3";

describe('TinySynq', () => {

  describe('Utils', () => {
    let filePath: string = getRandomdbPath();

    afterAll(() => {
      removeDb({filePath});
    });

    test('strftimeAsISO8601 returns a SQLite expression to generate an ISO-8601 string', () => {
      const ts = new TinySynq({
        filePath,
        prefix: '',
        tables: []
      });
      expect(ts.utils.strftimeAsISO8601).toBe(`STRFTIME('%Y-%m-%dT%H:%M:%fZ','NOW')`);
    });

    test('nowAsISO8601 returns a SQLite expression to generate an ISO-8601 string', () => {
      const ts = new TinySynq({
        filePath,
        prefix: '',
        tables: []
      });
      expect(ts.utils.nowAsISO8601).toBe(`STRFTIME('%Y-%m-%dT%H:%M:%fZ','NOW')`);
    });

    test('utcNowAsISO8601 returns a standard ISO-8601 an ISO-8601 date string', () => {
      const ts = new TinySynq({
        filePath,
        prefix: '',
        tables: []
      });
      expect(ts.utils.utcNowAsISO8601()).toMatch(TINYSYNQ_SAFE_ISO8601_REGEX);
    });
  });

  describe('SQL', () => {
    test('should create INSERT SQL', () => {
      let filePath: string = getRandomdbPath();

      const ts = getConfiguredDb({useDefault: true, config: {
        filePath,
      }});
      const data = {item_id: 'item001A', item_name: 'test001'};
      const { sql } = ts.createInsertFromObject({data, table_name: 'items'});
      const expected = 
      `INSERT INTO items (item_id,item_name)
      VALUES (?,?)
      ON CONFLICT DO UPDATE SET item_id = ?, item_name = ?
      RETURNING *`.replace(/\s+/g, ' ');
      removeDb({filePath});
      expect(sql.trim().replace(/\s+/g, ' ')).toEqual(expected);
    });

    test('should create UPDATE SQL', () => {
      let filePath: string = getRandomdbPath();

      const ts = getConfiguredDb({useDefault: true, config: {
        filePath,
      }});
      const data = {item_id: 'item001B', item_name: 'test002'};
      const { sql } = ts.createUpdateFromObject({data, table_name: 'items'});
      const expected = `UPDATE items SET item_name = ? WHERE item_id = ? RETURNING *;`;
      removeDb({filePath});
      expect(sql?.trim().replace(/\s+/g, ' ')).toEqual(expected);
    });
  });

  describe('Database Interaction', () => {
    let filePath: string = getRandomdbPath();

    afterAll(() => {
      removeDb({filePath});
    });

    test('should perform basic CRUD operations', () => {
      const ts = getConfiguredDb({useDefault: true, config: {
        filePath,
      }});
      const initialData = { item_id: 'crud001', name: 'CRUD Initial' };
      const insertCmd = ts.createInsertFromObject({data: initialData, table_name: 'items'});
      const insertResult: RunResult = ts.run(insertCmd);
      
      // Create/Insert
      expect(insertResult.changes).toBe(1);
      const createdItem = ts.getById({table_name: 'items', row_id: initialData.item_id});
      expect(createdItem).toEqual(initialData);
      const meta = ts.getRecordMeta({table_name: 'items', row_id: initialData.item_id});
      expect(meta).toBeDefined();
      expect(meta.row_id).toBe(initialData.item_id);
      expect(meta.table_name).toBe('items');

      // Update
      const updatedData = { ...initialData, name: 'CRUD Updated' };
      const updateCmd = ts.createUpdateFromObject({data: updatedData, table_name: 'items'});
      // Ensure SQL was generated (requires primary key)
      expect(updateCmd.sql, 'Update SQL should be generated').toBeTypeOf('string'); 
      const updateResult: RunResult = ts.run({sql: updateCmd.sql!, values: updateCmd.values}); // Use non-null assertion
      expect(updateResult.changes).toBe(1);
      const updatedItem = ts.getById({table_name: 'items', row_id: initialData.item_id});
      expect(updatedItem).toEqual(updatedData);

      // Delete
      const deleteResult: RunResult = ts.run({sql: 'DELETE FROM items WHERE item_id = ?', values: [initialData.item_id]});
      expect(deleteResult.changes).toBe(1);
      const deletedItem = ts.getById({table_name: 'items', row_id: initialData.item_id});
      expect(deletedItem).toBeUndefined();

      // Verify meta still exists after delete (soft delete via trigger)
      const metaAfterDelete = ts.getRecordMeta({table_name: 'items', row_id: initialData.item_id});
      expect(metaAfterDelete).toBeDefined();
      
      // Check if the delete trigger correctly updated the meta operation
      const deleteChange = ts.getFilteredChanges().find((c: Change) => c.row_id === initialData.item_id && c.operation === TinySynqOperation.DELETE);
      expect(deleteChange).toBeDefined();
    });
  });
});
