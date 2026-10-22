import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
const evidenceDir = path.resolve(process.env.EVIDENCE_DIR || '../.work/evidence');

async function instrumentation(context: BrowserContext) {
  await context.addInitScript(() => {
    const w = window as any;
    w.__pcs = []; w.__channels = []; w.__signalFrames = []; w.__textFrames = []; w.__dropAcks = false;
    const NativePC = window.RTCPeerConnection;
    window.RTCPeerConnection = new Proxy(NativePC, {construct(Target,args) {
      const pc = Reflect.construct(Target,args);
      w.__pcs.push(pc);
      pc.addEventListener('datachannel',(e: RTCDataChannelEvent)=>w.__channels.push(e.channel));
      const create = pc.createDataChannel.bind(pc);
      pc.createDataChannel = (...params: any[]) => { const dc = create(...params); w.__channels.push(dc); return dc; };
      return pc;
    }});
    const dcSend = RTCDataChannel.prototype.send;
    RTCDataChannel.prototype.send = function(this: RTCDataChannel, data: any) {
      if (typeof data === 'string') {
        try { const f = JSON.parse(data); if (f.type === 'text') w.__textFrames.push(f); if (f.type === 'ack' && w.__dropAcks) return; } catch {}
      }
      return dcSend.call(this,data);
    } as any;
    const wsSend = WebSocket.prototype.send;
    WebSocket.prototype.send = function(data: any) {
      if (typeof data === 'string') w.__signalFrames.push(JSON.parse(data));
      return wsSend.call(this,data);
    };
  });
}
async function pair(browser: Browser, baseURL: string) {
  const contexts = await Promise.all([browser.newContext({viewport:{width:1440,height:1040}}),browser.newContext({viewport:{width:1440,height:1040}})]);
  await Promise.all(contexts.map(instrumentation));
  const [a,b] = await Promise.all(contexts.map(c=>c.newPage()));
  await Promise.all([a.goto(baseURL),b.goto(baseURL)]);
  await a.getByRole('button',{name:'创建房间',exact:true}).click();
  await expect(a.getByTestId('connection-state')).toContainText('等待');
  const invite = await a.getByTestId('invite-link').inputValue();
  await b.getByRole('textbox',{name:'邀请信息',exact:true}).fill(invite);
  await b.getByRole('button',{name:'加入房间',exact:true}).click();
  await Promise.all([expect(a.getByTestId('remote-fingerprint')).toHaveValue(/^(?:[A-F0-9]{2}:){31}[A-F0-9]{2}$/),expect(b.getByTestId('remote-fingerprint')).toHaveValue(/^(?:[A-F0-9]{2}:){31}[A-F0-9]{2}$/)]);
  await Promise.all([expect(a.getByTestId('connection-state')).toContainText('已连接'),expect(b.getByTestId('connection-state')).toContainText('已连接')]);
  const aLocal=(await a.getByTestId('local-fingerprint').inputValue()).trim(),bLocal=(await b.getByTestId('local-fingerprint').inputValue()).trim();
  expect(aLocal).toBe((await b.getByTestId('remote-fingerprint').inputValue()).trim());
  expect(bLocal).toBe((await a.getByTestId('remote-fingerprint').inputValue()).trim());
  expect(aLocal.split(':')).toHaveLength(32);
  const close=()=>Promise.all(contexts.map(c=>c.close()));
  return {a,b,aLocal,bLocal,contexts,close};
}
async function verify(p: Awaited<ReturnType<typeof pair>>) {
  await p.a.getByRole('textbox',{name:'对方带外指纹',exact:true}).fill(p.bLocal);
  await p.a.getByRole('button',{name:'确认指纹一致',exact:true}).click();
  await expect(p.a.getByTestId('message-input')).toBeDisabled();
  await p.b.getByRole('textbox',{name:'对方带外指纹',exact:true}).fill(p.aLocal);
  await p.b.getByRole('button',{name:'确认指纹一致',exact:true}).click();
  await Promise.all([expect(p.a.getByTestId('verification-state')).toContainText('已验证'),expect(p.b.getByTestId('verification-state')).toContainText('已验证')]);
  await expect(p.a.getByTestId('message-input')).toBeEnabled();
}
async function send(page:Page,body:string) {
  await page.getByTestId('message-input').fill(body);
  await page.getByTestId('send-button').click();
}
async function shot(page:Page,name:string) {
  await mkdir(evidenceDir,{recursive:true});
  // Redact the invitation capability; only synthetic test messages are photographed.
  await page.screenshot({path:path.join(evidenceDir,`${name}.png`),fullPage:true,mask:[page.getByTestId('invite-link')]});
}

