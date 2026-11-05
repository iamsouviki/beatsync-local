class PCMEncoder extends AudioWorkletProcessor {
  constructor(){super();this.frames=0;this.bytes=new Uint8Array(19200);this.view=new DataView(this.bytes.buffer);}
  process(inputs){const channels=inputs[0];if(!channels?.[0])return true;
    for(let i=0;i<channels[0].length;i++){
      for(let c=0;c<2;c++){const value=Math.max(-1,Math.min(1,(channels[c]||channels[0])[i]||0));this.view.setInt16(this.frames*4+c*2,value<0?value*32768:value*32767,true);}
      if(++this.frames===4800){this.port.postMessage(this.bytes.buffer,[this.bytes.buffer]);this.frames=0;this.bytes=new Uint8Array(19200);this.view=new DataView(this.bytes.buffer);}
    }return true;
  }
}
registerProcessor('beatsync-pcm',PCMEncoder);
