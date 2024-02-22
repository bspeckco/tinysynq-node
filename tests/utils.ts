import setupDatabase from '../src/lib/index.js';
import { Change, LogLevel, SyncableTable } from '../src/lib/types.js';
import fs from 'fs';
import { SynQLite } from '../src/lib/synqlite.class.js';
import { ILogObj, ISettingsParam } from 'tslog';
import { nanoid } from 'nanoid';
import { SYNQLITE_NANOID_SIZE } from '../src/lib/constants.js';
import { testCreateTableItems, testInsertRowItem } from './test-data/items.data.js';

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
  debug?: boolean;
}

export function getNanoId() {
  return nanoid(SYNQLITE_NANOID_SIZE);
}

export function getConfiguredDb(configData?: {config?: ConfigureParams, useDefault?: boolean}): SynQLite {
  const { config, useDefault = false } = (configData || {});
  const filename = getRandomDbName();
  const prefix = (filename.split('/').pop() || '').split('.')[0];
  const defaultConfig = {
    wal: true,
    filename,
    tables: [
      {name: 'items', id: 'item_id', editable: ['name']},
    ],
    prefix,
    preInit: config?.preInit || (useDefault ? testCreateTableItems : []),
    postInit: config?.postInit || (useDefault ? testInsertRowItem : []),
    logOptions: {
      name: filename,
      minLevel: logLevel
    },
    debug: config?.debug
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

export function getRandom(size: number) {
  return Math.floor(Math.random() * size);
}

enum ChangeOperation {
  'INSERT' = 'INSERT',
  'UPDATE' = 'UPDATE',
  'DELETE' = 'DELETE'
}

type Operation = keyof typeof ChangeOperation; 

function generateChangeData(
  {db, operation, table_name, row_id, change_id}:
  {db: SynQLite, operation: Operation, table_name: string, row_id: string, change_id: number})
{
  const id = change_id;
  operation = operation || 'INSERT';
  return {
    id, 
    table_name,
    row_id,
    operation,
    data: JSON.stringify({item_id: row_id, name: `${operation.toLowerCase()} item ${row_id}` }),
    modified_at: db.utils.utcNowAsISO8601()
  }
}

function generateRowData(
  { sq, operation, table_name, row_id, values, columns}:
  { sq: SynQLite, operation: Operation, table_name: string, row_id: string, values: any, columns: any})
{
  operation = operation || 'INSERT';

  const data: any = sq
    // Get record as template.
    ? sq.runQuery({sql: `SELECT * FROM ${table_name} ORDER BY RANDOM() LIMIT 1`})[0]
    : {};
  for (const column of columns) {
    const col = column.name;
    if (col === 'id' || col.endsWith('_id')) {
      // Updates and deletes need an existing record.
      data[col] = operation === ChangeOperation.INSERT ? row_id : data[column.name];
    }
    else if (values[col] !== 'undefined') {
      data[col] = values[col];
    }
  }
  
  // modified_at: db.utils.utcNowAsISO8601()
  return data;
}

export function getRandomValue({columnType}: {columnType: string}) {
  switch(columnType) {
    case 'TEXT':
      return getNanoId();
    case 'INTEGER':
      return getRandom(10000);
    case 'BOOLEAN':
      return getRandom(2);
    case 'DATE':
      return new Date().toISOString().replace(/[TZ]/g, '');
  }
}

export function getTableIdColumn({db, table}: {db: SynQLite, table: string}) {
  return db.synqTables![table]?.id as string;
}

export function getDefaultColumnValue({columnData, columnName, allowEmpty = true}: {columnData: any, columnName: string, allowEmpty?: boolean}) {
  let val: any;
  if (Array.isArray(columnData)) {
    const items = columnData;
    val = (items as string[])[getRandom(items.length)];
  }
  else if (typeof columnData === 'function') {
    val = (columnData as ValueGenerator)(getNanoId());
  }
  else if (!columnData && !allowEmpty) {
    throw new Error(`Unable to set default columnd value; column data empty.\nReceived: ${columnData}`);
  }
  else {
    val = columnData ?? '';
  }
  return val;
}

export function generateChangesForTable(
  {sq, table, origin, editableColumns, operation, total = 1}:
  {sq: SynQLite, table: string, origin: string, editableColumns: Record<string, any>, operation?: Operation, total?: number}
) {
  // Get table schema
  const columns = sq.runQuery({
    sql: `SELECT name, type FROM pragma_table_info('${table}');`
  });

  if (!columns.length) throw new Error(`Failed to get column data for ${table}`);

  const editableTables: any = {
    [table]: {}
  };

  for (const col of columns) {
    if (col.name in editableColumns) {
      let val = getDefaultColumnValue({
        columnData: editableColumns[col.name],
        columnName: col.name
      }) || getRandomValue({columnType: col.type});
      editableTables[table][col.name] = val;
    }
  }

  // Get highest existing change ID
  const highestId = sq.runQuery({
    sql: `SELECT id FROM ${sq.synqPrefix}_changes ORDER BY id DESC LIMIT 1`
  })[0]?.id || 0;
  if (highestId === 0) console.warn('WARNING: highestId === 0');

  const changes: Change[] = [];
  const operations = ['INSERT', 'UPDATE', 'DELETE'];
  let currentId = highestId + 1;
  let created = 0;
  while (created < total) {
    const row_id = `fake${currentId}`;
    const { randTable, randCol, randVal } = getRandomColumnUpdate({editableTables});
    // console.log({randTable, randCol, randVal, editableTables})
    editableTables[randTable][randCol] = randVal;
    const randOp = operation || operations[getRandom(operations.length)];
    const rowData: any = generateRowData({
      sq: sq,
      table_name: randTable,
      row_id,
      values: editableTables[randTable],
      operation: randOp as Operation,
      columns
    });
    const idCol = getTableIdColumn({db: sq, table: randTable});
    if (!idCol) throw new Error('Invalid ID column: ' + idCol);
    console.log(rowData)
    const recordMeta = sq.getRecordMeta({
      table_name: randTable,
      row_id: rowData[idCol]
    }) || {vclock: '{}'};
    
    const vclock = JSON.parse(recordMeta.vclock);
    //console.log('BEFORE', vclock)
    vclock[origin] = (vclock[origin] || 0 ) + 1;
    //console.log('AFTER', {vclock})
    
    const change: Change = {
      id: currentId,
      table_name: randTable,
      row_id,
      operation: randOp as Operation,
      data: JSON.stringify(rowData),
      vclock,
      modified_at: sq.utils.utcNowAsISO8601()
    };
    changes.push(change);
    currentId++;
    created++;
  }
  
  
  return changes;
}

type ValueGenerator = (id: string) => string;

type EditableTableData = {
  [table: string]: {
    [column: string]: string[] | ValueGenerator
  }
}

export function getRandomColumnUpdate({editableTables}: {editableTables: EditableTableData}) {
  const tables = Object.keys(editableTables);
  const randKey = getRandom(tables.length);
  const randTable: string = tables[randKey];
  const cols = Object.keys(editableTables[randTable]);
  const randCol = cols[getRandom(cols.length)];
  let randVal: any; 
  randVal = getDefaultColumnValue({
    columnData: editableTables[randTable][randCol],
    columnName: randCol
  });
  return { randVal, randCol, randTable };
}