test('真实双端完整流程 / 实际证书与DTLS / 双向ACK / 信令无正文 / 结束',async({browser,baseURL})=>{
 const p=await pair(browser,baseURL!);
 try {
  await expect(p.a.getByTestId('message-input')).toBeDisabled();
  await shot(p.a,'01-connected-a'); await shot(p.b,'02-connected-b');
  const evidence=await Promise.all([p.a,p.b].map(page=>page.evaluate(()=> (window as any).__quietpeerTest.getEvidence())));
  for(const e of evidence){expect(e.bindingSource).toMatch(/dtls-der-and-stats|transport-certificate-stats/);expect(e.stats.some((s:any)=>s.type==='transport'&&s.dtlsState==='connected')).toBeTruthy();}
  await verify(p); await shot(p.a,'03-fingerprint-verified');
  await send(p.a,'你好，连接已核对。这里只是验收测试消息。');
  await expect(p.b.getByTestId('message-list')).toContainText('你好，连接已核对。');
  await expect(p.a.getByTestId('message-list')).toContainText('已送达');
  await send(p.b,'收到。消息直接在我们两个浏览器之间传输。');
  await expect(p.a.getByTestId('message-list')).toContainText('收到。消息直接');
  await expect(p.b.getByTestId('message-list')).toContainText('已送达');
  await shot(p.a,'04-chat-a'); await shot(p.b,'05-chat-b');
  const signal=await Promise.all([p.a,p.b].map(page=>page.evaluate(()=> (window as any).__signalFrames.map((f:any)=>({type:f.type,keys:Object.keys(f),raw:JSON.stringify(f)})))));
  for(const list of signal){for(const f of list){expect(['create','join','peer-ready','offer','answer','leave']).toContain(f.type);expect(f.raw).not.toContain('你好，连接已核对');expect(f.raw).not.toContain('收到。消息直接');expect(f.keys).not.toContain('body');}}
  await mkdir(evidenceDir,{recursive:true});
  await writeFile(path.join(evidenceDir,'dtls-evidence.json'),JSON.stringify({contexts:2,actualNetwork:'host WebRTC over loopback/LAN candidates; not mocked',evidence,signalTypes:signal.map(list=>list.map((f:any)=>f.type)),verification:'automation copies full fingerprints across isolated contexts; not human OOB attestation'},null,2));
  await p.a.getByRole('button',{name:'结束会话',exact:true}).click();
  await expect(p.b.getByTestId('connection-state')).toContainText('已结束');
  await expect(p.b.getByTestId('message-input')).toBeDisabled();
  await shot(p.b,'06-disconnected');
 }finally{await p.close();}
});

test('带外指纹不一致必须终止且阻止正文',async({browser,baseURL})=>{
 const p=await pair(browser,baseURL!);try{
 await p.a.getByRole('textbox',{name:'对方带外指纹',exact:true}).fill(Array(32).fill('00').join(':'));
 await expect(p.a.getByRole('button',{name:'确认指纹一致',exact:true})).toBeDisabled();
 await p.a.getByRole('button',{name:'指纹不一致',exact:true}).click();
 await expect(p.a.getByTestId('verification-state')).toContainText('失败');
 await expect(p.a.getByTestId('message-input')).toBeDisabled();
 await shot(p.a,'07-identity-failure');
 }finally{await p.close();}
});

