import { createServer, type Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { createSignalingServer, type SignalingDiagnostic, type SignalingServer } from '../server/signaling.js';
import type { ServerMessage } from '../shared/signaling.js';

const HOST = '127.0.0.1';
const timeoutMs = 1_500;

type Waiter = {
  predicate: (message: ServerMessage) => boolean;
  resolve: (message: ServerMessage) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

interface TestClient {
  ws: WebSocket;
  messages: ServerMessage[];
  waiters: Waiter[];
}

let server: Server;
let signaling: SignalingServer;
let origin: string;
let websocketUrl: string;
let clients: TestClient[];

function identifier(value: number): string {
  return value.toString(16).padStart(32, '0');
}

async function start(ttlMs?: number, onDiagnostic?: (diagnostic: SignalingDiagnostic) => void): Promise<void> {
  clients = [];
  server = createServer((_request, response) => response.end('test'));
  await new Promise<void>((resolve) => server.listen(0, HOST, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('TEST_SERVER_ADDRESS_UNAVAILABLE');
  origin = `http://${HOST}:${address.port}`;
  websocketUrl = `ws://${HOST}:${address.port}/signaling`;
  signaling = createSignalingServer({ server, allowedOrigins: [origin], ttlMs, onDiagnostic });
}

async function stop(): Promise<void> {
  if (signaling) await signaling.close();
  if (server?.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
}

async function connect(requestOrigin = origin): Promise<TestClient> {
  return new Promise<TestClient>((resolve, reject) => {
    const ws = new WebSocket(websocketUrl, { origin: requestOrigin });
    const client: TestClient = { ws, messages: [], waiters: [] };
    ws.on('message', (data) => {
      const message = JSON.parse(data.toString()) as ServerMessage;
      client.messages.push(message);
      for (const waiter of [...client.waiters]) {
        if (!waiter.predicate(message)) continue;
        clearTimeout(waiter.timer);
        client.waiters.splice(client.waiters.indexOf(waiter), 1);
        waiter.resolve(message);
        break;
      }
    });
    ws.once('open', () => {
      clients.push(client);
      resolve(client);
    });
    ws.once('error', reject);
  });
}

function send(client: TestClient, message: unknown): void {
  client.ws.send(JSON.stringify(message));
}

function waitForMessage(
  client: TestClient,
  predicate: (message: ServerMessage) => boolean,
  timeout = timeoutMs,
): Promise<ServerMessage> {
  const found = client.messages.findIndex(predicate);
  if (found >= 0) return Promise.resolve(client.messages.splice(found, 1)[0]);
  return new Promise<ServerMessage>((resolve, reject) => {
    const waiter: Waiter = {
      predicate,
      resolve,
      reject,
      timer: setTimeout(() => {
        const index = client.waiters.indexOf(waiter);
        if (index >= 0) client.waiters.splice(index, 1);
        reject(new Error('MESSAGE_TIMEOUT'));
      }, timeout),
    };
    client.waiters.push(waiter);
  });
}

function waitForClose(client: TestClient, timeout = timeoutMs): Promise<void> {
  if (client.ws.readyState === WebSocket.CLOSED) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('CLOSE_TIMEOUT')), timeout);
    client.ws.once('close', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function createRoom(roomNumber = 1): Promise<{ a: TestClient; roomId: string; token: string; epoch: string }> {
  const a = await connect();
  const roomId = identifier(roomNumber);
  const token = identifier(roomNumber + 100);
  const epoch = identifier(roomNumber + 200);
  send(a, { type: 'create', roomId, token, epoch });
  expect(await waitForMessage(a, (message) => message.type === 'created')).toEqual({
    type: 'created', roomId, token, epoch, role: 'a',
  });
  return { a, roomId, token, epoch };
}

async function joinRoom(room: { roomId: string; token: string; epoch: string }): Promise<TestClient> {
  const b = await connect();
  send(b, { type: 'join', roomId: room.roomId, token: room.token });
  expect(await waitForMessage(b, (message) => message.type === 'joined')).toEqual({
    type: 'joined', roomId: room.roomId, epoch: room.epoch, role: 'b',
  });
  return b;
}

async function readyPair(a: TestClient, b: TestClient): Promise<void> {
  send(a, { type: 'peer-ready' });
  expect(await waitForMessage(b, (message) => message.type === 'peer-ready')).toEqual({ type: 'peer-ready' });
  send(b, { type: 'peer-ready' });
  expect(await waitForMessage(a, (message) => message.type === 'peer-ready')).toEqual({ type: 'peer-ready' });
}

beforeEach(async () => { await start(); });
afterEach(async () => { await stop(); });

describe('local signaling server', () => {
  it('creates a role-a room and returns the exact invite metadata', async () => {
    const room = await createRoom();
    expect(signaling.rooms.size).toBe(1);
    expect(room.a.ws.readyState).toBe(WebSocket.OPEN);
  });

  it('joins as role b and returns epoch without returning the invite token', async () => {
    const room = await createRoom(2);
    const b = await joinRoom(room);
    const joined = b.messages.find((message) => message.type === 'joined');
    expect(joined).toEqual({ type: 'joined', roomId: room.roomId, epoch: room.epoch, role: 'b' });
    expect(JSON.stringify(joined)).not.toContain(room.token);
    expect(signaling.rooms.size).toBe(1);
  });

  it('queues a peer-ready notice after joined when A becomes ready first', async () => {
    const room = await createRoom(3);
    send(room.a, { type: 'peer-ready' });
    const b = await connect();
    send(b, { type: 'join', roomId: room.roomId, token: room.token });
    expect(await waitForMessage(b, (message) => message.type === 'joined')).toMatchObject({ role: 'b' });
    expect(await waitForMessage(b, (message) => message.type === 'peer-ready')).toEqual({ type: 'peer-ready' });
    send(b, { type: 'peer-ready' });
    expect(await waitForMessage(room.a, (message) => message.type === 'peer-ready')).toEqual({ type: 'peer-ready' });
  });

  it('routes one complete offer and answer only between the bound roles', async () => {
    const room = await createRoom(4);
    const b = await joinRoom(room);
    await readyPair(room.a, b);
    const offer = 'v=0\r\no=- 123 2 IN IP4 127.0.0.1\r\ns=-\r\n';
    const answer = 'v=0\r\no=- 456 2 IN IP4 127.0.0.1\r\ns=-\r\n';
    send(room.a, { type: 'offer', sdp: offer });
    expect(await waitForMessage(b, (message) => message.type === 'offer')).toEqual({ type: 'offer', sdp: offer });
    send(b, { type: 'answer', sdp: answer });
    expect(await waitForMessage(room.a, (message) => message.type === 'answer')).toEqual({ type: 'answer', sdp: answer });
  });

  it('rejects a third participant without disturbing the bound pair', async () => {
    const room = await createRoom(5);
    await joinRoom(room);
    const third = await connect();
    send(third, { type: 'join', roomId: room.roomId, token: room.token });
    expect(await waitForMessage(third, (message) => message.type === 'error')).toEqual({ type: 'error', code: 'ROOM_FULL' });
    expect(signaling.rooms.size).toBe(1);
  });

  it('rejects an invitation with the wrong token', async () => {
    const room = await createRoom(6);
    const b = await connect();
    send(b, { type: 'join', roomId: room.roomId, token: identifier(999) });
    expect(await waitForMessage(b, (message) => message.type === 'error')).toEqual({ type: 'error', code: 'INVALID_INVITE' });
  });

  it('rejects unsupported chat payloads using a fixed protocol error', async () => {
    const a = await connect();
    send(a, { type: 'chat', body: 'not accepted by signaling' });
    expect(await waitForMessage(a, (message) => message.type === 'error')).toEqual({ type: 'error', code: 'INVALID_SIGNAL' });
    expect(signaling.metrics.types.invalid).toBe(1);
  });

  it('enforces the 32 KiB WebSocket maximum without parsing the oversized payload', async () => {
    const a = await connect();
    a.ws.send(JSON.stringify({ type: 'offer', sdp: 'x'.repeat(33 * 1024) }));
    await waitForClose(a);
    expect(signaling.metrics.rejected.PAYLOAD_TOO_LARGE).toBeGreaterThanOrEqual(1);
  });

  it('rejects both an offer by B and an offer sent before the ready phase', async () => {
    const room = await createRoom(7);
    const b = await joinRoom(room);
    send(b, { type: 'offer', sdp: 'v=0\r\n' });
    expect(await waitForMessage(b, (message) => message.type === 'error')).toEqual({ type: 'error', code: 'INVALID_SIGNAL' });
    send(room.a, { type: 'offer', sdp: 'v=0\r\n' });
    expect(await waitForMessage(room.a, (message) => message.type === 'error')).toEqual({ type: 'error', code: 'INVALID_PHASE' });
  });

  it('destroys the room and informs the survivor when a peer disconnects', async () => {
    const room = await createRoom(8);
    const b = await joinRoom(room);
    b.ws.close();
    expect(await waitForMessage(room.a, (message) => message.type === 'peer-left')).toEqual({ type: 'peer-left', reason: 'disconnected' });
    expect(signaling.rooms.size).toBe(0);
    const retry = await connect();
    send(retry, { type: 'join', roomId: room.roomId, token: room.token });
    expect(await waitForMessage(retry, (message) => message.type === 'error')).toEqual({ type: 'error', code: 'ROOM_NOT_FOUND' });
  });

  it('expires a waiting invitation and reports ROOM_EXPIRED to later joins', async () => {
    await stop();
    await start(25);
    const room = await createRoom(9);
    expect(await waitForMessage(room.a, (message) => message.type === 'peer-left')).toEqual({ type: 'peer-left', reason: 'expired' });
    const lateJoiner = await connect();
    send(lateJoiner, { type: 'join', roomId: room.roomId, token: room.token });
    expect(await waitForMessage(lateJoiner, (message) => message.type === 'error')).toEqual({ type: 'error', code: 'ROOM_EXPIRED' });
  });

  it('rejects WebSocket upgrades whose Origin is not the current loopback origin', async () => {
    const status = await new Promise<number>((resolve, reject) => {
      const ws = new WebSocket(websocketUrl, { origin: 'http://evil.invalid' });
      ws.once('unexpected-response', (_request, response) => {
        response.resume();
        ws.terminate();
        resolve(response.statusCode ?? 0);
      });
      ws.once('error', reject);
    });
    expect(status).toBe(403);
    expect(signaling.metrics.rejected.ORIGIN_FORBIDDEN).toBe(1);
  });

  it('emits metadata-only diagnostics and never exposes SDP or invitation material', async () => {
    const diagnostics: SignalingDiagnostic[] = [];
    await stop();
    await start(undefined, (diagnostic) => diagnostics.push(diagnostic));
    const room = await createRoom(10);
    const b = await joinRoom(room);
    await readyPair(room.a, b);
    const secretSdp = 'v=0\r\nSENSITIVE_SDP_MUST_NOT_APPEAR\r\n';
    send(room.a, { type: 'offer', sdp: secretSdp });
    await waitForMessage(b, (message) => message.type === 'offer');
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics.every((diagnostic) => Object.keys(diagnostic).sort().join(',') === 'size,type')).toBe(true);
    expect(JSON.stringify(diagnostics)).not.toContain('SENSITIVE_SDP_MUST_NOT_APPEAR');
    expect(JSON.stringify(diagnostics)).not.toContain(room.token);
  });

  it('does not permit a bound socket to create or join another room', async () => {
    const room = await createRoom(11);
    send(room.a, { type: 'create', roomId: identifier(12), token: identifier(112), epoch: identifier(212) });
    expect(await waitForMessage(room.a, (message) => message.type === 'error')).toEqual({ type: 'error', code: 'ALREADY_BOUND' });
  });
});
