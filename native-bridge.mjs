import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const executable=fileURLToPath(new URL('./.native/BeatSyncAppAudio',import.meta.url));
export function nativeAvailable(){return process.platform==='darwin'&&existsSync(executable);}
export function startNative({onAudio,onError}){
  if(!nativeAvailable()) throw new Error('Run npm run build:native on the Mac first.');
  const child=spawn(executable,[],{stdio:['ignore','pipe','pipe']});
  let pending='',stopped=false,lastError='';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data',chunk=>{
    pending+=chunk;
    if(pending.length>1048576){onError('Native audio buffer overflow');stop();return;}
    let end;while((end=pending.indexOf('\n'))>=0){
      const line=pending.slice(0,end);pending=pending.slice(end+1);
      try{const packet=JSON.parse(line);if(packet.rate===48000&&packet.channels===2&&typeof packet.pcm==='string'&&packet.pcm.length<=131072)onAudio(packet);}catch{}
    }
  });
  child.stderr.on('data',data=>{lastError=(lastError+data.toString()).slice(-3000);});
  child.on('error',e=>{if(!stopped)onError(e.message);});
  child.on('exit',()=>{if(!stopped)onError(lastError||'Native audio helper stopped');});
  function stop(){stopped=true;child.kill('SIGTERM');}
  return {stop};
}
