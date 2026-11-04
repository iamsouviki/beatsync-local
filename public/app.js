const $ = id => document.getElementById(id);
let session = null, room = null, events = null, capture = null, audioStream = null, listening = false;
let toneContext = null, toneTimer = null;
let network = null, signalQueue = Promise.resolve(), toastTimer, leaving = false;
const peers = new Map();
let nativeContext = null, nativeGain = null, nativeCursor = 0;
const nativeNodes = new Set();
const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const canCapture = !!navigator.mediaDevices?.getDisplayMedia && !mobile;
$('name').value = localStorage.getItem('beatsync-name') || (mobile ? 'My phone' : 'My computer');
$('audio').volume = .8;
const inviteCode = new URL(location.href).searchParams.get('room');
if (inviteCode) $('code').value = inviteCode.toUpperCase().replace(/[^A-F0-9]/g,'').slice(0,6);
function toast(message) { $('toast').textContent = message; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').hidden = true,7000); }
function showHelp() { $('help').showModal(); }
$('help-open').onclick = $('compat-open').onclick = $('apps-help').onclick = showHelp;
document.querySelectorAll('#help .close').forEach(b => b.onclick = () => $('help').close());
$('help').onclick = e => { if (e.target === $('help')) { const r = $('help').getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) $('help').close(); } };
async function request(path, data, authenticated = false) {
  const res = await fetch(path,{method:'POST',headers:{'Content-Type':'application/json',...(authenticated ? {Authorization:'Bearer '+session.token} : {})},body:JSON.stringify(data)});
  const result = await res.json();
  if (!res.ok) throw new Error(result.error || 'Connection failed');
  return result;
}
const action = data => request(`/api/rooms/${session.code}/action`,data,true);
async function enter(create) {
  // Start the media element in this user gesture, before waiting for the network.
  unlockSpeaker();
  const name = $('name').value.trim() || 'Guest';
  localStorage.setItem('beatsync-name',name);
  const code = $('code').value.trim().toUpperCase();
  if (!create && !/^[A-F0-9]{6}$/.test(code)) return toast('Enter the six-character room code.');
  $('create').disabled = true;
  try {
    session = await request(create ? '/api/rooms' : `/api/rooms/${code}/join`,{name});
    leaving = false; listening = true;
    $('landing').hidden = true; $('room').hidden = false; $('room-code').textContent = session.code;
    const url = new URL(location.href); url.searchParams.set('room',session.code); history.replaceState(null,'',url);
    events = new EventSource(`/api/rooms/${session.code}/events?token=${encodeURIComponent(session.token)}`);
    events.addEventListener('state',e => { room = JSON.parse(e.data); render(); reconcile(); });
    events.addEventListener('native-audio',e => receiveNativeAudio(JSON.parse(e.data)));
    events.addEventListener('native-error',e => toast(JSON.parse(e.data).message));
    events.addEventListener('signal',e => { const message = JSON.parse(e.data); signalQueue = signalQueue.then(() => receiveSignal(message)).catch(e => toast('Audio connection: '+e.message)); });
    let disconnectedAt = null;
    events.onopen = () => { if (disconnectedAt) toast('Room connection restored.'); disconnectedAt = null; };
    events.onerror = () => {
      if (leaving) return;
      disconnectedAt ||= Date.now();
      if (Date.now() - disconnectedAt > 20000) { toast('Room connection expired. Please rejoin.'); leave(false); }
      else toast('Room connection interrupted. Reconnecting…');
    };
    await action({type:'listen',enabled:true});
    renderNetwork(); window.scrollTo({top:0,behavior:'smooth'});
  } catch(e) { toast(e.message); } finally { $('create').disabled = false; }
}
$('create').onclick = () => enter(true);
$('join-form').onsubmit = e => { e.preventDefault(); enter(false); };
function render() {
  if (!room || !session) return;
  const sender = room.members.find(m => m.id === room.sender);
  const mine = room.sender === session.id;
  $('device-count').textContent = room.members.length;
  $('cast-status').textContent = sender ? 'LIVE AUDIO' : 'STANDING BY';
  $('cast-status').classList.toggle('active',!!sender);
  $('cast-art').classList.toggle('active',!!sender);
  $('cast-title').textContent = sender ? mine ? 'Your sound is making the rounds.' : `${sender.name} is casting.` : 'Give this room a soundtrack.';
  $('cast-description').textContent = sender ? mine ? 'Keep the music playing in your source tab. This device and the room’s enabled speakers receive its audio.' : 'The same audio is sent to every enabled speaker, including the sender. Keep this page open.' : 'No music is being sent yet. On the computer playing music, click Cast a music tab and select that tab with Share tab audio enabled.';
  $('sender-controls').hidden = !!sender;
  $('stop').hidden = !mine;
  $('listen').disabled = false;
  $('listen').textContent = listening ? 'Disable this speaker ◖))' : 'Enable this speaker ◖))';
  $('cast').disabled = !canCapture;
  $('native-cast').disabled = !network?.nativeAvailable || !network?.nativeHost;
  $('native-hint').textContent = !network?.nativeHost ? 'Start Mac app audio from localhost on the Mac. This device can listen.' : !network?.nativeAvailable ? 'Run npm run build:native on the Mac first.' : 'Captures desktop music apps. Browser audio is excluded to prevent feedback.';
  if (sender && room.sourceType === 'native') { $('cast-title').textContent = `${sender.name} is sharing app audio.`; $('cast-description').textContent = mine ? 'Play music in a native Mac app. The Mac plays its original audio; joined devices receive the stream. macOS recording permission is required.' : 'Receiving app audio over Wi-Fi. Keep this page open.'; }
  if (!canCapture) $('capture-hint').textContent = mobile ? 'This phone can listen. Sending app audio requires native AirPlay / Cast; tap Device compatibility below.' : !window.isSecureContext ? 'Sending requires HTTPS. Run npm run setup:https and trust the local certificate (see README).' : 'Use desktop Chrome or Edge to share tab audio.';
  $('devices').replaceChildren(...room.members.map(m => {
    const li = document.createElement('li');
    const icon = document.createElement('span'); icon.className = 'device-icon'; icon.textContent = m.id === room.sender ? '↗' : m.listening ? '◖))' : '▣';
    const name = document.createElement('span'); name.className = 'device-name'; name.textContent = m.name;
    const detail = document.createElement('small'); detail.textContent = !m.online ? 'Reconnecting…' : m.id === room.sender ? 'Sharing tab audio' : m.listening ? 'Speaker enabled' : 'Speaker off'; name.append(detail);
    li.append(icon,name);
    if (m.id === session.id) { const badge = document.createElement('span'); badge.className = 'device-badge'; badge.textContent = 'YOU'; li.append(badge); }
    return li;
  }));
}
function renderNetwork() {
  if (!network || !session) return;
  $('network-links').replaceChildren();
  const ports = [{scheme:'http',port:network.port},...(network.httpsPort ? [{scheme:'https',port:network.httpsPort}] : [])];
  for (const ip of network.addresses) for (const {scheme,port} of ports) {
    const link = document.createElement('a'); link.href = `${scheme}://${ip}:${port}/?room=${session.code}`; link.textContent = link.href; $('network-links').append(link);
  }
  if (!network.addresses.length) $('network-links').textContent = 'No Wi-Fi address detected. Connect the server to your network.';
}
$('copy').onclick = async () => {
  let url = new URL(network?.preferredOrigin || location.href);
  if (session) url.searchParams.set('room',session.code);
  if (['localhost','127.0.0.1'].includes(url.hostname) && network?.addresses.length) url.hostname = network.addresses[0];
  try { await navigator.clipboard.writeText(url.href); toast('Invite link copied. Open it on the same Wi-Fi.'); }
  catch { const input = document.createElement('input'); input.value = url.href; document.body.append(input); input.select(); const copied = document.execCommand('copy'); input.remove(); toast(copied ? 'Invite link copied.' : 'Copy a Wi-Fi URL from “Connecting another device”.'); }
};
function closePeer(id) { const p = peers.get(id); if (p) { clearTimeout(p.timeout); p.pc.close(); peers.delete(id); } }
function closePeers() { for (const id of [...peers.keys()]) closePeer(id); $('audio').srcObject = null; $('retry-audio').hidden = true; }
function makePeer(id) {
  closePeer(id);
  const pc = new RTCPeerConnection({iceServers:[]});
  const entry = {pc, candidates:[], outgoing:[], signaled:false, timeout:null}; peers.set(id,entry);
  pc.onicecandidate = e => {
    if (!e.candidate || !session) return;
    const signal = {type:'ice',candidate:e.candidate.toJSON()};
    if (entry.signaled) action({type:'signal',to:id,signal}).catch(() => {});
    else entry.outgoing.push(signal);
  };
  pc.ontrack = e => { $('audio-status').textContent = 'Audio stream received · starting playback'; $('audio').srcObject = e.streams[0] || new MediaStream([e.track]); playAudio(); };
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'connected') { clearTimeout(entry.timeout); if (listening) $('audio-status').textContent = 'Connected · receiving live audio'; toast('Audio connected.'); }
    if (listening && ['connecting','disconnected'].includes(pc.connectionState)) $('audio-status').textContent = 'Audio ' + pc.connectionState + '…';
    if (pc.connectionState === 'failed') { closePeer(id); toast('Audio connection failed. Check Wi-Fi isolation, VPN, and firewall. Toggle your speaker to retry.'); }
  };
  entry.timeout = setTimeout(() => { if (!['connected','closed'].includes(pc.connectionState)) toast('Still connecting audio. Both devices need the same non-isolated Wi-Fi; allow local network access if prompted.'); },15000);
  return entry;
}
async function sendDescription(id, entry, type) {
  await action({type:'signal',to:id,signal:{type,sdp:entry.pc.localDescription.toJSON()}});
  entry.signaled = true;
  for (const signal of entry.outgoing) await action({type:'signal',to:id,signal});
  entry.outgoing = [];
}
async function sendOffer(id) {
  const entry = makePeer(id);
  try {
    for (const track of audioStream.getAudioTracks()) entry.pc.addTrack(track,audioStream);
    const offer = await entry.pc.createOffer(); await entry.pc.setLocalDescription(offer);
    await sendDescription(id,entry,'offer');
  } catch(e) { closePeer(id); toast(e.message); }
}
function reconcile() {
  if (!room || !session) return;
  const mine = room.sender === session.id;
  if (audioStream && !mine) { cleanupCapture(); }
  for (const [id] of peers) {
    const m = room.members.find(x => x.id === id);
    if (!m?.online || (mine ? !m.listening : !listening || room.sender !== id)) closePeer(id);
  }
  if (room.sourceType !== 'native' || !room.sender) clearNativeAudio();
  if (room.sourceType === 'native' && room.sender) {
    if (mine) $('audio-status').textContent = 'Mac plays through its original app. Room volume controls apply on receiving devices.';
    return;
  }
  if (!room.sender) { $('audio-status').textContent = listening ? 'Speaker ready · waiting for a broadcast' : 'Speaker is off.'; $('audio').srcObject = null; $('retry-audio').hidden = true; }
  if (mine && audioStream && listening && $('audio').srcObject !== audioStream) { $('audio').srcObject = audioStream; playAudio(); }
  if (mine && audioStream) for (const m of room.members) if (m.id !== session.id && m.online && m.listening && !peers.has(m.id)) sendOffer(m.id);
}
async function receiveSignal({from,signal}) {
  if (!room || !session || (!listening && room.sender !== session.id)) return;
  if (signal.type === 'offer') {
    if (from !== room.sender || !listening) return;
    const entry = makePeer(from);
    await entry.pc.setRemoteDescription(signal.sdp);
    await entry.pc.setLocalDescription(await entry.pc.createAnswer());
    await sendDescription(from,entry,'answer');
  } else {
    const entry = peers.get(from); if (!entry) return;
    if (signal.type === 'answer') {
      await entry.pc.setRemoteDescription(signal.sdp);
      for (const candidate of entry.candidates) await entry.pc.addIceCandidate(candidate);
      entry.candidates = [];
    } else if (signal.type === 'ice') {
      if (entry.pc.remoteDescription) await entry.pc.addIceCandidate(signal.candidate); else entry.candidates.push(signal.candidate);
    }
  }
}
$('cast').onclick = async () => {
  if (!canCapture || !session) return showHelp();
  let selected;
  try {
    selected = await navigator.mediaDevices.getDisplayMedia({video:{displaySurface:'browser'},audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false,suppressLocalAudioPlayback:true},selfBrowserSurface:'exclude',systemAudio:'include',surfaceSwitching:'exclude'});
    if (!selected.getAudioTracks().length) { selected.getTracks().forEach(t=>t.stop()); return toast('No audio was shared. Choose a Chrome tab and enable “Share tab audio”.'); }
    capture = selected;
    audioStream = new MediaStream(selected.getAudioTracks());
    selected.getTracks().forEach(t => t.onended = () => stopCasting());
    closePeers(); listening = true;
    await action({type:'start'});
    // SSE may arrive before or after the POST response.
    if (room?.sender === session.id) reconcile();
  } catch(e) { selected?.getTracks().forEach(t=>t.stop()); cleanupCapture(); toast(e.name === 'NotAllowedError' ? 'Sharing was cancelled or blocked. Choose a music tab and allow tab audio.' : e.message); }
};
function cleanupCapture() {
  if (capture) { const s = capture; capture = null; s.getTracks().forEach(t=>{t.onended = null;t.stop();}); }
  audioStream = null;
  clearTimeout(toneTimer);
  if (toneContext) { toneContext.close(); toneContext = null; }
  closePeers();
}
async function stopCasting() { cleanupCapture(); clearNativeAudio(); if (session && room?.sender === session.id) try { await action({type:'stop'}); } catch(e) { toast(e.message); } }
$('stop').onclick = stopCasting;
function unlockSpeaker() {
  configureBackgroundAudio();
  try {
    if (!nativeContext) { nativeContext = new (window.AudioContext || window.webkitAudioContext)(); nativeGain = nativeContext.createGain(); nativeGain.gain.value = Number($('volume').value)/100; nativeGain.connect(nativeContext.destination); }
    nativeContext.resume().catch(()=>{});
  } catch {}
  const audio = $('audio');
  if (audio.srcObject) { audio.play().catch(()=>{}); return; }
  const samples = 400;
  const wav = new ArrayBuffer(44 + samples * 2), view = new DataView(wav);
  const text = (offset,value) => [...value].forEach((c,i)=>view.setUint8(offset+i,c.charCodeAt(0)));
  text(0,'RIFF'); view.setUint32(4,36+samples*2,true); text(8,'WAVE'); text(12,'fmt ');
  view.setUint32(16,16,true); view.setUint16(20,1,true); view.setUint16(22,1,true);
  view.setUint32(24,8000,true); view.setUint32(28,16000,true); view.setUint16(32,2,true); view.setUint16(34,16,true);
  text(36,'data'); view.setUint32(40,samples*2,true);
  const url = URL.createObjectURL(new Blob([wav],{type:'audio/wav'}));
  audio.src = url; audio.play().catch(()=>{}).finally(()=>URL.revokeObjectURL(url));
}
async function playAudio() {
  if (!listening || !$('audio').srcObject) return;
  try { await $('audio').play(); $('retry-audio').hidden = true; }
  catch { $('retry-audio').hidden = false; toast('Tap “Play incoming audio” to enable sound on this device.'); }
}
$('retry-audio').onclick = playAudio;
$('listen').onclick = async () => {
  if (!session) return;
  const previous = listening;
  const next = !listening;
  listening = next;
  try {
    // Unlock the audio element during a user gesture where supported.
    if (next) unlockSpeaker();
    await action({type:'listen',enabled:next}); listening = next;
    if (!listening) { setMediaPlayback('paused'); clearNativeAudio(); $('audio').pause(); if (room?.sender !== session.id) closePeers(); }
    render(); reconcile();
  } catch(e) { listening = previous; render(); toast(e.message); }
};
$('volume').oninput = () => { $('audio').volume = Number($('volume').value)/100; $('volume-value').value = $('volume').value+'%'; if (nativeGain) nativeGain.gain.value = Number($('volume').value)/100; };
async function leave(notify = true) {
  leaving = true;
  setMediaPlayback('none');
  clearTimeout(toastTimer); $('toast').hidden = true;
  if (notify && session) try { await action({type:'leave'}); } catch {}
  events?.close(); events = null; cleanupCapture(); clearNativeAudio(); nativeContext?.close(); nativeContext = null; nativeGain = null; session = null; room = null; listening = false;
  $('room').hidden = true; $('landing').hidden = false; history.replaceState(null,'',location.pathname);
}
$('leave').onclick = () => leave();
window.addEventListener('pagehide', () => {
  if (session) fetch(`/api/rooms/${session.code}/action`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+session.token},body:JSON.stringify({type:'leave'}),keepalive:true}).catch(()=>{});
  cleanupCapture(); events?.close();
});
$('audio').onplaying = () => { if ($('audio').srcObject) { $('audio-status').textContent = 'Playing live audio on this speaker'; setMediaPlayback('playing'); } };
fetch('/api/info').then(r=>r.json()).then(info => { network = info; renderNetwork(); if(room) render(); }).catch(()=>{});

