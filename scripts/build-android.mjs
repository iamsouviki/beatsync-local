import {execFileSync} from 'node:child_process';import {mkdirSync,readdirSync,existsSync} from 'node:fs';import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));const sdk=process.env.ANDROID_HOME||process.env.HOME+'/Library/Android/sdk',tools=sdk+'/build-tools/35.0.0',android=sdk+'/platforms/android-35/android.jar',out=root+'.native/android';mkdirSync(out+'/classes',{recursive:true});mkdirSync(out+'/dex',{recursive:true});
const run=(cmd,args)=>execFileSync(cmd,args,{stdio:'inherit'});
run(tools+'/aapt2',['link','-I',android,'--manifest',root+'companions/android/AndroidManifest.xml','-o',out+'/unsigned.apk']);
run('javac',['--release','8','-classpath',android,'-d',out+'/classes',...readdirSync(root+'companions/android/src/local/beatsync').filter(f=>f.endsWith('.java')).map(f=>root+'companions/android/src/local/beatsync/'+f)]);
run('jar',['cf',out+'/classes.jar','-C',out+'/classes','.']);run(tools+'/d8',['--min-api','29','--lib',android,'--output',out+'/dex',out+'/classes.jar']);
execFileSync('zip',['-j',out+'/unsigned.apk',out+'/dex/classes.dex'],{stdio:'inherit'});run(tools+'/zipalign',['-f','4',out+'/unsigned.apk',out+'/aligned.apk']);
const key=out+'/development.jks';if(!existsSync(key))run('keytool',['-genkeypair','-keystore',key,'-storepass','android','-keypass','android','-alias','development','-keyalg','RSA','-validity','3650','-dname','CN=BeatSync Local Development']);
run(tools+'/apksigner',['sign','--ks',key,'--ks-pass','pass:android','--out',out+'/BeatSync-WiFi.apk',out+'/aligned.apk']);run(tools+'/apksigner',['verify',out+'/BeatSync-WiFi.apk']);console.log('Built '+out+'/BeatSync-WiFi.apk');
