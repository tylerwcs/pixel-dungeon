import {drawSprite,cache} from './render.mjs?v=wave-1';
export function createAnimationVideo(asset,animation,onProgress=()=>{}){
  const source=animation==='wave'?asset.wave:asset;if(!source||!cache.has(source.src))return Promise.reject(new Error('This animation is not available yet.'));
  const size=512,canvas=document.createElement('canvas');canvas.width=size;canvas.height=size;const ctx=canvas.getContext('2d'),frames=[];
  for(let row=0;row<(animation==='wave'?1:4);row++)for(let col=0;col<4;col++){
    ctx.fillStyle='#10152f';ctx.fillRect(0,0,size,size);
    drawSprite(ctx,source,size/2,size/2,size*.9,col/source.fps,['down','left','right','up'][row],true);
    frames.push(ctx.getImageData(0,0,size,size).data);
  }
  return new Promise((resolve,reject)=>{
    const worker=new Worker(new URL('./animation-worker.js?v=queue-1',import.meta.url)),timer=setTimeout(()=>finish(new Error('Video preparation took too long. Try again.')),120000);
    const finish=(error,bytes)=>{clearTimeout(timer);worker.terminate();window.removeEventListener('pagehide',cancel);if(error)reject(error);else resolve(new Blob([bytes],{type:'video/mp4'}));};
    const cancel=()=>finish(new Error('Video preparation cancelled.'));window.addEventListener('pagehide',cancel,{once:true});
    worker.onerror=()=>finish(new Error('Video preparation is unavailable. Refresh and try again.'));
    worker.onmessage=({data})=>{if(data.error)finish(new Error(data.error));else if(data.bytes)finish(null,data.bytes);else onProgress(data.progress);};
    worker.postMessage({size,frames,animation},frames.map(frame=>frame.buffer));
  });
}