$('test-tone').onclick = async () => {
  if (!session || room?.sender) return;
  try {
    toneContext = new AudioContext();
    const destination = toneContext.createMediaStreamDestination();
    const oscillator = toneContext.createOscillator(), gain = toneContext.createGain();
    oscillator.frequency.value = 440; gain.gain.value = .04;
    oscillator.connect(gain).connect(destination); oscillator.start();
    await toneContext.resume();
    audioStream = destination.stream; listening = true; closePeers();
    await action({type:'start'});
    if (room?.sender === session.id) reconcile();
    toast('Sending a quiet test tone for 15 seconds. Enable a speaker on another device.');
    toneTimer = setTimeout(stopCasting,15000);
  } catch(e) { cleanupCapture(); toast(e.message); }
};

function clearNativeAudio() {
  for (const source of nativeNodes) { try { source.stop(); } catch {} }
  nativeNodes.clear(); nativeCursor = 0;
}
function receiveNativeAudio(packet) {
  if (!listening || room?.sourceType !== 'native' || room.sender === session?.id) return;
  if (!nativeContext || nativeContext.state !== 'running') {
    $('retry-audio').hidden = false;
    $('audio-status').textContent = 'Tap Play incoming audio to allow app audio';
    return;
  }
  if (packet.rate !== 48000 || packet.channels !== 2 || typeof packet.pcm !== 'string') return;
  const bytes = Uint8Array.from(atob(packet.pcm),c=>c.charCodeAt(0));
  if (bytes.length % 4 || !bytes.length) return;
  const frames = bytes.length / 4, view = new DataView(bytes.buffer);
  const buffer = nativeContext.createBuffer(2,frames,48000);
  for (let c=0;c<2;c++) { const data=buffer.getChannelData(c); for(let i=0;i<frames;i++) data[i]=view.getInt16(i*4+c*2,true)/32768; }
  if (nativeCursor < nativeContext.currentTime || nativeCursor > nativeContext.currentTime + 1) { clearNativeAudio(); nativeCursor = nativeContext.currentTime + .2; }
  const source=nativeContext.createBufferSource(); source.buffer=buffer; source.connect(nativeGain);
  nativeNodes.add(source); source.onended=()=>nativeNodes.delete(source);
  source.start(nativeCursor); nativeCursor+=buffer.duration;
  $('retry-audio').hidden=true; $('audio-status').textContent='Playing native app audio on this speaker'; setMediaPlayback('playing');
}
$('native-cast').onclick = async () => {
  if (!session) return;
  try { await action({type:'native-start'}); } catch(e) { toast(e.message); }
};
const retryTabAudio = $('retry-audio').onclick;
$('retry-audio').onclick = () => { unlockSpeaker(); retryTabAudio(); };

