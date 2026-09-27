export const stageLabels={accepted:'Photo received',walking:'Creating your walking animation',waving:'Creating your waving animation',saving:'Finishing your character',complete:'Your character is ready',failed:'The booth needs to try again'};
export async function readJob(ticket){
  const response=await fetch(`/api/character-jobs/${encodeURIComponent(ticket.id)}`,{headers:{authorization:`Bearer ${ticket.token}`},cache:'no-store'});
  const data=await response.json();if(!response.ok)throw Object.assign(new Error(data.error||'Could not check progress. Reconnecting…'),{status:response.status});return data.job;
}
export function readPass(){try{return JSON.parse(localStorage.getItem('pixel-dungeon-character-pass')||'null');}catch{return null;}}
export async function savePass(character,claimToken){
  const response=await fetch(`/api/characters/${encodeURIComponent(character.id)}/pass`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({claimToken})}),data=await response.json();
  if(!response.ok)throw new Error(data.error||'Your pass could not be created.');
  try{localStorage.setItem('pixel-dungeon-character-pass',JSON.stringify({...data.character,claimToken}));}catch{throw new Error('Allow browser storage to save your character pass, then try again.');}
  return data.character;
}
