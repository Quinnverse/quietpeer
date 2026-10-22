import type { Role } from './types';

export const MAX_TEXT_BYTES = 4096;
export const MAX_FRAME_BYTES = 8192;
export const MAX_MESSAGES = 2000;
export const MAX_UINT64 = (1n << 64n) - 1n;
const HEX = /^[a-f0-9]{32}$/;
export const bytes = (text: string) => new TextEncoder().encode(text).byteLength;
export const randomId = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('');
export const otherRole = (role: Role): Role => role === 'a' ? 'b' : 'a';

export interface TextFrame { v: 1; type: 'text'; epoch: string; role: Role; seq: string; id: string; body: string }
export interface AckFrame { v: 1; type: 'ack'; epoch: string; role: Role; id: string; seq: string }
export interface VerifyFrame { v: 1; type: 'verify'; epoch: string; role: Role; local: string; remote: string }
export interface PulseFrame { v: 1; type: 'ping' | 'pong'; epoch: string; role: Role; id: string }
export type Frame = TextFrame | AckFrame | VerifyFrame | PulseFrame;

export function normalizeFingerprint(input: string): string {
  const clean = input.trim().replace(/\s/g, '').replace(/:/g, '').toUpperCase();
  if (!/^[0-9A-F]{64}$/.test(clean)) throw new Error('FINGERPRINT_FORMAT');
  return clean.match(/.{2}/g)!.join(':');
}

export function parseFrame(raw: unknown, epoch: string, peer: Role): Frame {
  if (typeof raw !== 'string' || bytes(raw) > MAX_FRAME_BYTES) throw new Error('FRAME_SIZE');
  let f: Record<string, unknown>;
  try { f = JSON.parse(raw); } catch { throw new Error('FRAME_JSON'); }
  if (!f || typeof f !== 'object' || Array.isArray(f)) throw new Error('FRAME_SCHEMA');
  if (f.v !== 1 || f.epoch !== epoch || !HEX.test(String(f.epoch)) || f.role !== peer) throw new Error('FRAME_CONTEXT');
  const base = ['v', 'type', 'epoch', 'role'];
  const fields: Record<string, string[]> = { text: ['seq', 'id', 'body'], ack: ['id', 'seq'], verify: ['local', 'remote'], ping: ['id'], pong: ['id'] };
  const extra = fields[String(f.type)];
  if (!extra || Object.keys(f).length !== base.length + extra.length || Object.keys(f).some(k => ![...base, ...extra].includes(k))) throw new Error('FRAME_SCHEMA');
  if (f.type === 'text' || f.type === 'ack') {
    if (typeof f.id !== 'string' || !HEX.test(f.id) || typeof f.seq !== 'string' || !/^[1-9][0-9]{0,19}$/.test(f.seq) || BigInt(f.seq) > MAX_UINT64) throw new Error('FRAME_ID');
  }
  if (f.type === 'text' && (typeof f.body !== 'string' || !f.body.trim() || bytes(f.body) > MAX_TEXT_BYTES)) throw new Error('TEXT_SIZE');
  if (f.type === 'verify') {
    if (typeof f.local !== 'string' || typeof f.remote !== 'string' || normalizeFingerprint(f.local) !== f.local || normalizeFingerprint(f.remote) !== f.remote) throw new Error('VERIFY_FORMAT');
  }
  if ((f.type === 'ping' || f.type === 'pong') && (typeof f.id !== 'string' || !HEX.test(f.id))) throw new Error('PULSE_FORMAT');
  return f as unknown as Frame;
}

export class ReceiveLedger {
  private high = 0n;
  private entries = new Map<string, TextFrame>();
  accept(frame: TextFrame): 'new' | 'duplicate' {
    const prior = this.entries.get(frame.id);
    if (prior) {
      if (prior.seq === frame.seq && prior.body === frame.body) return 'duplicate';
      throw new Error('MESSAGE_COLLISION');
    }
    if (BigInt(frame.seq) <= this.high) throw new Error('MESSAGE_REPLAY');
    if (this.entries.size >= MAX_MESSAGES) throw new Error('SESSION_LIMIT');
    this.entries.set(frame.id, frame);
    this.high = BigInt(frame.seq);
    return 'new';
  }
  clear() { this.high = 0n; this.entries.clear(); }
  get count() { return this.entries.size; }
}

export function ackMatches(ack: AckFrame, sent: TextFrame): boolean {
  return ack.epoch === sent.epoch && ack.role === otherRole(sent.role) && ack.id === sent.id && ack.seq === sent.seq;
}
