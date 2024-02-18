import { describe, test, beforeAll, beforeEach, expect, afterAll } from 'vitest';
import setupDatabase from '../src/lib/index.js';
import { LogLevel, type SynQLiteOptions, type SynqlDatabase } from '../src/lib/types.js';
import DB from 'better-sqlite3';
import { nanoid } from 'nanoid';
import fs from 'fs';
import { Logger } from 'tslog';

const TEST_DB_PATH = '/tmp/synql-test.db'; // Use an in-memory database for tests
const TEST_DB_PREFIX = 'test_sync';
const ID_SIZE = 16; // 1000 years to reach 1% probability of collision at 1000 IDs per second
const logLevel = LogLevel.Warn;

type PostCreateFunction = (db: DB.Database) => void;
type GetConfiguredDbParams = {
  config: SynQLiteOptions,
  path?: string;
  createStatements?: string[];
  postCreate?: PostCreateFunction;
}

function getConfiguredDb({
  createStatements = [],
  config,
}: GetConfiguredDbParams)  {
  const defaultCreateStatement = `
  CREATE TABLE IF NOT EXISTS items (
    item_id TEXT PRIMARY KEY,
    name TEXT
  );`;

  const preInit = createStatements.length
    ? createStatements
    : [defaultCreateStatement];

  const logOptions = {
    name: 'synql-test',
    minLevel: logLevel
  };

  return setupDatabase({ ...config, preInit: (config.preInit || preInit), logOptions });
}

