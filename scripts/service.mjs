import {mkdirSync,writeFileSync,existsSync,copyFileSync,unlinkSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {homedir} from 'node:os';
if(process.platform!=='darwin')throw new Error('This service installer requires macOS.');
const root=fileURLToPath(new URL('../',import.meta.url));
const label='local.beatsync.server';const scope=`gui/${process.getuid()}`;
const target=homedir()+'/Library/LaunchAgents/'+label+'.plist';
const run=(args,optional=false)=>{try{return execFileSync('launchctl',args,{encoding:'utf8'});}catch(e){if(!optional)throw e;}};
const action=process.argv[2]||'status';
if(action==='install'){
 mkdirSync(root+'.logs',{recursive:true});mkdirSync(root+'.native',{recursive:true});
 const xml=s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
 const plist=`<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>
 <key>Label</key><string>${label}</string>
 <key>ProgramArguments</key><array><string>${xml(process.execPath)}</string><string>--env-file-if-exists=.env</string><string>${xml(root+'server.mjs')}</string></array>
 <key>WorkingDirectory</key><string>${xml(root)}</string>
 <key>EnvironmentVariables</key><dict><key>PORT</key><string>3001</string><key>HTTPS_PORT</key><string>3444</string><key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string></dict>
 <key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>10</integer>
 <key>StandardOutPath</key><string>${xml(root+'.logs/server.log')}</string>
 <key>StandardErrorPath</key><string>${xml(root+'.logs/server-error.log')}</string>
 </dict></plist>\n`;
 writeFileSync(root+'.native/'+label+'.plist',plist,{mode:0o600});
 execFileSync('plutil',['-lint',root+'.native/'+label+'.plist'],{stdio:'inherit'});
 mkdirSync(homedir()+'/Library/LaunchAgents',{recursive:true});
 if(existsSync(target))run(['bootout',scope,target],true);
 copyFileSync(root+'.native/'+label+'.plist',target);
 run(['bootstrap',scope,target]);console.log('BeatSync background service installed on port 3001. Starts at login and restarts after a crash.');
}else if(action==='stop'){
 if(existsSync(target))run(['bootout',scope,target]);console.log('Stopped. Run npm run service:start to resume.');
}else if(action==='start'){
 if(!existsSync(target))throw new Error('Install the service first.');run(['bootstrap',scope,target]);
}else if(action==='restart'){run(['kickstart','-k',scope+'/'+label]);}
else if(action==='uninstall'){if(existsSync(target)){run(['bootout',scope,target],true);unlinkSync(target);}console.log('Removed background service.');}
else if(action==='status'){console.log(run(['print',scope+'/'+label]));}
else throw new Error('Use install, start, stop, restart, status, or uninstall.');
