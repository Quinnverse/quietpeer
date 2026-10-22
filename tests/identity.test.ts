import { describe, it, expect } from 'vitest';
import { readIdentityBinding, certificateFingerprint } from '../src/core/identity';
const localDer = new Uint8Array([1,2,3,4]), remoteDer = new Uint8Array([5,6,7,8]);
async function fp(der: Uint8Array) { const hash = await crypto.subtle.digest('SHA-256',der as Uint8Array<ArrayBuffer>);return Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0').toUpperCase()).join(':'); }
async function fixture() {
 const local=await fp(localDer),remote=await fp(remoteDer);
 const certificate={getFingerprints:()=>[{algorithm:'sha-256',value:local}]} as unknown as RTCCertificate;
 const sdp=(value:string)=>`v=0\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\na=fingerprint:sha-256 ${value}\r\n`;
 const stats=new Map<string,any>([['t',{id:'t',type:'transport',dtlsState:'connected',localCertificateId:'l',remoteCertificateId:'r',dtlsCipher:'TLS_TEST',selectedCandidatePairId:'p'}],['l',{id:'l',type:'certificate',fingerprint:local,fingerprintAlgorithm:'sha-256',base64Certificate:Buffer.from(localDer).toString('base64')}],['r',{id:'r',type:'certificate',fingerprint:remote,fingerprintAlgorithm:'sha-256',base64Certificate:Buffer.from(remoteDer).toString('base64')}],['p',{id:'p',type:'candidate-pair',localCandidateId:'c'}],['c',{id:'c',type:'local-candidate',candidateType:'host'}]]);
 const transport={state:'connected',getRemoteCertificates:()=>[remoteDer.buffer]};
 const pc={connectionState:'connected',sctp:{transport},getConfiguration:()=>({certificates:[certificate]}),getStats:async()=>stats,localDescription:{sdp:sdp(local)},remoteDescription:{sdp:sdp(remote)}};
 return {local,remote,certificate,stats,transport,pc};
}
describe('actual certificate binding logic (unit fixtures, not WebRTC E2E)',()=>{
 it('cross-checks DER hashes, referenced stats, SDP and local certificate',async()=>{const f=await fixture();const b=await readIdentityBinding(f.pc as any,f.certificate);expect(b.local).toBe(f.local);expect(b.remote).toBe(f.remote);expect(b.source).toBe('dtls-der-and-stats');});
 it('uses standard transport-referenced DER stats if remote API returns none',async()=>{const f=await fixture();f.transport.getRemoteCertificates=()=>[];expect((await readIdentityBinding(f.pc as any,f.certificate)).source).toBe('transport-certificate-stats');});
 it('rejects disconnected DTLS',async()=>{const f=await fixture();f.transport.state='connecting';await expect(readIdentityBinding(f.pc as any,f.certificate)).rejects.toThrow();});
 it('rejects replaced local certificate handle',async()=>{const f=await fixture();f.pc.getConfiguration=()=>({certificates:[{} as RTCCertificate]});await expect(readIdentityBinding(f.pc as any,f.certificate)).rejects.toThrow();});
 it('rejects missing actual certificate reference',async()=>{const f=await fixture();f.stats.delete('r');await expect(readIdentityBinding(f.pc as any,f.certificate)).rejects.toThrow();});
 it('rejects remote SDP substitution',async()=>{const f=await fixture();f.pc.remoteDescription.sdp=f.pc.localDescription.sdp;await expect(readIdentityBinding(f.pc as any,f.certificate)).rejects.toThrow();});
 it('rejects actual DER/stat mismatch',async()=>{const f=await fixture();f.transport.getRemoteCertificates=()=>[localDer.buffer];await expect(readIdentityBinding(f.pc as any,f.certificate)).rejects.toThrow();});
 it('rejects local DER/stat mismatch',async()=>{const f=await fixture();f.stats.get('l').base64Certificate=Buffer.from(remoteDer).toString('base64');await expect(readIdentityBinding(f.pc as any,f.certificate)).rejects.toThrow();});
 it('rejects unsupported hash algorithms',async()=>{const f=await fixture();f.stats.get('r').fingerprintAlgorithm='sha-1';await expect(readIdentityBinding(f.pc as any,f.certificate)).rejects.toThrow();});
 it('never trusts a missing getFingerprints implementation',()=>expect(()=>certificateFingerprint({} as RTCCertificate)).toThrow());
});
