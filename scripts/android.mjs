import {spawnSync} from 'node:child_process';
import {existsSync} from 'node:fs';
const bins=['/opt/homebrew/bin/scrcpy','/usr/local/bin/scrcpy'];
const binary=bins.find(existsSync)||'scrcpy';
if(spawnSync(binary,['--version'],{stdio:'ignore'}).error){
  console.error('scrcpy is not installed. On this Mac run: brew install scrcpy\nAndroid 11+ is required. Enable Developer options and pair USB/Wireless debugging with this Mac first.');process.exit(1);
}
const args=process.argv.slice(2);
if(args.some(a=>!/^--(?:tcpip(?:=[0-9.:]+)?|serial=[A-Za-z0-9.:_-]+)$/.test(a))) throw new Error('Allowed options: --tcpip, --tcpip=IP:PORT, --serial=SERIAL');
const sdk=process.env.ANDROID_HOME||`${process.env.HOME}/Library/Android/sdk`;
const adb=existsSync(sdk+'/platform-tools/adb')?sdk+'/platform-tools/adb':process.env.ADB;
console.log('Forwarding Android system audio to this Mac. In your localhost room choose Cast Mac apps to send it to the other speakers. Android source-speaker playback may stop during forwarding. Close this process and disable debugging when finished.');
const result=spawnSync(binary,['--no-video','--no-control','--require-audio','--audio-source=output','--audio-buffer=200',...args],{stdio:'inherit',env:{...process.env,...(adb?{ADB:adb}:{})}});
process.exit(result.status??1);
