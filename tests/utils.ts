import initTinySynq from '../src/lib/index.js';
import { Change, LogLevel, SyncableTable, TinySynqOperation, VClock } from '../src/lib/types.js';
import fs from 'fs';
import { TinySynq } from '../src/lib/tinysynq.class.js';
import { ILogObj, ISettingsParam } from 'tslog';
import { nanoid } from 'nanoid';
import { TINYSYNQ_NANOID_SIZE } from '../src/lib/constants.js';
import { testCreateTableItems, testInsertRowItem } from './test-data/items.data.js';

const logLevel = LogLevel.Warn;

type ConfigureParams = {
  filePath?: string;
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
  return nanoid(TINYSYNQ_NANOID_SIZE);
}

export function getConfiguredDb(configData?: {config?: ConfigureParams, useDefault?: boolean}): TinySynq {
  const { config, useDefault = false } = (configData || {});
  const filePath = getRandomdbPath();
  const prefix = (filePath.split('/').pop() || '').split('.')[0];
  const defaultConfig = {
    wal: true,
    filePath,
    tables: [
      {name: 'items', id: 'item_id', editable: ['name']},
    ],
    prefix,
    preInit: config?.preInit || (useDefault ? testCreateTableItems : []),
    postInit: config?.postInit || (useDefault ? testInsertRowItem : []),
    logOptions: {
      name: filePath,
      minLevel: logLevel,
      type: 'pretty' as any
    },
    debug: config?.debug
  };
  const finalConfig = {...defaultConfig, ...(config || {})};
  return initTinySynq(finalConfig);
}

export function wait({ms = 100}: {ms: number}) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function getRandomdbPath() {
  return `/tmp/tst_${Math.ceil(Math.random() * 10000)}.db`
}

export function removeDb({filePath}: {filePath: string}) {
  try {
    fs.unlinkSync(filePath);
    fs.unlinkSync(filePath+'-shm');
    fs.unlinkSync(filePath+'-wal'); 
  }
  catch(err: any) {
    // File is already gone
    console.warn(err, err.stack);
  }
}

export function getRandom(size: number) {
  return Math.floor(Math.random() * size);
}

type Operation = keyof typeof TinySynqOperation;
type GetRandomReturn<T> = {
  id_col: string;
  table_name: string;
  data: T;
}

/**
 * Get a specific or random record
 * 
 * Retrieves either the specified `opts.row_id` from `opts.table_name`
 * or a random record from `opts.table_name`.
 * 
 * @param {Object} opts - configure behaviour
 * @param {TinySynq} opts.sq - TinySynq instance
 * @param {string} opts.table_name - name of the table from which to grab a record 
 * @param {string} opts.row_id - identifier of the table row 
 * @param {boolean} opts.select - whether or not to select a random record 
 * @returns 
 */
export function getRecordOrRandom<T>({sq, table_name, row_id, select = true}: any): GetRandomReturn<T | any> | never {
  // Find the referenced item
  let linkedRecord;
  if (row_id) {
    linkedRecord = sq.getById({table_name, row_id});
  }

  // If it doesn't exist, pick a random one
  if (select && !linkedRecord) {
    linkedRecord = sq.runQuery({
      sql: `SELECT * FROM ${table_name} ORDER BY RANDOM() LIMIT 1 `
    })[0];
  }
  if (select && !linkedRecord) throw new Error(`No records found in table: ${table_name}`);
  const id_col = sq.getTableIdColumn({table_name});
  return {id_col, table_name, data: linkedRecord};
}

type ColumnName = string;
type TableName = string;
type GenerateRowDataOptions = {
  sq: TinySynq;
  operation: Operation;
  table_name: string;
  row_id: string;
  values: any;
  columns: any;
  target?: any;
  constraints?: Map<ColumnName, TableName> // specify columns with foreign key constraints
}
function generateRowData(
  {sq, operation, table_name, row_id, values, columns, constraints, target}: GenerateRowDataOptions
)
{
  operation = operation || 'INSERT';

  let updated: any = {};
  if (target) {
    updated = sq.getById({table_name, row_id: target}) || {};
  }
  else {
    updated = sq.runQuery({sql: `SELECT * FROM ${table_name} ORDER BY RANDOM() LIMIT 1`})[0] || {};
  }
  
  // console.log('<<generateRowData>>', {data, columns, values});
  for (const column of columns) {
    const col = column.name;
    if (col === 'id' || col.endsWith('_id')) {
      // Updates and deletes need an existing record.
      if (constraints?.has(col)) {
        const t = constraints.get(col)!;
        const record = getRecordOrRandom({sq, table_name: t, row_id: updated[col]});
        updated[col] = record.data[record.id_col];
      }
      else {
        updated[col] = operation === TinySynqOperation.INSERT ? row_id : updated[column.name];
      }
    }
    else if (values && values[col] !== 'undefined') {
      updated[col] = values[col];
    }
  }
  
  // modified: db.utils.utcNowAsISO8601()
  return updated;
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
    case 'TIMESTAMP':
      return getRandomDateTime();
  }
}

