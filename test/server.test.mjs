import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createApp} from '../server.mjs';

async function setup(t, options) {
  const app = createApp(options), server = http.createServer(app.handler);
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(() => { app.close(); server.closeAllConnections(); server.close(); });
  async function post(path,data,token,headers={}) {
    const r = await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',...(token ? {Authorization:'Bearer '+token}:{}),...headers},body:JSON.stringify(data)});
    return {status:r.status,body:await r.json()};
  }
  const create = async name => (await post('/api/rooms',{name})).body;
  const join = async (code,name) => (await post(`/api/rooms/${code}/join`,{name})).body;
  const action = (m,data) => post(`/api/rooms/${m.code}/action`,data,m.token);
  async function stream(m) {
    const controller = new AbortController(); t.after(()=>controller.abort());
    const res = await fetch(`${base}/api/rooms/${m.code}/events?token=${m.token}`,{signal:controller.signal});
    assert.equal(res.status,200);
    const reader = res.body.getReader(), decoder = new TextDecoder(); let buffer='';
    return async function next(type) {
      const timeout = AbortSignal.timeout(3000);
      while (true) {
        let end;
        while ((end=buffer.indexOf('\n\n')) !== -1) {
          const chunk = buffer.slice(0,end); buffer=buffer.slice(end+2);
          if (chunk.startsWith(`event: ${type}\n`)) return JSON.parse(chunk.split('\ndata: ')[1]);
        }
        const result = await Promise.race([reader.read(),new Promise((_,reject)=>timeout.addEventListener('abort',()=>reject(new Error('SSE timed out')),{once:true}))]);
        if (result.done) throw new Error('SSE closed'); buffer+=decoder.decode(result.value,{stream:true});
      }
    };
  }
  return {base,post,create,join,action,stream};
}
test('room creation, membership, authorization, sender arbitration and cleanup',async t=>{
  const a=await setup(t), host=await a.create('Mac'), guest=await a.join(host.code,'Phone');
  assert.match(host.code,/^[A-F0-9]{6}$/); assert.notEqual(host.token,guest.token);
  assert.equal((await a.post(`/api/rooms/${host.code}/action`,{type:'start'})).status,401);
  assert.equal((await a.action(host,{type:'start'})).status,200);
  assert.equal((await a.action(guest,{type:'start'})).status,409);
  assert.equal((await a.action(guest,{type:'stop'})).status,403);
  assert.equal((await a.action(host,{type:'stop'})).status,200);
  assert.equal((await a.action(guest,{type:'start'})).status,200);
  await a.action(guest,{type:'leave'});
  assert.equal((await a.action(host,{type:'start'})).status,200);
  await a.action(host,{type:'leave'});
  assert.equal((await a.post(`/api/rooms/${host.code}/join`,{name:'Late'})).status,404);
});
test('live membership and directed WebRTC signaling are delivered through SSE',async t=>{
  const a=await setup(t), sender=await a.create('Sender');
  const senderEvents=await a.stream(sender);
  assert.equal((await senderEvents('state')).members.length,1);
  const receiver=await a.join(sender.code,'Receiver'), receiverEvents=await a.stream(receiver);
  await receiverEvents('state');
  await a.action(receiver,{type:'listen',enabled:true});
  const state=await receiverEvents('state'); assert.equal(state.members.find(m=>m.id===receiver.id).listening,true);
  await a.action(sender,{type:'start'});
  const signal={type:'offer',sdp:{type:'offer',sdp:'test-sdp'}};
  assert.equal((await a.action(sender,{type:'signal',to:receiver.id,signal})).status,200);
  const message=await receiverEvents('signal'); assert.equal(message.from,sender.id); assert.deepEqual(message.signal,signal);
  const other=await a.join(sender.code,'Other');
  assert.equal((await a.action(other,{type:'signal',to:receiver.id,signal})).status,403);
});
test('rejects cross-origin mutation, malformed bodies, and non-existent static paths',async t=>{
  const a=await setup(t);
  assert.equal((await a.post('/api/rooms',{name:'x'},null,{Origin:'https://untrusted.example'})).status,403);
  const bad=await fetch(a.base+'/api/rooms',{method:'POST',body:'{broken'}); assert.equal(bad.status,400);
  const traversal=await fetch(a.base+'/.certs/key.pem'); assert.equal(traversal.status,404);
  const home=await fetch(a.base+'/'); assert.equal(home.status,200); assert.match(await home.text(),/Cast a music tab/);
});

