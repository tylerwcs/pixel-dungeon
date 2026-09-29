import {MAP,WIDTH,HEIGHT,COLORS,DIRS,position} from './engine.mjs';
export const cache=new Map();
const frameCache=new Map();
export function loadImage(src){if(cache.has(src))return Promise.resolve(cache.get(src));return new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>{cache.set(src,img);resolve(img);};img.onerror=()=>reject(new Error('This PNG could not be opened.'));img.src=src;});}
export function characterAsset(character){return {...character,src:character.imageUrl,...(character.wave?{wave:{...character.wave,src:character.wave.imageUrl,anchor:'cell'}}:{})};}
export async function loadCharacterAsset(character){const asset=characterAsset(character);await loadImage(asset.src);if(asset.wave)await loadImage(asset.wave.src).catch(()=>{});return asset;}
// Return to neutral between greetings. Characters without a wave (the defaults, old characters, failed loads) walk in place instead.
const waveSequence=[0,1,2,3,2,3,2,1,0,0,0,0,0,0,0,0,0,0];
const greetingMotion=globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');
export function waveFrame(time,fps=6){return waveSequence[Math.floor(Math.max(0,time)*fps)%waveSequence.length];}
export function drawGreeting(ctx,asset,x,y,size,time=0){
  if(asset.wave&&cache.has(asset.wave.src)){const wave=asset.wave;drawSprite(ctx,wave,x,y,size,(greetingMotion?.matches?1:waveFrame(time,wave.fps))/wave.fps);}
  else{const still=!!greetingMotion?.matches;drawSprite(ctx,asset,x,y,size,still?0:time,'down',!still);}
}
export const defaults={collector:{src:'assets/adventurer.png',cols:4,rows:4,fps:8,layout:'directional',name:'Dungeon adventurer'},pursuer:{src:'assets/monster.png',cols:4,rows:4,fps:8,layout:'directional',name:'Dungeon monster'}};
// Humans without a booth character play the adventurer and AI players the monster; a booth character replaces either.
// Without a slot status (a fresh game), Player 1 is the human.
export function identityAsset(players,index){const player=players[index],human=player.slotStatus?player.slotStatus==='joined':index===0;return player.booth||defaults[human?'collector':'pursuer'];}
// In-game names: each character's name, numbered with the player slot only when another player shares it.
export function playerNames(players){
  const names=players.map((_,index)=>identityAsset(players,index).name?.trim()||`Player ${index+1}`),key=name=>name.toLowerCase();
  return names.map((name,index)=>names.filter(other=>key(other)===key(name)).length>1?`${name} ${index+1}`:name);
}

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
  // Waving changes the silhouette width; a cell anchor keeps the torso from sliding.
  if(asset.layout!=='directional'||asset.anchor==='cell')return null;const key=`${asset.src}|${asset.cols}x${asset.rows}`;if(frameCache.has(key))return frameCache.get(key);
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
  // Dash effects (drawing only): colour-tinted afterimages trail a dashing character and a puff marks where the dash began.
  const trails=new Map(),dashing=new Map(),puffs=[],ghost=document.createElement('canvas');ghost.width=ghost.height=48;const g=ghost.getContext('2d');
  function trackDashes(state,time){
    for(const a of state.actors){const p=position(a),active=a.dashTime>0&&state.phase==='playing',trail=trails.get(a.id)||[];
      if(active&&!dashing.get(a.id))puffs.push({x:p.x,y:p.y,start:time,color:COLORS[a.id]});dashing.set(a.id,active);
      if(active)trail.push({x:p.x,y:p.y,facing:a.facing,time});while(trail.length&&time-trail[0].time>.3)trail.shift();trails.set(a.id,trail);}
    while(puffs.length&&time-puffs[0].start>.35)puffs.shift();
  }
  function drawAfterimages(players,time){
    for(const [id,trail] of trails){let last=Infinity;
      for(let i=trail.length-1;i>=0;i--){const t=trail[i],age=time-t.time;if(age<.035||last-t.time<.045)continue;last=t.time;
        g.clearRect(0,0,48,48);drawSprite(g,identityAsset(players,id),24,24,39,t.time,t.facing,true);g.globalCompositeOperation='source-atop';g.globalAlpha=.55;g.fillStyle=COLORS[id];g.fillRect(0,0,48,48);g.globalAlpha=1;g.globalCompositeOperation='source-over';
        ctx.globalAlpha=.55*(1-age/.3);ctx.drawImage(ghost,Math.round(t.x*32+16-24),Math.round(t.y*32+13-24));ctx.globalAlpha=1;}}
  }
  function drawPuffs(time){
    for(const puff of puffs){const k=(time-puff.start)/.35,x=puff.x*32+16,y=puff.y*32+16;if(k<0||k>1)continue;
      ctx.globalAlpha=1-k;ctx.strokeStyle=puff.color;ctx.lineWidth=1+3*(1-k);ctx.beginPath();ctx.arc(x,y+4,8+26*k,0,Math.PI*2);ctx.stroke();
      ctx.fillStyle='#e9dcc4';for(let i=0;i<6;i++){const angle=i*Math.PI/3+.4,r=6+20*k;ctx.fillRect(Math.round(x+Math.cos(angle)*r-2),Math.round(y+8+Math.sin(angle)*r*.5-2),4,4);}
      ctx.globalAlpha=1;}
  }
  function render(state,players,time){
    ctx.imageSmoothingEnabled=false;ctx.drawImage(bg,0,0);
    for(const [x,y]of torches){const cx=x*32+16,cy=y*32+16;const glow=ctx.createRadialGradient(cx,cy,0,cx,cy,65);glow.addColorStop(0,'#eea75424');glow.addColorStop(1,'#eea75400');ctx.fillStyle=glow;ctx.fillRect(cx-65,cy-65,130,130);ctx.fillStyle='#9c663e';ctx.fillRect(cx-3,cy+2,6,10);ctx.fillStyle='#edac59';ctx.fillRect(cx-4,cy-6,8,10);ctx.fillStyle='#ffe6a2';ctx.fillRect(cx-2,cy-8+(Math.floor(time*4)%2)*2,4,9);}
    for(const k of state.coins){const [x,y]=k.split(',').map(Number),cx=x*32+16,cy=y*32+16;ctx.fillStyle='#8e642e';ctx.fillRect(cx-3,cy-4,7,9);ctx.fillStyle='#edbc68';ctx.fillRect(cx-3,cy-4,5,7);ctx.fillStyle='#ffe5a4';ctx.fillRect(cx-2,cy-3,2,3);}
    trackDashes(state,time);drawPuffs(time);drawAfterimages(players,time);
    for(const a of state.actors){const p=position(a),x=p.x*32+16,y=p.y*32+16,color=COLORS[a.id];ctx.fillStyle='#0007';ctx.beginPath();ctx.ellipse(x,y+11,12,5,0,0,Math.PI*2);ctx.fill();if(a.collector){const pulse=.5+.5*Math.sin(time*5);ctx.fillStyle=`rgba(255,212,107,${.12+.14*pulse})`;ctx.beginPath();ctx.arc(x,y,19+pulse*2,0,Math.PI*2);ctx.fill();ctx.strokeStyle='#ffd46b';ctx.lineWidth=3;ctx.beginPath();ctx.arc(x,y,16,0,Math.PI*2);ctx.stroke();}else{ctx.strokeStyle=color;ctx.lineWidth=2;ctx.strokeRect(Math.round(x-12),Math.round(y-12),24,25);}drawSprite(ctx,identityAsset(players,a.id),x,y-3,39,time,a.facing,!!a.target);ctx.fillStyle=color;ctx.fillRect(Math.round(x+7),Math.round(y-17),12,12);ctx.font='bold 9px monospace';ctx.textAlign='center';ctx.fillStyle='#191620';ctx.fillText(String(a.id+1),Math.round(x+13),Math.round(y-8));}
  }
  return render;
}
