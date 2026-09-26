import {roundScores} from './engine.mjs';

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
