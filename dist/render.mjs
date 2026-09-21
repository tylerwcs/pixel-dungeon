import {MAP,WIDTH,HEIGHT,COLORS,DIRS,position} from './engine.mjs';
export const cache=new Map();
const frameCache=new Map();
export function loadImage(src){if(cache.has(src))return Promise.resolve(cache.get(src));return new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>{cache.set(src,img);resolve(img);};img.onerror=()=>reject(new Error('This PNG could not be opened.'));img.src=src;});}
export const defaults={collector:{src:'assets/adventurer.png',cols:4,rows:4,fps:8,layout:'directional',name:'Dungeon adventurer'},pursuer:{src:'assets/monster.png',cols:4,rows:4,fps:8,layout:'directional',name:'Dungeon monster'}};

export function detectSpriteFrames(alpha,width,height,cols=4,rows=4,threshold=24){
  if(!alpha||alpha.length!==width*height||cols<1||rows<1)return null;
  const frames=Array.from({length:rows},()=>[]);let maxWidth=0,maxHeight=0;
  for(let row=0;row<rows;row+=1){
    const top=Math.floor(row*height/rows),bottom=Math.floor((row+1)*height/rows),active=new Uint8Array(width);
    for(let y=top;y<bottom;y+=1)for(let x=0;x<width;x+=1)if(alpha[y*width+x]>threshold)active[x]=1;
    const groups=[];for(let x=0;x<width;){while(x<width&&!active[x])x+=1;if(x>=width)break;const start=x;while(x<width&&active[x])x+=1;groups.push({start,end:x-1});}
    while(groups.length>cols){let merge=0,gap=Infinity;for(let index=0;index<groups.length-1;index+=1){const nextGap=groups[index+1].start-groups[index].end-1;if(nextGap<gap){gap=nextGap;merge=index;}}groups.splice(merge,2,{start:groups[merge].start,end:groups[merge+1].end});}
    if(groups.length!==cols)return null;
    for(const group of groups){let minX=width,minY=bottom,maxX=-1,maxY=-1;for(let y=top;y<bottom;y+=1)for(let x=group.start;x<=group.end;x+=1)if(alpha[y*width+x]>threshold){minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);}if(maxX<minX||maxY<minY)return null;const frame={x:minX,y:minY,width:maxX-minX+1,height:maxY-minY+1};frames[row].push(frame);maxWidth=Math.max(maxWidth,frame.width);maxHeight=Math.max(maxHeight,frame.height);}
  }
  return {frames,maxWidth,maxHeight};
}

function frameAtlas(img,asset){
  if(asset.layout!=='directional')return null;const key=`${asset.src}|${asset.cols}x${asset.rows}`;if(frameCache.has(key))return frameCache.get(key);
  let atlas=null;try{const canvas=document.createElement('canvas');canvas.width=img.width;canvas.height=img.height;const context=canvas.getContext('2d',{willReadFrequently:true});context.drawImage(img,0,0);const rgba=context.getImageData(0,0,img.width,img.height).data,alpha=new Uint8Array(img.width*img.height);for(let source=3,target=0;source<rgba.length;source+=4,target+=1)alpha[target]=rgba[source];atlas=detectSpriteFrames(alpha,img.width,img.height,asset.cols,asset.rows);}catch{}
  frameCache.set(key,atlas);return atlas;
}

