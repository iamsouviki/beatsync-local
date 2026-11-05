import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

function browser() {
  const elements = new Map(), posted = [];
  function element(id) {
    if (!elements.has(id)) elements.set(id,{value:'',textContent:'',hidden:false,srcObject:null,paused:true,playCount:0,classList:{toggle(){}},replaceChildren(){},append(){},play(){this.paused=false;this.playCount++;return Promise.resolve();},pause(){this.paused=true;},showModal(){},close(){}});
    return elements.get(id);
  }
  const context = vm.createContext({
    document:{getElementById:element,querySelectorAll:()=>[],createElement:()=>({append(){}})},
    navigator:{userAgent:'Chrome',platform:'MacIntel',maxTouchPoints:0,mediaDevices:{getDisplayMedia(){}}},
    localStorage:{getItem(){return null;},setItem(){}},location:{href:'http://localhost:3000/',pathname:'/'},
    window:{isSecureContext:true,scrollTo(){},addEventListener(){}},history:{replaceState(){}},
    URL,Blob,DataView,ArrayBuffer,Uint8Array,atob,console,setTimeout:()=>1,clearTimeout(){},EventSource:class{addEventListener(){}close(){}},
    fetch:async (path,options)=>{
      if (!options) return {json:async()=>({addresses:[],port:3000})};
      const b=JSON.parse(options.body);posted.push({path,body:b});
      return {ok:true,json:async()=>path==='/api/rooms'?{code:'ABC123',id:'self',token:'token'}:{ok:true}};
    }
  });
  vm.runInContext(readFileSync(new URL('../public/app.js',import.meta.url),'utf8'),context);
  return {elements,context,posted,run:code=>vm.runInContext(code,context)};
}
test('joining automatically enables the device speaker',async()=>{
  const b=browser();
  await b.run('enter(true)');
  assert.ok(b.posted.some(x=>x.body.type==='listen'&&x.body.enabled===true));
  assert.equal(b.run('listening'),true);
  assert.ok(b.elements.get('audio').playCount>0,'audio element is primed during the join gesture');
});
test('sender plays the same source locally and may mute without cutting off receivers',async()=>{
  const b=browser();
  b.run(`session={id:'self',code:'ABC123',token:'token'}; listening=true;
    room={sender:'self',members:[{id:'self',name:'Mac',online:true,listening:true},{id:'remote',name:'Phone',online:true,listening:true}]};
    audioStream={getAudioTracks:()=>[]};
    peers.set('remote',{pc:{close(){throw new Error('Receiver should stay connected');}},timeout:null});
    reconcile();`);
  assert.equal(b.elements.get('audio').srcObject,b.run('audioStream'));
  assert.equal(b.elements.get('audio').paused,false);
  await b.elements.get('listen').onclick();
  assert.equal(b.elements.get('audio').paused,true);
  assert.equal(b.run('peers.has("remote")'),true);
  await b.elements.get('listen').onclick();
  assert.equal(b.elements.get('audio').paused,false);
});

test('native PCM is decoded as stereo and scheduled only on receiving speakers',()=>{
  const b=browser();
  b.context.packet={rate:48000,channels:2,pcm:Buffer.from([255,127,0,128,0,0,0,64]).toString('base64')};
  b.run(`session={id:'self'};room={sender:'mac',sourceType:'native'};listening=true;
    var played=[];var channels=[];
    nativeGain={};
    nativeContext={state:'running',currentTime:1,
      createBuffer(count,frames,rate){channels=[new Float32Array(frames),new Float32Array(frames)];return {getChannelData:c=>channels[c],duration:frames/rate};},
      createBufferSource(){return {connect(){},start(at){played.push(at);},stop(){}};}
    };
    receiveNativeAudio(packet);`);
  assert.equal(b.run('played.length'),1);
  assert.equal(b.run('channels[0][0]'),32767/32768);
  assert.equal(b.run('channels[1][0]'),-1);
  assert.equal(b.run('channels[1][1]'),.5);
  b.run('listening=false;receiveNativeAudio(packet);');assert.equal(b.run('played.length'),1);
  b.run("listening=true;room.sender='self';receiveNativeAudio(packet);");assert.equal(b.run('played.length'),1,'sender uses original app audio to avoid feedback');
});

test('music audio session and lock-screen controls are installed on speaker activation',async()=>{
 const b=browser();
 b.context.navigator.audioSession={type:'auto'};
 const handlers={};b.context.navigator.mediaSession={setActionHandler(name,handler){handlers[name]=handler;}};
 await b.run('enter(true)');
 assert.equal(b.context.navigator.audioSession.type,'playback');
 assert.equal(typeof handlers.play,'function');assert.equal(typeof handlers.pause,'function');
 await handlers.pause();assert.equal(b.run('listening'),false);
 await handlers.play();assert.equal(b.run('listening'),true);
});

test('pending browser picker can be cancelled and late-selected tracks are stopped',async()=>{
 const b=browser();let choose;let stopped=0;
 b.context.navigator.mediaDevices.getDisplayMedia=()=>new Promise(resolve=>{choose=resolve;});
 b.run("session={id:'self',code:'ABC123',token:'token'};");
 const pending=b.elements.get('cast').onclick();
 assert.equal(b.elements.get('cast').disabled,true);
 assert.equal(b.elements.get('capture-progress').hidden,false);
 b.elements.get('cancel-capture').onclick();
 assert.equal(b.elements.get('cast').disabled,false);
 choose({getTracks:()=>[{stop(){stopped++;}}]});await pending;
 assert.equal(stopped,1);assert.equal(b.run('audioStream'),null);
});
test('OS capture failures restore controls and explain the recording permission',async()=>{
 const b=browser();b.context.navigator.mediaDevices.getDisplayMedia=async()=>{const e=new Error('OS capture failed');e.name='NotReadableError';throw e;};
 b.run("session={id:'self',code:'ABC123',token:'token'};");
 await b.elements.get('cast').onclick();
 assert.equal(b.elements.get('cast').disabled,false);
 assert.equal(b.elements.get('capture-progress').hidden,true);
 assert.match(b.elements.get('toast').textContent,/Screen & System Audio Recording/);
});
