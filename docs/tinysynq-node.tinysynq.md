<!-- Do not edit this file. It is automatically generated by API Documenter. -->

[Home](./index.md) &gt; [tinysynq-node](./tinysynq-node.md) &gt; [TinySynq](./tinysynq-node.tinysynq.md)

## TinySynq class

The main class for managing SQLite3 synchronisation.

**Signature:**

```typescript
export declare class TinySynq 
```

## Remarks

Expects SQLite3 version &gt;<!-- -->=3.45.1

## Constructors

|  Constructor | Modifiers | Description |
|  --- | --- | --- |
|  [(constructor)(opts)](./tinysynq-node.tinysynq._constructor_.md) |  | Configure new TinySynq instance. |

## Properties

|  Property | Modifiers | Type | Description |
|  --- | --- | --- | --- |
|  [db](./tinysynq-node.tinysynq.db.md) | <code>readonly</code> | any | better-sqlite3 instance (See [BetterSqlite3](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md)<!-- -->) |
|  [dbPath](./tinysynq-node.tinysynq.dbpath.md) | <code>readonly</code> | string | Path to DB file |
|  [deviceId](./tinysynq-node.tinysynq.deviceid.md) | <code>readonly</code> | string \| undefined | Automatically generated ID for device's DB instance. |
|  [synqBatchSize](./tinysynq-node.tinysynq.synqbatchsize.md) | <code>readonly</code> | number | Number of records to process in each batch when syncing changes. |
|  [synqDbId](./tinysynq-node.tinysynq.synqdbid.md) | <code>readonly</code> | string \| undefined | Alias for [TinySynq.deviceId](./tinysynq-node.tinysynq.deviceid.md)<!-- -->. |
|  [synqPrefix](./tinysynq-node.tinysynq.synqprefix.md) | <code>readonly</code> | string \| undefined | The prefix used for TinySynq's tables. |
|  [synqTables](./tinysynq-node.tinysynq.synqtables.md) | <code>readonly</code> | Record&lt;string, [SyncableTable](./tinysynq-node.syncabletable.md)<!-- -->&gt; \| undefined | Object containing [SyncableTable](./tinysynq-node.syncabletable.md)<!-- -->s, keyed by table name. |
|  [utils](./tinysynq-node.tinysynq.utils.md) | <code>readonly</code> | Utils | <p>Basic Helpers.</p><p> move to a separate file.</p> |
|  [wal](./tinysynq-node.tinysynq.wal.md) | <code>readonly</code> | boolean | Enable or disable WAL mode. |

## Methods

|  Method | Modifiers | Description |
|  --- | --- | --- |
|  [applyChangesToLocalDB({ changes, restore })](./tinysynq-node.tinysynq.applychangestolocaldb.md) |  |  |
|  [clearDebugData()](./tinysynq-node.tinysynq.cleardebugdata.md) |  | Empties the <code>*_dump</code> table. |
|  [createInsertFromObject({ data, table\_name: table })](./tinysynq-node.tinysynq.createinsertfromobject.md) |  | Creates an insert query based on the syncable table name and data provided. |
|  [disableDebug()](./tinysynq-node.tinysynq.disabledebug.md) |  | Writes debug mode value (false) which disables recording of operations on syncable tables. |
|  [enableDebug()](./tinysynq-node.tinysynq.enabledebug.md) |  | Writes debug mode value (true) which disables recording of operations on syncable tables. |
|  [getById(params)](./tinysynq-node.tinysynq.getbyid.md) |  | Retrieves a single record by it's ID. |
|  [getChanges(params)](./tinysynq-node.tinysynq.getchanges.md) |  | Returns matching [Change](./tinysynq-node.change.md) objects since the last local sync. |
|  [getChangesSinceLastSync(params)](./tinysynq-node.tinysynq.getchangessincelastsync.md) |  | Returns [Change](./tinysynq-node.change.md) objects since the last local sync. |
|  [getDeviceId()](./tinysynq-node.tinysynq.getdeviceid.md) |  | Returns the current device's unique TinySynq ID. |
|  [getLastSync()](./tinysynq-node.tinysynq.getlastsync.md) |  | Returns an ISO8601 formatted date and time of the last successful local sync. |
|  [getNewId()](./tinysynq-node.tinysynq.getnewid.md) |  | Get a random 16-character ID generated by nanoid |
|  [getPending()](./tinysynq-node.tinysynq.getpending.md) |  | Returns changes that couldn't be applied yet because they were received out of sequence. |
|  [getRecordMeta(params)](./tinysynq-node.tinysynq.getrecordmeta.md) |  | Get associated meta data (including <code>vclock</code>) for record. |
|  [getTableIdColumn(params)](./tinysynq-node.tinysynq.gettableidcolumn.md) |  | Get the column used as identifier for the [SyncableTable](./tinysynq-node.syncabletable.md)<!-- -->. |
|  [insertRecordMeta({ change, vclock })](./tinysynq-node.tinysynq.insertrecordmeta.md) |  |  |
|  [run(params)](./tinysynq-node.tinysynq.run.md) |  | Run an operation against the DB |
|  [runMany(params)](./tinysynq-node.tinysynq.runmany.md) |  | Run multiple operations against the DB |
|  [runQuery(params)](./tinysynq-node.tinysynq.runquery.md) |  | Run an operation against the DB |
|  [setDeviceId()](./tinysynq-node.tinysynq.setdeviceid.md) |  | If not already set, generates and sets deviceId. |
|  [tablesReady()](./tinysynq-node.tinysynq.tablesready.md) |  |  |
