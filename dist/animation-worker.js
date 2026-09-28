importScripts('./vendor/h264-mp4-encoder.js');
let encoder,frame=0;
self.onmessage=async({data})=>{
  try{
    if(data.width){
      encoder=await HME.createH264MP4Encoder();encoder.width=data.width;encoder.height=data.height;encoder.frameRate=24;encoder.speed=8;encoder.quantizationParameter=22;encoder.initialize();
      self.postMessage({frame:0});return;
    }
    encoder.addFrameRgba(data.rgba);frame++;
    if(frame<144){self.postMessage({frame});return;}
    encoder.finalize();const bytes=encoder.FS.readFile(encoder.outputFilename);self.postMessage({bytes},[bytes.buffer]);encoder.delete();encoder=null;
  }catch{encoder?.delete();encoder=null;self.postMessage({error:'The video could not be prepared on this device. Close other tabs and try again.'});}
};
