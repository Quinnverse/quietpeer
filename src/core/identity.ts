import { normalizeFingerprint } from './protocol';

export interface IdentityBinding {
  local: string; remote: string; dtlsState: string; cipher: string; tlsVersion: string; candidateType: string;
  source: 'dtls-der-and-stats' | 'transport-certificate-stats';
}
interface Stat { id: string; type: string; [key: string]: unknown }

export function applicationFingerprint(sdp?: string): string {
  if (!sdp) throw new Error('MISSING_SDP');
  const sections = sdp.replace(/\r/g, '').split(/\nm=/);
  const session = sections[0];
  const media = sections.slice(1);
  if (media.length !== 1 || !media[0].startsWith('application ') || /^application 0 /m.test(media[0])) throw new Error('UNEXPECTED_TRANSPORT');
  const extract = (text: string) => [...text.matchAll(/^a=fingerprint:sha-256\s+([^\n]+)$/gmi)].map(m => normalizeFingerprint(m[1]));
  const inMedia = extract(media[0]);
  const values = inMedia.length ? inMedia : extract(session);
  if (values.length !== 1) throw new Error('AMBIGUOUS_FINGERPRINT');
  return values[0];
}

export function certificateFingerprint(certificate: RTCCertificate): string {
  if (typeof certificate.getFingerprints !== 'function') throw new Error('CERTIFICATE_API_UNSUPPORTED');
  const sha = certificate.getFingerprints().filter(f => f.algorithm?.toLowerCase() === 'sha-256');
  if (sha.length !== 1 || typeof sha[0].value !== 'string') throw new Error('CERTIFICATE_API_UNSUPPORTED');
  return normalizeFingerprint(sha[0].value);
}

async function digest(der: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', der);
  return normalizeFingerprint(Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join(''));
}
function derFromStat(cert: Stat): ArrayBuffer {
  if (typeof cert.base64Certificate !== 'string' || !cert.base64Certificate || cert.base64Certificate.length > 16384) throw new Error('CERTIFICATE_STATS_UNAVAILABLE');
  return Uint8Array.from(atob(cert.base64Certificate), ch => ch.charCodeAt(0)).buffer;
}

export async function readIdentityBinding(pc: RTCPeerConnection, cert: RTCCertificate): Promise<IdentityBinding> {
  const transport = pc.sctp?.transport;
  if (!transport || transport.state !== 'connected' || pc.connectionState !== 'connected') throw new Error('TRANSPORT_NOT_CONNECTED');
  if (pc.getConfiguration().certificates?.[0] !== cert) throw new Error('LOCAL_CERTIFICATE_CHANGED');
  const report = await pc.getStats();
  const records = Array.from(report.values()) as Stat[];
  const transports = records.filter(s => s.type === 'transport' && s.dtlsState === 'connected');
  if (transports.length !== 1) throw new Error('TRANSPORT_STATS_UNAVAILABLE');
  const t = transports[0];
  const localCert = report.get(String(t.localCertificateId)) as Stat | undefined;
  const remoteCert = report.get(String(t.remoteCertificateId)) as Stat | undefined;
  if (!localCert || !remoteCert || localCert.type !== 'certificate' || remoteCert.type !== 'certificate' || localCert.fingerprintAlgorithm !== 'sha-256' || remoteCert.fingerprintAlgorithm !== 'sha-256') throw new Error('CERTIFICATE_STATS_UNAVAILABLE');
  const local = certificateFingerprint(cert);
  const remoteStats = normalizeFingerprint(String(remoteCert.fingerprint));
  if (local !== applicationFingerprint(pc.localDescription?.sdp) || local !== normalizeFingerprint(String(localCert.fingerprint))) throw new Error('LOCAL_BINDING_MISMATCH');
  let remote: string;
  let source: IdentityBinding['source'];
  const actual = typeof transport.getRemoteCertificates === 'function' ? transport.getRemoteCertificates() : [];
  if (actual.length) {
    remote = await digest(actual[0]);
    source = 'dtls-der-and-stats';
  } else {
    // Standard transport stats reference the certificate actually used, not a signaling claim.
    remote = await digest(derFromStat(remoteCert));
    source = 'transport-certificate-stats';
  }
  if (remote !== remoteStats || remote !== applicationFingerprint(pc.remoteDescription?.sdp)) throw new Error('REMOTE_BINDING_MISMATCH');
  if (await digest(derFromStat(localCert)) !== local || await digest(derFromStat(remoteCert)) !== remote) throw new Error('CERTIFICATE_DIGEST_MISMATCH');
  const pair = report.get(String(t.selectedCandidatePairId)) as Stat | undefined;
  const candidate = pair && report.get(String(pair.localCandidateId)) as Stat | undefined;
  return { local, remote, dtlsState: String(t.dtlsState), cipher: String(t.dtlsCipher || '浏览器未公开'), tlsVersion: String(t.tlsVersion || '浏览器未公开'), candidateType: String(candidate?.candidateType || 'unknown'), source };
}
