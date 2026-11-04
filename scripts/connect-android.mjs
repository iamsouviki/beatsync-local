import {spawnSync} from 'node:child_process';
import {existsSync} from 'node:fs';
const sdk=process.env.ANDROID_HOME||`${process.env.HOME}/Library/Android/sdk`;
const adb=process.env.ADB||(existsSync(sdk+'/platform-tools/adb')?sdk+'/platform-tools/adb':'adb');
function run(args){const r=spawnSync(adb,args,{encoding:'utf8'});if(r.error)throw new Error('Android SDK adb is not available: '+r.error.message);if(r.status!==0)throw new Error((r.stderr||r.stdout||'ADB command failed').trim());return r.stdout;}
try {
  const rows=run(['devices']).split('\n').slice(1).map(l=>l.trim().split(/\s+/)).filter(r=>r[0]);
  const ready=rows.filter(r=>r[1]==='device');
  if(!ready.length){
    console.error(rows.some(r=>r[1]==='unauthorized')?'Unlock Android and accept the USB debugging prompt for this Mac, then rerun.':'Connect Android by USB, enable Developer options → USB debugging, unlock it, and rerun. No authorized device is connected.');process.exit(1);
  }
  const serial=process.argv[2]||ready[0][0];
  if(!ready.some(r=>r[0]===serial))throw new Error('That device is not authorized.');
  if(ready.length>1&&!process.argv[2])throw new Error('Multiple devices are connected. Pass the device serial: npm run connect:android -- SERIAL');
  run(['-s',serial,'reverse','tcp:3000','tcp:3000']);
  console.log('Local website connection is ready over ADB.\nOn Android, manually open http://localhost:3000 in Chrome.\nThis tests the website without depending on Wi-Fi isolation. It does not repair the router.\nFor native music apps, run npm run cast:android, then Cast Mac apps in the Mac room. Keep the sending phone’s room speaker off to prevent feedback.\nTo remove this connection: adb -s '+serial+' reverse --remove tcp:3000');
} catch(e){console.error(e.message);process.exitCode=1;}