describe('Sync Module', () => {
  let db: SynqlDatabase;

  beforeAll(() => {
    // Initialize the database once for all tests in this suite
    const config: SynQLiteOptions = {
      filename: TEST_DB_PATH,
      prefix: TEST_DB_PREFIX,
      tables: [
        { name: 'items', id: 'item_id' }, // Just set the default test table
      ],
      postInit: [
        `INSERT INTO items (item_id, name) VALUES ('fakeId0', 'Initial Item')`,
        `INSERT INTO items (item_id, name) VALUES ('fakeId1', 'Deleteable Item')`,
      ]
    };
    db = getConfiguredDb({config});
  });

  afterAll(() => {
    fs.unlinkSync(TEST_DB_PATH);
  });

  beforeEach(() => { 
    // Nothing yet...
  });

  test('setupDatabase creates necessary tables and triggers', () => {
    const tables = db.runQuery({
      sql:`SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '${db.synqPrefix}_%'`
    });
    const expectedTables = ['changes', 'meta', 'record_meta'];
    expectedTables.forEach(expectedTable => {
      expect(tables.some((table: any) => table.name === `${db.synqPrefix}_${expectedTable}`)).toBe(true);
    });

    // Optionally, check for the existence of triggers
    const triggers = db.runQuery({
      sql: `SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE '${db.synqPrefix}_%'`
    });
    expect(triggers.length).toBeGreaterThan(0);
    
    const deviceId = db.getDeviceId();
    expect(deviceId).toBeTruthy();
  });

  test.only('getRecordMeta retrieves meta data for table row change', () => {
    const priv = getConfiguredDb({
      config: {
        wal: true,
        filename: '/tmp/ptest.db',
        tables: [
          {name: 'items', id: 'item_id'},
        ],
        prefix: 'tstchtb',
        postInit: [
          `INSERT INTO items (item_id, name) VALUES ('fakeId0', 'Initial Item')`,
          `INSERT INTO items (item_id, name) VALUES ('fakeId1', 'Deleteable Item')`,
        ]
      }
    });
    const updates = [
      { id: 1, table_name: 'items', row_id: 'fakeId0', operation: 'INSERT', data: JSON.stringify({item_id: 'fakeId0', name: "Insert Item" }), modified_at: db.utils.utcNowAsISO8601() },
    ];
    db.applyChangesToLocalDB({changes: updates});
    const changes:any[] = db.getChangesSinceLastSync();
    console.log({changes})
    const res =  db.getRecordMeta({table_name: 'items', row_id: 'fakeId0'});
    console.log(res);
    expect(res).toBeTruthy();
  });

  test.only('getRecordMeta retrieves meta data for table row change', () => {
    const priv = getConfiguredDb({
      config: {
        wal: true,
        filename: '/tmp/ptest.db',
        tables: [
          {name: 'items', id: 'item_id'},
        ],
        prefix: 'tstchtb',
        postInit: [
          `INSERT INTO items (item_id, name) VALUES ('fakeId0', 'Initial Item')`,
          `INSERT INTO items (item_id, name) VALUES ('fakeId1', 'Deleteable Item')`,
        ]
      }
    });
    const updates = [
      { id: 1, table_name: 'items', row_id: 'fakeId0', operation: 'INSERT', data: JSON.stringify({item_id: 'fakeId0', name: "Insert Item" }), modified_at: db.utils.utcNowAsISO8601() },
    ];
    db.applyChangesToLocalDB({changes: updates});
    const changes:any[] = db.getChangesSinceLastSync();
    console.log({changes})
    const res =  db.getRecordMeta({table_name: 'items', row_id: 'fakeId0'});
    console.log(res);
    
    fs.unlinkSync('/tmp/ptest.db');
    fs.unlinkSync('/tmp/ptest.db-shm');
    fs.unlinkSync('/tmp/ptest.db-wal');
    expect(res).toBeTruthy();
  });

  test('getChangesSinceLastSync retrieves changes after a given timestamp', () => {
    const changes:any[] = db.getChangesSinceLastSync();
    expect(changes.length).toBe(2);
    expect(changes[0].row_id).toBe('fakeId0');
  });

  describe('applyChangesToLocalDB', () => {
    test('UPDATE is applied correctly', () => {
      // Prepare additional test data if necessary

      // Simulate changes
      const changes = [
        { id: 1, table_name: 'items', row_id: 'fakeId0', operation: 'UPDATE', data: JSON.stringify({item_id: 'fakeId0', name: "Updated Item" }), modified_at: db.utils.utcNowAsISO8601() },
      ];
      db.applyChangesToLocalDB({changes});

      // Verify changes were applied
      const item:any = db.runQuery({sql: 'SELECT * FROM items WHERE item_id = ?', values: ['fakeId0']})[0];
      console.log(item);
      expect(item.name).toBe('Updated Item');
    });

    test('DELETE is applied correctly', () => {
      // Check item exists
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
      console.log({deleted});
      expect(deleted).toBeFalsy();
    });

    test('INSERT is applied correctly', () => {
      // Simulate INSERT
      const changes = [
        { id: 3, table_name: 'items', row_id: 'fakeId2', operation: 'INSERT', data: JSON.stringify({ item_id: 'fakeId2', name: "Inserted Item" }), modified_at: db.utils.utcNowAsISO8601() },
        // Add more changes as needed for testing
      ];

      db.applyChangesToLocalDB({changes});

      // Verify item was deleted were applied
      const inserted:any = db.db.prepare('SELECT * FROM items WHERE item_id = ?').get('fakeId2');

      expect(inserted).toBeTruthy();
      expect(inserted.item_id).toBe('fakeId2');
    });
  });

  describe('Multiple changes', () => {
    test('Multiple inserts, updates and deletes', () => {
      const log = new Logger({ name: 'multi-in-up-de', minLevel: LogLevel.Trace });
      const preInit = [
        `CREATE TABLE IF NOT EXISTS member (
          member_id TEXT NOT NULL PRIMARY KEY,
          member_name TEXT NOT NULL,
          member_status TEXT NOT NULL, -- ONLINE, OFFLINE 
          member_created TIMESTAMP DEFAULT(STRFTIME('%Y-%m-%dT%H:%M:%f','NOW')),
          member_updated TIMESTAMP
          member_deleted TIMESTAMP
        );`,
        `CREATE TABLE IF NOT EXISTS message (
          message_id TEXT NOT NULL PRIMARY KEY,
          message_member_Id TEXT,
          message_text TEXT NOT NULL,
          message_created TIMESTAMP DEFAULT(STRFTIME('%Y-%m-%dT%H:%M:%f','NOW')),
          message_updated TIMESTAMP,
          message_deleted TIMESTAMP,
          FOREIGN KEY (message_member_id) REFERENCES member (member_id)
        );`
      ];
      const insertMember = `
        INSERT INTO member (member_id, member_name, member_status)
        VALUES (:member_id, :member_name, :member_status)
      `;
      const insertMessage = `
        INSERT INTO message (message_id, message_text, message_member_id)
        SELECT :message_id, :message_text, member_id
        FROM member
        ORDER BY RANDOM()
        LIMIT 1
      `;
      const memberVals = [];
      const messageVals = [];
      for (let i = 0; i < 20; i++) {
        const id = nanoid(ID_SIZE);
        memberVals.push({
          member_id: id,
          member_name: `member:${id}`,
          member_status: 'ONLINE'
        });
      }
      for (let i = 0; i < 20; i++) {
        const id = nanoid(ID_SIZE);
        messageVals.push({
          message_id: id,
          message_text: `${id} message text ${Date.now()}`
        });
      }
      
      const now = Date.now();
      const dbFileA = `/tmp/test${now}A.db`;
      const dbFileB = `/tmp/test${now}B.db`;
      const dbA = getConfiguredDb({
        config: {
          filename: dbFileA,
          tables: [
            {name: 'member', id: 'member_id'},
            {name: 'message', id: 'message_id'}
          ],
          prefix: 'tstchta',
          preInit,
        },
      });

      dbA.runMany({sql: insertMember, values: memberVals});
      const members = dbA.runQuery<any[]>({sql: `SELECT * FROM member`});
      console.debug('dbA members:', members.length)
      expect(members).toBeTruthy();

      dbA.runMany({sql: insertMessage, values: messageVals});
      const messages = dbA.runQuery<any[]>({
        sql: `SELECT * FROM message JOIN member ON member_id = message_member_id`
      });
      expect(messages?.length).toBeGreaterThan(0);

      const changes = dbA.getChangesSinceLastSync();
      expect(changes?.length).toBeGreaterThan(0);

      fs.copyFileSync(dbFileA, dbFileB);
      const dbB = getConfiguredDb({
        config: {
          filename: dbFileB,
          tables: [
            {name: 'member', id: 'member_id'},
            {name: 'message', id: 'message_id'},
          ],
          prefix: 'tstchtb',
          preInit
        }
      });

      function getRandom(size: number) {
        return Math.floor(Math.random() * size);
      }

      // Perform n random changes on A and check they are applied to B
      const editableTables: any = {
        member: {
          member_status: ['ONLINE', 'OFFLINE']
        },
        message: {
          message_text: (id: string) => `UPDATED with ${id}`,
        }
      };

      console.log('::: update random :::');

      for (let i = 0; i < 10000; i++) {
        const tables = Object.keys(editableTables);
        const randTable: string = tables[getRandom(tables.length)];
        const cols = Object.keys(editableTables[randTable]);
        const randCol = cols[getRandom(cols.length)];
        //console.log({randTable, cols, randCol})
        let randVal: any; 
        if (Array.isArray(editableTables[randTable][randCol])) {
          const items = editableTables[randTable][randCol];
          randVal = items[getRandom(items.length)];
        }
        else if (typeof editableTables[randTable][randCol] === 'function') {
          randVal = editableTables[randTable][randCol](nanoid());
        }
        else {
          console.log('Unable to find value', randCol, typeof  editableTables[randTable][randCol], ':::', editableTables[randTable], )
        }
        if (!randVal) {
          log.warn('{?} No randVal', {randVal});
          continue;
        }
        const idCol = dbA.synqTables?.find((t: any) => t.name === randTable)?.id;

        if (!idCol) {
          console.warn(`Unable to determine ID column for '${randTable}'`);
          continue;
        }
        const itemToUpdate = dbA.runQuery<any>({
          sql: `SELECT ${idCol} FROM ${randTable} ORDER BY RANDOM() LIMIT 1;`
        });
        const updateData = {[randCol]: randVal, [idCol]: itemToUpdate[0][idCol]};
        //log.trace('@@@>>> ', {randTable, randCol, idCol, randVal, updateData});

        dbA.run({
          sql: `UPDATE ${randTable} SET ${randCol} = :${randCol} WHERE ${idCol} = :${idCol}`,
          values: updateData
        });
      }
      const changelog = dbA.runQuery<any[]>({
        sql: `SELECT * FROM ${dbA.synqPrefix}_changes;`
      });
      console.log(':O:O: changes to apply:', changelog.length);
      expect(changelog).toBeTruthy();

      // Apply the changes to database B
      dbB.applyChangesToLocalDB({changes: changelog});
      
      // Compare records
      const member1A = dbA.runQuery<any[]>({sql: `SELECT * FROM member ORDER BY member_id`});
      const member1B = dbB.runQuery<any[]>({sql: `SELECT * FROM member ORDER BY member_id`});
      
      expect(member1A.length).toEqual(member1B.length);

      member1B.forEach((b: any) => {
        const a: any = member1A.find((a: any) => a.member_id === b.member_id);
        if (!a) {
          console.error(b);
          throw new Error('Mismatched records!');
        }
        
        Object.keys(b).forEach(col => {
          if (a[col] !== b[col]) {
            console.log({a, b});
            const change = changelog.filter((c: any) => c.row_id === a.member_id);
            console.log(change);
            throw new Error(`Columns don't match!\nA: ${a[col]}\nB: ${b[col]}`);
          }
        });
      });

      // See how big the databases are
      const statA = fs.statSync(dbFileA);
      const statB = fs.statSync(dbFileB);
      console.log({statA, statB});

      // Remove the databases
      fs.unlinkSync(dbFileA);
      fs.unlinkSync(dbFileA+'-shm');
      fs.unlinkSync(dbFileA+'-wal');
      fs.unlinkSync(dbFileB);
      fs.unlinkSync(dbFileB+'-shm');
      fs.unlinkSync(dbFileB+'-wal');
    });
  })
});
