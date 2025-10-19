import { describe, test, expect, beforeEach } from 'vitest';
import { TinySynq } from '../src/lib/tinysynq.class.js';
import DB from 'better-sqlite3';
import { LogLevel } from '@bspeckco/tinysynq-lib';
import fs from 'fs';

const testDbPath = '/tmp/adapter_test.db';

describe('Hybrid Adapter for better-sqlite3', () => {
  beforeEach(() => {
    // Clean up test database
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
  });

  describe('Adapter Creation', () => {
    test('should create adapter from filePath', () => {
      const ts = new TinySynq({
        filePath: testDbPath,
        prefix: 'test',
        tables: [],
        logOptions: { minLevel: LogLevel.Error },
      });

      expect(ts).toBeDefined();
      expect(ts.db).toBeDefined();
    });

    test('should create adapter from sqlite3 instance', () => {
      const db = new DB(testDbPath);
      const ts = new TinySynq({
        sqlite3: db,
        prefix: 'test',
        tables: [],
        logOptions: { minLevel: LogLevel.Error },
      });

      expect(ts).toBeDefined();
      expect(ts.db).toBe(db);
    });

    test('should enable WAL mode by default', () => {
      const ts = new TinySynq({
        filePath: testDbPath,
        prefix: 'test',
        tables: [],
        logOptions: { minLevel: LogLevel.Error },
      });

      const result = ts.runQuery<Array<{ journal_mode: string }>>({
        sql: 'PRAGMA journal_mode',
      });

      expect(result[0].journal_mode).toBe('wal');
    });

    test('should skip WAL mode when wal=false', () => {
      const ts = new TinySynq({
        filePath: testDbPath,
        prefix: 'test',
        tables: [],
        wal: false,
        logOptions: { minLevel: LogLevel.Error },
      });

      const result = ts.runQuery<Array<{ journal_mode: string }>>({
        sql: 'PRAGMA journal_mode',
      });

      expect(result[0].journal_mode).not.toBe('wal');
    });
  });

  describe('Parameter Binding', () => {
    test('should handle positional parameters (arrays)', () => {
      const ts = new TinySynq({
        filePath: testDbPath,
        prefix: 'test',
        tables: [],
        logOptions: { minLevel: LogLevel.Error },
      });

      ts.run({ sql: 'CREATE TABLE test (id TEXT, name TEXT)' });
      ts.run({
        sql: 'INSERT INTO test VALUES (?, ?)',
        values: ['1', 'Alice'],
      });

      const result = ts.runQuery<Array<{ id: string; name: string }>>({
        sql: 'SELECT * FROM test WHERE id = ?',
        values: ['1'],
      });

      expect(result[0]).toEqual({ id: '1', name: 'Alice' });
    });

    test('should handle named parameters (objects without prefix)', () => {
      const ts = new TinySynq({
        filePath: testDbPath,
        prefix: 'test',
        tables: [],
        logOptions: { minLevel: LogLevel.Error },
      });

      ts.run({ sql: 'CREATE TABLE test (id TEXT, name TEXT)' });
      ts.run({
        sql: 'INSERT INTO test VALUES (:id, :name)',
        values: { id: '2', name: 'Bob' },
      });

      const result = ts.runQuery<Array<{ id: string; name: string }>>({
        sql: 'SELECT * FROM test WHERE id = :id',
        values: { id: '2' },
      });

      expect(result[0]).toEqual({ id: '2', name: 'Bob' });
    });

    test('should handle runMany with named parameters', () => {
      const ts = new TinySynq({
        filePath: testDbPath,
        prefix: 'test',
        tables: [],
        logOptions: { minLevel: LogLevel.Error },
      });

      ts.run({ sql: 'CREATE TABLE test (id TEXT, name TEXT, status TEXT)' });
      ts.runMany({
        sql: 'INSERT INTO test VALUES (:id, :name, :status)',
        values: [
          { id: '1', name: 'Alice', status: 'active' },
          { id: '2', name: 'Bob', status: 'inactive' },
          { id: '3', name: 'Charlie', status: 'active' },
        ],
      });

      const result = ts.runQuery<Array<{ id: string; name: string; status: string }>>({
        sql: 'SELECT * FROM test ORDER BY id',
      });

      expect(result).toHaveLength(3);
      expect(result[0]).toEqual({ id: '1', name: 'Alice', status: 'active' });
      expect(result[2]).toEqual({ id: '3', name: 'Charlie', status: 'active' });
    });

    test('should handle null and undefined values', () => {
      const ts = new TinySynq({
        filePath: testDbPath,
        prefix: 'test',
        tables: [],
        logOptions: { minLevel: LogLevel.Error },
      });

      ts.run({ sql: 'CREATE TABLE test (id TEXT, name TEXT, email TEXT)' });
      ts.run({
        sql: 'INSERT INTO test VALUES (:id, :name, :email)',
        values: { id: '1', name: null, email: undefined },
      });

      const result = ts.runQuery<Array<{ id: string; name: string | null; email: string | null }>>({
        sql: 'SELECT * FROM test WHERE id = ?',
        values: ['1'],
      });

      expect(result[0].id).toBe('1');
      expect(result[0].name).toBe(null);
      expect(result[0].email).toBe(null);
    });
  });

  describe('Transactions', () => {
    test('should commit transaction successfully', () => {
      const ts = new TinySynq({
        filePath: testDbPath,
        prefix: 'test',
        tables: [],
        logOptions: { minLevel: LogLevel.Error },
      });

      ts.run({ sql: 'CREATE TABLE test (id TEXT, value TEXT)' });

      const txId = (ts as any).beginTransaction();
      expect(txId).toMatch(/^SP\d+/);

      ts.run({
        sql: 'INSERT INTO test VALUES (?, ?)',
        values: ['1', 'committed'],
      });

      (ts as any).commitTransaction({ savepoint: txId });

      const result = ts.runQuery<Array<{ id: string; value: string }>>({
        sql: 'SELECT * FROM test',
      });

      expect(result).toHaveLength(1);
      expect(result[0].value).toBe('committed');
    });

    test('should rollback transaction successfully', () => {
      const ts = new TinySynq({
        filePath: testDbPath,
        prefix: 'test',
        tables: [],
        logOptions: { minLevel: LogLevel.Error },
      });

      ts.run({ sql: 'CREATE TABLE test (id TEXT, value TEXT)' });

      const txId = (ts as any).beginTransaction();
      ts.run({
        sql: 'INSERT INTO test VALUES (?, ?)',
        values: ['1', 'rolled back'],
      });

      (ts as any).rollbackTransaction({ savepoint: txId });

      const result = ts.runQuery<Array<{ id: string; value: string }>>({
        sql: 'SELECT * FROM test',
      });

      expect(result).toHaveLength(0);
    });

    test('should handle nested transactions (savepoints)', () => {
      const ts = new TinySynq({
        filePath: testDbPath,
        prefix: 'test',
        tables: [],
        logOptions: { minLevel: LogLevel.Error },
      });

      ts.run({ sql: 'CREATE TABLE test (id TEXT, value TEXT)' });

      const tx1 = (ts as any).beginTransaction();
      ts.run({ sql: 'INSERT INTO test VALUES (?, ?)', values: ['1', 'outer'] });

      const tx2 = (ts as any).beginTransaction();
      ts.run({ sql: 'INSERT INTO test VALUES (?, ?)', values: ['2', 'inner'] });
      (ts as any).rollbackTransaction({ savepoint: tx2 });

      (ts as any).commitTransaction({ savepoint: tx1 });

      const result = ts.runQuery<Array<{ id: string }>>({
        sql: 'SELECT id FROM test ORDER BY id',
      });

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('1');
    });
  });

  describe('Error Handling', () => {
    test('should throw error for invalid SQL', () => {
      const ts = new TinySynq({
        filePath: testDbPath,
        prefix: 'test',
        tables: [],
        logOptions: { minLevel: LogLevel.Error },
      });

      expect(() => {
        ts.run({ sql: 'INVALID SQL STATEMENT' });
      }).toThrow();
    });

    test('should throw error for constraint violations', () => {
      const ts = new TinySynq({
        filePath: testDbPath,
        prefix: 'test',
        tables: [],
        logOptions: { minLevel: LogLevel.Error },
      });

      ts.run({ sql: 'CREATE TABLE test (id TEXT PRIMARY KEY)' });
      ts.run({ sql: 'INSERT INTO test VALUES (?)', values: ['1'] });

      expect(() => {
        ts.run({ sql: 'INSERT INTO test VALUES (?)', values: ['1'] });
      }).toThrow(/UNIQUE constraint failed/);
    });
  });
});
