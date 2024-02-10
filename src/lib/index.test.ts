import { describe, test, beforeAll, beforeEach, expect, afterAll } from 'vitest';
import SynQLite, { type SynQLiteOptions, type SynqlDatabase } from './index.js';
import DB from 'better-sqlite3';
import SUI from 'short-unique-id';
import { nanoid } from 'nanoid';
import fs from 'fs';

const TEST_DB_PATH = '/tmp/synql-test.db'; // Use an in-memory database for tests
const ID_SIZE = 16; // 1000 years to reach 1% probability of collision at 1000 IDs per second

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
  postCreate
}: GetConfiguredDbParams)  {
  // Initialize the database once for all tests in this suite
  const tmp = new DB(config.database);
  const defaultCreateStatement = `
  CREATE TABLE IF NOT EXISTS items (
    item_id TEXT PRIMARY KEY,
    name TEXT
  );`;

  createStatements = createStatements.length
    ? createStatements
    : [defaultCreateStatement]
  // Common test data setup
  for (const stmt of createStatements) {
    tmp.prepare(stmt).run();
  };
  if (postCreate) postCreate(tmp);
  tmp.close();

  // Use the connection provided SynQLite
  return SynQLite.setupDatabase(config);
}

describe('Sync Module', () => {
  let db: SynqlDatabase;

  beforeAll(() => {
    const postCreate = (tmp: DB.Database) => {
      const tmpStmt = tmp.prepare('INSERT INTO items (item_id, name) VALUES (:item_id, :name)');
      tmpStmt.run({item_id: 'fakeId0', name:'Initial Item'});
      tmpStmt.run({item_id: 'fakeId1', name:'Deleteable Item'});
    }

    // Initialize the database once for all tests in this suite
    const config = {
      database: TEST_DB_PATH,
      prefix: 'test_sync',
      tables: [
        { name: 'items', id: 'item_id' }, // Just set the default test table
      ],
    }
    db = getConfiguredDb({config, postCreate});
  });

  afterAll(() => {
    fs.unlinkSync(TEST_DB_PATH);
  });

  beforeEach(() => {
    // Reset or recreate tables as necessary before each test
    // If tables are modified by tests, ensure they are reset to their initial state here
    // For in-memory databases, this might be less relevant
  });

  test('setupDatabase creates necessary tables and triggers', () => {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'test_sync_%'").all() as any[];
    const expectedTables = ['test_sync_changes', 'test_sync_meta'];
    expectedTables.forEach(expectedTable => {
      expect(tables.some(table => table.name === expectedTable)).toBe(true);
    });

    // Optionally, check for the existence of triggers
    const triggers = db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'test_sync_%'").all();
    expect(triggers.length).toBeGreaterThan(0);
  });

  test('getChangesSinceLastSync retrieves changes after a given timestamp', () => {
    const changes:any[] = SynQLite.getChangesSinceLastSync(db);
    expect(changes.length).toBe(1);
    expect(changes[0].row_id).toBe(2);
  });

  describe.skip('applyChangesToLocalDB', () => {
    test('UPDATE is applied correctly', () => {
      // Prepare additional test data if necessary

      // Simulate changes
      const changes = [
        { id: 1, table_name: 'items', row_id: 'fakeId0', operation: 'UPDATE', data: JSON.stringify({ name: "Updated Item" }), modified_at: db.utils.utcNowAsISO8601() },
        // Add more changes as needed for testing
      ];

      SynQLite.applyChangesToLocalDB(db, changes);

      // Verify changes were applied
      const item:any = db.prepare('SELECT * FROM items WHERE item_id = ?').get('fakeId0');
      console.log(item);
      expect(item.name).toBe('Updated Item');
    });

    test('DELETE is applied correctly', () => {
      // Check item exists
      const existing:any = db.prepare('SELECT * FROM items WHERE item_id = ?').get('fakeId1');
      console.log({existing});
      expect(existing).toBeTruthy();

      // Simulate UPDATE
      const changes = [
        { id: 2, table_name: 'items', row_id: 'fakeId1', operation: 'DELETE', data: JSON.stringify({ name: "Updated Item" }), modified_at: db.utils.utcNowAsISO8601() },
        // Add more changes as needed for testing
      ];

      SynQLite.applyChangesToLocalDB(db, changes);

      // Verify item was deleted were applied
      const deleted:any = db.prepare('SELECT * FROM items WHERE item_id = ?').get('fakeId1');
      console.log({deleted});
      expect(deleted).toBeFalsy();
    });

    test('INSERT is applied correctly', () => {
      // Simulate INSERT
      const changes = [
        { id: 3, table_name: 'items', row_id: 'fakeId2', operation: 'INSERT', data: JSON.stringify({ item_id: 'fakeId2', name: "Inserted Item" }), modified_at: db.utils.utcNowAsISO8601() },
        // Add more changes as needed for testing
      ];

      SynQLite.applyChangesToLocalDB(db, changes);

      // Verify item was deleted were applied
      const inserted:any = db.prepare('SELECT * FROM items WHERE item_id = ?').get('fakeId2');
      console.log({inserted});
      expect(inserted).toBeTruthy();
      expect(inserted.item_id).toBe('fakeId2');
    });
  });

  describe.only('Multiple changes', () => {
    test('Multiple inserts, updates and deletes', () => {
      const createStatements = [
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
      const postCreate = (tmp: DB.Database) => {
        // Create some records
        const insertUser = tmp.prepare(`
          INSERT INTO member (member_id, member_name, member_status)
          VALUES (:member_id, :member_name, :member_status)
        `);
        const insertMessage = tmp.prepare(`
          INSERT INTO message (message_id, message_text, message_member_id)
          SELECT :message_id, :message_text, member_id
          FROM member
          ORDER BY RANDOM()
          LIMIT 1
        `);
        const trx = tmp.transaction(() => {
          console.log('::: BEGINNING TRANSACTION:', tmp.constructor.name);  
          for (let i = 0; i < 20; i++) {
            const id = nanoid(ID_SIZE);
            insertUser.run({
              member_id: id,
              member_name: `member:${id}`,
              member_status: 'ONLINE'
            });
          }
          for (let i = 0; i < 20; i++) {
            const id = nanoid(ID_SIZE);
            insertMessage.run({
              message_id: id,
              message_text: `${id} message text ${Date.now()}`
            });
          }
        });
        trx();
      };
      
      const now = Date.now();
      const dbFileA = `/tmp/test${now}A.db`;
      const dbFileB = `/tmp/test${now}B.db`;
      const dbA = getConfiguredDb({
        config: {
          database: dbFileA,
          tables: [
            {name: 'member', id: 'member_id'},
            {name: 'message', id: 'message_id'}
          ],
          prefix: 'tstcht'
        },
        createStatements,
        postCreate
      }); // Isolated in-memory DB instance

      const users = dbA.prepare(`SELECT * FROM member`).all();
      console.log(users.length)
      expect(users).toBeTruthy();

      const messages = dbA.prepare(`SELECT * FROM message JOIN member ON member_id = message_member_id`).all();
      expect(messages).toBeTruthy();

      const changes = dbA.prepare(`SELECT * FROM ${dbA.synqPrefix}_changes`).all();
      expect(changes).toBeTruthy();

      fs.copyFileSync(dbFileA, dbFileB);
      const dbB = getConfiguredDb({
        config: {
          database: dbFileB,
          tables: [
            {name: 'member', id: 'member_id'},
            {name: 'message', id: 'message_id'},
          ],
          prefix: 'tstcht'
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
      const updates = [];
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
        if (!randVal) continue;
        //console.log('@@@>>> ', {randTable, randCol, randVal, synqTables: dbA.synqTables});
        const idCol = dbA.synqTables?.find((t: any) => t.name === randTable)?.id;
        if (!idCol) {
          console.warn(`Unable to determine ID column for '${randTable}'`);
          continue;
        }
        const itemToUpdate = dbA.prepare(`SELECT ${idCol} FROM ${randTable} ORDER BY RANDOM() LIMIT 1`).get() as any;
        // console.log({itemToUpdate});
        const updateData = {[randCol]: randVal, [idCol]: itemToUpdate[idCol]};
        dbA.prepare(
          `UPDATE ${randTable} SET ${randCol} = :${randCol} WHERE ${idCol} = :${idCol}`
        ).run(updateData);
        updates.push(updateData);
      }
      const changelog = dbA.prepare(`SELECT * FROM ${dbA.synqPrefix}_changes;`).all();
      console.log(':O:O: changes to apply:', changelog.length);
      expect(changelog).toBeTruthy();

      // Apply the changes to database B
      SynQLite.applyChangesToLocalDB(dbB, changelog as any[]);
      
      // Compare records
      const member1A = dbA.prepare(`SELECT * FROM member ORDER BY member_id`).all();
      const member1B = dbB.prepare(`SELECT * FROM member ORDER BY member_id`).all();
      
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
      fs.unlinkSync(dbFileB);
    });
  })
});
