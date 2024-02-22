import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { generateChangesForTable, getConfiguredDb, removeDb } from "./utils.js";
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
        { name: 'entry', id: 'entry_id', editable: ['entry_title', 'entry_content', 'entry_date']}
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
    test('should increment', () => {
      const sq = getNew();
      const deviceId = sq.deviceId as string;
      const entry = sq.runQuery({
        sql: 'SELECT * FROM entry LIMIT 1'
      })[0];
      const originalMeta = sq.getRecordMeta({table_name: 'entry', row_id: entry.entry_id});
      entry.entry_title = `Updated at ${Date.now()}`;
      const insertSql = sq.createInsertFromObject({data: entry, table: 'entry'});
      const res = sq.runQuery({sql: insertSql, values: entry});
      const changes = sq.getChangesSinceLastSync();
      const meta = sq.getRecordMeta({table_name: 'entry', row_id: entry.entry_id});
      // console.log({res, changes, meta, originalMeta});

      expect(meta.vclock).toMatchObject(JSON.stringify({[deviceId]: 2}));
      removeDb({ filename: sq.dbName });
    });

    test.skip('should resolve changes presented in chronological order', () => {
      const sq = getNew();
      const deviceId = nanoid(SYNQLITE_NANOID_SIZE);
      const localChanges = sq.getChangesSinceLastSync();
      const remoteChanges = generateChangesForTable({
        sq, 
        table: 'entry',
        editableColumns: {
          entry_title: null,
          entry_date: null,
          entry_content: null
        },
        origin: deviceId
      });
      console.log({localChanges, remoteChanges})
      //sq.applyChangesToLocalDB({ changes });
      //const latest = sq.getChangesSinceLastSync();
      //console.log({latest})
      removeDb({ filename: sq.dbName });
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
        editableColumns: {
          entry_title: null,
          entry_date: null,
          entry_content: null
        },
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