export function drawSprite(ctx,asset,x,y,size,time=0,facing='down',moving=true){
  const img=cache.get(asset.src);if(!img)return;
  const col=moving?Math.floor(time*asset.fps)%asset.cols:0,row=asset.layout==='directional'?DIRS[facing].row:0;
  const atlas=frameAtlas(img,asset),frame=atlas?.frames[row]?.[col];
  if(frame){const scale=size*.84/Math.max(atlas.maxWidth,atlas.maxHeight),w=frame.width*scale,h=frame.height*scale,baseline=y+size*.42;ctx.imageSmoothingEnabled=false;ctx.drawImage(img,frame.x,frame.y,frame.width,frame.height,Math.round(x-w/2),Math.round(baseline-h),Math.round(w),Math.round(h));return;}
  const sw=img.width/asset.cols,sh=img.height/asset.rows,scale=size/Math.max(sw,sh),w=sw*scale,h=sh*scale;
  ctx.imageSmoothingEnabled=false;ctx.drawImage(img,col*sw,row*sh,sw,sh,Math.round(x-w/2),Math.round(y-h/2),Math.round(w),Math.round(h));
}
export function createRenderer(canvas){
  const ctx=canvas.getContext('2d'),tile=32,bg=document.createElement('canvas');bg.width=WIDTH*tile;bg.height=HEIGHT*tile;const b=bg.getContext('2d');
  b.fillStyle='#1c1b24';b.fillRect(0,0,bg.width,bg.height);
  for(let y=0;y<HEIGHT;y++)for(let x=0;x<WIDTH;x++){
    const px=x*tile,py=y*tile,wall=MAP[y][x]==='#';
    if(wall){
      b.fillStyle='#373244';b.fillRect(px,py,tile,tile);b.fillStyle='#464052';b.fillRect(px+1,py+1,30,3);b.fillStyle='#292433';b.fillRect(px,py+29,32,3);
      b.fillStyle='#2c2738';b.fillRect(px+((y%2)?10:23),py+4,2,24);b.fillRect(px+1,py+16,30,1);
      if((x*13+y*7)%17===0){b.fillStyle='#535245';b.fillRect(px+2,py+2,10,3);b.fillRect(px+2,py+5,5,3);}
      if(MAP[y+1]?.[x]==='.'){b.fillStyle='#17141e';b.fillRect(px,py+29,32,3);}
    }else{b.fillStyle=((x+y)%2)?'#201e29':'#211f2a';b.fillRect(px,py,32,32);b.fillStyle='#302936';if((x*5+y*3)%5===0){b.fillRect(px+6,py+9,3,2);b.fillRect(px+22,py+24,2,2);}}
  }
  // Warm torch niches along the perimeter.
  const torches=[[3,0],[15,0],[0,7],[24,11],[9,20],[21,20]];
  function render(state,players,time){
    ctx.imageSmoothingEnabled=false;ctx.drawImage(bg,0,0);
    for(const [x,y]of torches){const cx=x*32+16,cy=y*32+16;const glow=ctx.createRadialGradient(cx,cy,0,cx,cy,65);glow.addColorStop(0,'#eea75424');glow.addColorStop(1,'#eea75400');ctx.fillStyle=glow;ctx.fillRect(cx-65,cy-65,130,130);ctx.fillStyle='#9c663e';ctx.fillRect(cx-3,cy+2,6,10);ctx.fillStyle='#edac59';ctx.fillRect(cx-4,cy-6,8,10);ctx.fillStyle='#ffe6a2';ctx.fillRect(cx-2,cy-8+(Math.floor(time*4)%2)*2,4,9);}
    for(const k of state.coins){const [x,y]=k.split(',').map(Number),cx=x*32+16,cy=y*32+16;ctx.fillStyle='#8e642e';ctx.fillRect(cx-3,cy-4,7,9);ctx.fillStyle='#edbc68';ctx.fillRect(cx-3,cy-4,5,7);ctx.fillStyle='#ffe5a4';ctx.fillRect(cx-2,cy-3,2,3);}
    for(const a of state.actors){const p=position(a),x=p.x*32+16,y=p.y*32+16,color=COLORS[a.id];ctx.fillStyle='#0007';ctx.beginPath();ctx.ellipse(x,y+11,12,5,0,0,Math.PI*2);ctx.fill();ctx.strokeStyle=color;ctx.lineWidth=2;ctx.strokeRect(Math.round(x-12),Math.round(y-12),24,25);const role=a.collector?'collector':'pursuer';drawSprite(ctx,players[a.id].booth||players[a.id][role]||defaults[role],x,y-3,39,time,a.facing,!!a.target);ctx.fillStyle=color;ctx.fillRect(Math.round(x+7),Math.round(y-17),12,12);ctx.font='bold 9px monospace';ctx.textAlign='center';ctx.fillStyle='#191620';ctx.fillText(String(a.id+1),Math.round(x+13),Math.round(y-8));}
  }
  return render;
}
