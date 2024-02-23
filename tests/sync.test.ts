import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { generateChangesForTable, getConfiguredDb, getNanoId, removeDb, wait } from "./utils.js";
import { SynQLite } from "../src/lib/synqlite.class.js";
import { testCreateTableEntry, testCreateTableJournal, testEntryData, testInsertRowEntry, testInsertRowJournal, testJournalData } from "./test-data/journal.data.js";
import { SYNQLITE_NANOID_SIZE } from "../src/lib/constants.js";
import { nanoid } from "nanoid";
import { LogLevel } from "../src/lib/types.js";

const preInit = [
  testCreateTableJournal,
  testCreateTableEntry
];

const getNew = () => {
  let sq: SynQLite = getConfiguredDb({
    config: {
      preInit,
      tables: [
        { name: 'journal', id: 'journal_id', editable: ['journal_name']},
        { name: 'entry', id: 'entry_id', editable: ['entry_title', 'entry_content', 'entry_date', 'entry_updated']}
      ],
      logOptions: {
        minLevel: LogLevel.Info
      },
      debug: true
    },
    useDefault: false
  });
  const insertJournal = sq.db.prepare(testInsertRowJournal);
  for (const j of testJournalData) insertJournal.run(j);

  const insertEntry = sq.db.prepare(testInsertRowEntry);
  for (const e of testEntryData) insertEntry.run(e);

  return sq;
};

describe.only('sync', () => {
  
  beforeAll(() => {
    
  });

  afterAll(() => {
    //removeDb({ filename: sq.dbName });
  });

  describe('vclock', () => {
    test('should increment by 1', () => {
      const sq = getNew();
      const deviceId = sq.deviceId as string;
      const entry = sq.runQuery({
        sql: 'SELECT * FROM entry LIMIT 1'
      })[0];
      const originalMeta = sq.getRecordMeta({table_name: 'entry', row_id: entry.entry_id});
      expect(originalMeta.vclock).toMatchObject(JSON.stringify({[deviceId]: 1}));

      entry.entry_title = `Updated at ${Date.now()}`;
      const insertSql = sq.createInsertFromObject({data: entry, table: 'entry'});
      sq.runQuery({sql: insertSql, values: entry});
      const meta = sq.getRecordMeta({table_name: 'entry', row_id: entry.entry_id});

      expect(meta.vclock).toMatchObject(JSON.stringify({[deviceId]: 2}));
      removeDb({ filename: sq.dbName });
    });

    test('should add another participant', async () => {
      const sq = getNew();
      const localId = sq.deviceId as string;
      const remoteId = getNanoId();
      const changes = generateChangesForTable({
        sq,
        table: 'entry',
        origin: remoteId,
        operation: 'UPDATE',
      });

      const entry = sq.getById({table_name: 'entry', row_id: changes[0].row_id});
      const originalMeta = sq.getRecordMeta({table_name: 'entry', row_id: entry.entry_id});
      expect(originalMeta.vclock).toMatchObject(JSON.stringify({[localId]: 1}));
      
      sq.applyChangesToLocalDB({ changes });
      
      // Change might not be immediately visible, wait a moment.
      await wait({ms: 100});
      const meta = sq.getRecordMeta({table_name: 'entry', row_id: entry.entry_id});

      removeDb({ filename: sq.dbName });
      expect(meta.vclock).toMatchObject(JSON.stringify({[localId]: 1, [remoteId]: 1}));
    }); 

    test('should increment a local ID in vclock', () => {
      const sq = getNew();
      console.log('@DB_FILE:', sq.dbName);
      const localId = sq.deviceId as string;
      const remoteId = getNanoId();
      const changes = generateChangesForTable({
        sq,
        table: 'entry',
        origin: remoteId,
        operation: 'UPDATE',
      });
      console.log({changes});
      sq.applyChangesToLocalDB({ changes });

      const entry = sq.getById<any>({table_name: 'entry', row_id: changes[0].row_id});
      entry.entry_title = `Updated to ${performance.now()}`;
      const sql = sq.createInsertFromObject({
        data: entry,
        table: 'entry'
      });
      const updatedEntry = sq.runQuery({sql, values: entry});
      const meta = sq.getRecordMeta({table_name: 'entry', row_id: entry.entry_id});
      console.log({updatedEntry, meta});

      removeDb({ filename: sq.dbName });
      expect(JSON.parse(meta.vclock)).toMatchObject({[localId]: 2});
    });

    test('should increment a local ID in vclock with another participant', async () => {
      const sq = getNew();
      console.log('@DB_FILE:', sq.dbName);
      const localId = sq.deviceId as string;
      const remoteId = getNanoId();
      const changes = generateChangesForTable({
        sq,
        table: 'entry',
        origin: remoteId,
        operation: 'UPDATE',
      });

      sq.applyChangesToLocalDB({ changes });
      
      await wait({ms: 100});

      const entry = sq.getById<any>({table_name: 'entry', row_id: changes[0].row_id});
      entry.entry_title = `Updated to ${performance.now()}`;
      const sql = sq.createInsertFromObject({
        data: entry,
        table: 'entry'
      });
      sq.runQuery({sql, values: entry});
      const meta = sq.getRecordMeta({table_name: 'entry', row_id: entry.entry_id});

      removeDb({ filename: sq.dbName });
      expect(JSON.parse(meta.vclock)).toMatchObject({[remoteId]: 1, [localId]: 2});
    });
  });

  describe.skip('ordered changes', () => {
    // @TODO: revisit
    test('it should resolve changes presented in chronological order', () => {
      const sq = getNew();
      const deviceId = nanoid(SYNQLITE_NANOID_SIZE);
      const changes = generateChangesForTable({
        sq, 
        table: 'entry',
        origin: deviceId
      });
      console.log({changes})
      sq.applyChangesToLocalDB({ changes });
      const latest = sq.getChangesSinceLastSync();
      console.log({latest})
      removeDb({ filename: sq.dbName });
    });
  });
});