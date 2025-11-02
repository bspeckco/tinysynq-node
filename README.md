# tinysynq-node

Node.js host utilities for [TinySynq](https://github.com/bspeckco/tinysynq).  
The package bootstraps SQLite change tracking (via `@bspeckco/tinysynq-lib`) and exposes
an optional WebSocket hub powered by `uWebSockets.js` so TinySynq clients can push/pull
changes.

- `initTinySynq` configures a `TinySynqSync` instance backed by `better-sqlite3`.
- `startTinySynqServer` starts a WebSocket hub that serves TinySynq clients.

## Prerequisites

- Node.js ≥ 18.18.2
- SQLite ≥ 3.45.1 (required by `better-sqlite3@^12`)
- Build tooling needed by `better-sqlite3` (Brew/XCode CLT on macOS, `build-essential` on Linux, MSVC on Windows)
- Existing tables for every sync target (create them up front or via `preInit`)

## Installation

```bash
pnpm add @bspeckco/tinysynq-node
# optional if you want to control the driver version yourself
pnpm add better-sqlite3
```

`tinysynq-node` auto-loads `.env` files through `dotenv`. Place a `.env` file next to
your entry point or export `TINYSYNQ_*` variables in your shell.

## Quick Start

Create the tables you want to synchronise, then wire everything together:

```ts
// sync-server.ts
import { resolve } from 'node:path';
import { initTinySynq, startTinySynqServer } from '@bspeckco/tinysynq-node';

const ts = initTinySynq({
  filePath: resolve('app.db'),
  prefix: 'app', // internal tables use this prefix
  tables: [
    {
      name: 'todos',
      id: 'todo_id',
      editable: ['title', 'is_done'],
    },
  ],
  preInit: [
    `CREATE TABLE IF NOT EXISTS todos (
       todo_id TEXT PRIMARY KEY,
       title TEXT NOT NULL,
       is_done INTEGER DEFAULT 0,
       updated_at TEXT DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%f','now'))
     );`,
  ],
  logOptions: { type: 'pretty', minLevel: 3 },
});

const server = startTinySynqServer({
  ts,
  port: 7174, // defaults to process.env.TINYSYNQ_WS_PORT || 7174
  logOptions: { type: 'pretty', minLevel: 3 },
  auth: async (req) => {
    const token = req.getHeader('authorization');
    return token === process.env.SYNC_TOKEN; // true to authorise, false to reject
  },
  telemetry: {
    emit: (event) => console.log('[tinysynq]', event),
  },
});

process.on('SIGTERM', () => server.close());
process.on('SIGINT', () => server.close());
```

Run the hub:

```bash
node --loader ts-node/esm sync-server.ts   # or compile first then run
```

Point a TinySynq client (`@bspeckco/tinysynq-web`, `@bspeckco/tinysynq-tauri`, etc.)
at `ws://localhost:7174`.

## Using an existing `better-sqlite3` instance

If your app already manages the database connection, pass it in via `sqlite3`:

```ts
import Database from 'better-sqlite3';
import { initTinySynq } from '@bspeckco/tinysynq-node';

const db = new Database(':memory:');

const ts = initTinySynq({
  sqlite3: db,
  prefix: 'app',
  tables: [
    { name: 'todos', id: 'todo_id', editable: ['title', 'is_done'] },
  ],
  wal: true, // enabled by default; set to false if WAL can't be used
});
```

You can also supply your own adapter via `adapter` when integrating with
non-`better-sqlite3` drivers.

## API reference

```ts
import {
  initTinySynq,
  startTinySynqServer,
  TinySynq,
  type TinySynqOptions,
  type SyncableTable,
  type TSServerParams,
  type TinySynqServerControl,
  type TSSocketRequestParams,
  type SocketRequestType,
} from '@bspeckco/tinysynq-node';
```

### `initTinySynq(options: TinySynqOptions)`

Required options:
- `prefix`: string prefix for TinySynq metadata tables (trailing `_` removed)
- `tables`: array of `{ name, id, editable }` describing sync targets
- One of `filePath`, `sqlite3`, or `adapter`

Useful optional settings:
- `preInit`/`postInit`: SQL executed before/after triggers are installed
- `debug`: write change dumps to `{table}_dump` tables
- `logOptions`: forwarded to [`tslog`](https://tslog.js.org/#/?id=settings)
- `wal`: toggle WAL mode (defaults to `true`)
- `batchSize`: max records per pull round
- `telemetry`: `{ emit(event) }` hook for lifecycle events

Returns the configured `TinySynq` instance.

### `startTinySynqServer(params: TSServerParams)`

Parameters:
- `ts` (**required**): TinySynq instance returned from `initTinySynq`
- `logOptions` (**required**): same shape as `tslog` settings
- `port`: overrides the default port (falls back to `TINYSYNQ_WS_PORT || 7174`)
- `auth(req)`: async guard executed during WebSocket upgrade. Return `true`, `false`, or an object to merge into the connection's user data.
- `telemetry`: emit structured events for connection/push/pull lifecycle.

Returns `{ app, close }`. Call `close()` to stop listening.

### Types

The package re-exports the most useful types directly:

- `SyncableTable`, `TinySynqOptions`, `Change`, `QueryParams` (from the core lib)
- `TSServerParams`, `TSSocketRequestParams`, `TinySynqServerControl`, `SocketRequestType`
- `BetterSqlite3Instance`, `TinySynq`

## Environment variables

| Variable              | Purpose                                        | Default |
| --------------------- | ---------------------------------------------- | ------- |
| `TINYSYNQ_WS_PORT`    | WebSocket port for the hub                     | `7174`  |
| `TINYSYNQ_LOG_LEVEL`  | Numeric [`tslog` level](https://tslog.js.org)  | `info`  |
| `TINYSYNQ_LOG_FORMAT` | `json`, `pretty`, or `hidden`                  | `json`  |

`TINYSYNQ_WS_HOST`, `TINYSYNQ_HTTP_HOST`, and `TINYSYNQ_HTTP_PORT` are loaded for consistency with other packages but unused in this module.

## Development scripts

```bash
pnpm i
pnpm test
pnpm build
pnpm watch
```

Set `SKIP_PREPARE=1` if you do not want Husky hooks to run during install.

## Related packages

- [`@bspeckco/tinysynq-lib`](../tinysynq-lib) – core change-tracking engine
- [`@bspeckco/tinysynq-web`](../tinysynq-web) – browser/WebSocket client
- [`@bspeckco/tinysynq-tauri`](../tinysynq-tauri) – Tauri desktop client
