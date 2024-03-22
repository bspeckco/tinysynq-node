import { describe, expect, test } from "vitest";
import { TinySynq } from "../src/lib/tinysynq.class.js";
import { TINYSYNQ_SAFE_ISO8601_REGEX } from "../src/lib/constants.js";

const filePath = '/tmp/tst000.db';
describe('TinySynq', () => {
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
});