import { initialSnapshot, type Snapshot, type Role } from './types';
import { ackMatches, bytes, MAX_MESSAGES, MAX_TEXT_BYTES, MAX_UINT64, normalizeFingerprint, otherRole, parseFrame, randomId, ReceiveLedger, type Frame, type TextFrame } from './protocol';
import { certificateFingerprint, readIdentityBinding, type IdentityBinding } from './identity';

const ACK_MS = 5000;
const HEARTBEAT_MS = 2500;
const PEER_TIMEOUT_MS = 12000;
const MAX_BUFFER = 65536;
const SIGNAL_ERRORS: Record<string, string> = {
  ROOM_NOT_FOUND: '房间不存在或已结束，请获取新的邀请。', ROOM_FULL: '这是双人房间，已有另一位参与者。',
  INVALID_INVITE: '邀请信息不正确，请向对方确认。', ROOM_EXPIRED: '邀请已过期，请重新创建房间。',
  RATE_LIMIT: '连接请求过于频繁，已停止此次会话。', CAPACITY: '信令服务暂时繁忙，请稍后再试。',
  INVALID_SIGNAL: '连接信息异常，已停止会话以避免身份混淆。',
};
const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

export function parseInvite(input: string): { roomId: string; token: string } {
  let value = input.trim();
  if (value.length > 2048) throw new Error('INVITE_FORMAT');
  if (value.includes('#')) {
    const url = new URL(value);
    value = new URLSearchParams(url.hash.slice(1)).get('invite') || '';
  }
  const parts = value.split('.');
  if (parts.length !== 2 || parts.some(p => !/^[a-f0-9]{32}$/.test(p))) throw new Error('INVITE_FORMAT');
  return { roomId: parts[0], token: parts[1] };
}

export class ChatClient {
  private snapshot = initialSnapshot();
  private listeners = new Set<() => void>();
  private pc?: RTCPeerConnection;
  private certificate?: RTCCertificate;
  private channel?: RTCDataChannel;
  private socket?: WebSocket;
  private generation = 0;
  private expectedBinding = '';
  private bindingSource = '';
  private lastPeerSeen = 0;
  private lastPulse = 0;
  private pulses = new Set<string>();
  private tickBusy = false;
  private ticker?: ReturnType<typeof setInterval>;
  private connectTimer?: ReturnType<typeof setTimeout>;
  private disconnectTimer?: ReturnType<typeof setTimeout>;
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private pending = new Map<string, TextFrame>();
  private receiveLedger = new ReceiveLedger();
  private sequence = 0n;
  private signalQueue = Promise.resolve();
  private inboundQueue = Promise.resolve();
  private sendQueue = Promise.resolve();
  private incomingWindow = { start: 0, count: 0 };
  private ended = false;
  private inboundDepth = 0;

