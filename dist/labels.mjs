import {roundScores,DASH_COOLDOWN} from './engine.mjs';

// Round-result wording, kept pure so the Node tests can check it.
export function listNames(names){return names.length<2?names.join(''):`${names.slice(0,-1).join(', ')} & ${names.at(-1)}`;}
export function roundHeadline(state,names){
  const collector=names[state.collector];
  return state.winner==='collector'?`${collector} escaped with all ${state.collected} gold!`:`${listNames(state.catchers.map(id=>names[id]))} caught ${collector}!`;
}
export function roundRows(state,names,totals){
  const earned=roundScores(state);
  return names.map((name,index)=>{
    const collector=index===state.collector,action=collector?`Collector · ${state.collected} gold collected`:state.catchers.includes(index)?`Caught ${names[state.collector]}`:'No catch';
    return {index,name,action,earned:earned[index],total:totals[index],collector};
  });
}
export function dashStatus(a,phase='playing'){
  if(a.dashTime>0&&phase!=='result')return {text:'⚡ DASHING',charge:1,dashing:true,spent:false};
  if(a.collector)return a.dashCooldown>0?{text:`⚡ ${Math.ceil(a.dashCooldown)}s`,charge:1-a.dashCooldown/DASH_COOLDOWN,dashing:false,spent:false}:{text:'⚡ DASH',charge:1,dashing:false,spent:false};
  return a.dashesLeft>0?{text:'⚡ DASH ×1',charge:1,dashing:false,spent:false}:{text:'DASH USED',charge:0,dashing:false,spent:true};
}