test('验证前提前到达正文不会缓存或在验证后补展示',async({browser,baseURL})=>{
 const p=await pair(browser,baseURL!);try{
 await p.a.evaluate(()=>{const w=window as any;const s=w.__quietpeerTest.getSnapshot();w.__channels[0].send(JSON.stringify({v:1,type:'text',epoch:s.epoch,role:s.role,seq:'1',id:'1'.repeat(32),body:'PREVERIFY_SHOULD_DROP'}));});
 await expect.poll(()=>p.b.evaluate(()=>(window as any).__quietpeerTest.getSnapshot().rejectedCount)).toBeGreaterThan(0);
 await verify(p);await expect(p.b.getByTestId('message-list')).not.toContainText('PREVERIFY_SHOULD_DROP');
 }finally{await p.close();}
});

test('应用层重复、旧epoch、错角色、超大和畸形帧安全拒绝',async({browser,baseURL})=>{
 const p=await pair(browser,baseURL!);try{
 await verify(p);await send(p.a,'DEDUP_SYNTHETIC');await expect(p.b.getByTestId('message-list')).toContainText('DEDUP_SYNTHETIC');
 await p.a.evaluate(()=>{const w=window as any,f=w.__textFrames[0],dc=w.__channels[0];dc.send(JSON.stringify(f));dc.send(JSON.stringify({...f,id:'2'.repeat(32),epoch:'0'.repeat(32)}));dc.send(JSON.stringify({...f,id:'3'.repeat(32),role:'b'}));dc.send(JSON.stringify({...f,id:'4'.repeat(32),seq:'2',body:'X'.repeat(5000)}));dc.send('{');dc.send('X'.repeat(9000));dc.send(JSON.stringify({...f,id:'5'.repeat(32),seq:'01'}));});
 await expect.poll(()=>p.b.evaluate(()=>(window as any).__quietpeerTest.getSnapshot().rejectedCount)).toBeGreaterThanOrEqual(6);
 expect(await p.b.getByTestId('message-list').getByText('DEDUP_SYNTHETIC',{exact:true}).count()).toBe(1);
 await expect(p.b.getByTestId('verification-state')).toContainText('已验证');
 }finally{await p.close();}
});

test('ACK丢失为送达未知；伪ACK不能提升成功状态',async({browser,baseURL})=>{
 const p=await pair(browser,baseURL!);try{
 await verify(p);await p.b.evaluate(()=>(window as any).__dropAcks=true);await send(p.a,'ACK_LOSS_SYNTHETIC');await expect(p.b.getByTestId('message-list')).toContainText('ACK_LOSS_SYNTHETIC');
 await p.b.evaluate(()=>{const w=window as any,s=w.__quietpeerTest.getSnapshot();w.__channels[0].send(JSON.stringify({v:1,type:'ack',epoch:s.epoch,role:s.role,id:'0'.repeat(32),seq:'1'}));});
 await expect(p.a.getByTestId('message-list')).toContainText('送达未知');await expect(p.a.getByTestId('message-list')).not.toContainText('已送达');
 }finally{await p.close();}
});

test('双方并发各100条实际消息，独立方向顺序与一次交付',async({browser,baseURL})=>{
 const p=await pair(browser,baseURL!);try{
 await verify(p);
 await Promise.all([p.a.evaluate(async()=>{for(let i=0;i<100;i++)await(window as any).__quietpeerTest.sendText(`A-${i.toString().padStart(3,'0')}`);}),p.b.evaluate(async()=>{for(let i=0;i<100;i++)await(window as any).__quietpeerTest.sendText(`B-${i.toString().padStart(3,'0')}`);})]);
 for(const page of[p.a,p.b])await expect.poll(()=>page.evaluate(()=>(window as any).__quietpeerTest.getSnapshot().messages.filter((m:any)=>m.direction==='in').length)).toBe(100);
 const messages=await Promise.all([p.a,p.b].map(page=>page.evaluate(()=>(window as any).__quietpeerTest.getSnapshot().messages)));
 expect(messages[0].filter((m:any)=>m.direction==='in').map((m:any)=>m.body)).toEqual(Array.from({length:100},(_,i)=>`B-${i.toString().padStart(3,'0')}`));
 expect(messages[1].filter((m:any)=>m.direction==='in').map((m:any)=>m.body)).toEqual(Array.from({length:100},(_,i)=>`A-${i.toString().padStart(3,'0')}`));
 await expect.poll(()=>p.a.evaluate(()=>(window as any).__quietpeerTest.getSnapshot().messages.filter((m:any)=>m.direction==='out'&&m.state==='delivered').length)).toBe(100);
 }finally{await p.close();}
});

