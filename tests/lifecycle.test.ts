import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ChatClient } from '../src/core/client';
import { initialSnapshot } from '../src/core/types';
const fingerprint=Array(32).fill('AB').join(':');
function deferred<T>() {let resolve!:(v:T)=>void,reject!:(e:Error)=>void;const promise=new Promise<T>((r,j)=>{resolve=r;reject=j;});return{promise,resolve,reject};}
function prepared(){const client=new ChatClient() as any;client.ended=false;client.snapshot={...initialSnapshot(),connection:'connected',verification:'verified',bindingReady:true,localConfirmed:true,remoteConfirmed:true,role:'a',epoch:'a'.repeat(32),localFingerprint:fingerprint,remoteFingerprint:fingerprint};client.isOpen=()=>true;client.canChat=()=>true;client.channel={readyState:'open',close:()=>{},send:()=>{},bufferedAmount:0};return client;}
function reopen(client:any){client.reset();client.ended=false;client.snapshot={...initialSnapshot(),connection:'waiting',roomId:'new-room'};}
beforeEach(()=>vi.stubGlobal('window',{}));
afterEach(()=>vi.unstubAllGlobals());
describe('session cancellation regression (unit fixtures)',()=>{
 it('old confirm failure cannot close a newer session',async()=>{const c=prepared(),d=deferred<any>();c.refreshBinding=()=>d.promise;const old=c.confirm(fingerprint);reopen(c);d.reject(new Error('SESSION_ENDED'));await old;expect(c.getSnapshot().connection).toBe('waiting');expect(c.getSnapshot().error).toBe('');});
 it('old send failure cannot close a newer session',async()=>{const c=prepared(),d=deferred<any>();c.refreshBinding=()=>d.promise;const old=c.sendText('unit-only');await Promise.resolve();reopen(c);d.reject(new Error('SESSION_ENDED'));await old;expect(c.getSnapshot().connection).toBe('waiting');expect(c.getSnapshot().error).toBe('');});
 it('queued old send does not write errors into new session',async()=>{const c=prepared(),d=deferred<void>();c.sendQueue=d.promise;const old=c.sendText('unit-only');reopen(c);d.resolve();await old;expect(c.getSnapshot().error).toBe('');});
 it('old heartbeat failure cannot close a newer session',async()=>{const c=prepared(),d=deferred<any>();c.lastPeerSeen=Date.now();c.refreshBinding=()=>d.promise;const old=c.tick();reopen(c);d.reject(new Error('SESSION_ENDED'));await old;expect(c.getSnapshot().connection).toBe('waiting');expect(c.tickBusy).toBe(false);});
 it('old inbound certificate failure cannot close new session',async()=>{const c=prepared(),d=deferred<any>();c.refreshBinding=()=>d.promise;const old=c.onFrame(JSON.stringify({v:1,type:'ping',epoch:c.snapshot.epoch,role:'b',id:'b'.repeat(32)}));reopen(c);d.reject(new Error('SESSION_ENDED'));await old;expect(c.getSnapshot().connection).toBe('waiting');});
});
