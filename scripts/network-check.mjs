import http from 'node:http';
import {networkInterfaces} from 'node:os';
const page=Buffer.from('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>BeatSync network check</title></head><body style="font:20px system-ui;padding:30px"><h1>Connection works</h1><p>This device reached your Mac over the network.</p><p>This test uses HTTP only. There is no certificate, redirect, JavaScript, or music player.</p><p>Return to BeatSync on port 3000 next.</p></body></html>');
const server=http.createServer((req,res)=>{
 console.log(new Date().toISOString(),'HTTP request from',req.socket.remoteAddress,'method',req.method);
 res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Content-Length':page.length,'Connection':'close','Cache-Control':'no-store'});res.end(page);
});
server.on('connection',socket=>console.log(new Date().toISOString(),'TCP connection from',socket.remoteAddress));
server.on('error',error=>{console.error(error.message);process.exitCode=1;});
server.listen(8080,'0.0.0.0',()=>{console.log('Plain HTTP diagnostic page:');for(const n of Object.values(networkInterfaces()).flat())if(n.family==='IPv4'&&!n.internal)console.log(`http://${n.address}:8080/`);console.log('Leave this running while opening the address on Android. Incoming connections appear here.');});
