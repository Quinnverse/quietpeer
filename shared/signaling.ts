export const MAX_SIGNAL_PAYLOAD_BYTES = 32 * 1024;
// Leave protocol overhead below the 32 KiB WebSocket message ceiling.
export const MAX_SDP_BYTES = 30 * 1024;
export const HEX_32_PATTERN = /^[a-f0-9]{32}$/;

export type Role = 'a' | 'b';
export type PeerLeftReason = 'ended' | 'disconnected' | 'expired';
export type ClientMessageType = 'create' | 'join' | 'peer-ready' | 'offer' | 'answer' | 'leave';

export type SignalingErrorCode =
  | 'ALREADY_BOUND'
  | 'CAPACITY'
  | 'INVALID_INVITE'
  | 'INVALID_PHASE'
  | 'INVALID_SIGNAL'
  | 'ORIGIN_FORBIDDEN'
  | 'PAYLOAD_TOO_LARGE'
  | 'RATE_LIMIT'
  | 'ROOM_EXPIRED'
  | 'ROOM_FULL'
  | 'ROOM_NOT_FOUND'
  | 'ROOM_EXISTS';

export interface CreateMessage {
  type: 'create';
  roomId: string;
  token: string;
  epoch: string;
}

export interface JoinMessage {
  type: 'join';
  roomId: string;
  token: string;
}

export interface PeerReadyMessage {
  type: 'peer-ready';
}

export interface OfferMessage {
  type: 'offer';
  sdp: string;
}

export interface AnswerMessage {
  type: 'answer';
  sdp: string;
}

export interface LeaveMessage {
  type: 'leave';
}

export type ClientMessage =
  | CreateMessage
  | JoinMessage
  | PeerReadyMessage
  | OfferMessage
  | AnswerMessage
  | LeaveMessage;

export type ServerMessage =
  | { type: 'created'; roomId: string; token: string; epoch: string; role: 'a' }
  | { type: 'joined'; roomId: string; epoch: string; role: 'b' }
  | PeerReadyMessage
  | OfferMessage
  | AnswerMessage
  | { type: 'peer-left'; reason: PeerLeftReason }
  | { type: 'error'; code: SignalingErrorCode };

export function isHex32(value: unknown): value is string {
  return typeof value === 'string' && HEX_32_PATTERN.test(value);
}

/** Generates identifiers only from the browser/runtime CSPRNG; never falls back to Math.random. */
export function secureRandomHex32(): string {
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi?.getRandomValues) {
    throw new Error('CRYPTO_UNAVAILABLE');
  }
  const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length && keys.every((key) => expected.includes(key));
}

function isValidSdp(value: unknown): value is string {
  // SDP is intentionally not grammar-parsed: browser-generated SDP varies by engine.
  return typeof value === 'string' && value.trim().length > 0 && utf8ByteLength(value) <= MAX_SDP_BYTES;
}

/**
 * JSON.parse accepts duplicate object keys. The wire protocol does not: reject duplicate
 * root keys before parsing so an earlier security-relevant value cannot be silently replaced.
 */
function hasDuplicateRootKeys(input: string): boolean {
  let index = 0;
  const skipWhitespace = () => {
    while (/\s/.test(input[index] ?? '')) index += 1;
  };
  const scanString = (): string | null => {
    if (input[index] !== '"') return null;
    const start = index;
    index += 1;
    let escaped = false;
    while (index < input.length) {
      const char = input[index++];
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        try {
          return JSON.parse(input.slice(start, index)) as string;
        } catch {
          return null;
        }
      }
    }
    return null;
  };
  const scanValue = (): boolean => {
    let nesting = 0;
    let inString = false;
    let escaped = false;
    while (index < input.length) {
      const char = input[index];
      if (inString) {
        index += 1;
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') inString = false;
        continue;
      }
      if (char === '"') {
        inString = true;
        index += 1;
      } else if (char === '{' || char === '[') {
        nesting += 1;
        index += 1;
      } else if (char === '}' || char === ']') {
        if (nesting === 0) return true;
        nesting -= 1;
        index += 1;
      } else if (char === ',' && nesting === 0) {
        return true;
      } else {
        index += 1;
      }
    }
    return false;
  };

  skipWhitespace();
  if (input[index] !== '{') return false;
  index += 1;
  const keys = new Set<string>();
  for (;;) {
    skipWhitespace();
    if (input[index] === '}') return false;
    const key = scanString();
    if (key === null) return false;
    if (keys.has(key)) return true;
    keys.add(key);
    skipWhitespace();
    if (input[index] !== ':') return false;
    index += 1;
    if (!scanValue()) return false;
    if (input[index] === ',') {
      index += 1;
      continue;
    }
    if (input[index] === '}') return false;
    return false;
  }
}

/** Parses only exact protocol objects; any extra, missing, or duplicate field is invalid. */
export function parseClientMessage(text: string): ClientMessage | null {
  if (hasDuplicateRootKeys(text)) return null;

  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(value) || typeof value.type !== 'string') return null;

  switch (value.type) {
    case 'create':
      return hasOnlyKeys(value, ['type', 'roomId', 'token', 'epoch']) &&
        isHex32(value.roomId) && isHex32(value.token) && isHex32(value.epoch)
        ? { type: 'create', roomId: value.roomId, token: value.token, epoch: value.epoch }
        : null;
    case 'join':
      return hasOnlyKeys(value, ['type', 'roomId', 'token']) && isHex32(value.roomId) && isHex32(value.token)
        ? { type: 'join', roomId: value.roomId, token: value.token }
        : null;
    case 'peer-ready':
      return hasOnlyKeys(value, ['type']) ? { type: 'peer-ready' } : null;
    case 'offer':
      return hasOnlyKeys(value, ['type', 'sdp']) && isValidSdp(value.sdp)
        ? { type: 'offer', sdp: value.sdp }
        : null;
    case 'answer':
      return hasOnlyKeys(value, ['type', 'sdp']) && isValidSdp(value.sdp)
        ? { type: 'answer', sdp: value.sdp }
        : null;
    case 'leave':
      return hasOnlyKeys(value, ['type']) ? { type: 'leave' } : null;
    default:
      return null;
  }
}
