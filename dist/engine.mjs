export const DIRS = {up:{x:0,y:-1,row:3},down:{x:0,y:1,row:0},left:{x:-1,y:0,row:1},right:{x:1,y:0,row:2}};
export const COLORS = ['#bade80','#b8a2ee','#f59b83','#88cddd'];
export const WIDTH=25, HEIGHT=21;
export const GAME_ROUNDS=4, CATCH_BONUS=15;
// Hand-shaped connected corridor network. Every loop joins the outer circuit.
export function makeMap(){
  const map=Array.from({length:HEIGHT},()=>Array(WIDTH).fill('#'));
  const line=(x,y,xx,yy)=>{while(true){map[y][x]='.';if(x===xx&&y===yy)break;x+=Math.sign(xx-x);y+=Math.sign(yy-y);}};
  line(1,1,23,1);line(1,19,23,19);line(1,1,1,19);line(23,1,23,19);
  for(const y of [5,9,13,17])line(1,y,23,y);
  for(const x of [5,11,17])line(x,1,x,19);
  line(8,5,8,9);line(20,1,20,5);line(14,9,14,13);line(8,13,8,17);line(20,13,20,17);
  line(1,11,5,11);line(17,7,23,7);line(11,3,17,3);line(11,15,17,15);
  return map;
}
export const MAP=makeMap();
export const key=(x,y)=>`${x},${y}`;
export const open=(x,y)=>MAP[y]?.[x]==='.';
export function neighbors(x,y){return Object.entries(DIRS).filter(([,d])=>open(x+d.x,y+d.y)).map(([name,d])=>({x:x+d.x,y:y+d.y,name}));}
export function distanceField(tx,ty){
  if(!open(tx,ty)){let best=Infinity;for(let y=0;y<HEIGHT;y++)for(let x=0;x<WIDTH;x++)if(open(x,y)){const d=Math.abs(x-tx)+Math.abs(y-ty);if(d<best){best=d;tx=x;ty=y;}}}
  const dist=new Map([[key(tx,ty),0]]),q=[{x:tx,y:ty}];
  for(let i=0;i<q.length;i++){const p=q[i];for(const n of neighbors(p.x,p.y)){const k=key(n.x,n.y);if(!dist.has(k)){dist.set(k,dist.get(key(p.x,p.y))+1);q.push(n);}}}return dist;
}
// Player slots mirror their lobby quadrants and never trade corners between rounds.
const SPAWNS=[{x:1,y:1},{x:23,y:1},{x:1,y:19},{x:23,y:19}];
export function newRound(players,collector=0,round=1){
  const collectorIndex=Number.isInteger(collector)&&collector>=0&&collector<players.length?collector:0;
  const actors=players.map((p,i)=>{const isCollector=i===collectorIndex;return {id:i,human:p.control!=='ai',control:p.control,collector:isCollector,...SPAWNS[i],dir:null,facing:i<2?'down':'up',queued:null,target:null,progress:0,speed:isCollector?4.5:3.8,aiKind:i};});
  const coins=new Set();for(let y=0;y<HEIGHT;y++)for(let x=0;x<WIDTH;x++)if(open(x,y))coins.add(key(x,y));
  const c=actors[collectorIndex];coins.delete(key(c.x,c.y));
  return {actors,collector:collectorIndex,coins,total:coins.size,phase:'countdown',countdown:5,elapsed:0,round,winner:null,collected:0,catchers:[]};
}
export function position(a){return a.target?{x:a.x+(a.target.x-a.x)*a.progress,y:a.y+(a.target.y-a.y)*a.progress}:{x:a.x,y:a.y};}
export function sweptContact(a0,a1,b0,b1,radius=.58){
  const x=a0.x-b0.x,y=a0.y-b0.y,dx=a1.x-a0.x-b1.x+b0.x,dy=a1.y-a0.y-b1.y+b0.y;
  const v=dx*dx+dy*dy,t=v?Math.max(0,Math.min(1,-(x*dx+y*dy)/v)):0;
  return (x+dx*t)**2+(y+dy*t)**2<=radius**2;
}
export function aiDirection(a,state){
  if(a.collector){
    const from=distanceField(a.x,a.y);let target=null,best=Infinity;
    for(const coin of state.coins){const [x,y]=coin.split(',').map(Number),distance=from.get(coin)??Infinity;if(distance<best){best=distance;target={x,y};}}
    if(!target)return null;
    const dist=distanceField(target.x,target.y),opts=neighbors(a.x,a.y);opts.sort((b,c)=>(dist.get(key(b.x,b.y))??Infinity)-(dist.get(key(c.x,c.y))??Infinity)||b.name.localeCompare(c.name));return opts[0]?.name;
  }
  const c=state.actors[state.collector],p=position(c),d=DIRS[c.facing];let tx=Math.round(p.x),ty=Math.round(p.y);
  if(a.aiKind===1){for(let i=0;i<3;i++){if(!open(tx+d.x,ty+d.y))break;tx+=d.x;ty+=d.y;}}
  if(a.aiKind===2){const choices=[];for(let y=1;y<HEIGHT-1;y++)for(let x=1;x<WIDTH-1;x++)if(open(x,y)&&neighbors(x,y).length>=3){const distance=Math.abs(x-p.x)+Math.abs(y-p.y);if(distance>1&&distance<7)choices.push({x,y,score:distance+Math.abs(x-a.x)*.14+Math.abs(y-a.y)*.14});}choices.sort((a,b)=>a.score-b.score);if(choices[0]){tx=choices[0].x;ty=choices[0].y;}if(a.x===tx&&a.y===ty){tx=Math.round(p.x);ty=Math.round(p.y);}}
  const dist=distanceField(tx,ty),opts=neighbors(a.x,a.y);opts.sort((b,c)=>(dist.get(key(b.x,b.y))??Infinity)-(dist.get(key(c.x,c.y))??Infinity));return opts[0]?.name;
}
function move(a,dt,state){
  let remaining=a.speed*dt;
  while(remaining>0){
    if(!a.target){
      if(!a.human)a.queued=aiDirection(a,state);
      const q=DIRS[a.queued];if(q&&open(a.x+q.x,a.y+q.y)){a.dir=a.queued;a.queued=null;}
      const d=DIRS[a.dir];if(!d||!open(a.x+d.x,a.y+d.y)){a.dir=null;break;}
      a.facing=a.dir;a.target={x:a.x+d.x,y:a.y+d.y};a.progress=0;
    }
    const step=Math.min(remaining,1-a.progress);a.progress+=step;remaining-=step;
    if(a.progress>=1-1e-9){a.x=a.target.x;a.y=a.target.y;a.target=null;a.progress=0;}
  }
}
export function step(state,dt){
  if(state.phase==='countdown'){state.countdown=Math.max(0,state.countdown-dt);if(state.countdown===0)state.phase='playing';return [];}
  if(state.phase!=='playing')return [];
  state.elapsed+=dt;const prev=state.actors.map(position);
  for(const a of state.actors)move(a,dt,state);
  const c=state.actors[state.collector],cp=position(c);
  const catchers=state.actors.filter((a,i)=>!a.collector&&sweptContact(prev[state.collector],cp,prev[i],position(a))).map(a=>a.id);
  if(catchers.length){state.catchers=catchers;state.phase='result';state.winner='pursuers';return ['caught'];}
  const x=Math.round(cp.x),y=Math.round(cp.y);const events=[];
  if(Math.abs(cp.x-x)<.22&&Math.abs(cp.y-y)<.22&&state.coins.delete(key(x,y))){state.collected++;events.push('coin');}
  if(state.coins.size===0){state.phase='result';state.winner='collector';events.push('win');}return events;
}
export function nextCollector(players,current){return (current+1)%players.length;}
export function roundScores(state,catchBonus=CATCH_BONUS){const earned=Array(state.actors.length).fill(0);earned[state.collector]=state.collected;for(const id of state.catchers||[])if(id>=0&&id<earned.length)earned[id]+=catchBonus;return earned;}
export function rankScores(scores){return scores.map((score,index)=>({index,score})).sort((a,b)=>b.score-a.score||a.index-b.index);}
