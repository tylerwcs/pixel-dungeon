import {mountLobbyScanner} from '../lobby-scanner.mjs?v=queue-1';
import {readPass} from '../job-client.mjs?v=design-1';
import {loadCharacterAsset,drawGreeting} from '../render.mjs?v=burst-1';
const $=id=>document.getElementById(id),passKey='pixel-dungeon-character-pass',guestKey='pixel-dungeon-guest-controller',params=new URLSearchParams(location.search);
const lobby=params.get('lobby'),lobbyToken=params.get('token'),slotKey=`pixel-dungeon-slot-${lobby||'none'}`,colors=['#bade80','#c7a7ff','#ff9f82','#84e8ff'];
let pass,characters=[],character,currentLobby,selectedSlot=Number(localStorage.getItem(slotKey)||0),pollPending=false;

function status(message,error=false){$('joinStatus').textContent=message;$('joinStatus').classList.toggle('error',error);}
function escapeHTML(value){return String(value).replace(/[&<>"']/g,character=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));}
function validInvite(){return /^[0-9a-f-]{36}$/i.test(lobby||'')&&typeof lobbyToken==='string'&&lobbyToken.length>10;}
function loadPass(){pass=readPass();return pass?.id?pass:null;}
function guestToken(){let token=localStorage.getItem(guestKey);if(!token||token.length<20){token=crypto.randomUUID();localStorage.setItem(guestKey,token);}return token;}
function slotState(slot){if(slot.slot===selectedSlot)return 'yours';if(slot.status==='joined')return 'occupied';if(slot.status==='ai')return 'ai';return 'open';}
const portraits=new Map();
function preparePortrait(item){if(!portraits.has(item.id)){portraits.set(item.id,null);loadCharacterAsset(item).then(asset=>portraits.set(item.id,asset)).catch(()=>portraits.delete(item.id));}}
function spriteMarkup(item,className='slot-avatar'){preparePortrait(item);return `<canvas class="${className}" data-character="${escapeHTML(item.id)}" width="220" height="220" aria-label="${escapeHTML(item.name)} character"></canvas>`;}
let portraitFrame=0;
function animatePortraits(time){for(const canvas of document.querySelectorAll('canvas[data-character]')){const asset=portraits.get(canvas.dataset.character);if(!asset)continue;const ctx=canvas.getContext('2d');ctx.clearRect(0,0,canvas.width,canvas.height);drawGreeting(ctx,asset,110,110,220,time/1000);}portraitFrame=requestAnimationFrame(animatePortraits);}
portraitFrame=requestAnimationFrame(animatePortraits);
window.addEventListener('pagehide',()=>cancelAnimationFrame(portraitFrame),{once:true});

function renderCharacter(){
  const available=!!character;$('selectedCharacter').hidden=!available;$('noCharacters').hidden=available;
  if(available){preparePortrait(character);$('joinImage').dataset.character=character.id;$('joinName').textContent=character.name;}
  const grid=$('characterGrid');grid.replaceChildren();
  for(const item of characters){const button=document.createElement('button'),own=item.id===pass?.id;button.type='button';button.className=`character-choice${item.id===character?.id?' selected':''}${own?' own':''}`;button.innerHTML=`${spriteMarkup(item,'character-choice-sprite')}<strong>${escapeHTML(item.name)}</strong>${own?'<small>YOUR DEFAULT</small>':''}`;button.setAttribute('aria-label',`${item.name}${own?', your default character':''}`);button.onclick=async()=>{character=item;renderCharacter();$('characterLibrary').close();if(selectedSlot)await claim(selectedSlot);else status(`${item.name} selected. Choose an open player slot.`);};grid.append(button);}
  if(!characters.length){const empty=document.createElement('p');empty.className='character-library-empty';empty.textContent='No shared characters are available yet.';grid.append(empty);}
}

function renderSlots(){
  const grid=$('slotGrid');grid.replaceChildren();if(!currentLobby)return;
  if(selectedSlot&&!['joined'].includes(currentLobby.slots[selectedSlot-1]?.status)){selectedSlot=0;localStorage.removeItem(slotKey);}
  for(const slot of currentLobby.slots){
    const state=slotState(slot),button=document.createElement('button');button.type='button';button.className=`slot-choice ${state}`;button.style.setProperty('--player',colors[slot.slot-1]);button.setAttribute('aria-label',`Player ${slot.slot}: ${state==='open'?'available':state}`);
    const sprite=slot.character?.imageUrl||(state==='occupied'&&slot.slot===1?'../assets/adventurer.png':'');
    const image=sprite?spriteMarkup(slot.character||{id:'host',name:'Host player',imageUrl:sprite,cols:4,rows:4,fps:8,layout:'directional'}):'<span class="slot-silhouette" aria-hidden="true">?</span>';
    const label=state==='yours'?'YOUR SLOT':state==='open'?'TAP TO JOIN':state==='ai'?'AI PLAYER':slot.slot===1&&!slot.character?'HOST PLAYER':'OCCUPIED';
    button.innerHTML=`<span class="slot-badge">${slot.slot}</span>${image}<strong>${escapeHTML(slot.character?.name||`PLAYER ${slot.slot}`)}</strong><small>${label}</small>`;
    button.disabled=!character||state==='occupied'||state==='ai'||state==='yours';if(!button.disabled)button.onclick=()=>claim(slot.slot);grid.append(button);
  }
  $('readySlot').hidden=!selectedSlot;$('readySlot').textContent=currentLobby.slots[selectedSlot-1]?.ready?'✓ READY':'I’M READY  ✓';$('readySlot').disabled=!!currentLobby.slots[selectedSlot-1]?.ready;
  $('joinCopy').textContent=selectedSlot?`You are Player ${selectedSlot}. Choose another open quadrant to switch.`:'Tap an available quadrant to join the game.';
}

async function loadCharacters(){const response=await fetch('/api/characters',{cache:'no-store'}),data=await response.json();if(!response.ok)throw new Error(data.error||'The character library could not be loaded.');characters=Array.isArray(data.characters)?data.characters:[];loadPass();if(pass?.id&&!characters.some(item=>item.id===pass.id)){const response=await fetch(`/api/characters/${encodeURIComponent(pass.id)}/pass`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({claimToken:pass.claimToken})});if(response.ok)characters.unshift((await response.json()).character);}character=characters.find(item=>item.id===pass?.id)||characters[0]||null;renderCharacter();}
async function refreshLobby(showErrors=false){if(!validInvite()||pollPending)return;pollPending=true;try{const response=await fetch(`/api/lobbies/${encodeURIComponent(lobby)}`,{cache:'no-store'}),data=await response.json();if(!response.ok)throw new Error(data.error||'The lobby could not be loaded.');currentLobby=data.lobby;renderSlots();}catch(error){if(showErrors)status(error.message,true);}finally{pollPending=false;}}

async function claim(slot){if(!character)return;try{status(`Moving ${character.name} to Player ${slot}…`);const response=await fetch(`/api/lobbies/${encodeURIComponent(lobby)}/slots/${slot}/claim`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({lobbyToken,characterId:character.id,guestToken:guestToken()})}),data=await response.json();if(!response.ok)throw new Error(data.error||'That slot could not be joined.');currentLobby=data.lobby;selectedSlot=slot;localStorage.setItem(slotKey,String(slot));renderSlots();status(`${character.name} is now Player ${slot}.`);}catch(error){status(error.message,true);await refreshLobby();}}

$('readySlot').onclick=async()=>{if(!selectedSlot)return;try{$('readySlot').disabled=true;const response=await fetch(`/api/lobbies/${encodeURIComponent(lobby)}/slots/${selectedSlot}/ready`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({lobbyToken,guestToken:guestToken(),ready:true})}),data=await response.json();if(!response.ok)throw new Error(data.error||'Ready status could not be sent.');currentLobby=data.lobby;renderSlots();status('You’re ready. Look at the game screen for the countdown.');}catch(error){$('readySlot').disabled=false;status(error.message,true);}};
async function openCharacterLibrary(){try{status('Refreshing the shared character lobby…');await loadCharacters();$('characterLibrary').showModal();status(characters.length?'Choose a shared character.':'The shared character lobby is empty right now.');}catch(error){status(error.message,true);}}
$('chooseCharacter').onclick=openCharacterLibrary;
$('browseCharacters').onclick=openCharacterLibrary;

async function load(){
  const invited=validInvite();$('slotGrid').hidden=!invited;$('scanIntro').hidden=invited;
  if(!invited){$('slotPickerTitle').textContent='Join the dungeon';$('joinCopy').textContent='Scan the shared lobby QR from the game screen.';}
  try{await loadCharacters();}catch(error){status(error.message,true);$('noCharacters').hidden=false;}
  if(!invited){$('scanIntro').textContent=pass?.id?'Your character pass is ready. Scan the lobby QR on the game screen to choose a player slot.':'Scan the game screen’s lobby QR, then choose a character and player slot.';status('Ready to scan a lobby QR.');return;}
  await refreshLobby(true);setInterval(()=>refreshLobby(),1500);
}
$('scanLobby').onclick=mountLobbyScanner($('lobbyScanner'),url=>location.assign(url));
load();
