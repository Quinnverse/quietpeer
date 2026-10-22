import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, Server as HttpServer } from 'node:http';
import type { Socket } from 'node:net';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import {
  MAX_SIGNAL_PAYLOAD_BYTES,
  type ClientMessage,
  type ClientMessageType,
  type PeerLeftReason,
  type Role,
  type ServerMessage,
  type SignalingErrorCode,
  parseClientMessage,
} from '../shared/signaling.js';

const MAX_ROOMS = 100;
const MAX_SOCKETS = 200;
const MAX_MESSAGES_PER_WINDOW = 30;
const RATE_WINDOW_MS = 10_000;
const DEFAULT_WAITING_TTL_MS = 10 * 60 * 1_000;
const ESTABLISHED_TTL_MS = 60 * 60 * 1_000;
const HEARTBEAT_MS = 30_000;
const EXPIRED_TOMBSTONE_MS = 60_000;

export interface SignalingDiagnostic {
  /** A fixed protocol type (or "invalid"); never any client-supplied payload text. */
  type: ClientMessageType | 'invalid' | 'rejected';
  /** UTF-8/WebSocket message size only. */
  size: number;
}

export interface SignalingMetrics {
  /** Inbound protocol message counts by fixed type, plus invalid JSON/schema input. */
  types: Record<ClientMessageType | 'invalid', number>;
  /** Rejection counts by fixed server code only. */
  rejected: Record<string, number>;
}

export interface CreateSignalingServerOptions {
  server: HttpServer;
  allowedOrigins: readonly string[];
  /** Waiting-for-join lifetime. The established lifetime is always sixty minutes. */
  ttlMs?: number;
  onDiagnostic?: (diagnostic: SignalingDiagnostic) => void;
}

export interface SignalingServer {
  close: () => Promise<void>;
  /** Exposed for local tests only; it is never reachable from HTTP or WebSocket clients. */
  rooms: ReadonlyMap<string, unknown>;
  metrics: SignalingMetrics;
}

interface Session {
  ws: WebSocket;
  room?: Room;
  role?: Role;
  alive: boolean;
  messageTimes: number[];
}

interface Room {
  roomId: string;
  token: string;
  epoch: string;
  a: Session;
  b?: Session;
  aReady: boolean;
  bReady: boolean;
  offerSent: boolean;
  answerSent: boolean;
  destroyed: boolean;
  timer?: ReturnType<typeof setTimeout>;
}

interface ExpiredRoom {
  timer: ReturnType<typeof setTimeout>;
}

function increment(counter: Record<string, number>, key: string): void {
  counter[key] = (counter[key] ?? 0) + 1;
}

function toBuffer(data: RawData): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (Array.isArray(data)) return Buffer.concat(data);
  return Buffer.from(data);
}

function closeSocket(ws: WebSocket): void {
  if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CLOSING) {
    try {
      ws.close(1000);
    } catch {
      // Deliberately silent: close races do not carry application data.
    }
  }
}

function send(ws: WebSocket, message: ServerMessage): void {
  if (ws.readyState !== WebSocket.OPEN) return;
  try {
    ws.send(JSON.stringify(message));
  } catch {
    // The close handler tears down any affected room; never log signaling contents.
  }
}