  constructor() {
    if (import.meta.env.MODE === 'test') {
      (window as unknown as { __quietpeerTest?: ChatClient }).__quietpeerTest = this;
    }
  }

  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  getSnapshot = () => this.snapshot;
  private update(patch: Partial<Snapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    this.listeners.forEach(fn => fn());
  }
  private isCurrent(generation: number) { return generation === this.generation && !this.ended; }
  private rejectFrame() { this.update({ rejectedCount: this.snapshot.rejectedCount + 1 }); }
  private bindingKey(b: IdentityBinding) { return `${this.snapshot.epoch}|${this.snapshot.role}|${b.local}|${b.remote}`; }
  private isOpen() { return this.channel?.readyState === 'open' && this.pc?.connectionState === 'connected' && this.pc?.sctp?.transport.state === 'connected'; }
  private canChat() { return this.isOpen() && this.snapshot.connection === 'connected' && this.snapshot.bindingReady && this.snapshot.verification === 'verified' && this.snapshot.localConfirmed && this.snapshot.remoteConfirmed; }
  private signal(data: object) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) throw new Error('SIGNAL_UNAVAILABLE');
    this.socket.send(JSON.stringify(data));
  }
  private release() {
    this.ended = true;
    this.generation++;
    clearInterval(this.ticker); clearTimeout(this.connectTimer); clearTimeout(this.disconnectTimer);
    this.timers.forEach(t => clearTimeout(t)); this.timers.clear();
    this.channel?.close(); this.pc?.close(); this.socket?.close();
    this.channel = undefined; this.pc = undefined; this.socket = undefined; this.certificate = undefined;
    this.pending.clear(); this.receiveLedger.clear(); this.pulses.clear();
    this.expectedBinding = ''; this.bindingSource = ''; this.sequence = 0n;
    this.tickBusy = false; this.inboundDepth = 0; this.incomingWindow = {start:0,count:0}; this.lastPulse = 0;
    this.sendQueue = Promise.resolve(); this.inboundQueue = Promise.resolve(); this.signalQueue = Promise.resolve();
  }
  reset() { this.release(); this.snapshot = initialSnapshot(); this.listeners.forEach(fn => fn()); }
  end() {
    if (this.socket?.readyState === WebSocket.OPEN) this.signal({ type: 'leave' });
    this.release();
    this.update({ connection: 'closed', verification: 'revoked', bindingReady: false, localConfirmed: false, remoteConfirmed: false, dtlsState: 'closed', invite: '', messages: [], error: '', notice: '会话已结束，内存中的聊天记录已清除。' });
  }
  private fail(message: string, identity = false) {
    if (this.ended) return;
    this.release();
    this.update({ connection: 'failed', verification: identity ? 'mismatch' : 'revoked', bindingReady: false, localConfirmed: false, remoteConfirmed: false, dtlsState: 'closed', invite: '', error: message, messages: this.snapshot.messages.map(m => m.direction === 'out' && m.state === 'buffered' ? { ...m, state: 'unknown' } : m) });
  }
  rejectIdentity() { this.fail('指纹核对失败。连接已关闭，禁止继续聊天。请通过可信渠道重新确认对方。', true); }

  private async initialize(role: Role) {
    this.reset(); this.ended = false;
    const generation = this.generation;
    this.update({ connection: 'creating', role });
    if (!window.isSecureContext || !crypto?.getRandomValues || !crypto.subtle || typeof RTCPeerConnection?.generateCertificate !== 'function') throw new Error('CAPABILITY_UNSUPPORTED');
    const algorithm: EcKeyGenParams = { name: 'ECDSA', namedCurve: 'P-256' };
    const certificate = await RTCPeerConnection.generateCertificate(algorithm);
    if (generation !== this.generation) throw new Error('SESSION_ENDED');
    const localFingerprint = certificateFingerprint(certificate);
    const pc = new RTCPeerConnection({ certificates: [certificate], iceServers: [] });
    this.certificate = certificate; this.pc = pc;
    this.update({ localFingerprint });
    pc.onconnectionstatechange = () => {
      if (this.pc !== pc || this.ended) return;
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') this.fail('连接已中断，当前会话不能继续。请新建房间并重新核对指纹。');
      else if (pc.connectionState === 'disconnected') this.pause();
      else if (pc.connectionState === 'connected' && this.channel?.readyState === 'open') void this.refreshBinding().catch(() => { if (this.isCurrent(generation) && this.pc === pc) this.fail('无法可靠核验实际连接证书。已停止聊天。', true); });
    };
    pc.ondatachannel = e => {
      if (this.pc !== pc || this.ended) { e.channel.close(); return; }
      if (this.snapshot.role !== 'b' || this.channel) { e.channel.close(); this.fail('检测到异常数据通道，已停止会话。'); return; }
      this.attachChannel(e.channel, pc);
    };
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(`${protocol}//${location.host}/signaling`);
    this.socket = socket;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { socket.close(); reject(new Error('SIGNAL_TIMEOUT')); }, 8000);
      socket.onopen = () => { clearTimeout(timer); resolve(); };
      socket.onerror = () => { clearTimeout(timer); reject(new Error('SIGNAL_UNAVAILABLE')); };
      socket.onclose = () => { clearTimeout(timer); reject(new Error('SIGNAL_UNAVAILABLE')); };
    });
    if (generation !== this.generation) { socket.close(); throw new Error('SESSION_ENDED'); }
    socket.onmessage = e => {
      if (this.socket !== socket || this.ended) return;
      this.signalQueue = this.signalQueue.then(async () => { if (!this.ended && this.socket === socket) await this.onSignal(e.data); }).catch(() => { if (this.isCurrent(generation) && this.socket === socket) this.fail('连接信息异常或连接超时，已停止会话。'); });
    };
    socket.onerror = () => { /* No untrusted error details or sensitive diagnostic logging. */ };
    socket.onclose = () => {
      if (this.socket !== socket || this.ended) return;
      if (this.channel?.readyState === 'open') this.update({ notice: '信令服务离线；现有端点通道仍按实际连接状态工作。' });
      else this.fail('信令连接已断开，请新建房间重试。');
    };
    this.ticker = setInterval(() => { void this.tick(); }, 1000);
  }

  async create() {
    const initialization = this.initialize('a');
    const generation = this.generation;
    try {
      await initialization;
      if (!this.isCurrent(generation)) return;
      const roomId = randomId(), token = randomId(), epoch = randomId();
      const invite = `${location.origin}${location.pathname}#invite=${roomId}.${token}`;
      this.update({ roomId, epoch, invite });
      this.signal({ type: 'create', roomId, token, epoch });
    } catch { if (this.isCurrent(generation)) this.fail('无法创建房间：浏览器不支持安全证书核验，或本地信令服务不可用。'); }
  }
  async join(invite: string) {
    let parsed: {roomId: string; token: string};
    try { parsed = parseInvite(invite); } catch { this.update({ error: '邀请格式不正确，请粘贴完整邀请链接或房间邀请信息。' }); return; }
    const initialization = this.initialize('b');
    const generation = this.generation;
    try {
      await initialization;
      if (!this.isCurrent(generation)) return;
      this.update({ roomId: parsed.roomId });
      this.signal({ type: 'join', ...parsed });
    } catch { if (this.isCurrent(generation)) this.fail('无法加入房间：浏览器不支持安全证书核验，或信令服务不可用。'); }
  }

  private async onSignal(raw: unknown) {
    const generation = this.generation;
    if (typeof raw !== 'string' || bytes(raw) > 32768) throw new Error('SIGNAL_FORMAT');
    const data = JSON.parse(raw) as Record<string, unknown>;
    if (!data || typeof data !== 'object' || Array.isArray(data) || typeof data.type !== 'string') throw new Error('SIGNAL_FORMAT');
    if (data.type === 'error') { this.fail(SIGNAL_ERRORS[String(data.code)] || '信令服务拒绝此次连接。请重新创建会话。'); return; }
    if (data.type === 'created') {
      if (this.snapshot.role !== 'a' || data.role !== 'a' || data.roomId !== this.snapshot.roomId || data.epoch !== this.snapshot.epoch) throw new Error('SIGNAL_CONTEXT');
      this.update({ connection: 'waiting', error: '', notice: '邀请有效期10分钟，只允许另一位参与者加入。' });
      this.signal({ type: 'peer-ready' });
    } else if (data.type === 'joined') {
      if (this.snapshot.role !== 'b' || data.role !== 'b' || data.roomId !== this.snapshot.roomId || typeof data.epoch !== 'string' || !/^[a-f0-9]{32}$/.test(data.epoch)) throw new Error('SIGNAL_CONTEXT');
      this.update({ epoch: data.epoch, connection: 'connecting', error: '', notice: '' });
      this.signal({ type: 'peer-ready' });
    } else if (data.type === 'peer-ready') {
      if (!this.snapshot.epoch || !this.pc || this.snapshot.connection === 'connected') throw new Error('SIGNAL_STATE');
      this.update({ connection: 'connecting', notice: '正在建立浏览器之间的加密通道。' });
      this.connectTimer = setTimeout(() => { if (this.isCurrent(generation)) this.fail('连接超时。此本地版本未配置TURN，受限网络可能无法直连。'); }, 30000);
      if (this.snapshot.role === 'a') {
        const pc = this.pc;
        this.attachChannel(pc.createDataChannel('quietpeer-v1', { ordered: true, protocol: 'quietpeer/1' }), pc);
        await pc.setLocalDescription(await pc.createOffer());
        await this.gather(pc);
        if (this.pc === pc && !this.ended) this.signal({ type: 'offer', sdp: pc.localDescription!.sdp });
      }
    } else if (data.type === 'offer' || data.type === 'answer') {
      const pc = this.pc;
      if (!pc || typeof data.sdp !== 'string' || data.sdp.length > 30000 || this.snapshot.connection !== 'connecting') throw new Error('SIGNAL_STATE');
      if (data.type === 'offer' && this.snapshot.role === 'b' && !pc.remoteDescription) {
        await pc.setRemoteDescription({ type: 'offer', sdp: data.sdp });
        await pc.setLocalDescription(await pc.createAnswer());
        await this.gather(pc);
        if (this.pc === pc && !this.ended) this.signal({ type: 'answer', sdp: pc.localDescription!.sdp });
      } else if (data.type === 'answer' && this.snapshot.role === 'a' && !pc.remoteDescription) {
        await pc.setRemoteDescription({ type: 'answer', sdp: data.sdp });
      } else { this.fail('连接描述发生异常变化，原身份验证已撤销。', true); }
    } else if (data.type === 'peer-left') {
      if (this.channel?.readyState === 'open' && data.reason === 'disconnected') {
        this.update({ notice: '对方信令离线。端点通道仍被独立监测；刷新或关闭会结束会话。' });
      } else {
        this.release();
        this.update({ connection: 'closed', verification: 'revoked', localConfirmed: false, remoteConfirmed: false, bindingReady: false, dtlsState: 'closed', messages: [], invite: '', notice: '对方已离开，会话已结束。请使用新的邀请重新连接。' });
      }
    } else throw new Error('UNEXPECTED_SIGNAL');
  }
  private async gather(pc: RTCPeerConnection) {
    const until = Date.now() + 8000;
    while (pc.iceGatheringState !== 'complete') {
      if (this.pc !== pc || this.ended) throw new Error('SESSION_ENDED');
      if (Date.now() > until) throw new Error('ICE_TIMEOUT');
      await sleep(50);
    }
  }
  private attachChannel(channel: RTCDataChannel, pc: RTCPeerConnection) {
    const generation = this.generation;
    if (channel.label !== 'quietpeer-v1' || channel.protocol !== 'quietpeer/1' || !channel.ordered || channel.maxPacketLifeTime !== null || channel.maxRetransmits !== null) { channel.close(); this.fail('数据通道配置异常，已停止会话。'); return; }
    this.channel = channel;
    channel.onopen = () => {
      if (this.pc !== pc || this.ended) return;
      this.lastPeerSeen = Date.now();
      void this.refreshBinding().catch(() => { if (this.isCurrent(generation) && this.pc === pc) this.fail('无法将指纹绑定到实际DTLS证书。此浏览器暂不支持可靠核验，已关闭连接。', true); });
    };
    channel.onmessage = e => {
      if (this.pc !== pc || this.ended) return;
      if (typeof e.data !== 'string' || bytes(e.data) > 8192) { this.rejectFrame(); return; }
      if (this.inboundDepth >= 256) { this.fail('入站数据超过处理容量，已停止会话。'); return; }
      this.inboundDepth++;
      this.inboundQueue = this.inboundQueue.then(async () => { if (!this.ended && this.pc === pc) await this.onFrame(e.data); }).catch(() => { if (this.isCurrent(generation) && this.pc === pc) this.rejectFrame(); }).finally(() => { if (generation === this.generation) this.inboundDepth--; });
    };
    channel.onclose = () => { if (this.pc === pc && !this.ended) this.fail('端点数据通道已关闭。未获得确认的消息不能视为已送达。'); };
    channel.onerror = () => { if (this.pc === pc && !this.ended) this.fail('加密数据通道发生错误，已停止发送。'); };
  }
  private async refreshBinding() {
    const pc = this.pc, cert = this.certificate, generation = this.generation;
    if (!pc || !cert || !this.isOpen()) throw new Error('TRANSPORT_NOT_CONNECTED');
    const binding = await readIdentityBinding(pc, cert);
    if (!this.isCurrent(generation) || this.pc !== pc) throw new Error('SESSION_ENDED');
    if (!this.isOpen()) throw new Error('TRANSPORT_NOT_CONNECTED');
    const key = this.bindingKey(binding);
    if (this.expectedBinding && key !== this.expectedBinding) { this.fail('实际连接证书发生变化。身份验证已撤销，禁止继续聊天。', true); throw new Error('IDENTITY_CHANGED'); }
    this.expectedBinding = key; this.bindingSource = binding.source;
    clearTimeout(this.connectTimer); clearTimeout(this.disconnectTimer);
    if (this.snapshot.connection === 'interrupted') this.update({ verification: 'unverified', localConfirmed: false, remoteConfirmed: false });
    this.update({ connection: 'connected', bindingReady: true, localFingerprint: binding.local, remoteFingerprint: binding.remote, dtlsState: binding.dtlsState, cipher: binding.cipher, tlsVersion: binding.tlsVersion, candidateType: binding.candidateType, notice: this.snapshot.verification === 'verified' ? '' : '通道已加密；请通过独立可信渠道核对双方完整指纹。' });
    return binding;
  }
  async confirm(peerFingerprint: string) {
    const generation = this.generation;
    if (!this.snapshot.bindingReady || !this.isOpen() || this.ended) return;
    let provided: string;
    try { provided = normalizeFingerprint(peerFingerprint); } catch { this.rejectIdentity(); return; }
    try {
      const binding = await this.refreshBinding();
      if (!this.isCurrent(generation)) return;
      if (!binding || provided !== binding.remote) { this.rejectIdentity(); return; }
      this.update({ localConfirmed: true, verification: this.snapshot.remoteConfirmed ? 'verified' : 'local-confirmed', error: '', notice: this.snapshot.remoteConfirmed ? '' : '你的核对已完成，正在等待对方独立核对并确认。' });
      this.sendFrame({v:1,type:'verify',epoch:this.snapshot.epoch,role:this.snapshot.role!,local:binding.local,remote:binding.remote});
    } catch { if (this.isCurrent(generation)) this.fail('无法再次核验实际证书，已阻止身份验证。', true); }
  }
  private sendFrame(frame: Frame) {
    if (!this.channel || this.channel.readyState !== 'open' || !this.snapshot.bindingReady || this.channel.bufferedAmount > MAX_BUFFER) throw new Error('CHANNEL_NOT_READY');
    this.channel.send(JSON.stringify(frame));
  }
  sendText(body: string): Promise<void> {
    const generation = this.generation;
    const task = this.sendQueue.then(async () => {
      if (!this.isCurrent(generation)) return;
      if (!this.canChat()) { this.update({ error: '身份未完成双向验证或连接不可用，消息没有发送。' }); return; }
      if (!body.trim() || bytes(body) > MAX_TEXT_BYTES) { this.update({ error: '消息不能为空，且UTF-8长度不能超过4 KiB。' }); return; }
      if (this.snapshot.messages.length >= MAX_MESSAGES || this.sequence >= MAX_UINT64) { this.fail('已达到本次会话容量上限，请新建会话。'); return; }
      try {
        await this.refreshBinding();
        if (generation !== this.generation || !this.canChat()) return;
        if (this.channel!.bufferedAmount > MAX_BUFFER) { this.update({ error: '发送缓冲暂时繁忙，此消息未发送。请稍后再试。' }); return; }
        const frame: TextFrame = {v:1,type:'text',epoch:this.snapshot.epoch,role:this.snapshot.role!,seq:(++this.sequence).toString(),id:randomId(),body};
        this.sendFrame(frame);
        this.pending.set(frame.id, frame);
        this.update({ error: '', messages: [...this.snapshot.messages, {id:frame.id,direction:'out',body,time:Date.now(),state:'buffered'}] });
        this.timers.set(frame.id, setTimeout(() => {
          if (generation !== this.generation) return;
          this.timers.delete(frame.id);
          this.update({ messages: this.snapshot.messages.map(m => m.id === frame.id && m.state === 'buffered' ? {...m,state:'unknown'} : m) });
        }, ACK_MS));
      } catch { if (this.isCurrent(generation)) this.fail('发送前证书或连接核验失败，已停止聊天。', true); }
    });
    this.sendQueue = task.catch(() => {});
    return task;
  }
  private async onFrame(raw: unknown) {
    const generation = this.generation;
    if (!this.snapshot.role || this.ended) return;
    const now = Date.now();
    if (now - this.incomingWindow.start > 1000) this.incomingWindow = {start:now,count:0};
    if (++this.incomingWindow.count > 600) { this.fail('接收到异常高频数据，已停止会话。'); return; }
    let frame: Frame;
    try { frame = parseFrame(raw, this.snapshot.epoch, otherRole(this.snapshot.role)); } catch { this.rejectFrame(); return; }
    if (!this.snapshot.bindingReady || !this.isOpen()) { this.rejectFrame(); return; }
    // Recheck the actual certificate before any sensitive application effect.
    try { await this.refreshBinding(); } catch { if (this.isCurrent(generation)) this.fail('接收时实际证书核验失败，已停止聊天。', true); return; }
    if (!this.isCurrent(generation)) return;
    if (frame.type === 'verify') {
      if (frame.local !== this.snapshot.remoteFingerprint || frame.remote !== this.snapshot.localFingerprint) { this.fail('对方确认的证书与实际连接不一致，已撤销验证。', true); return; }
      this.lastPeerSeen = now;
      this.update({ remoteConfirmed: true, verification: this.snapshot.localConfirmed ? 'verified' : 'unverified', notice: this.snapshot.localConfirmed ? '' : '对方已确认；你仍需独立核对对方指纹。' });
      return;
    }
    if (frame.type === 'ping') { this.lastPeerSeen = now; this.sendFrame({...frame,type:'pong',role:this.snapshot.role}); return; }
    if (frame.type === 'pong') { if (this.pulses.delete(frame.id)) this.lastPeerSeen = now; else this.rejectFrame(); return; }
    if (!this.canChat()) { this.rejectFrame(); return; }
    this.lastPeerSeen = now;
    if (frame.type === 'text') {
      try {
        const result = this.receiveLedger.accept(frame);
        if (result === 'new') {
          if (this.snapshot.messages.length >= MAX_MESSAGES) { this.fail('会话消息容量已满，请新建会话。'); return; }
          this.update({ messages: [...this.snapshot.messages, {id:frame.id,direction:'in',body:frame.body,time:now,state:'delivered'}] });
        }
        this.sendFrame({v:1,type:'ack',epoch:frame.epoch,role:this.snapshot.role,id:frame.id,seq:frame.seq});
      } catch { this.rejectFrame(); }
    } else if (frame.type === 'ack') {
      const sent = this.pending.get(frame.id);
      if (!sent || !ackMatches(frame, sent)) { this.rejectFrame(); return; }
      clearTimeout(this.timers.get(frame.id)); this.timers.delete(frame.id); this.pending.delete(frame.id);
      this.update({ messages: this.snapshot.messages.map(m => m.id === frame.id ? {...m,state:'delivered'} : m) });
    }
  }
  private pause() {
    const generation = this.generation;
    if (this.ended || this.snapshot.connection === 'interrupted') return;
    this.timers.forEach(t => clearTimeout(t)); this.timers.clear();
    this.update({ connection: 'interrupted', bindingReady: false, verification: 'revoked', localConfirmed: false, remoteConfirmed: false, notice: '连接中断，已暂停发送。恢复后需要重新核对双方指纹。', messages: this.snapshot.messages.map(m => m.direction === 'out' && m.state === 'buffered' ? {...m,state:'unknown'} : m) });
    this.disconnectTimer = setTimeout(() => { if (this.isCurrent(generation)) this.fail('连接恢复超时，请创建新会话并重新核对身份。'); }, 15000);
  }
  private async tick() {
    const generation = this.generation;
    if (this.ended || this.tickBusy || !this.channel || this.channel.readyState !== 'open') return;
    this.tickBusy = true;
    try {
      if (!this.isOpen()) { this.pause(); return; }
      if (Date.now() - this.lastPeerSeen > PEER_TIMEOUT_MS) { this.fail('对端长时间没有响应，连接已中断。未确认消息的送达状态未知。'); return; }
      await this.refreshBinding();
      if (!this.isCurrent(generation)) return;
      if (Date.now() - this.lastPulse >= HEARTBEAT_MS) {
        this.lastPulse = Date.now();
        const id = randomId();
        this.pulses.add(id);
        if (this.pulses.size > 8) this.pulses.delete(this.pulses.values().next().value!);
        this.sendFrame({v:1,type:'ping',epoch:this.snapshot.epoch,role:this.snapshot.role!,id});
      }
    } catch { if (this.isCurrent(generation)) this.fail('实际加密传输或证书核验失败，已停止聊天。', true); }
    finally { if (generation === this.generation) this.tickBusy = false; }
  }
  async getEvidence(): Promise<Record<string, unknown>> {
    const pc = this.pc;
    if (!pc) return { connection: this.snapshot.connection, verification: this.snapshot.verification };
    const report = await pc.getStats();
    const summary = Array.from(report.values()).filter(s => ['transport','data-channel','certificate'].includes(s.type)).map(s => {
      const {type,dtlsState,dtlsCipher,tlsVersion,localCertificateId,remoteCertificateId,fingerprint,fingerprintAlgorithm,messagesSent,messagesReceived,state} = s;
      return {type,dtlsState,dtlsCipher,tlsVersion,localCertificateId,remoteCertificateId,fingerprint,fingerprintAlgorithm,messagesSent,messagesReceived,state};
    });
    return { bindingSource: this.bindingSource, localFingerprint: this.snapshot.localFingerprint, remoteFingerprint: this.snapshot.remoteFingerprint, localDescriptionFingerprintBound: !!this.expectedBinding, candidateType: this.snapshot.candidateType, stats: summary };
  }
}
