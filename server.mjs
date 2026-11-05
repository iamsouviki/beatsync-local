import http from 'node:http';
import {createRadio} from './mp3-radio.mjs';
import {nativeAvailable, startNative} from './native-bridge.mjs';
import https from 'node:https';
import { readFileSync, existsSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
export function addresses() {
  return Object.values(networkInterfaces()).flat().filter(x => x.family === 'IPv4' && !x.internal).map(x => x.address);
}
export function createApp({bridgeFactory = startNative, radioFactory = createRadio} = {}) {
  let nativeOwner = null;
  function stopBridge(room) { room.radio?.stop(); room.radio = null; room.bridge?.stop(); room.bridge = null; if (nativeOwner === room.code) nativeOwner = null; room.sourceType = null; for (const m of room.members.values()) delete m.audioSeq; }
  const rooms = new Map();
  const json = (res, status, data) => { res.writeHead(status, {'Content-Type': 'application/json', 'Cache-Control': 'no-store'}); res.end(JSON.stringify(data)); };
  const emit = (member, type, data) => member.connection?.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
  const state = room => ({code: room.code, sender: room.sender, sourceType: room.sourceType || 'tab', members: [...room.members.values()].map(m => ({id: m.id, name: m.name, listening: m.listening, online: !!m.connection}))});
  const broadcast = room => { for (const member of room.members.values()) emit(member, 'state', state(room)); };
  function remove(room, id) {
    const m = room.members.get(id);
    if (!m) return;
    clearTimeout(m.timer); m.audioConnection?.end(); m.connection?.end(); room.members.delete(id);
    if (room.sender === id) { stopBridge(room); room.sender = null; }
    broadcast(room);
    if (!room.members.size) rooms.delete(room.code);
  }
  async function body(req) {
    let text = '';
    for await (const part of req) { text += part; if (text.length > 65536) throw new Error('Request too large'); }
    try { return JSON.parse(text || '{}'); } catch { throw new Error('Invalid JSON'); }
  }
  const handler = async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    // Same-origin API only; no cross-site submissions to a LAN receiver.
    if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}` && req.headers.origin !== `https://${req.headers.host}`) return json(res, 403, {error:'Cross-origin requests are not allowed'});
    const url = new URL(req.url, 'http://local');
    try {
      if (req.method === 'GET' && url.pathname === '/api/info') return json(res, 200, {addresses: addresses(), port: Number(process.env.PORT || 3000), httpsPort: existsSync(process.env.TLS_CERT || root + '.certs/cert.pem') ? Number(process.env.HTTPS_PORT || 3443) : null, preferredOrigin: process.env.BEATSYNC_ORIGIN || null, nativeAvailable: nativeAvailable(), nativeHost: ['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress)});
      if (req.method === 'POST' && url.pathname === '/api/rooms') {
        const b = await body(req);
        if (rooms.size >= 100) return json(res, 503, {error:'Room limit reached'});
        let code; do { code = randomBytes(4).toString('hex').slice(0,6).toUpperCase(); } while (rooms.has(code));
        const room = {code, sender:null, members:new Map()}; rooms.set(code,room);
        const timer = setTimeout(() => { if (!room.members.size) rooms.delete(code); }, 60000); timer.unref();
        return join(room,b,res);
      }
      const match = url.pathname.match(/^\/api\/rooms\/([A-F0-9]{6})(?:\/(join|events|action|audio))?$/);
      if (match) {
        const room = rooms.get(match[1]);
        if (!room) return json(res,404,{error:'Room not found. Check the code or create a new room.'});
        if (req.method === 'POST' && match[2] === 'join') return join(room,await body(req),res);
        const token = req.headers.authorization?.replace(/^Bearer /,'') || url.searchParams.get('token');
        const member = [...room.members.values()].find(m => m.token === token);
        if (!member) return json(res,401,{error:'Please rejoin this room.'});
        if (req.method === 'GET' && match[2] === 'audio') {
          if (!room.sender || room.sourceType !== 'native' || room.sender === member.id) return json(res,409,{error:'No remote PCM audio broadcast is active.'});
          if (!room.radio || room.radio.stopped) room.radio = radioFactory(message=>{for(const m of room.members.values())emit(m,'native-error',{message});});
          clearTimeout(member.timer); member.audioConnection?.end(); member.audioConnection = res;
          res.writeHead(200,{'Content-Type':'audio/mpeg','Cache-Control':'no-store','Connection':'keep-alive','X-Accel-Buffering':'no'});res.flushHeaders();
          room.radio.add(res);
          res.on('close',()=>{if(member.audioConnection!==res)return;member.audioConnection=null;if(!member.connection){member.timer=setTimeout(()=>remove(room,member.id),20000);member.timer.unref();}});
          return;
        }
        if (req.method === 'GET' && match[2] === 'events') {
          clearTimeout(member.timer);
          member.connection?.end(); member.connection = res;
          res.writeHead(200, {'Content-Type':'text/event-stream','Cache-Control':'no-cache, no-transform','Connection':'keep-alive','X-Accel-Buffering':'no'});
          res.write(': connected\n\n'); broadcast(room);
          const pulse = setInterval(() => res.write(': keepalive\n\n'),15000); pulse.unref();
          req.on('close', () => { clearInterval(pulse); if (member.connection !== res) return; member.connection = null; broadcast(room); if (!member.audioConnection) { member.timer = setTimeout(() => remove(room,member.id),20000); member.timer.unref(); } });
          return;
        }
        if (req.method === 'POST' && match[2] === 'action') {
          const b = await body(req);
          if (b.type === 'leave') remove(room,member.id);
          else if (b.type === 'listen') { member.listening = !!b.enabled; broadcast(room); }
          else if (b.type === 'phone-start' || b.type === 'pcm-start') {
            if (room.sender) return json(res,409,{error:'Stop the current sender first.'});
            room.sender = member.id; room.sourceType = 'native'; member.listening = b.type === 'pcm-start'; member.audioSeq = -1; broadcast(room);
          } else if (b.type === 'phone-audio') {
            if (room.sender !== member.id || room.sourceType !== 'native' || member.audioSeq === undefined) return json(res,403,{error:'This device is not the phone sender.'});
            if (!Number.isSafeInteger(b.seq) || b.seq <= member.audioSeq || typeof b.pcm !== 'string' || b.pcm.length > 60000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(b.pcm)) return json(res,400,{error:'Invalid audio packet'});
            const bytes = Buffer.from(b.pcm,'base64');
            if (!bytes.length || bytes.length % 4) return json(res,400,{error:'Expected stereo 16-bit PCM'});
            member.audioSeq = b.seq;
            room.radio?.write(bytes);
            for (const m of room.members.values()) if (m.id !== member.id && m.listening && m.connection && m.connection.writableLength < 512000) emit(m,'native-audio',{rate:48000,channels:2,pcm:b.pcm});
          } else if (b.type === 'native-start') {
            if (!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress)) return json(res,403,{error:'Start Mac app capture from http://localhost:3000 on the Mac. Remote devices cannot start system capture.'});
            if (room.sender || nativeOwner) return json(res,409,{error:'Stop the current broadcast before starting Mac app capture.'});
            nativeOwner = room.code; room.sender = member.id; room.sourceType = 'native';
            try {
              room.bridge = bridgeFactory({
                onAudio(packet) { if (room.sender !== member.id) return; room.radio?.write(Buffer.from(packet.pcm,'base64')); for (const m of room.members.values()) if (m.id !== member.id && m.listening && m.connection && m.connection.writableLength < 512000) emit(m,'native-audio',packet); },
                onError(message) { if (room.sender !== member.id) return; emit(member,'native-error',{message}); stopBridge(room); room.sender = null; broadcast(room); }
              });
            } catch(e) { stopBridge(room); room.sender = null; return json(res,400,{error:e.message}); }
            broadcast(room);
          } else if (b.type === 'start') {
            if (room.sender && room.sender !== member.id) return json(res,409,{error:'Someone is already casting. Ask them to stop first.'});
            delete member.audioSeq; room.sender = member.id; room.sourceType = 'tab'; member.listening = true; broadcast(room);
          } else if (b.type === 'stop') {
            if (room.sender !== member.id) return json(res,403,{error:'Only the sender can stop this cast.'});
            stopBridge(room); room.sender = null; broadcast(room);
          } else if (b.type === 'signal') {
            const target = room.members.get(b.to);
            if (!target || !target.connection) return json(res,404,{error:'Device disconnected'});
            if (room.sender !== member.id && room.sender !== target.id) return json(res,403,{error:'Signals must involve the sender'});
            if (!b.signal || !['offer','answer','ice'].includes(b.signal.type)) return json(res,400,{error:'Invalid signal'});
            emit(target,'signal',{from:member.id, signal:b.signal});
          } else return json(res,400,{error:'Unknown action'});
          return json(res,200,{ok:true});
        }
      }
      if (req.method === 'GET' && url.pathname === '/download/android.apk' && existsSync(root + '.native/android/BeatSync-WiFi.apk')) { res.writeHead(200, {'Content-Type':'application/vnd.android.package-archive','Content-Disposition':'attachment; filename=BeatSync-WiFi.apk'}); return res.end(readFileSync(root + '.native/android/BeatSync-WiFi.apk')); }
      if (req.method === 'GET') {
        const files = {'/':['index.html','text/html'], '/app.js':['app.js','text/javascript'], '/pcm-encoder.js':['pcm-encoder.js','text/javascript'], '/style.css':['style.css','text/css'], '/favicon.svg':['favicon.svg','image/svg+xml']};
        const f = files[url.pathname];
        if (f) { res.writeHead(200,{'Content-Type': f[1] + '; charset=utf-8','Cache-Control':'no-cache'}); return res.end(readFileSync(root + 'public/' + f[0])); }
      }
      json(res,404,{error:'Not found'});
    } catch (e) { if (!res.headersSent) json(res,400,{error:e.message}); else res.end(); }
  };
  function join(room,b,res) {
    if (room.members.size >= 16) return json(res,409,{error:'This room is full (16 devices).'});
    const member = {id:randomUUID(), token:randomBytes(24).toString('hex'), name:String(b.name || 'Guest').trim().slice(0,40) || 'Guest', listening:false, connection:null};
    room.members.set(member.id,member);
    member.timer = setTimeout(() => remove(room,member.id),30000); member.timer.unref();
    broadcast(room); json(res,200,{code:room.code, id:member.id, token:member.token});
  }
  return {handler, close() { for (const room of rooms.values()) { stopBridge(room); for (const m of room.members.values()) { clearTimeout(m.timer); m.audioConnection?.end(); m.connection?.end(); } } rooms.clear(); }};
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const app = createApp();
  const port = Number(process.env.PORT || 3000);
  const server = http.createServer(app.handler);
  server.listen(port,'0.0.0.0', () => {
    console.log(`\n  BEATSYNC LOCAL\n  This computer: http://localhost:${port}`);
    for (const ip of addresses()) console.log(`  Wi-Fi devices: http://${ip}:${port}`);
    if (!existsSync(root + '.certs/cert.pem')) console.log('  For casting from another computer, run: npm run setup:https\n');
  });
  server.on('error', e => { console.error(e.message); process.exitCode = 1; });
  const certPath = process.env.TLS_CERT || root + '.certs/cert.pem';
  const keyPath = process.env.TLS_KEY || root + '.certs/key.pem';
  if (existsSync(certPath)) {
    const secure = https.createServer({key:readFileSync(keyPath),cert:readFileSync(certPath)},app.handler);
    const securePort = Number(process.env.HTTPS_PORT || 3443);
    secure.listen(securePort,'0.0.0.0',() => { console.log(`  Secure: https://localhost:${securePort}`); for (const ip of addresses()) console.log(`  Secure Wi-Fi: https://${ip}:${securePort}`); });
    secure.on('error', e => console.error('HTTPS:',e.message));
  }
}
