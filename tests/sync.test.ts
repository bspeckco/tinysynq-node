import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { alterRecordMeta, generateChangesForTable, getConfiguredDb, getNanoId, getRandomDateTime, getRecordOrRandom, removeDb, wait } from "./utils.js";
import { SynQLite } from "../src/lib/synqlite.class.js";
import { testCreateTableEntry, testCreateTableJournal, testEntryData, testInsertRowEntry, testInsertRowJournal, testJournalData } from "./test-data/journal.data.js";
import { SYNQLITE_NANOID_SIZE, SYNQ_INSERT, SYNQ_UPDATE } from "../src/lib/constants.js";
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

describe('sync', () => {

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
      const insertSql = sq.createInsertFromObject({data: entry, table_name: 'entry'});
      sq.runQuery({sql: insertSql, values: entry});
      const meta = sq.getRecordMeta({table_name: 'entry', row_id: entry.entry_id});

      removeDb({ filename: sq.dbName });
      expect(meta.vclock).toMatchObject(JSON.stringify({[deviceId]: 2}));
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
     
      console.log({changes})
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
        table_name: 'entry'
      });
      const updatedEntry = sq.runQuery({sql, values: entry});
      const meta = sq.getRecordMeta({table_name: 'entry', row_id: entry.entry_id});

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
        table_name: 'entry'
      });
      sq.runQuery({sql, values: entry});
      const meta = sq.getRecordMeta({table_name: 'entry', row_id: entry.entry_id});

      removeDb({ filename: sq.dbName });
      expect(JSON.parse(meta.vclock)).toMatchObject({[remoteId]: 1, [localId]: 2});
    });
  });

  describe('changes', () => {
    test('should move to pendingld when received out of order', () => {
      const sq = getNew();
      const deviceId = nanoid(SYNQLITE_NANOID_SIZE);
      const constraints = new Map(Object.entries({
        'entry_journal_id':'journal',
      }));
      const randomJournal = getRecordOrRandom({
        sq, table_name: 'journal'
      }).data;
      const randomEntry = getRecordOrRandom({
        sq, table_name: 'entry'
      }).data;
      const fixed = {'entry_journal_id': randomJournal?.journal_id }
      const changes = generateChangesForTable({
        sq, 
        table: 'entry',
        origin: deviceId,
        total: 2,
        constraints,
        fixed,
        operations: [SYNQ_UPDATE],
        target: randomEntry.entry_id,
      });

      if (changes[0].operation === 'INSERT') {
        changes.reverse();
      }
      changes[0].vclock[deviceId] = 2;
      sq.applyChangesToLocalDB({ changes });
      const pending = sq.getPending();
      expect(pending.length).toBe(1);
      expect(pending[0].row_id).toBe(randomEntry.entry_id);
    });

    test('should be put on hold when attempting to update non-existent record', () => {
      const sq = getNew();
      const deviceId = nanoid(SYNQLITE_NANOID_SIZE);
      const constraints = new Map(Object.entries({
        'entry_journal_id':'journal'
      }));
      const randomRecord = getRecordOrRandom({
        sq, table_name: 'journal'
      });
      const target = nanoid(SYNQLITE_NANOID_SIZE);
      const fixed = {'entry_journal_id': randomRecord?.data.journal_id }
      const changes = generateChangesForTable({
        sq, 
        table: 'entry',
        origin: deviceId,
        total: 1,
        constraints,
        fixed,
        target,
        operations: [SYNQ_UPDATE],
      });

      // Slow way for now, smart way later
      changes[0].row_id = target;
      const modifiedRowData = JSON.parse(changes[0].data);
      modifiedRowData.entry_id = target;
      changes[0].data = JSON.stringify(modifiedRowData);

      sq.applyChangesToLocalDB({ changes });
      const pending = sq.getPending();
      removeDb({ filename: sq.dbName });

      expect(pending.length).toBe(1);
    });

    test('when conflicted should keep REMOTE changes if they are newer', () => {
      const sq = getNew();
      const deviceId = nanoid(SYNQLITE_NANOID_SIZE);
      const constraints = new Map(Object.entries({
        'entry_journal_id':'journal'
      }));
      const randomJournal = getRecordOrRandom({
        sq, table_name: 'journal'
      }).data;
      const randomEntry = getRecordOrRandom({
        sq, table_name: 'entry'
      }).data;
      const metaParams = {
        table_name: 'entry',
        row_id: randomEntry.entry_id
      };
      const currentMeta = sq.getRecordMeta(metaParams);
      const alteredMeta = alterRecordMeta({
        sq,
        ...metaParams,
        updates: {
          modified: getRandomDateTime({asString: false}) as Date,
          vclock: {[sq.deviceId!]: 1}
        }
      });
      console.log({currentMeta, alteredMeta, randomEntry});

      const target = randomEntry.entry_id;
      const fixed = {'entry_journal_id': randomJournal?.journal_id }
      const changes = generateChangesForTable({
        sq, 
        table: 'entry',
        origin: deviceId,
        total: 1,
        constraints,
        fixed,
        target,
        operations: [SYNQ_UPDATE],
      });

      changes[0].vclock[sq.deviceId!] = 0;
      sq.applyChangesToLocalDB({ changes });

      const updatedRecord = sq.getById(metaParams);
      const incoming = JSON.parse(changes[0].data);
      
      removeDb({ filename: sq.dbName });
      expect(updatedRecord.entry_title).toEqual(incoming.entry_title);
      expect(updatedRecord.entry_content).toEqual(incoming.entry_content);
      expect(updatedRecord.entry_updated).toEqual(incoming.entry_updated);
    });

    test('when conflicted should keep LOCAL changes if they are newer', () => {
      const sq = getNew();
      const deviceId = nanoid(SYNQLITE_NANOID_SIZE);
      const constraints = new Map(Object.entries({
        'entry_journal_id':'journal'
      }));
      const randomJournal = getRecordOrRandom({
        sq, table_name: 'journal'
      }).data;
      const randomEntry = getRecordOrRandom({
        sq, table_name: 'entry'
      }).data;
      const metaParams = {
        table_name: 'entry',
        row_id: randomEntry.entry_id
      };
      const entryMeta = sq.getRecordMeta(metaParams);
      const lastSyncBefore = sq.getLastSync();
      const target = randomEntry.entry_id;
      const fixed = {'entry_journal_id': randomJournal?.journal_id }
      const changes = generateChangesForTable({
        sq, 
        table: 'entry',
        origin: deviceId,
        total: 1,
        constraints,
        fixed,
        target,
        operations: [SYNQ_UPDATE],
      });

      changes[0].vclock[sq.deviceId!] = 0;
      changes[0].modified = getRandomDateTime() as string;
      sq.applyChangesToLocalDB({ changes });

      const updatedRecord = sq.getById(metaParams);
      const updatedMeta = sq.getRecordMeta(metaParams);
      const lastSyncAfter = sq.getLastSync();
      
      removeDb({filename: sq.dbName});
      expect(updatedRecord).toMatchObject(randomEntry);
      expect(updatedMeta).toEqual(entryMeta);
      expect(lastSyncBefore).not.toEqual(lastSyncAfter);
    });

/*
    test('when conflicted should apply REMOTE changes if they are newer', () => {
      const sq = getNew();
      const deviceId = nanoid(SYNQLITE_NANOID_SIZE);
      const constraints = new Map(Object.entries({
        'entry_journal_id':'journal'
      }));
      const randomJournal = getRecordOrRandom({
        sq, table_name: 'journal'
      }).data;
      const randomEntry = getRecordOrRandom({
        sq, table_name: 'entry'
      }).data;
      const metaParams = {
        table_name: 'entry',
        row_id: randomEntry.entry_id
      };
      const entryMeta = sq.getRecordMeta(metaParams);
      const lastSyncBefore = sq.getLastSync();
      const target = randomEntry.entry_id;
      const fixed = {'entry_journal_id': randomJournal?.journal_id }
      const changes = generateChangesForTable({
        sq, 
        table: 'entry',
        origin: deviceId,
        total: 1,
        constraints,
        fixed,
        target,
        operations: [SYNQ_UPDATE],
      });

      changes[0].vclock[sq.deviceId!] = 0;
      changes[0].modified = getRandomDateTime() as string;

      sq.applyChangesToLocalDB({ changes });

      const updatedRecord = sq.getById(metaParams);
      const updatedMeta = sq.getRecordMeta(metaParams);
      const lastSyncAfter = sq.getLastSync();
      const incoming = JSON.parse(changes[0].data);
      console.log({entryMeta, updatedMeta});
      
      removeDb({filename: sq.dbName});
      expect(updatedRecord).toMatchObject(randomEntry);
      // expect(updatedMeta).not.toEqual(entryMeta);
      expect(lastSyncBefore).not.toEqual(lastSyncAfter);
    });
    */
  });
});