test('native app audio reaches listeners and stops when the owner leaves',async t=>{
  let bridgeCallbacks, stopped=0;
  const a=await setup(t,{bridgeFactory:callbacks=>{bridgeCallbacks=callbacks;return {stop(){stopped++;}};}});
  const host=await a.create('Mac apps'), receiver=await a.join(host.code,'Phone');
  const hostEvents=await a.stream(host), receiverEvents=await a.stream(receiver);
  await hostEvents('state'); await receiverEvents('state');
  await a.action(receiver,{type:'listen',enabled:true}); await receiverEvents('state');
  assert.equal((await a.action(host,{type:'native-start'})).status,200);
  const state=await receiverEvents('state'); assert.equal(state.sourceType,'native');
  const packet={rate:48000,channels:2,pcm:Buffer.alloc(1920).toString('base64')};
  bridgeCallbacks.onAudio(packet);
  assert.deepEqual(await receiverEvents('native-audio'),packet);
  assert.equal((await a.action(receiver,{type:'native-start'})).status,409);
  await a.action(host,{type:'leave'}); assert.equal(stopped,1);
});
test('native capture errors release the sender and notify its owner',async t=>{
  let callbacks;
  const a=await setup(t,{bridgeFactory:c=>{callbacks=c;return {stop(){}};}}),host=await a.create('Mac');
  const events=await a.stream(host); await events('state');
  await a.action(host,{type:'native-start'}); await events('state');
  callbacks.onError('Recording permission is missing');
  assert.equal((await events('native-error')).message,'Recording permission is missing');
  assert.equal((await events('state')).sender,null);
});

test('phone companion audio is authenticated, ordered, and distributed to room listeners',async t=>{
 const a=await setup(t),phone=await a.create('Android'),receiver=await a.join(phone.code,'Windows');
 const pe=await a.stream(phone),re=await a.stream(receiver);await pe('state');await re('state');
 await a.action(receiver,{type:'listen',enabled:true});await re('state');
 assert.equal((await a.action(phone,{type:'phone-start'})).status,200);await re('state');
 const pcm=Buffer.alloc(19200).toString('base64');
 assert.equal((await a.action(receiver,{type:'phone-audio',seq:0,pcm})).status,403);
 assert.equal((await a.action(phone,{type:'phone-audio',seq:0,pcm})).status,200);
 assert.equal((await re('native-audio')).pcm,pcm);
 assert.equal((await a.action(phone,{type:'phone-audio',seq:0,pcm})).status,400);
 await a.action(phone,{type:'stop'});
 assert.equal((await a.action(phone,{type:'phone-audio',seq:1,pcm})).status,403);
});

test('browser radio uses an authenticated audio stream and forwards PCM to its encoder',async t=>{
 let output,encoded;const a=await setup(t,{radioFactory:()=>({stopped:false,add(res){output=res;res.write(Buffer.from('ID3test'));},write(pcm){encoded=pcm;},stop(){output?.end();}})});
 const host=await a.create('Tab'),listener=await a.join(host.code,'Android browser');
 const se=await a.stream(host),le=await a.stream(listener);await se('state');await le('state');
 await a.action(host,{type:'pcm-start'});await le('state');
 const controller=new AbortController();t.after(()=>controller.abort());
 const response=await fetch(`${a.base}/api/rooms/${host.code}/audio?token=${listener.token}`,{signal:controller.signal});
 assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'audio/mpeg');
 const reader=response.body.getReader();assert.equal(Buffer.from((await reader.read()).value).toString(),'ID3test');
 const pcm=Buffer.alloc(19200);assert.equal((await a.action(host,{type:'phone-audio',seq:0,pcm:pcm.toString('base64')})).status,200);assert.deepEqual(encoded,pcm);
 const forbidden=await fetch(`${a.base}/api/rooms/${host.code}/audio?token=invalid`);assert.equal(forbidden.status,401);
 controller.abort();
});
