import { describe, test, expect } from 'vitest';
import { LogLevel } from '../src/lib/types.js';
import { nanoid } from 'nanoid';
import fs from 'fs';
import { Logger } from 'tslog';
import { getConfiguredDb, getRandom, getRandomColumnUpdate, removeDb } from './utils.js';

const ID_SIZE = 16; // 1000 years to reach 1% probability of collision at 1000 IDs per second
const logLevel = LogLevel.Warn;

describe('Sync Module', () => {

  describe('Multiple changes', () => {
    test('Multiple inserts, updates and deletes', () => {
      const log = new Logger({ name: 'multi-in-up-de', minLevel: logLevel });
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
            {name: 'member', id: 'member_id', editable: ['member_name', 'member_status']},
            {name: 'message', id: 'message_id', editable: ['message_text']},
          ],
          prefix: 'tstchta',
          preInit,
          postInit: ['select 1'] // override default test postInit
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
            {name: 'member', id: 'member_id', editable: ['member_name', 'member_status']},
            {name: 'message', id: 'message_id', editable: ['message_text']},
          ],
          preInit,
        }
      });

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
        const { randVal, randCol, randTable } = getRandomColumnUpdate({ editableTables });

        // console.log({randVal, randCol, randTable});
        const idCol = dbA.synqTables![randTable].id;

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
      const changelog = dbA.getChangesSinceLastSync();
      log.debug(':O:O: changes to apply:', changelog.length);
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
            log.warn({a, b});
            const change = changelog.filter((c: any) => c.row_id === a.member_id);
            log.warn(change);
            throw new Error(`Columns don't match!\nA: ${a[col]}\nB: ${b[col]}`);
          }
        });
      });

      // See how big the databases are
      const statA = fs.statSync(dbFileA);
      const statB = fs.statSync(dbFileB);
      console.log({statA, statB});

      // Remove the databases
      removeDb({filename: dbFileA});
      removeDb({filename: dbFileB});
    });
  })
});