function rejectUpgrade(socket: Socket, status: '403 Forbidden' | '404 Not Found'): void {
  if (!socket.destroyed) {
    socket.write(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
    socket.destroy();
  }
}

function constantTimeTokenMatch(actual: string, supplied: string): boolean {
  const left = Buffer.from(actual, 'utf8');
  const right = Buffer.from(supplied, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * Attaches the complete local-only signaling protocol to an existing Node HTTP server.
 * It stores invitations only in process memory and never retains forwarded SDP.
 */
export function createSignalingServer(options: CreateSignalingServerOptions): SignalingServer {
  const { server, onDiagnostic } = options;
  const waitingTtlMs = Number.isFinite(options.ttlMs) && (options.ttlMs ?? 0) > 0
    ? Math.floor(options.ttlMs as number)
    : DEFAULT_WAITING_TTL_MS;
  const allowedOrigins = new Set<string>();
  for (const origin of options.allowedOrigins) {
    try {
      allowedOrigins.add(new URL(origin).origin);
    } catch {
      // Invalid configuration cannot broaden access; it simply grants no origin.
    }
  }

  const rooms = new Map<string, Room>();
  const expiredRooms = new Map<string, ExpiredRoom>();
  const sessions = new Set<Session>();
  const metrics: SignalingMetrics = { types: Object.create(null), rejected: Object.create(null) };
  const wss = new WebSocketServer({
    noServer: true,
    clientTracking: false,
    maxPayload: MAX_SIGNAL_PAYLOAD_BYTES,
    perMessageDeflate: false,
  });
  let closePromise: Promise<void> | undefined;

  const diagnostic = (type: SignalingDiagnostic['type'], size: number): void => {
    try {
      onDiagnostic?.({ type, size });
    } catch {
      // Diagnostics are optional observability, never part of signaling control flow.
    }
  };

  const sendError = (session: Session, code: SignalingErrorCode): void => {
    increment(metrics.rejected, code);
    diagnostic('rejected', 0);
    send(session.ws, { type: 'error', code });
  };

  const rememberExpiredRoom = (roomId: string): void => {
    const existing = expiredRooms.get(roomId);
    if (existing) clearTimeout(existing.timer);
    if (expiredRooms.size >= MAX_ROOMS && !existing) {
      const oldest = expiredRooms.entries().next().value as [string, ExpiredRoom] | undefined;
      if (oldest) {
        clearTimeout(oldest[1].timer);
        expiredRooms.delete(oldest[0]);
      }
    }
    const timer = setTimeout(() => expiredRooms.delete(roomId), EXPIRED_TOMBSTONE_MS);
    timer.unref?.();
    expiredRooms.set(roomId, { timer });
  };

  const armRoomExpiry = (room: Room, durationMs: number): void => {
    if (room.timer) clearTimeout(room.timer);
    room.timer = setTimeout(() => destroyRoom(room, 'expired'), durationMs);
    room.timer.unref?.();
  };

  const destroyRoom = (room: Room, reason: PeerLeftReason, departed?: Session): void => {
    if (room.destroyed) return;
    room.destroyed = true;
    if (room.timer) clearTimeout(room.timer);
    rooms.delete(room.roomId);
    if (reason === 'expired') rememberExpiredRoom(room.roomId);

    const members = room.b ? [room.a, room.b] : [room.a];
    const recipients = departed
      ? members.filter((member) => member !== departed)
      : members;
    for (const recipient of recipients) {
      send(recipient.ws, { type: 'peer-left', reason });
    }
    for (const member of members) {
      member.room = undefined;
      closeSocket(member.ws);
    }
  };

  const canAcceptMessage = (session: Session): boolean => {
    const now = Date.now();
    session.messageTimes = session.messageTimes.filter((time) => now - time < RATE_WINDOW_MS);
    if (session.messageTimes.length >= MAX_MESSAGES_PER_WINDOW) return false;
    session.messageTimes.push(now);
    return true;
  };

  const handleCreate = (session: Session, message: Extract<ClientMessage, { type: 'create' }>): void => {
    if (session.room) return sendError(session, 'ALREADY_BOUND');
    if (rooms.size >= MAX_ROOMS) return sendError(session, 'CAPACITY');
    if (rooms.has(message.roomId)) return sendError(session, 'ROOM_EXISTS');

    const room: Room = {
      roomId: message.roomId,
      token: message.token,
      epoch: message.epoch,
      a: session,
      aReady: false,
      bReady: false,
      offerSent: false,
      answerSent: false,
      destroyed: false,
    };
    rooms.set(room.roomId, room);
    session.room = room;
    session.role = 'a';
    armRoomExpiry(room, waitingTtlMs);
    send(session.ws, { type: 'created', roomId: room.roomId, token: room.token, epoch: room.epoch, role: 'a' });
  };

  const handleJoin = (session: Session, message: Extract<ClientMessage, { type: 'join' }>): void => {
    if (session.room) return sendError(session, 'ALREADY_BOUND');
    if (expiredRooms.has(message.roomId)) return sendError(session, 'ROOM_EXPIRED');
    const room = rooms.get(message.roomId);
    if (!room || room.destroyed) return sendError(session, 'ROOM_NOT_FOUND');
    if (!constantTimeTokenMatch(room.token, message.token)) return sendError(session, 'INVALID_INVITE');
    if (room.b) return sendError(session, 'ROOM_FULL');

    room.b = session;
    session.room = room;
    session.role = 'b';
    armRoomExpiry(room, ESTABLISHED_TTL_MS);
    // WebSocket ordering guarantees joined is delivered before any queued peer-ready notice.
    send(session.ws, { type: 'joined', roomId: room.roomId, epoch: room.epoch, role: 'b' });
    if (room.aReady) send(session.ws, { type: 'peer-ready' });
  };

  const handlePeerReady = (session: Session): void => {
    const room = session.room;
    if (!room || room.destroyed || !session.role) return sendError(session, 'INVALID_PHASE');
    if (session.role === 'a') {
      if (room.aReady) return sendError(session, 'INVALID_SIGNAL');
      room.aReady = true;
      if (room.b) send(room.b.ws, { type: 'peer-ready' });
      return;
    }
    if (room.bReady) return sendError(session, 'INVALID_SIGNAL');
    room.bReady = true;
    send(room.a.ws, { type: 'peer-ready' });
  };

  const handleOffer = (session: Session, message: Extract<ClientMessage, { type: 'offer' }>): void => {
    const room = session.room;
    if (!room || room.destroyed || session.role !== 'a') return sendError(session, 'INVALID_SIGNAL');
    if (!room.b || !room.aReady || !room.bReady || room.offerSent) return sendError(session, 'INVALID_PHASE');
    room.offerSent = true;
    send(room.b.ws, { type: 'offer', sdp: message.sdp });
  };

  const handleAnswer = (session: Session, message: Extract<ClientMessage, { type: 'answer' }>): void => {
    const room = session.room;
    if (!room || room.destroyed || session.role !== 'b') return sendError(session, 'INVALID_SIGNAL');
    if (!room.offerSent || !room.aReady || !room.bReady || room.answerSent) return sendError(session, 'INVALID_PHASE');
    room.answerSent = true;
    send(room.a.ws, { type: 'answer', sdp: message.sdp });
  };

  const handleMessage = (session: Session, message: ClientMessage): void => {
    switch (message.type) {
      case 'create': return handleCreate(session, message);
      case 'join': return handleJoin(session, message);
      case 'peer-ready': return handlePeerReady(session);
      case 'offer': return handleOffer(session, message);
      case 'answer': return handleAnswer(session, message);
      case 'leave': {
        if (!session.room) return sendError(session, 'INVALID_PHASE');
        return destroyRoom(session.room, 'ended', session);
      }
    }
  };

  const heartbeat = setInterval(() => {
    for (const session of sessions) {
      if (!session.alive) {
        session.ws.terminate();
        continue;
      }
      session.alive = false;
      try {
        session.ws.ping();
      } catch {
        session.ws.terminate();
      }
    }
  }, HEARTBEAT_MS);
  heartbeat.unref?.();

  wss.on('connection', (ws) => {
    if (sessions.size >= MAX_SOCKETS) {
      const rejectedSession: Session = { ws, alive: true, messageTimes: [] };
      sendError(rejectedSession, 'CAPACITY');
      closeSocket(ws);
      return;
    }

    const session: Session = { ws, alive: true, messageTimes: [] };
    sessions.add(session);
    ws.on('pong', () => { session.alive = true; });
    ws.on('error', () => {
      // ws emits an error before closing a frame that exceeds maxPayload; do not inspect it.
      increment(metrics.rejected, 'PAYLOAD_TOO_LARGE');
      diagnostic('rejected', 0);
    });
    ws.on('message', (data: RawData, isBinary: boolean) => {
      const payload = toBuffer(data);
      if (isBinary) {
        increment(metrics.types, 'invalid');
        diagnostic('invalid', payload.byteLength);
        sendError(session, 'INVALID_SIGNAL');
        closeSocket(ws);
        return;
      }
      if (payload.byteLength > MAX_SIGNAL_PAYLOAD_BYTES) {
        increment(metrics.types, 'invalid');
        diagnostic('invalid', payload.byteLength);
        sendError(session, 'PAYLOAD_TOO_LARGE');
        closeSocket(ws);
        return;
      }
      if (!canAcceptMessage(session)) {
        sendError(session, 'RATE_LIMIT');
        closeSocket(ws);
        return;
      }

      const message = parseClientMessage(payload.toString('utf8'));
      if (!message) {
        increment(metrics.types, 'invalid');
        diagnostic('invalid', payload.byteLength);
        sendError(session, 'INVALID_SIGNAL');
        return;
      }
      increment(metrics.types, message.type);
      diagnostic(message.type, payload.byteLength);
      handleMessage(session, message);
    });
    ws.on('close', () => {
      sessions.delete(session);
      if (session.room) destroyRoom(session.room, 'disconnected', session);
    });
  });

  const upgradeHandler = (request: IncomingMessage, socket: Socket, head: Buffer): void => {
    let pathname = '';
    try {
      pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
    } catch {
      increment(metrics.rejected, 'INVALID_SIGNAL');
      diagnostic('rejected', 0);
      rejectUpgrade(socket, '404 Not Found');
      return;
    }
    if (pathname !== '/signaling') {
      increment(metrics.rejected, 'INVALID_SIGNAL');
      diagnostic('rejected', 0);
      rejectUpgrade(socket, '404 Not Found');
      return;
    }
    const origin = request.headers.origin;
    if (typeof origin !== 'string' || !allowedOrigins.has(origin)) {
      increment(metrics.rejected, 'ORIGIN_FORBIDDEN');
      diagnostic('rejected', 0);
      rejectUpgrade(socket, '403 Forbidden');
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => wss.emit('connection', ws, request));
  };
  server.on('upgrade', upgradeHandler);

  return {
    rooms,
    metrics,
    close: (): Promise<void> => {
      if (closePromise) return closePromise;
      closePromise = new Promise((resolve) => {
        clearInterval(heartbeat);
        server.off('upgrade', upgradeHandler);
        for (const room of rooms.values()) {
          if (room.timer) clearTimeout(room.timer);
        }
        rooms.clear();
        for (const expired of expiredRooms.values()) clearTimeout(expired.timer);
        expiredRooms.clear();
        for (const session of sessions) session.ws.terminate();
        sessions.clear();
        wss.close(() => resolve());
      });
      return closePromise;
    },
  };
}
