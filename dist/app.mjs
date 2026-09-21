import {newRound,nextCollector,step,COLORS} from './engine.mjs';
import {loadImage,drawSprite,defaults,createRenderer} from './render.mjs';
import {createCharacterEditor,readSettings,writeSettings,validateSettings} from './characters.mjs';
import {connectedPads,controlsAvailable,gamepadDirection} from './input.mjs';
const $=id=>document.getElementById(id);
const players=Array.from({length:4},(_,i)=>({control:i===0?'wasd':'ai',collector:null,pursuer:null,boothCharacterId:null,booth:null}));
let state=newRound(players),lobby=true,muted=false,audio=null,pausedPhase='playing',pauseReason='',lastPhase='',lastCount=-1;
let pads=[],padSignature='',toastTimer,boothCharacters=[],boothRefreshPending=false,boothSignature='';
const render=createRenderer($('game'));
let storageWarning=false;
async function savePreferences(){try{await writeSettings({version:1,muted,players:players.map(({booth,...p})=>({...p}))});}catch{if(!storageWarning){storageWarning=true;toast('Browser storage is unavailable. Changes will last for this visit only.');}}}
const characterEditor=createCharacterEditor(players,{changed:async()=>{renderPlayers();await savePreferences();},notify:message=>toast(message)});
function toast(message){$('toast').textContent=message;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,4500);}
function beep(kind){if(muted||!audio)return;const now=audio.currentTime;const notes=kind==='coin'?[720,960]:kind==='win'?[523,659,784,1047]:[250,180,110];notes.forEach((f,i)=>{const o=audio.createOscillator(),g=audio.createGain();o.type='square';o.frequency.value=f;g.gain.setValueAtTime(.025,now+i*.075);g.gain.exponentialRampToValueAtTime(.001,now+i*.075+.095);o.connect(g);g.connect(audio.destination);o.start(now+i*.075);o.stop(now+i*.075+.1);});}
async function activateAudio(){try{audio??=new (window.AudioContext||window.webkitAudioContext)();await audio.resume();}catch{}}
function controlLabel(c){return c==='wasd'?'Keyboard · WASD':c==='arrows'?'Keyboard · Arrow keys':c==='ai'?'Computer-controlled':`Gamepad ${Number(c.split(':')[1])+1}`;}
function humanCount(){return players.filter(p=>p.control!=='ai').length;}
function controlsValid(){return controlsAvailable(players,pads);}
function boothAsset(id){const character=boothCharacters.find(item=>item.id===id);return character?{src:character.imageUrl,cols:character.cols,rows:character.rows,fps:character.fps,layout:character.layout,name:character.name}:null;}
function playerAsset(i,role){return players[i].booth||players[i][role]||defaults[role];}
async function refreshBoothCharacters(){
  if(boothRefreshPending)return;boothRefreshPending=true;
  try{const response=await fetch('api/characters',{cache:'no-store'});if(!response.ok)throw new Error();const data=await response.json(),characters=Array.isArray(data.characters)?data.characters.filter(item=>typeof item?.id==='string'&&typeof item?.name==='string'&&typeof item?.imageUrl==='string'):[];const signature=characters.map(item=>`${item.id}:${item.name}`).join('|');boothCharacters=characters;if(signature!==boothSignature){boothSignature=signature;players.forEach(p=>p.booth=boothAsset(p.boothCharacterId));await Promise.all(players.map(p=>p.booth).filter(Boolean).map(asset=>loadImage(asset.src).catch(()=>null)));if(lobby)renderPlayers();}}
  catch{}finally{boothRefreshPending=false;}
}
function renderPlayers(){
  const active=!lobby;
  $('players').replaceChildren();players.forEach((p,i)=>{
    const card=document.createElement('div');card.className=`player-card ${i===state.collector?'collector':''} ${p.control==='ai'?'ai':''}`;
    card.innerHTML=`<div class="player-top"><canvas class="portrait" width="88" height="88" aria-label="Player ${i+1} character"></canvas><div class="player-info"><strong style="color:${COLORS[i]}">Player ${i+1}</strong><small>${i===state.collector?'✦ COIN COLLECTOR':p.control==='ai'?'AI PURSUER':'PURSUER'}</small></div><button class="edit-character" aria-label="Customize Player ${i+1}" title="Import a custom sprite">✎</button></div><label class="player-select-label">Character<select class="character-select" aria-label="Player ${i+1} character"></select></label><label class="player-select-label">Controls<select class="control-select" aria-label="Player ${i+1} controls"></select></label>`;
    const select=card.querySelector('.control-select'),options=[['ai','Computer-controlled'],['wasd','Keyboard · WASD'],['arrows','Keyboard · Arrow keys'],...pads.map(g=>[`pad:${g.index}`,`Gamepad ${g.index+1}`])];
    if(p.control.startsWith('pad:')&&!options.some(([v])=>v===p.control))options.push([p.control,`${controlLabel(p.control)} · disconnected`]);
    options.forEach(([v,label])=>{const option=new Option(label,v);option.disabled=v!=='ai'&&players.some((other,j)=>j!==i&&other.control===v);select.add(option);});select.value=p.control;select.disabled=active;
    select.addEventListener('change',()=>{if(select.value!=='ai'&&players.some((other,j)=>j!==i&&other.control===select.value)){toast('Those controls are already assigned.');renderPlayers();return;}p.control=select.value;if(humanCount()){state=newRound(players,state.collector,state.round);}renderPlayers();savePreferences();});
    const characterSelect=card.querySelector('.character-select');characterSelect.add(new Option('Default / imported sprite',''));boothCharacters.forEach(character=>characterSelect.add(new Option(character.name,character.id)));if(p.boothCharacterId&&!boothCharacters.some(character=>character.id===p.boothCharacterId))characterSelect.add(new Option('Waiting for booth character…',p.boothCharacterId));characterSelect.value=p.boothCharacterId||'';characterSelect.disabled=active;
    characterSelect.addEventListener('change',async()=>{const id=characterSelect.value||null,asset=boothAsset(id);if(asset){characterSelect.disabled=true;try{await loadImage(asset.src);}catch{toast('That booth character could not be loaded.');renderPlayers();return;}}p.boothCharacterId=id;p.booth=asset;renderPlayers();savePreferences();});
    const edit=card.querySelector('.edit-character');edit.disabled=active;edit.onclick=()=>openEditor(i);$('players').append(card);
  });
  $('humanCount').textContent=`${humanCount()} / 4`;$('play').disabled=!lobby||!controlsValid();$('boardPlay')&&($('boardPlay').disabled=!controlsValid());
  $('play').innerHTML=lobby?'Start the chase <span>→</span>':'Chase in progress <span>✦</span>';
  $('startNote').textContent=humanCount()===0?'Choose a keyboard or gamepad to play.':!controlsValid()?'Reconnect the assigned gamepad to play.':`${boothCharacters.length} booth character${boothCharacters.length===1?'':'s'} ready · ${humanCount()} human${humanCount()===1?'':'s'} + ${4-humanCount()} AI`;
}
function start(){if(!lobby||!controlsValid())return false;activateAudio();state=newRound(players,state.collector,state.round);lobby=false;lastPhase='';renderPlayers();updateOverlay();return true;}
function returnLobby(){const ended=state.phase==='result';lobby=true;state=newRound(players,ended?nextCollector(players,state.collector):state.collector,state.round+(ended?1:0));lastPhase='';renderPlayers();updateOverlay();}
function nextRound(){state=newRound(players,nextCollector(players,state.collector),state.round+1);lobby=false;lastPhase='';renderPlayers();updateOverlay();}
function pause(reason='Take a breather. The dungeon can wait.'){
  if(lobby||!['countdown','playing'].includes(state.phase))return;
  pausedPhase=state.phase;state.phase='paused';pauseReason=reason;state.actors.forEach(a=>a.queued=null);updateOverlay();
}
function resume(){if(state.phase!=='paused')return false;if(!controlsValid()){toast('Reconnect the assigned gamepad, or return to the lobby.');return false;}state.phase=pausedPhase;lastPhase='';activateAudio();updateOverlay();return true;}
function togglePause(){if(state.phase==='paused')resume();else pause();}
function updateOverlay(){
  const phase=lobby?'lobby':state.phase,count=Math.ceil(state.countdown);if(phase===lastPhase&&(phase!=='countdown'||count===lastCount))return;lastPhase=phase;lastCount=count;
  const overlay=$('overlay');overlay.hidden=phase==='playing';$('pause').disabled=lobby||phase==='result';$('pause').textContent=phase==='paused'?'▶ Resume':'Ⅱ Pause';
  if(phase==='lobby'){overlay.innerHTML='<div class="overlay-card"><span class="eyebrow">THE DUNGEON IS WAITING</span><h2>Ready to make<br>a run for it?</h2><p>Gather the gold. Dodge the monsters.<br>Don’t get caught.</p><button id="boardPlay" class="primary-button">Enter the dungeon <span>→</span></button><span class="overlay-note">1–4 PLAYERS · ONE SCREEN</span></div>';$('boardPlay').onclick=start;$('boardPlay').disabled=!controlsValid();}
  if(phase==='countdown'){overlay.innerHTML=`<div class="overlay-card" aria-live="polite"><span class="eyebrow">PLAYER ${state.collector+1} COLLECTS</span><div class="countdown-number">${count}</div><p>Get ready. The chase is on.</p></div>`;}
  if(phase==='paused'){overlay.innerHTML='<div class="overlay-card"><span class="eyebrow">A MOMENT OF PEACE</span><h2>Chase paused.</h2><p id="pauseReason"></p><button id="resume" class="primary-button">Back to the chase <span>→</span></button><br><button id="leave" class="secondary-button">Return to lobby</button></div>';$('pauseReason').textContent=pauseReason;$('resume').onclick=resume;$('leave').onclick=returnLobby;}
  if(phase==='result'){const won=state.winner==='collector';overlay.innerHTML=`<div class="overlay-card" role="status"><span class="eyebrow">ROUND ${String(state.round).padStart(2,'0')} COMPLETE</span><h2>${won?'A golden escape!':'Caught in the act.'}</h2><p>${won?`Player ${state.collector+1} collected every coin.`:'The pursuers win this round.'}<br>${state.collected} / ${state.total} coins · ${Math.floor(state.elapsed)} seconds</p><button id="continue" class="primary-button">Next round <span>→</span></button><br><button id="leave" class="secondary-button">Return to lobby</button><span class="overlay-note">PLAYER ${nextCollector(players,state.collector)+1} COLLECTS NEXT</span></div>`;$('continue').onclick=nextRound;$('leave').onclick=returnLobby;}
}
const keys={KeyW:['wasd','up'],KeyA:['wasd','left'],KeyS:['wasd','down'],KeyD:['wasd','right'],ArrowUp:['arrows','up'],ArrowLeft:['arrows','left'],ArrowDown:['arrows','down'],ArrowRight:['arrows','right']};
document.addEventListener('keydown',e=>{
  if(e.target.closest('input,select,textarea')||document.querySelector('dialog[open]'))return;
  if(keys[e.code]&&!lobby){e.preventDefault();const [control,direction]=keys[e.code],a=state.actors.find(a=>a.control===control);if(a&&['playing','countdown'].includes(state.phase))a.queued=direction;}
  if(e.code==='Escape'&&!e.repeat){e.preventDefault();togglePause();}if(e.code==='KeyM'&&!e.repeat)toggleSound();
});
window.addEventListener('blur',()=>pause('The window lost focus. Resume when everyone is ready.'));
document.addEventListener('visibilitychange',()=>{if(document.hidden)pause('The game was hidden. Resume when everyone is ready.');});
function pollPads(){
  pads=connectedPads(navigator.getGamepads?.());
  const sig=pads.map(p=>p.index).join(',');if(sig!==padSignature){padSignature=sig;if(!controlsValid())pause('A player’s gamepad disconnected. Reconnect it to resume.');renderPlayers();$('controllerNote').textContent=pads.length?`${pads.length} gamepad${pads.length===1?'':'s'} detected. Choose one in a player’s control menu.`:'Connect a gamepad, then press any button to join.';}
  if(!lobby&&['playing','countdown'].includes(state.phase))for(const a of state.actors){if(!a.control.startsWith('pad:'))continue;const g=pads.find(p=>`pad:${p.index}`===a.control);if(!g)continue;const d=gamepadDirection(g);if(d)a.queued=d;}
}
function updateSound(){$('sound').textContent=muted?'♪̸':'♫';$('sound').setAttribute('aria-label',muted?'Unmute sound':'Mute sound');$('sound').setAttribute('aria-pressed',String(muted));}
function toggleSound(){muted=!muted;updateSound();savePreferences();}
$('sound').onclick=toggleSound;$('play').onclick=start;$('boardPlay').onclick=start;$('pause').onclick=togglePause;
$('help').onclick=()=>{pause();$('helpDialog').showModal();};
$('fullscreen').onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await $('boardWrap').requestFullscreen();}catch{toast('Full screen is unavailable in this browser view.');}};
function openEditor(i){characterEditor.open(i);}
let accumulator=0,last=performance.now();
function frame(now){const dt=Math.min((now-last)/1000,.1);last=now;pollPads();if(!lobby){accumulator+=dt;while(accumulator>=1/60){step(state,1/60).forEach(beep);accumulator-=1/60;}}else accumulator=0;updateOverlay();render(state,players,now/1000);$('coins').textContent=state.coins.size;$('roundLabel').textContent=`ROUND ${String(state.round).padStart(2,'0')}`;$('statusLabel').textContent=lobby?'WAITING FOR PARTY':state.phase==='playing'?'CHASE IN PROGRESS':state.phase.toUpperCase();
  document.querySelectorAll('.portrait').forEach((c,i)=>{const ctx=c.getContext('2d');ctx.clearRect(0,0,c.width,c.height);const role=i===state.collector?'collector':'pursuer';drawSprite(ctx,playerAsset(i,role),44,44,84,now/1000);});
  characterEditor.render(now/1000);requestAnimationFrame(frame);
}
await Promise.all(Object.values(defaults).map(a=>loadImage(a.src))).catch(()=>toast('Character artwork could not load. Please refresh.'));
  try{const saved=await readSettings();if(saved?.version===1&&Array.isArray(saved.players)&&saved.players.length===4){const used=new Set();for(let i=0;i<4;i++){const p=saved.players[i],control=p?.control;if(typeof control==='string'&&(/^(wasd|arrows|ai)$/.test(control)||/^pad:\d+$/.test(control))&&(control==='ai'||!used.has(control))){players[i].control=control;used.add(control);}else players[i].control='ai';players[i].boothCharacterId=typeof p?.boothCharacterId==='string'?p.boothCharacterId:null;for(const role of ['collector','pursuer'])if(p?.[role]){try{const a=validateSettings(p[role]);if(typeof a.src!=='string'||(!a.src.startsWith('data:image/png;base64,')&&!Object.values(defaults).some(d=>d.src===a.src)))continue;await loadImage(a.src);players[i][role]=a;}catch{toast('A saved character could not load. Its default has been restored.');}}}if(!humanCount())players[0].control='wasd';muted=!!saved.muted;state=newRound(players);}}catch{storageWarning=true;toast('Browser storage is unavailable. You can still play and import characters for this visit.');}
  await refreshBoothCharacters();setInterval(()=>{if(lobby)refreshBoothCharacters();},4000);
