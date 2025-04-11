import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { getConfiguredDb, removeDb } from './utils.js';
import { WebSocket } from 'ws';
import { startTinySynqServer, TinySynqServerControl, TSServerParams } from '../src/lib/server.js';
import { type HttpRequest } from 'uWebSockets.js';

const TEST_PORT = 7175;

describe('Server', () => {
  let ts: ReturnType<typeof getConfiguredDb>;
  let serverControl: TinySynqServerControl | null = null;

  const cleanup = () => {
    if (serverControl) {
      try {
        serverControl.close();
        serverControl = null;
      } catch (e) {
        console.error('Error stopping server during cleanup:', e);
      }
    }
    if (ts && ts.dbPath) {
      try {
        removeDb({ filePath: ts.dbPath });
      } catch (e) {
        console.error(`Error removing DB during cleanup: ${ts.dbPath}`, e);
      }
    }
  };

  afterAll(() => {
    cleanup();
  });

  test('can be reached after initialisation', async () => {
    cleanup(); 
    ts = getConfiguredDb({ useDefault: true });
    serverControl = startTinySynqServer({ ts, logOptions: { minLevel: 5 }, port: TEST_PORT }); 
    expect(serverControl.app).toBeTruthy(); 

    await expect(
      new Promise<void>((resolve, reject) => {
        const ws = new WebSocket(`ws://localhost:${TEST_PORT}`);
        ws.on('open', () => { ws.close(); resolve(); });
        const timer = setTimeout(() => reject(new Error('Connection timed out')), 5000);
        ws.on('error', (err) => {
          clearTimeout(timer);
          ws.close();
          reject(err);
         });
        ws.on('close', () => clearTimeout(timer));
      })
    ).resolves.toBeUndefined();

  }, { timeout: 10000 });

  test('should allow connection when no auth function is provided', async () => {
    cleanup();
    ts = getConfiguredDb({ useDefault: true });
    serverControl = startTinySynqServer({ ts, logOptions: { minLevel: 5 }, port: TEST_PORT });

    await expect(
      new Promise<void>((resolve, reject) => {
        const ws = new WebSocket(`ws://localhost:${TEST_PORT}`);
        ws.on('open', () => { ws.close(); resolve(); });
        ws.on('error', (err) => { ws.close(); reject(err); });
      })
    ).resolves.toBeUndefined();
  });

  test('should allow connection when auth function returns true', async () => {
    cleanup();
    ts = getConfiguredDb({ useDefault: true });
    const auth = async (req: HttpRequest) => true;
    serverControl = startTinySynqServer({ ts, auth, logOptions: { minLevel: 5 }, port: TEST_PORT });

    await expect(
      new Promise<void>((resolve, reject) => {
        const ws = new WebSocket(`ws://localhost:${TEST_PORT}`);
        ws.on('open', () => { ws.close(); resolve(); });
        ws.on('error', (err) => { ws.close(); reject(err); });
      })
    ).resolves.toBeUndefined();
  });

  test('should allow connection when auth function returns user data object', async () => {
    cleanup();
    ts = getConfiguredDb({ useDefault: true });
    const auth = async (req: HttpRequest) => ({ userId: 'test-user' });
    serverControl = startTinySynqServer({ ts, auth, logOptions: { minLevel: 5 }, port: TEST_PORT });

    await expect(
      new Promise<void>((resolve, reject) => {
        const ws = new WebSocket(`ws://localhost:${TEST_PORT}`);
        ws.on('open', () => { ws.close(); resolve(); });
        ws.on('error', (err) => { ws.close(); reject(err); });
      })
    ).resolves.toBeUndefined();
  });

  test('should deny connection when auth function returns false', async () => {
    cleanup();
    ts = getConfiguredDb({ useDefault: true });
    const auth = async (req: HttpRequest) => false;
    serverControl = startTinySynqServer({ ts, auth, logOptions: { minLevel: 5 }, port: TEST_PORT });

    await expect(
      new Promise<void>((resolve, reject) => {
        const ws = new WebSocket(`ws://localhost:${TEST_PORT}`);
        ws.on('open', () => { ws.close(); resolve(); });
        ws.on('error', (err: Error & { code?: string; statusCode?: number }) => {
          ws.close();

          if (err.message.includes('401')) {
            reject(new Error('Received 401 Unauthorized'));
          } else {
            reject(err);
          }
        });
      })
    ).rejects.toThrow('Received 401 Unauthorized');
  });

  test('should deny connection when auth function returns undefined', async () => {
    cleanup();
    ts = getConfiguredDb({ useDefault: true });
    
    const auth = async (req: HttpRequest) => { return undefined as any; };
    serverControl = startTinySynqServer({ ts, auth, logOptions: { minLevel: 5 }, port: TEST_PORT });

    await expect(
      new Promise<void>((resolve, reject) => {
        const ws = new WebSocket(`ws://localhost:${TEST_PORT}`);
        ws.on('open', () => { ws.close(); resolve(); });
        ws.on('error', (err) => {
          ws.close();
          if (err.message.includes('401')) {
            reject(new Error('Received 401 Unauthorized'));
          } else {
            reject(err);
          }
        });
      })
    ).rejects.toThrow('Received 401 Unauthorized');
  });

  test('should deny connection when auth function throws an error', async () => {
    cleanup();
    ts = getConfiguredDb({ useDefault: true });
    const auth = async (req: HttpRequest) => { throw new Error('Auth provider error'); };
    serverControl = startTinySynqServer({ ts, auth, logOptions: { minLevel: 5 }, port: TEST_PORT });

    await expect(
      new Promise<void>((resolve, reject) => {
        const ws = new WebSocket(`ws://localhost:${TEST_PORT}`);
        ws.on('open', () => { ws.close(); resolve(); });
        ws.on('error', (err) => {
          ws.close();
           // uWS might return 500 for internal errors during upgrade
          if (err.message.includes('500')) {
            reject(new Error('Received 500 Internal Server Error'));
          } else {
            reject(err);
          }
        });
      })
    ).rejects.toThrow('Received 500 Internal Server Error');
  });

  // --- Bearer Token (Auth) Tests ---

  const bearerAuth = (validToken: string) => async (req: HttpRequest) => {
    const authHeader = req.getHeader('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      console.warn('Bearer auth failed: No or invalid header');
      return false;
    }
    const token = authHeader.substring(7); // Remove 'Bearer '
    if (token === validToken) {
      console.log('Bearer auth success');
      return { tokenUser: 'authorized' };
    }
    console.warn('Bearer auth failed: Invalid token');
    return false;
  };

  test('should allow connection with valid Bearer token via auth', async () => {
    cleanup();
    const validToken = 'test-token-123';
    ts = getConfiguredDb({ useDefault: true });
    serverControl = startTinySynqServer({ ts, auth: bearerAuth(validToken), logOptions: { minLevel: 5 }, port: TEST_PORT });

    await expect(
      new Promise<void>((resolve, reject) => {
        const ws = new WebSocket(`ws://localhost:${TEST_PORT}`, {
          headers: {
            Authorization: `Bearer ${validToken}`
          }
        });
        ws.on('open', () => { ws.close(); resolve(); });
        ws.on('error', (err) => { ws.close(); reject(err); });
      })
    ).resolves.toBeUndefined();
  });

  test('should deny connection with invalid Bearer token via auth', async () => {
    cleanup();
    const validToken = 'test-token-123';
    const invalidToken = 'wrong-token';
    ts = getConfiguredDb({ useDefault: true });
    serverControl = startTinySynqServer({ ts, auth: bearerAuth(validToken), logOptions: { minLevel: 5 }, port: TEST_PORT });

    await expect(
      new Promise<void>((resolve, reject) => {
        const ws = new WebSocket(`ws://localhost:${TEST_PORT}`, {
          headers: {
            Authorization: `Bearer ${invalidToken}`
          }
        });
        ws.on('open', () => { ws.close(); resolve(); });
        ws.on('error', (err) => {
          ws.close();
          if (err.message.includes('401')) {
            reject(new Error('Received 401 Unauthorized'));
          } else {
            reject(err);
          }
        });
      })
    ).rejects.toThrow('Received 401 Unauthorized');
  });

  test('should deny connection without Bearer token when auth requires it', async () => {
    cleanup();
    const validToken = 'test-token-123';
    ts = getConfiguredDb({ useDefault: true });
    serverControl = startTinySynqServer({ ts, auth: bearerAuth(validToken), logOptions: { minLevel: 5 }, port: TEST_PORT });

    await expect(
      new Promise<void>((resolve, reject) => {
        const ws = new WebSocket(`ws://localhost:${TEST_PORT}`); // No headers
        ws.on('open', () => { ws.close(); resolve(); });
        ws.on('error', (err) => {
          ws.close();
          if (err.message.includes('401')) {
            reject(new Error('Received 401 Unauthorized'));
          } else {
            reject(err);
          }
        });
      })
    ).rejects.toThrow('Received 401 Unauthorized');
  });

  // --- Query Parameter Auth Tests ---

  const queryParamAuth = (validToken: string) => async (req: HttpRequest): Promise<boolean | { queryUser: string }> => {
    const token = req.getQuery('token');
    console.log(`Query Param Auth: Received token = '${token}'`);
    if (token === validToken) {
      console.log('Query Param Auth: Success');
      return { queryUser: 'authorized_via_query' };
    }
    console.warn('Query Param Auth: Failure');
    return false;
  };

  test('should allow connection with valid token in query parameter', async () => {
    cleanup();
    const validToken = 'query-token-789';
    ts = getConfiguredDb({ useDefault: true });
    // Use the specific auth function for this test
    serverControl = startTinySynqServer({ ts, auth: queryParamAuth(validToken), logOptions: { minLevel: 5 }, port: TEST_PORT });

    await expect(
      new Promise<void>((resolve, reject) => {
        // Construct URL with query parameter
        const ws = new WebSocket(`ws://localhost:${TEST_PORT}/?token=${validToken}`);
        ws.on('open', () => { ws.close(); resolve(); });
        ws.on('error', (err) => { ws.close(); reject(err); });
      })
    ).resolves.toBeUndefined();
  });

  test('should deny connection with invalid token in query parameter', async () => {
    cleanup();
    const validToken = 'query-token-789';
    const invalidToken = 'wrong-query-token';
    ts = getConfiguredDb({ useDefault: true });
    serverControl = startTinySynqServer({ ts, auth: queryParamAuth(validToken), logOptions: { minLevel: 5 }, port: TEST_PORT });

    await expect(
      new Promise<void>((resolve, reject) => {
        const ws = new WebSocket(`ws://localhost:${TEST_PORT}/?token=${invalidToken}`);
        ws.on('open', () => { ws.close(); resolve(); }); // Should not open
        ws.on('error', (err) => {
          ws.close();
          if (err.message.includes('401')) {
            reject(new Error('Received 401 Unauthorized'));
          } else {
            reject(err);
          }
        });
      })
    ).rejects.toThrow('Received 401 Unauthorized');
  });

  test('should deny connection without token query parameter when auth requires it', async () => {
    cleanup();
    const validToken = 'query-token-789';
    ts = getConfiguredDb({ useDefault: true });
    serverControl = startTinySynqServer({ ts, auth: queryParamAuth(validToken), logOptions: { minLevel: 5 }, port: TEST_PORT });

    await expect(
      new Promise<void>((resolve, reject) => {
        const ws = new WebSocket(`ws://localhost:${TEST_PORT}/`); // No query parameter
        ws.on('open', () => { ws.close(); resolve(); });
        ws.on('error', (err) => {
          ws.close();
          if (err.message.includes('401')) {
            reject(new Error('Received 401 Unauthorized'));
          } else {
            reject(err);
          }
        });
      })
    ).rejects.toThrow('Received 401 Unauthorized');
  });

});