export function getRandomDateTime(opts?: {asString?: boolean}) {
  const {asString = true} = opts || {};
  const time = Date.now();
  const modified = time - Math.floor(Math.random() * 1000000);
  const date = new Date(modified);
  if (!asString) return date;
  return date.toISOString().replace(/[TZ]/g, ' ').trim(); 
}

export function getTableIdColumn({db, table}: {db: TinySynq, table: string}) {
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

type generateChangesForTableOptions = {
  sq: TinySynq;
  table: string;
  origin: string;
  operation?: Operation;
  operations?: Operation[];
  total?: number;
  constraints?: Map<string, string>;
  fixed?: Record<string, any>;
  target?: any;
}
export function generateChangesForTable(
  {sq, table, origin, operation, constraints, fixed, operations, target, total = 1}: generateChangesForTableOptions
) {
  // Get table schema
  const columns = sq.runQuery({
    sql: `SELECT name, type FROM pragma_table_info('${table}');`
  });

  if (!columns.length) throw new Error(`Failed to get column data for ${table}`);

  // Get highest existing change ID
  const highestId = sq.runQuery({
    sql: `SELECT id FROM ${sq.synqPrefix}_changes ORDER BY id DESC LIMIT 1`
  })[0]?.id || 0;
  if (highestId === 0) console.warn('WARNING: highestId === 0');

  const changes: Change[] = [];
  operations = operations || ['INSERT', 'UPDATE', 'DELETE'];
  let currentId = highestId + 1;
  let created = 0;
  while (created < total) {
    const columnUpdates: any = {};
    const editableColumns = sq.synqTables![table].editable;
  
    // Why was this outside the loop???
    for (const col of columns) {
      if (fixed && fixed[col.name] !== undefined) {
        columnUpdates[col.name] = fixed[col.name];
      }
      else if (editableColumns.includes(col.name)) {
        let val = getDefaultColumnValue({
          columnData: editableColumns[col.name],
          columnName: col.name
        }) || getRandomValue({columnType: col.type});
        columnUpdates[col.name] = val;
      }
    }

    const row_id = target ?? `fake${currentId}`;
    const { randTable, randCol, randVal } = getRandomColumnUpdate(
      { editableTables: { [table]: columnUpdates } }
    );
    columnUpdates[randCol] = randVal;
    const randOp = operation || operations[getRandom(operations.length)];
    const rowData: any = generateRowData({
      sq: sq,
      table_name: randTable,
      row_id,
      values: columnUpdates,
      operation: randOp as Operation,
      columns,
      constraints,
      target,
    });
    const idCol = getTableIdColumn({db: sq, table: randTable});
    if (!idCol) throw new Error('Invalid ID column: ' + idCol);

    console.log({idCol})
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
      row_id: rowData[idCol],
      operation: randOp as Operation,
      data: JSON.stringify(rowData),
      vclock,
      source: origin,
      modified: sq.utils.utcNowAsISO8601()
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

type AlterRecordMetaBase = {
  sq: TinySynq,
  table_name: string;
  row_id: string;
  updates: {
    modified?: Date;
    vclock?: VClock;
  }
}

type AlterRecordMetaOptions = AlterRecordMetaBase & (
  {
    updates: {
      modified: Date;
      vclock?: VClock;
    }
  } | {
    updates: {
      modified?: Date;
      vclock: VClock;
    }
  }
)

export function alterRecordMeta({sq, table_name, row_id, updates}: AlterRecordMetaOptions) {
  const values: any = {
    table_name,
    row_id,
  };
  const setStatements: string[] = [];
  Object.keys(updates).forEach(k => {
    setStatements.push(`${k} = :${k}`);
    if (k === 'modified') {
      values[k] = updates.modified!.toISOString().replace(/[TZ]/g, ' ').trim(); 
    }
    else if (k === 'vclock') {
      values[k] = JSON.stringify(updates.vclock);
    }
  });

  //const params = [modified, vclock].filter(p => !!p).map(p => `${p}`).join(',');

  const sql = `
  UPDATE ${sq.synqPrefix}_record_meta
  SET ${setStatements.join(',')}
  WHERE table_name = :table_name
  AND row_id = :row_id
  RETURNING *`;
  console.log({sql, values})

  const res = sq.runQuery({sql, values});
  return res;
}