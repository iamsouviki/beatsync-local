import {spawnSync} from 'node:child_process';
import {mkdirSync,readFileSync,writeFileSync,existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const domain=process.argv[2];
if(!domain) throw new Error('Supply a domain you control: npm run setup:domain -- beatsync.example.com');
if(!/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i.test(domain))throw new Error('Provide a domain name, without https:// or a port.');
const certbot=['/opt/homebrew/bin/certbot','/usr/local/bin/certbot'].find(existsSync)||'certbot';
if(spawnSync(certbot,['--version'],{stdio:'ignore'}).error){console.error('Install the ACME client first: brew install certbot\nThen rerun: npm run setup:domain -- '+domain);process.exit(1);}
const folder=root+'.certs/acme';mkdirSync(folder,{recursive:true,mode:0o700});
console.log(`This requires DNS control of ${domain}. Certbot will ask you to accept its terms and add a public DNS TXT record. No incoming internet ports are opened.\nFor Wi-Fi access, set your router's local DNS record ${domain} to the Mac's reserved LAN IP. Use a router DNS override so the service remains private.\nManual DNS validation does not auto-renew: repeat this before the certificate expires, or configure your DNS provider's Certbot plugin.`);
const result=spawnSync(certbot,['certonly','--manual','--preferred-challenges','dns','--cert-name',domain,'-d',domain,'--config-dir',folder+'/config','--work-dir',folder+'/work','--logs-dir',folder+'/logs'],{stdio:'inherit'});
if(result.status!==0) process.exit(result.status??1);
const live=folder+'/config/live/'+domain;
const env=existsSync(root+'.env')?readFileSync(root+'.env','utf8'):'';
const lines=env.split('\n').filter(l=>!/^\s*(BEATSYNC_ORIGIN|TLS_CERT|TLS_KEY)=/.test(l));
lines.push(`BEATSYNC_ORIGIN=https://${domain}:3443`,`TLS_CERT="${live}/fullchain.pem"`,`TLS_KEY="${live}/privkey.pem"`);
writeFileSync(root+'.env',lines.join('\n')+'\n',{mode:0o600});
console.log('Trusted certificate installed into project config. Restart npm start. Open https://'+domain+':3443 on Wi-Fi. Configure router local DNS before using this URL.');
