export type Role = 'a' | 'b';
export type ConnectionState = 'idle' | 'creating' | 'waiting' | 'connecting' | 'connected' | 'interrupted' | 'failed' | 'closed';
export type VerificationState = 'unverified' | 'local-confirmed' | 'verified' | 'mismatch' | 'revoked';
export type DeliveryState = 'buffered' | 'delivered' | 'unknown' | 'failed';
export interface Message { id: string; direction: 'out' | 'in'; body: string; time: number; state: DeliveryState }
export interface Snapshot {
  connection: ConnectionState; verification: VerificationState; role: Role | null;
  invite: string; roomId: string; epoch: string;
  localFingerprint: string; remoteFingerprint: string;
  localConfirmed: boolean; remoteConfirmed: boolean; bindingReady: boolean;
  dtlsState: string; cipher: string; tlsVersion: string; candidateType: string;
  error: string; notice: string; messages: Message[]; rejectedCount: number;
}
export const initialSnapshot = (): Snapshot => ({
  connection: 'idle', verification: 'unverified', role: null, invite: '', roomId: '', epoch: '',
  localFingerprint: '', remoteFingerprint: '', localConfirmed: false, remoteConfirmed: false,
  bindingReady: false, dtlsState: 'new', cipher: '', tlsVersion: '', candidateType: '',
  error: '', notice: '', messages: [], rejectedCount: 0,
});
