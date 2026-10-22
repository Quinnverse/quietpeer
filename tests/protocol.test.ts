import { describe, it, expect } from 'vitest';
import { ackMatches, bytes, MAX_UINT64, normalizeFingerprint, parseFrame, ReceiveLedger, type TextFrame } from '../src/core/protocol';
import { applicationFingerprint } from '../src/core/identity';
const epoch = 'a'.repeat(32);
const fingerprint = Array(32).fill('AB').join(':');
const text = (): TextFrame => ({v:1,type:'text',epoch,role:'b',seq:'1',id:'b'.repeat(32),body:'你好'});
const parse = (f: unknown) => parseFrame(JSON.stringify(f), epoch, 'b');
describe('strict envelope', () => {
 it('accepts valid text',()=>expect(parse(text())).toEqual(text()));
 it('rejects malformed JSON and binary',()=>{expect(()=>parseFrame('{',epoch,'b')).toThrow();expect(()=>parseFrame(new ArrayBuffer(1),epoch,'b')).toThrow();});
 it('rejects foreign epoch',()=>expect(()=>parse({...text(),epoch:'c'.repeat(32)})).toThrow());
 it('rejects spoofed sender role',()=>expect(()=>parse({...text(),role:'a'})).toThrow());
 it('rejects extra fields',()=>expect(()=>parse({...text(),admin:true})).toThrow());
 it('rejects unknown types',()=>expect(()=>parse({...text(),type:'identity-success'})).toThrow());
 it('rejects unsafe numeric sequence',()=>expect(()=>parse({...text(),seq:1})).toThrow());
 it('rejects zero and noncanonical sequences',()=>{for(const seq of ['0','01','-1','1e2',' 1'])expect(()=>parse({...text(),seq})).toThrow();});
 it('bounds uint64',()=>{expect(parse({...text(),seq:MAX_UINT64.toString()})).toBeTruthy();expect(()=>parse({...text(),seq:(MAX_UINT64+1n).toString()})).toThrow();});
 it('measures UTF8 not characters',()=>{expect(bytes('你')).toBe(3);expect(()=>parse({...text(),body:'你'.repeat(1400)})).toThrow();});
 it('rejects large frames',()=>expect(()=>parseFrame(' '.repeat(8193),epoch,'b')).toThrow());
 it('rejects blank text',()=>expect(()=>parse({...text(),body:'  '})).toThrow());
 it('bounds pulse IDs',()=>expect(()=>parse({v:1,type:'ping',epoch,role:'b',id:'x'})).toThrow());
 it('strict verification metadata',()=>{expect(parse({v:1,type:'verify',epoch,role:'b',local:fingerprint,remote:fingerprint})).toBeTruthy();expect(()=>parse({v:1,type:'verify',epoch,role:'b',local:'AB',remote:fingerprint})).toThrow();});
});
describe('receive ledger',()=>{
 it('deduplicates without reapplying',()=>{const l=new ReceiveLedger();expect(l.accept(text())).toBe('new');expect(l.accept(text())).toBe('duplicate');expect(l.count).toBe(1);});
 it('rejects same ID with altered body',()=>{const l=new ReceiveLedger();l.accept(text());expect(()=>l.accept({...text(),body:'changed'})).toThrow();});
 it('rejects old sequences for unseen IDs',()=>{const l=new ReceiveLedger();l.accept({...text(),seq:'2'});expect(()=>l.accept({...text(),id:'c'.repeat(32)})).toThrow();});
 it('supports independent directional ledgers',()=>{const a=new ReceiveLedger(),b=new ReceiveLedger();expect(a.accept(text())).toBe('new');expect(b.accept({...text(),role:'a'})).toBe('new');});
 it('clears only when a session ends',()=>{const l=new ReceiveLedger();l.accept(text());l.clear();expect(l.count).toBe(0);});
});
describe('ACK and fingerprints',()=>{
 it('ACK matches exact direction epoch ID and sequence',()=>{const sent={...text(),role:'a' as const};const ack={v:1 as const,type:'ack' as const,epoch,role:'b' as const,id:sent.id,seq:sent.seq};expect(ackMatches(ack,sent)).toBe(true);for(const f of [{...ack,role:'a' as const},{...ack,epoch:'d'.repeat(32)},{...ack,id:'c'.repeat(32)},{...ack,seq:'2'}])expect(ackMatches(f,sent)).toBe(false);});
 it('normalizes full SHA256 and rejects short codes',()=>{expect(normalizeFingerprint('ab'.repeat(32))).toBe(fingerprint);expect(()=>normalizeFingerprint('123456')).toThrow();});
 it('extracts the sole application fingerprint',()=>expect(applicationFingerprint(`v=0\r\na=fingerprint:sha-256 ${fingerprint}\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\n`)).toBe(fingerprint));
 it('rejects multiple transports, missing or ambiguous SHA256',()=>{for(const sdp of ['v=0',`v=0\nm=audio 9 UDP/TLS/RTP/SAVPF 0\na=fingerprint:sha-256 ${fingerprint}`,`v=0\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\na=fingerprint:sha-256 ${fingerprint}\na=fingerprint:sha-256 ${fingerprint}`])expect(()=>applicationFingerprint(sdp)).toThrow();});
});
