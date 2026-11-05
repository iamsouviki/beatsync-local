import {spawn} from 'node:child_process';
export function createRadio(onError=()=>{}) {
 const listeners=new Set();let stopped=false;
 const encoder=spawn(process.env.FFMPEG_PATH||'ffmpeg',['-hide_banner','-loglevel','error','-f','s16le','-ar','48000','-ac','2','-i','pipe:0','-c:a','libmp3lame','-b:a','192k','-f','mp3','-flush_packets','1','pipe:1'],{stdio:['pipe','pipe','pipe']});
 let error='';
 encoder.stderr.on('data',b=>error=(error+b.toString()).slice(-1000));
 encoder.stdout.on('data',chunk=>{for(const res of listeners){if(res.writableLength>256000){res.destroy();listeners.delete(res);}else res.write(chunk);}});
 encoder.stdin.on('error',()=>{});
 const fail=message=>{if(stopped)return;stopped=true;for(const res of listeners)res.end();listeners.clear();onError(message);};
 encoder.on('error',e=>fail('Install FFmpeg for browser background playback: '+e.message));
 encoder.on('exit',code=>{if(!stopped)fail(error||'Audio encoder exited ('+code+')');});
 return {
  get stopped(){return stopped;},
  add(res){listeners.add(res);res.on('close',()=>listeners.delete(res));},
  write(pcm){if(!stopped&&!encoder.stdin.destroyed&&encoder.stdin.writableLength<384000)encoder.stdin.write(pcm);},
  stop(){stopped=true;for(const res of listeners)res.end();listeners.clear();encoder.stdin.end();encoder.kill('SIGTERM');}
 };
}