// Declare music playback instead of relying on the browser's ambient audio category.
// These APIs improve OS integration; they cannot override mobile process suspension.
let mediaActionsInstalled = false;
function setMediaPlayback(state) {
  try { if (navigator.mediaSession) navigator.mediaSession.playbackState = state; } catch {}
}
function configureBackgroundAudio() {
  try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch {}
  if (!navigator.mediaSession || mediaActionsInstalled) return;
  if (typeof MediaMetadata !== 'undefined') navigator.mediaSession.metadata = new MediaMetadata({title:'BeatSync live room',artist:'Audio from your Wi-Fi room',album:'BeatSync'});
  const handlers = {
    play: async () => {
      if (!session) return;
      if (!listening) await $('listen').onclick();
      else { unlockSpeaker(); await playAudio(); }
    },
    pause: async () => { if (session && listening) await $('listen').onclick(); },
    stop: async () => { if (session && listening) await $('listen').onclick(); }
  };
  for (const [name,handler] of Object.entries(handlers)) {
    try { navigator.mediaSession.setActionHandler(name,handler); } catch {}
  }
  mediaActionsInstalled = true;
}
document.addEventListener?.('visibilitychange', () => {
  // Backgrounding alone must not leave the room, pause sound, or close peers.
  if (document.visibilityState === 'visible' && session && listening) {
    configureBackgroundAudio(); nativeContext?.resume().catch(()=>{}); playAudio();
  }
});
