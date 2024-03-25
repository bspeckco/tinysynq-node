import { describe, test, expect } from 'vitest';
import { getConfiguredDb, removeDb } from './utils.js';
import { WebSocket } from 'ws';
import { startTinySynqServer } from '../src/lib/server.js';

describe('Server', () => {
  test('can be reached after initialisation', async () => {
    const ts = getConfiguredDb({useDefault: true});
    const server = startTinySynqServer({ts, logOptions: {}});
    console.log(server);
    server.close();
    removeDb({filePath: ts.dbPath});
    expect(server).toBeTruthy();
  }, {
    timeout: 60000
  });
});