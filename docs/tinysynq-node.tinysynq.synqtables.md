<!-- Do not edit this file. It is automatically generated by API Documenter. -->

[Home](./index.md) &gt; [tinysynq-node](./tinysynq-node.md) &gt; [TinySynq](./tinysynq-node.tinysynq.md) &gt; [synqTables](./tinysynq-node.tinysynq.synqtables.md)

## TinySynq.synqTables property

Object containing [SyncableTable](./tinysynq-node.syncabletable.md)<!-- -->s, keyed by table name.

**Signature:**

```typescript
get synqTables(): Record<string, SyncableTable> | undefined;
```

## Remarks

A [SyncableTable](./tinysynq-node.syncabletable.md) structure is never modified. TinySynq maintains its own tables and triggers for tracking and responding to changes.