updateSound();
renderPlayers();updateOverlay();requestAnimationFrame(frame);
if(document.modelContext?.registerTool){
  const life=new AbortController();window.addEventListener('pagehide',()=>life.abort(),{once:true});
  const snapshot=()=>({phase:lobby?'lobby':state.phase,round:state.round,collector:state.collector+1,coinsRemaining:state.coins.size,humanPlayers:humanCount()});
  for(const tool of [
    {name:'get_dungeon_game_state',description:'Read round status, collector and remaining coins.',annotations:{readOnlyHint:true},execute:()=>snapshot()},
    {name:'start_dungeon_round',description:'Start the round with the controls currently chosen in the lobby.',execute:()=>{if(!start())throw new Error('A playable lobby with connected controls is required.');return snapshot();}},
    {name:'pause_dungeon_round',description:'Pause an active dungeon chase.',execute:()=>{if(lobby||!['playing','countdown'].includes(state.phase))throw new Error('No active round to pause.');pause();return snapshot();}}
  ]){try{Promise.resolve(document.modelContext.registerTool({...tool,inputSchema:{type:'object',properties:{},additionalProperties:false},execute:input=>{if(input===null||typeof input!=='object'||Object.keys(input).length)throw new Error('Expected an empty object.');return tool.execute();}},{signal:life.signal})).catch(()=>{});}catch{}}
}
