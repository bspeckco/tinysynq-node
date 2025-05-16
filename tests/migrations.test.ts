import { describe, test, expect, afterAll, beforeAll } from 'vitest';
import { applyMigrationsSync, MIGRATIONS } from '@bspeckco/tinysynq-lib';
import { getConfiguredDb, getRandomdbPath, removeDb } from './utils.js';
import { TinySynq } from '../src/lib/tinysynq.class.js';

describe('Migrations', () => {
  let dbPath: string;
  let ts: TinySynq;
  
  beforeAll(() => {
    dbPath = getRandomdbPath();
    ts = getConfiguredDb({useDefault: true, config: {filePath: dbPath}});
    console.log(ts);
  });
  test('should apply migrations', () => {
    const migrations = MIGRATIONS;
    expect(migrations).toBeDefined();
    expect(migrations.length).toBeGreaterThan(0);
  });

  test('should apply migrations to the database', () => {
    const migrations = MIGRATIONS;
    expect(migrations.length).toBeGreaterThan(0);
    expect(() => applyMigrationsSync({ db: ts, logger: console }, migrations)).not.toThrow();
  });

  afterAll(() => {
    removeDb({filePath: dbPath});
  });
});