import {mkdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
if(process.platform!=='darwin') throw new Error('The native audio helper requires macOS 13 or newer.');
mkdirSync(root+'.native',{recursive:true});
execFileSync('xcrun',['swiftc','-parse-as-library','-O','-module-cache-path',root+'.native/module-cache',root+'native/AppAudio.swift','-o',root+'.native/BeatSyncAppAudio'],{stdio:'inherit'});
console.log('Built native audio helper. Open a room on localhost, then choose Cast Mac apps. macOS will request screen/system-audio recording permission.');
