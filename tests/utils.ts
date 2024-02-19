import setupDatabase from '../src/lib/index.js';
import { LogLevel, SyncableTable } from '../src/lib/types.js';
import fs from 'fs';
import { SynQLite } from '../src/lib/synqlite.class.js';
import { ILogObj, ISettingsParam } from 'tslog';

const logLevel = LogLevel.Warn;

type ConfigureParams = {
  filename?: string;
  prefix?: string;
  tables?: SyncableTable[];
  batchSize?: number;
  wal?: boolean;
  preInit?: string[];
  postInit?: string[];
  logOptions?: ISettingsParam<ILogObj>;
}

export function getConfiguredDb(configData?: {config: ConfigureParams}): SynQLite {
  const { config } = (configData || {});
  const preInit = [
    `CREATE TABLE IF NOT EXISTS items (
      item_id TEXT PRIMARY KEY,
      name TEXT
    );`
  ];
  const postInit = [
    `INSERT INTO items (item_id, name) VALUES ('fakeId0', 'Initial Item')`,
    `INSERT INTO items (item_id, name) VALUES ('fakeId1', 'Deleteable Item')`,
  ];
  const filename = getRandomDbName();
  const prefix = (filename.split('/').pop() || '').split('.')[0];
  const defaultConfig = {
    wal: true,
    filename,
    tables: [
      {name: 'items', id: 'item_id'},
    ],
    prefix,
    preInit: config?.preInit || preInit,
    postInit: config?.postInit || postInit,
    logOptions: {
      name: filename,
      minLevel: logLevel
    }
  };

  return setupDatabase({ ...defaultConfig, ...(config || {}) });
}

export function getRandomDbName() {
  return `/tmp/tst_${Math.ceil(Math.random() * 10000)}.db`
}

export function removeDb({filename}: {filename: string}) {
  try {
    fs.unlinkSync(filename);
    fs.unlinkSync(filename+'-shm');
    fs.unlinkSync(filename+'-wal'); 
  }
  catch(err) {
    // File is already gone
  }
}
