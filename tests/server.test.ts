import { describe, test, expect } from 'vitest';
import { getConfiguredDb, removeDb } from './utils.js';
import { WebSocket } from 'ws';
import { startTinySynqServer } from '../src/lib/server.js';

describe('Server', () => {
  test('can be reached after initialisation', async () => {
    const db = getConfiguredDb({useDefault: true});
    const server = startTinySynqServer(db);
    console.log(server);
    server.close();
  }, {
    timeout: 60000
  });
});