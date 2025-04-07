import { afterAll, describe, expect, test } from "vitest";
import { TinySynq } from "../src/lib/tinysynq.class.js";
import { TINYSYNQ_SAFE_ISO8601_REGEX } from "@bspeckco/tinysynq-lib";
import { getConfiguredDb, removeDb } from "./utils.js";

const filePath = '/tmp/tst000.db';
describe('TinySynq', () => {
  afterAll(() => {
    removeDb({filePath});
  });
  describe('Utils', () => {
    test('strftimeAsISO8601 returns a SQLite expression to generate an ISO-8601 string', () => {
      const ts = new TinySynq({
        filePath,
        prefix: '',
        tables: []
      });
      expect(ts.utils.strftimeAsISO8601).toBe(`STRFTIME('%Y-%m-%d %H:%M:%f','NOW')`);
    });

    test('nowAsISO8601 returns a SQLite expression to generate an ISO-8601 string', () => {
      const ts = new TinySynq({
        filePath,
        prefix: '',
        tables: []
      });
      expect(ts.utils.nowAsISO8601).toBe(`STRFTIME('%Y-%m-%d %H:%M:%f','NOW')`);
    });

    test('utcNowAsISO8601 returns a standard ISO-8601 an ISO-8601 date string', () => {
      const ts = new TinySynq({
        filePath,
        prefix: '',
        tables: []
      });
      expect(ts.utils.utcNowAsISO8601()).toMatch(TINYSYNQ_SAFE_ISO8601_REGEX);
    });

    test('isSafeISO8601 to correctly identify safe and unsafe date string formats', () => {
      const ts = new TinySynq({
        filePath,
        prefix: '',
        tables: []
      });
      const invalid = [
        '0000-00-00T00:00:00.000Z',
        '0000-00-00 00:00:00.000Z',
        '0000-00-00T00:00:00.000',
        '0000/00/00 00:00:00',
        '00-00-0000',
      ];

      for (const d of invalid) {
        expect(ts.utils.isSafeISO8601(d)).toBeFalsy();
      }

      const valid = [
        '0000-00-00 00:00:00.000',
        '0000-00-00 00:00:00.00',
        '0000-00-00 00:00:00.0',
        '0000-00-00 00:00:00'
      ];

      for (const d of valid) {
        expect(ts.utils.isSafeISO8601(d)).toBeTruthy();
      }
    });
  });

  describe('SQL', () => {
    test('should create INSERT SQL', () => {
      const ts = getConfiguredDb({useDefault: true, config: {
        filePath,
      }});
      const data = {item_id: 'item001', item_name: 'test001'};
      const sql = ts.createInsertFromObject({data, table_name: 'items'}).trim();
      const expected = 
      `INSERT INTO items (item_id,item_name)
      VALUES (:item_id,:item_name)
      ON CONFLICT DO UPDATE SET item_id = :item_id,item_name = :item_name
      RETURNING *`.replace(/\s+/g, ' ');
      expect(sql.replace(/\s+/g, ' ')).toEqual(expected);
    });

    test('should create UPDATE SQL', () => {
      const ts = getConfiguredDb({useDefault: true, config: {
        filePath,
      }});
      const data = {item_name: 'test001'};
      const sql = ts.createUpdateFromObject({data, table_name: 'items'}).trim();
      const expected = `UPDATE items SET item_name = :item_name WHERE item_id = :item_id RETURNING *;`;
      expect(sql.replace(/\s+/g, ' ')).toEqual(expected);
    });
  });
});
