importScripts('./vendor/h264-mp4-encoder.js');
self.onmessage=async({data})=>{
  let encoder;
  try{
    encoder=await HME.createH264MP4Encoder();encoder.width=data.size;encoder.height=data.size;encoder.frameRate=24;encoder.speed=8;encoder.quantizationParameter=22;encoder.initialize();
    const sequence=[0,1,2,3,2,3,2,1,0,0,0,0,0,0,0,0,0,0];
    for(let frame=0;frame<144;frame++){
      const time=frame/24,index=data.animation==='wave'?sequence[Math.floor(time*6)%sequence.length]:Math.floor(time/1.5)*4+Math.floor(time*8)%4;
      encoder.addFrameRgba(data.frames[index]);
      if(frame%12===0)self.postMessage({progress:Math.round(frame/144*100)});
    }
    encoder.finalize();const bytes=encoder.FS.readFile(encoder.outputFilename);self.postMessage({bytes},[bytes.buffer]);
  }catch{self.postMessage({error:'The video could not be prepared on this device. Close other tabs and try again.'});}
  finally{encoder?.delete();}
};