test('XSS纯文本、客户端日志不含正文、本地存储无聊天',async({browser,baseURL})=>{
 const p=await pair(browser,baseURL!);const logs:string[]=[];[p.a,p.b].forEach(page=>page.on('console',msg=>logs.push(msg.text())));try{
 await verify(p);const body='<img src=x onerror="window.__xss=1"><script>window.__xss=2</script> XSS_TEST_ONLY';await send(p.a,body);await expect(p.b.getByTestId('message-list')).toContainText(body);
 expect(await p.b.evaluate(()=>(window as any).__xss)).toBeUndefined();expect(await p.b.getByTestId('message-list').locator('img,script').count()).toBe(0);
 for(const page of[p.a,p.b]){const storage=await page.evaluate(async()=>({local:Object.keys(localStorage),session:Object.keys(sessionStorage),db:await indexedDB.databases(),cache:await caches.keys()}));expect(storage).toEqual({local:[],session:[],db:[],cache:[]});}
 expect(logs.join('\n')).not.toContain('XSS_TEST_ONLY');
 }finally{await p.close();}
});

test('实际证书读取绑定失配时撤销验证（API故障注入）',async({browser,baseURL})=>{
 const p=await pair(browser,baseURL!);try{
 await verify(p);await p.a.evaluate(()=>{const t=(window as any).__pcs[0].sctp.transport;t.getRemoteCertificates=()=>[new Uint8Array([0,1,2,3]).buffer];});
 await expect(p.a.getByTestId('verification-state')).toContainText('失败');await expect(p.a.getByTestId('message-input')).toBeDisabled();await shot(p.a,'08-binding-failure');
 }finally{await p.close();}
});

test('对端浏览器关闭触发断线而非仍显示可发送',async({browser,baseURL})=>{
 const p=await pair(browser,baseURL!);try{
 await verify(p);await p.contexts[1].close();await expect(p.a.getByTestId('message-input')).toBeDisabled({timeout:25000});await expect(p.a.getByTestId('connection-state')).toContainText(/中断|失败|结束/);await shot(p.a,'09-peer-disconnected');
 }finally{await p.contexts[0].close();}
});

test('刷新清除历史，新会话新证书，错误邀请可见',async({browser,baseURL})=>{
 const p=await pair(browser,baseURL!);try{
 await verify(p);await send(p.a,'REFRESH_EPHEMERAL');await p.a.reload();await expect(p.a.getByTestId('message-list')).not.toContainText('REFRESH_EPHEMERAL');await expect(p.a.getByTestId('message-input')).toBeDisabled();
 await p.a.getByRole('button',{name:'创建房间',exact:true}).click();await expect(p.a.getByTestId('connection-state')).toContainText('等待');expect((await p.a.getByTestId('local-fingerprint').inputValue()).trim()).not.toBe(p.aLocal);
 }finally{await p.close();}
 const page=await browser.newPage();try{await page.goto(baseURL!);await page.getByRole('textbox',{name:'邀请信息',exact:true}).fill('bad-invitation');await page.getByRole('button',{name:'加入房间',exact:true}).click();await expect(page.getByRole('alert')).toContainText('邀请格式');await shot(page,'10-invalid-invite');}finally{await page.close();}
});

test('移动端布局不横向溢出',async({browser,baseURL})=>{
 const page=await browser.newPage({viewport:{width:390,height:844}});try{await page.goto(baseURL!);await expect(page.getByRole('button',{name:'创建房间',exact:true})).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBeTruthy();await shot(page,'11-mobile');}finally{await page.close();}
});
