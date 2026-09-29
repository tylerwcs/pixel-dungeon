import {drawSprite,cache,waveFrame} from './render.mjs?v=burst-1';
let frameImage;
const footAnchors=new Map();
function footAnchor(source,time=0,direction='down'){
  const col=Math.floor(time*source.fps)%source.cols;
  const image=cache.get(source.src),key=`${source.src}|${source.cols}|${source.rows}|${source.anchor||''}|${direction}|${col}`;
  const saved=footAnchors.get(key);if(saved&&saved.image===image)return saved;
  const size=512,canvas=document.createElement('canvas');canvas.width=canvas.height=size;
  const ctx=canvas.getContext('2d',{willReadFrequently:true});drawSprite(ctx,source,size/2,size/2,size,time,direction,true);
  const pixels=ctx.getImageData(0,0,size,size).data;let top=size,bottom=-1,left=size,right=-1;
  for(let y=0;y<size;y++)for(let x=0;x<size;x++)if(pixels[(y*size+x)*4+3]>24){top=Math.min(top,y);bottom=y;}
  // Find the shoes, excluding the bag and waving hand from horizontal alignment.
  for(let y=Math.max(top,Math.floor(bottom-(bottom-top)*.1));y<=bottom;y++)for(let x=0;x<size;x++)if(pixels[(y*size+x)*4+3]>24){left=Math.min(left,x);right=Math.max(right,x);}
  const anchor={image,x:bottom<0?0:((left+right+1)/2-size/2)/size,y:bottom<0?.42:(bottom+1-size/2)/size,height:bottom<0?0:(bottom-top+1)/size};
  footAnchors.set(key,anchor);return anchor;
}
export function loadSocialFrame(){
  if(!frameImage)frameImage=new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=()=>{frameImage=null;reject(new Error('The event frame could not load. Try again.'));};image.src=new URL('./assets/social-frame-v2.png',import.meta.url).href;});
  return frameImage;
}
export function drawVideoBackground(ctx,width,height,name,background,frame){
  ctx.imageSmoothingEnabled=true;
  if(background==='framed')ctx.drawImage(frame,0,0,width,height);
  else{ctx.fillStyle='#000';ctx.fillRect(0,0,width,height);}
  ctx.save();ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle=background==='framed'?'#ffe5ae':'#fff';
  let fontSize=width*.06;const label=String(name||'').trim();
  do{ctx.font=`600 ${fontSize}px Georgia, serif`;if(ctx.measureText(label).width<=width*.78)break;fontSize-=1;}while(fontSize>width*.022);
  ctx.shadowColor='#02051a';ctx.shadowBlur=width*.012;ctx.fillText(label,width/2,height*.115,width*.78);ctx.restore();
}
export function drawVideoCharacter(ctx,asset,animation,width,height,time=0,still=false,background='framed'){
  const source=animation==='wave'&&asset.wave&&cache.has(asset.wave.src)?asset.wave:asset;
  const pose=animation==='wave'?(still?0:waveFrame(time,source.fps))/source.fps:(still?0:time);
  const direction=animation==='wave'||still?'down':['down','left','right','up'][Math.floor(time/1.5)%4];
  // Anchor visible shoes to the platform, not the transparent sprite-cell centre.
  // Generated cells can shift even when the prompt asks for a stationary torso.
  // Measure each pose's shoes so raised hands cannot pull the body sideways.
  // Normalize to the neutral front-facing height: cell padding and the walk
  // renderer's atlas scale must not make one animation smaller than the other.
  // Keep that scale throughout the cycle, preserving natural step/head motion.
  const neutral=footAnchor(source),size=neutral.height>0?width*.84/neutral.height:width*.95,anchor=footAnchor(source,pose,direction);
  drawSprite(ctx,source,width/2-anchor.x*size,height*(background==='framed'?.745:.67)-anchor.y*size,size,pose,direction,true);
}
export async function createAnimationVideo(asset,animation,onProgress=()=>{},{name='',background='framed'}={}){
  const source=animation==='wave'?asset.wave:asset;if(!source||!cache.has(source.src))throw new Error('This animation is not available yet.');
  const frame=background==='framed'?await loadSocialFrame():null,width=1080,height=1920;
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;const ctx=canvas.getContext('2d',{willReadFrequently:true});
  const base=document.createElement('canvas');base.width=width;base.height=height;drawVideoBackground(base.getContext('2d'),width,height,name,background,frame);
  return new Promise((resolve,reject)=>{
    const worker=new Worker(new URL('./animation-worker.js?v=share-1',import.meta.url));let settled=false;
    const timer=setTimeout(()=>finish(new Error('Video preparation took too long. Try again.')),180000);
    const finish=(error,bytes)=>{if(settled)return;settled=true;clearTimeout(timer);worker.terminate();window.removeEventListener('pagehide',cancel);canvas.width=base.width=1;if(error)reject(error);else resolve(new Blob([bytes],{type:'video/mp4'}));};
    const cancel=()=>finish(new Error('Video preparation cancelled.'));window.addEventListener('pagehide',cancel,{once:true});
    worker.onerror=()=>finish(new Error('Video preparation is unavailable. Refresh and try again.'));
    worker.onmessage=({data})=>{
      if(data.error)finish(new Error(data.error));else if(data.bytes)finish(null,data.bytes);
      else if(Number.isInteger(data.frame)){
        try{ctx.drawImage(base,0,0);drawVideoCharacter(ctx,asset,animation,width,height,data.frame/24,false,background);const rgba=ctx.getImageData(0,0,width,height).data;worker.postMessage({rgba},[rgba.buffer]);onProgress(Math.round(data.frame/144*100));}catch{finish(new Error('The video could not be prepared. Please try again.'));}
      }
    };
    // Send one frame at a time, avoiding 16 full-HD buffers in phone memory.
    worker.postMessage({width,height});
  });
}
