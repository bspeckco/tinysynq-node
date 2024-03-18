<!-- Do not edit this file. It is automatically generated by API Documenter. -->

[Home](./index.md) &gt; [tinysynq-node](./tinysynq-node.md) &gt; [TinySynqOptionsBase](./tinysynq-node.tinysynqoptionsbase.md)

## TinySynqOptionsBase interface

Base options for TinySynq constructor.

**Signature:**

```typescript
export interface TinySynqOptionsBase 
```

## Properties

|  Property | Modifiers | Type | Description |
|  --- | --- | --- | --- |
|  [batchSize?](./tinysynq-node.tinysynqoptionsbase.batchsize.md) |  | number | _(Optional)_ Maximum number of changes to process at once. |
|  [debug?](./tinysynq-node.tinysynqoptionsbase.debug.md) |  | boolean | <p>_(Optional)_ Enable/disable debug mode</p><p>When enabled, all INSERT/UPDATE/DELETE actions on syncable tables are written to the \*\_dump table for inspection.</p> |
|  [filePath?](./tinysynq-node.tinysynqoptionsbase.filepath.md) |  | string | _(Optional)_ Path to SQLite3 database file. |
|  [logOptions?](./tinysynq-node.tinysynqoptionsbase.logoptions.md) |  | ISettingsParam&lt;ILogObj&gt; | _(Optional)_ Configure logging options. |
|  [postInit?](./tinysynq-node.tinysynqoptionsbase.postinit.md) |  | string\[\] | _(Optional)_ Array of queries to run after TinySynq's change tracking is configured |
|  [prefix](./tinysynq-node.tinysynqoptionsbase.prefix.md) |  | string | Prefix to use for TinySynq tables (trailing underscores will be removed). |
|  [preInit?](./tinysynq-node.tinysynqoptionsbase.preinit.md) |  | string\[\] | _(Optional)_ Array of queries to run before TinySynq's change tracking is configured. |
|  [sqlite3?](./tinysynq-node.tinysynqoptionsbase.sqlite3.md) |  | [BetterSqlite3Instance](./tinysynq-node.bettersqlite3instance.md) | _(Optional)_ A BetterSqlite3 instance. |
|  [tables](./tinysynq-node.tinysynqoptionsbase.tables.md) |  | [SyncableTable](./tinysynq-node.syncabletable.md)<!-- -->\[\] | Tables that should be synced between devices. |
|  [wal?](./tinysynq-node.tinysynqoptionsbase.wal.md) |  | boolean | _(Optional)_ Enable or disable WAL mode. |
