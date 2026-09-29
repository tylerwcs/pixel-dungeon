export function connectedPads(raw){return Array.from(raw||[]).filter(p=>p?.connected);}
export function controlsAvailable(players,pads){return players.some(p=>p.control!=='ai')&&players.every(p=>!p.control.startsWith('pad:')||pads.some(g=>`pad:${g.index}`===p.control));}
export function gamepadDirection(g){
  let direction=null;const x=g.axes?.[0]||0,y=g.axes?.[1]||0;
  if(Math.max(Math.abs(x),Math.abs(y))>.35)direction=Math.abs(x)>Math.abs(y)?(x<0?'left':'right'):(y<0?'up':'down');
  for(const [index,name]of [[12,'up'],[13,'down'],[14,'left'],[15,'right']])if(g.buttons?.[index]?.pressed)direction=name;
  return direction;
}
export function controlOrder(pads){return [...pads.map(g=>`pad:${g.index}`),'wasd','arrows'];}
export function controlName(control){return control?.startsWith('pad:')?`PAD ${Number(control.slice(4))+1}`:{wasd:'WASD KEYS',arrows:'ARROW KEYS'}[control]||'';}
export function padPressed(g){return !!gamepadDirection(g)||!!g.buttons?.some(button=>button.pressed);}
export function gamepadStart(g){return !!g.buttons?.[9]?.pressed;}
export function gamepadDash(g){return [0,1,2,3].some(index=>g.buttons?.[index]?.pressed);}
