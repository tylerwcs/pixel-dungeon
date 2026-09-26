import {newRound,nextCollector,step,roundScores,rankScores,COLORS,GAME_ROUNDS,CATCH_BONUS} from './engine.mjs';
import {loadImage,drawSprite,defaults,identityAsset,createRenderer} from './render.mjs?v=booth-identity-1';
import {readSettings,writeSettings} from './preferences.mjs';
import {connectedPads,controlsAvailable,gamepadDirection} from './input.mjs';
import {drawQR} from './qr.mjs';

const $=id=>document.getElementById(id);
const escapeHTML=value=>String(value).replace(/[&<>"']/g,character=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
const players=Array.from({length:4},(_,i)=>({control:i===0?'wasd':'ai',slotStatus:i===0?'joined':'open',ready:false,booth:null,remoteCharacterId:null}));
let state=newRound(players),lobby=true,muted=false,audio=null,pausedPhase='playing',pauseReason='',lastPhase='',lastCount=-1;
let scores=Array(4).fill(0),scoreDetails=Array.from({length:4},()=>({collected:0,bonus:0})),roundSettled=false;
let pads=[],padSignature='',toastTimer,lobbySession=null,lobbyInitPromise=null,lobbyRetryTimer,lobbyPollPending=false,lobbySignature='';
const render=createRenderer($('game')),lobbyDialog=$('lobbyDialog');let storageWarning=false;

async function savePreferences(){try{await writeSettings({version:3,muted});}catch{if(!storageWarning){storageWarning=true;toast('Browser storage is unavailable. Changes will last for this visit only.');}}}
function toast(message){$('toast').textContent=message;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,4500);}
function beep(kind){if(muted||!audio)return;const now=audio.currentTime,notes=kind==='coin'?[720,960]:kind==='win'?[523,659,784,1047]:[250,180,110];notes.forEach((frequency,index)=>{const oscillator=audio.createOscillator(),gain=audio.createGain();oscillator.type='square';oscillator.frequency.value=frequency;gain.gain.setValueAtTime(.025,now+index*.075);gain.gain.exponentialRampToValueAtTime(.001,now+index*.075+.095);oscillator.connect(gain);gain.connect(audio.destination);oscillator.start(now+index*.075);oscillator.stop(now+index*.075+.1);});}
async function activateAudio(){try{audio??=new (window.AudioContext||window.webkitAudioContext)();await audio.resume();}catch{}}
function humanCount(){return players.filter(player=>player.slotStatus==='joined'&&player.control!=='ai').length;}
function controlsValid(){return players.every(player=>player.slotStatus!=='open'&&player.control!=='pending')&&controlsAvailable(players,pads);}
function everyoneReady(){return controlsValid()&&players.every(player=>player.ready);}
function playerAsset(index){return identityAsset(players,index);}
function displayedScore(index){return scores[index]+(!roundSettled&&state.collector===index?state.collected:0);}
function updateScoreHud(){for(let index=0;index<players.length;index++){const node=$(`hudControl${index}`);if(node)node.textContent=`◆ ${displayedScore(index)} GOLD`;}}
function resetScoring(){scores=Array(4).fill(0);scoreDetails=Array.from({length:4},()=>({collected:0,bonus:0}));roundSettled=false;}
function settleRound(){if(roundSettled||state.phase!=='result')return;const earned=roundScores(state);scores=scores.map((score,index)=>score+earned[index]);scoreDetails[state.collector].collected+=state.collected;for(const id of state.catchers)scoreDetails[id].bonus+=CATCH_BONUS;roundSettled=true;updateScoreHud();}
function characterLabel(asset){return asset?.name||'Dungeon character';}
function availableControls(index){const used=new Set(players.map((player,i)=>i===index||player.slotStatus!=='joined'?null:player.control).filter(Boolean));return ['wasd','arrows',...pads.map(gamepad=>`pad:${gamepad.index}`)].filter(control=>!used.has(control));}
function assignControl(index){const player=players[index];if(player.control!=='ai'&&player.control!=='pending'&&!players.some((other,i)=>i!==index&&other.slotStatus==='joined'&&other.control===player.control))return;player.control=availableControls(index)[0]||'pending';}

function ensureLobby(){
  if(lobbySession)return Promise.resolve(true);
  if(lobbyInitPromise)return lobbyInitPromise;
  lobbyInitPromise=(async()=>{
    try{
      const response=await fetch('/api/lobbies',{method:'POST',headers:{'content-type':'application/json'},body:'{}'}),data=await response.json();
      if(!response.ok)throw new Error(data.error||'The lobby could not be created.');
      lobbySession={id:data.lobby.id,hostToken:data.hostToken,joinUrl:data.joinUrl};clearTimeout(lobbyRetryTimer);await applyLobby(data.lobby);return true;
    }catch(error){
      toast(`${error.message} Reconnecting…`);$('lobbyStatusTitle').textContent='RECONNECTING';$('startNote').textContent='Reconnecting the shared lobby…';
      clearTimeout(lobbyRetryTimer);lobbyRetryTimer=setTimeout(()=>ensureLobby(),2500);return false;
    }finally{lobbyInitPromise=null;}
  })();
  return lobbyInitPromise;
}
async function applyLobby(serverLobby){
  const signature=JSON.stringify(serverLobby.slots);if(signature===lobbySignature)return;lobbySignature=signature;
  for(const slot of serverLobby.slots){const index=slot.slot-1,player=players[index],previousStatus=player.slotStatus;player.slotStatus=slot.status;player.ready=!!slot.ready;
    if(slot.status==='open'){player.control='ai';player.booth=null;player.remoteCharacterId=null;}
    if(slot.status==='ai'){player.control='ai';player.booth=null;player.remoteCharacterId=null;player.ready=true;}
    if(slot.status==='joined'){
      if(slot.character&&(previousStatus!=='joined'||player.control==='ai'))assignControl(index);
      if(slot.character&&player.remoteCharacterId!==slot.character.id){const asset={src:slot.character.imageUrl,cols:slot.character.cols,rows:slot.character.rows,fps:slot.character.fps,layout:slot.character.layout,name:slot.character.name};try{await loadImage(asset.src);player.booth=asset;player.remoteCharacterId=slot.character.id;}catch{toast(`Player ${slot.slot}’s character could not be loaded.`);}}
    }
  }
  if(lobby)state=newRound(players,state.collector,state.round);renderPlayers();
}
async function refreshLobby(){if(!lobby||!lobbySession||lobbyPollPending)return;lobbyPollPending=true;try{const response=await fetch(`/api/lobbies/${lobbySession.id}`,{cache:'no-store'}),data=await response.json();if(!response.ok)throw new Error(data.error);await applyLobby(data.lobby);}catch{}finally{lobbyPollPending=false;}}
async function updateSlot(index,action,payload){if(!lobbySession&&!await ensureLobby())throw new Error('The lobby is reconnecting. Please try again in a moment.');const response=await fetch(`/api/lobbies/${lobbySession.id}/slots/${index+1}/${action}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload())}),data=await response.json();if(!response.ok)throw new Error(data.error||'The player slot could not be updated.');await applyLobby(data.lobby);}
async function setAI(index,enabled){try{await updateSlot(index,'ai',()=>({hostToken:lobbySession.hostToken,ai:enabled}));}catch(error){toast(error.message);}}
async function setReady(index,ready){try{await updateSlot(index,'ready',()=>({hostToken:lobbySession.hostToken,ready}));}catch(error){toast(error.message);}}
async function resetLobbyReadiness(){
 for(let index=0;index<players.length;index+=1){
  if(players[index].slotStatus==='joined')await setReady(index,false);
 }
}

function renderPlayers(){
  const active=!lobby;document.querySelectorAll('#players > *').forEach(element=>element.remove());
  players.forEach((player,index)=>{
    const ai=player.slotStatus==='ai',open=player.slotStatus==='open';
    const card=document.createElement('article');card.className=`player-card ${index===state.collector?'collector':''} ${ai?'ai':''} ${open?'open':''} ${player.ready?'ready':''}`;card.style.setProperty('--player',COLORS[index]);
    const action=ai?`<button class="summary-action reopen-slot" type="button"><span>◆ AI PLAYER</span><small>OPEN THIS SLOT</small></button>`:`<button class="summary-action ai-action" type="button"><span>＋ ADD AI</span><small>${open?'FILL THIS SLOT':'REPLACE PLAYER'}</small></button>`;
    const characterName=open?'OPEN SLOT':characterLabel(playerAsset(index));
    card.innerHTML=`<div class="player-card-head"><span class="player-badge">${index+1}</span></div><div class="player-card-body"><div class="character-tile"><canvas class="portrait" width="220" height="220" aria-label="Player ${index+1} character"></canvas><strong>PLAYER ${index+1}</strong></div><div class="player-summary"><div class="player-info"><strong>${escapeHTML(characterName)}</strong></div>${action}</div></div><button class="ready-button ${player.ready?'ready':''}" type="button">${open?'WAITING TO JOIN':ai?'◆ AI READY':player.ready?'✓ READY':'PRESS READY'}</button>`;
    $('players').append(card);
    card.querySelectorAll('.ai-action').forEach(button=>button.onclick=()=>setAI(index,true));const reopen=card.querySelector('.reopen-slot');if(reopen)reopen.onclick=()=>setAI(index,false);
    const readyButton=card.querySelector('.ready-button');readyButton.disabled=active||open||ai||player.control==='pending';readyButton.onclick=()=>setReady(index,!player.ready);
    const roleLabel=$(`hudRole${index}`);if(roleLabel)roleLabel.textContent=index===state.collector?'COLLECTOR':'PURSUER';
  });
  const joinLink=$('lobbyJoin'),joinQr=$('lobbyQr');if(joinLink)joinLink.href=lobbySession?.joinUrl||'#';if(joinQr&&lobbySession?.joinUrl)drawQR(joinQr,lobbySession.joinUrl,{dark:'#070914',light:'#ffffff'});
  updateScoreHud();const ready=everyoneReady();$('humanCount').textContent=`${humanCount()} / 4 HUMAN`;$('play').disabled=!lobby||!ready;$('boardPlay')&&($('boardPlay').disabled=!ready);$('play').innerHTML='START CHASE <span>▶</span>';$('lobbyStatusTitle').textContent=ready?'ALL PLAYERS READY':'WAITING FOR PLAYERS';$('startNote').textContent=!lobbySession?'Preparing the shared lobby code…':players.some(player=>player.slotStatus==='open')?'Scan the lobby code or add an AI player.':!controlsValid()?'Connect controls for every human player.':ready?'All players are ready.':'Ready every human player';
}

function openLobby(){if(!lobbyDialog.open)lobbyDialog.showModal();}
function hidePodium(){$('podiumScreen').hidden=true;$('podiumScreen').replaceChildren();}
function start(){if(!lobby||!everyoneReady())return false;activateAudio();resetScoring();state=newRound(players,0,1);lobby=false;hidePodium();if(lobbyDialog.open)lobbyDialog.close();lastPhase='';renderPlayers();updateOverlay();return true;}
async function returnLobby(){lobby=true;hidePodium();resetScoring();await resetLobbyReadiness();state=newRound(players,0,1);lastPhase='';renderPlayers();updateOverlay();openLobby();}
function nextRound(){if(state.round>=GAME_ROUNDS){showPodium();return;}state=newRound(players,nextCollector(players,state.collector),state.round+1);roundSettled=false;lobby=false;lastPhase='';renderPlayers();updateOverlay();}
function playAgain(){hidePodium();resetScoring();state=newRound(players,0,1);lobby=false;lastPhase='';renderPlayers();updateOverlay();}
function podiumCard(entry,place,compact=false){const detail=scoreDetails[entry.index];return `<article class="podium-entry rank-${place}${compact?' podium-fourth':''}" style="--player:${COLORS[entry.index]}"><span class="podium-place">${place}</span><div class="podium-player"><canvas class="podium-portrait" data-podium-player="${entry.index}" width="220" height="220" aria-label="Player ${entry.index+1} character"></canvas><strong>PLAYER ${entry.index+1}</strong><span>${entry.score} GOLD</span>${compact?'':`<small>${detail.collected} collected${detail.bonus?` · +${detail.bonus} catches`:''}</small>`}</div>${compact?'':`<div class="podium-step"><b>${place}</b></div>`}</article>`;}
function confettiMarkup(){const colors=['#ffe49b','#f59b83','#b8a2ee','#88cddd','#bade80'];return Array.from({length:42},(_,index)=>`<i style="--x:${(index*37)%101}%;--static-y:${8+(index*29)%84}%;--tilt:${(index*47)%180}deg;--delay:-${(index%11)*.43}s;--duration:${4.6+(index%7)*.34}s;--drift:${(index%2?-1:1)*(18+(index%5)*8)}px;--color:${colors[index%colors.length]}"></i>`).join('');}
function showPodium(){
  settleRound();const ranking=rankScores(scores),winner=ranking[0],screen=$('podiumScreen');
  screen.innerHTML=`<div class="podium-panel"><img class="podium-event-logo" src="assets/yep-event-logo.webp" alt="Ecopiana Year End Party 2026"><div class="podium-confetti" aria-hidden="true">${confettiMarkup()}</div><header class="podium-heading"><span class="eyebrow">GAME COMPLETE · FINAL RANKINGS</span><h2 id="podiumTitle">PLAYER ${winner.index+1} WINS!</h2></header><div class="podium-results"><div class="podium-stage"><div class="podium-top-three">${podiumCard(ranking[1],2)}${podiumCard(ranking[0],1)}${podiumCard(ranking[2],3)}</div>${podiumCard(ranking[3],4,true)}</div></div><footer class="podium-actions"><button id="playAgain" class="primary-button">PLAY AGAIN <span>▶</span></button><button id="podiumLobby" class="secondary-button">RETURN TO LOBBY</button></footer></div>`;
  screen.hidden=false;$('playAgain').onclick=playAgain;$('podiumLobby').onclick=returnLobby;
}
function pause(reason='Take a breather. The dungeon can wait.'){if(lobby||!['countdown','playing'].includes(state.phase))return;pausedPhase=state.phase;state.phase='paused';pauseReason=reason;state.actors.forEach(actor=>actor.queued=null);updateOverlay();}
function resume(){if(state.phase!=='paused')return false;if(!controlsValid()){toast('Reconnect the assigned gamepad, or return to the lobby.');return false;}state.phase=pausedPhase;lastPhase='';activateAudio();updateOverlay();return true;}
function togglePause(){if(state.phase==='paused')resume();else pause();}
function updateOverlay(){
  const phase=lobby?'lobby':state.phase,count=Math.ceil(state.countdown);if(phase===lastPhase&&(phase!=='countdown'||count===lastCount))return;lastPhase=phase;lastCount=count;
  const overlay=$('overlay');overlay.hidden=phase==='playing';$('pause').disabled=lobby||phase==='result';$('pause').textContent=phase==='paused'?'▶ Resume':'Ⅱ Pause';
  if(phase==='lobby'){overlay.innerHTML='<div class="overlay-card"><span class="eyebrow">THE DUNGEON IS WAITING</span><h2>Ready to make<br>a run for it?</h2><p>Four rounds. Every player gets one turn collecting gold.</p><button id="boardPlay" class="primary-button">Open matchmaking lobby <span>→</span></button><span class="overlay-note">1–4 PLAYERS · ONE SCREEN</span></div>';$('boardPlay').onclick=openLobby;}
  if(phase==='countdown')overlay.innerHTML=`<div class="overlay-card" aria-live="polite"><span class="eyebrow">PLAYER ${state.collector+1} COLLECTS</span><div class="countdown-number">${count}</div><p>Get ready. The chase is on.</p></div>`;
  if(phase==='paused'){overlay.innerHTML='<div class="overlay-card"><span class="eyebrow">A MOMENT OF PEACE</span><h2>Chase paused.</h2><p id="pauseReason"></p><button id="resume" class="primary-button">Back to the chase <span>→</span></button><br><button id="leave" class="secondary-button">Return to lobby</button></div>';$('pauseReason').textContent=pauseReason;$('resume').onclick=resume;$('leave').onclick=returnLobby;}
  if(phase==='result'){
    settleRound();
    if(state.round>=GAME_ROUNDS){overlay.hidden=true;showPodium();return;}
    const won=state.winner==='collector',catcherText=state.catchers.length?`${state.catchers.map(id=>`Player ${id+1}`).join(' & ')} earned +${CATCH_BONUS} gold.`:'';
    overlay.innerHTML=`<div class="overlay-card" role="status"><span class="eyebrow">ROUND ${String(state.round).padStart(2,'0')} COMPLETE</span><h2>${won?'A golden escape!':'Caught in the act.'}</h2><p>Player ${state.collector+1} banked ${state.collected} gold.${catcherText?`<br>${catcherText}`:''}<br>${Math.floor(state.elapsed)} seconds</p><button id="continue" class="primary-button">Next round <span>→</span></button><br><button id="leave" class="secondary-button">Return to lobby</button><span class="overlay-note">PLAYER ${nextCollector(players,state.collector)+1} COLLECTS NEXT</span></div>`;$('continue').onclick=nextRound;$('leave').onclick=returnLobby;
  }
}

const keys={KeyW:['wasd','up'],KeyA:['wasd','left'],KeyS:['wasd','down'],KeyD:['wasd','right'],ArrowUp:['arrows','up'],ArrowLeft:['arrows','left'],ArrowDown:['arrows','down'],ArrowRight:['arrows','right']};
document.addEventListener('keydown',event=>{if(event.target.closest('input,select,textarea')||document.querySelector('dialog[open]'))return;if(keys[event.code]&&!lobby){event.preventDefault();const [control,direction]=keys[event.code],actor=state.actors.find(candidate=>candidate.control===control);if(actor&&['playing','countdown'].includes(state.phase))actor.queued=direction;}if(event.code==='Escape'&&!event.repeat){event.preventDefault();togglePause();}if(event.code==='KeyM'&&!event.repeat)toggleSound();});
window.addEventListener('blur',()=>pause('The window lost focus. Resume when everyone is ready.'));document.addEventListener('visibilitychange',()=>{if(document.hidden)pause('The game was hidden. Resume when everyone is ready.');});
function pollPads(){pads=connectedPads(navigator.getGamepads?.());const signature=pads.map(gamepad=>gamepad.index).join(',');if(signature!==padSignature){padSignature=signature;players.forEach((player,index)=>{if(player.slotStatus==='joined'&&player.control==='pending')assignControl(index);});if(!controlsValid())pause('A player’s gamepad disconnected. Reconnect it to resume.');renderPlayers();$('controllerNote').textContent=pads.length?`${pads.length} gamepad${pads.length===1?'':'s'} detected. Player controls are ready.`:'Connect gamepads for Players 3 and 4 before they join.';}if(!lobby&&['playing','countdown'].includes(state.phase))for(const actor of state.actors){if(!actor.control.startsWith('pad:'))continue;const gamepad=pads.find(candidate=>`pad:${candidate.index}`===actor.control);if(!gamepad)continue;const direction=gamepadDirection(gamepad);if(direction)actor.queued=direction;}}
function updateSound(){$('sound').textContent='♫';$('sound').classList.toggle('is-muted',muted);$('sound').setAttribute('aria-label',muted?'Unmute sound':'Mute sound');$('sound').setAttribute('aria-pressed',String(muted));}
function toggleSound(){muted=!muted;updateSound();savePreferences();}
$('sound').onclick=toggleSound;$('play').onclick=start;$('boardPlay').onclick=openLobby;$('pause').onclick=togglePause;$('lobbyDialog').addEventListener('cancel',event=>{if(lobby)event.preventDefault();});$('help').onclick=()=>{pause();$('helpDialog').showModal();};$('fullscreen').onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await document.querySelector('.game-stage').requestFullscreen();}catch{toast('Full screen is unavailable in this browser view.');}};
let accumulator=0,last=performance.now();
function frame(now){
  const delta=Math.min((now-last)/1000,.1);last=now;pollPads();
  if(!lobby){accumulator+=delta;while(accumulator>=1/60){const events=step(state,1/60);events.forEach(beep);if(state.phase==='result')settleRound();accumulator-=1/60;}}else accumulator=0;
  updateOverlay();updateScoreHud();render(state,players,now/1000);$('coins').textContent=state.coins.size;$('roundLabel').textContent=`ROUND ${String(state.round).padStart(2,'0')} / ${String(GAME_ROUNDS).padStart(2,'0')}`;$('roundCrown').textContent=`ROUND ${String(state.round).padStart(2,'0')} / ${String(GAME_ROUNDS).padStart(2,'0')}`;$('statusLabel').textContent=lobby?'WAITING FOR PARTY':state.phase==='playing'?'CHASE IN PROGRESS':state.phase.toUpperCase();
  document.querySelectorAll('.portrait').forEach((canvas,index)=>{const context=canvas.getContext('2d');context.clearRect(0,0,canvas.width,canvas.height);if(players[index].slotStatus==='open')return;drawSprite(context,playerAsset(index),110,104,190,now/1000);});
  document.querySelectorAll('.game-portrait').forEach(canvas=>{const index=Number(canvas.dataset.player),context=canvas.getContext('2d');context.clearRect(0,0,canvas.width,canvas.height);drawSprite(context,playerAsset(index),88,88,156,now/1000);});
  document.querySelectorAll('.podium-portrait').forEach(canvas=>{const context=canvas.getContext('2d'),index=Number(canvas.dataset.podiumPlayer);context.clearRect(0,0,canvas.width,canvas.height);drawSprite(context,playerAsset(index),110,108,190,now/1000);});
  requestAnimationFrame(frame);
}

await Promise.all(Object.values(defaults).map(asset=>loadImage(asset.src))).catch(()=>toast('Character artwork could not load. Please refresh.'));
try{const saved=await readSettings();if(saved?.muted)muted=true;}catch{storageWarning=true;}
await ensureLobby();setInterval(refreshLobby,1000);updateSound();renderPlayers();updateOverlay();openLobby();requestAnimationFrame(frame);

if(document.modelContext?.registerTool){const life=new AbortController();window.addEventListener('pagehide',()=>life.abort(),{once:true});const snapshot=()=>({phase:lobby?'lobby':state.phase,round:state.round,rounds:GAME_ROUNDS,collector:state.collector+1,coinsRemaining:state.coins.size,scores:[...scores],humanPlayers:humanCount()});for(const tool of [{name:'get_dungeon_game_state',description:'Read round status, collector, remaining coins and game scores.',annotations:{readOnlyHint:true},execute:()=>snapshot()},{name:'start_dungeon_round',description:'Start the game when every lobby slot is filled and ready.',execute:()=>{if(!start())throw new Error('Every player slot must be filled and ready.');return snapshot();}},{name:'pause_dungeon_round',description:'Pause an active dungeon chase.',execute:()=>{if(lobby||!['playing','countdown'].includes(state.phase))throw new Error('No active round to pause.');pause();return snapshot();}}]){try{Promise.resolve(document.modelContext.registerTool({...tool,inputSchema:{type:'object',properties:{},additionalProperties:false},execute:input=>{if(input===null||typeof input!=='object'||Object.keys(input).length)throw new Error('Expected an empty object.');return tool.execute();}},{signal:life.signal})).catch(()=>{});}catch{}}}
