const $=id=>document.getElementById(id),passKey='pixel-dungeon-character-pass',guestKey='pixel-dungeon-guest-controller',params=new URLSearchParams(location.search);
const lobby=params.get('lobby'),lobbyToken=params.get('token'),slotKey=`pixel-dungeon-slot-${lobby||'none'}`,colors=['#bade80','#c7a7ff','#ff9f82','#84e8ff'];
let pass,characters=[],character,currentLobby,selectedSlot=Number(localStorage.getItem(slotKey)||0),pollPending=false;

function status(message,error=false){$('joinStatus').textContent=message;$('joinStatus').classList.toggle('error',error);}
function escapeHTML(value){return String(value).replace(/[&<>"']/g,character=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));}
function validInvite(){return /^[0-9a-f-]{36}$/i.test(lobby||'')&&typeof lobbyToken==='string'&&lobbyToken.length>10;}
function loadPass(){try{pass=JSON.parse(localStorage.getItem(passKey)||'null');}catch{pass=null;}return pass?.id?pass:null;}
function guestToken(){let token=localStorage.getItem(guestKey);if(!token||token.length<20){token=crypto.randomUUID();localStorage.setItem(guestKey,token);}return token;}
function slotState(slot){if(slot.slot===selectedSlot)return 'yours';if(slot.status==='joined')return 'occupied';if(slot.status==='ai')return 'ai';return 'open';}
function spriteMarkup(item,className='slot-avatar'){return `<span class="${className}" role="img" aria-label="${escapeHTML(item.name)} character" style="--sprite:url('${item.imageUrl}')"></span>`;}

function renderCharacter(){
  const available=!!character;$('selectedCharacter').hidden=!available;$('noCharacters').hidden=available;
  if(available){$('joinImage').style.setProperty('--sprite',`url('${character.imageUrl}')`);$('joinName').textContent=character.name;}
  const grid=$('characterGrid');grid.replaceChildren();
  for(const item of characters){const button=document.createElement('button'),own=item.id===pass?.id;button.type='button';button.className=`character-choice${item.id===character?.id?' selected':''}${own?' own':''}`;button.innerHTML=`${spriteMarkup(item,'character-choice-sprite')}<strong>${escapeHTML(item.name)}</strong>${own?'<small>YOUR DEFAULT</small>':''}`;button.setAttribute('aria-label',`${item.name}${own?', your default character':''}`);button.onclick=async()=>{character=item;renderCharacter();$('characterLibrary').close();if(selectedSlot)await claim(selectedSlot);else status(`${item.name} selected. Choose an open player slot.`);};grid.append(button);}
}

function renderSlots(){
  const grid=$('slotGrid');grid.replaceChildren();if(!currentLobby)return;
  if(selectedSlot&&!['joined'].includes(currentLobby.slots[selectedSlot-1]?.status)){selectedSlot=0;localStorage.removeItem(slotKey);}
  for(const slot of currentLobby.slots){
    const state=slotState(slot),button=document.createElement('button');button.type='button';button.className=`slot-choice ${state}`;button.style.setProperty('--player',colors[slot.slot-1]);button.setAttribute('aria-label',`Player ${slot.slot}: ${state==='open'?'available':state}`);
    const sprite=slot.character?.imageUrl||(state==='occupied'&&slot.slot===1?'../assets/adventurer.png':'');
    const image=sprite?`<span class="slot-avatar" role="img" aria-label="${escapeHTML(slot.character?.name||`Player ${slot.slot}`)} character" style="--sprite:url('${sprite}')"></span>`:'<span class="slot-silhouette" aria-hidden="true">?</span>';
    const label=state==='yours'?'YOUR SLOT':state==='open'?'TAP TO JOIN':state==='ai'?'AI PLAYER':slot.slot===1&&!slot.character?'HOST PLAYER':'OCCUPIED';
    button.innerHTML=`<span class="slot-badge">${slot.slot}</span>${image}<strong>${escapeHTML(slot.character?.name||`PLAYER ${slot.slot}`)}</strong><small>${label}</small>`;
    button.disabled=!character||state==='occupied'||state==='ai'||state==='yours';if(!button.disabled)button.onclick=()=>claim(slot.slot);grid.append(button);
  }
  $('readySlot').hidden=!selectedSlot;$('changeSlot').hidden=!selectedSlot;$('readySlot').textContent=currentLobby.slots[selectedSlot-1]?.ready?'✓ READY':'I’M READY  ✓';$('readySlot').disabled=!!currentLobby.slots[selectedSlot-1]?.ready;
  $('joinCopy').textContent=selectedSlot?`You are Player ${selectedSlot}. Choose another open quadrant to switch.`:'Tap an available quadrant to join the game.';
}

async function loadCharacters(){const response=await fetch('/api/characters',{cache:'no-store'}),data=await response.json();if(!response.ok)throw new Error(data.error||'The character library could not be loaded.');characters=Array.isArray(data.characters)?data.characters:[];loadPass();character=characters.find(item=>item.id===pass?.id)||characters[0]||null;renderCharacter();}
async function refreshLobby(showErrors=false){if(!validInvite()||pollPending)return;pollPending=true;try{const response=await fetch(`/api/lobbies/${encodeURIComponent(lobby)}`,{cache:'no-store'}),data=await response.json();if(!response.ok)throw new Error(data.error||'The lobby could not be loaded.');currentLobby=data.lobby;renderSlots();}catch(error){if(showErrors)status(error.message,true);}finally{pollPending=false;}}

async function claim(slot){if(!character)return;try{status(`Moving ${character.name} to Player ${slot}…`);const response=await fetch(`/api/lobbies/${encodeURIComponent(lobby)}/slots/${slot}/claim`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({lobbyToken,characterId:character.id,guestToken:guestToken()})}),data=await response.json();if(!response.ok)throw new Error(data.error||'That slot could not be joined.');currentLobby=data.lobby;selectedSlot=slot;localStorage.setItem(slotKey,String(slot));renderSlots();status(`${character.name} is now Player ${slot}.`);}catch(error){status(error.message,true);await refreshLobby();}}

$('readySlot').onclick=async()=>{if(!selectedSlot)return;try{$('readySlot').disabled=true;const response=await fetch(`/api/lobbies/${encodeURIComponent(lobby)}/slots/${selectedSlot}/ready`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({lobbyToken,guestToken:guestToken(),ready:true})}),data=await response.json();if(!response.ok)throw new Error(data.error||'Ready status could not be sent.');currentLobby=data.lobby;renderSlots();status('You’re ready. Look at the game screen for the countdown.');}catch(error){$('readySlot').disabled=false;status(error.message,true);}};
$('changeSlot').onclick=()=>{document.querySelector('.slot-choice.open')?.focus();status('Choose any glowing available quadrant.');};
$('chooseCharacter').onclick=()=>$('characterLibrary').showModal();

async function load(){
  if(!validInvite()){$('joinCopy').textContent='Scan the shared lobby QR from the matchmaking screen.';status('No active lobby invitation was found.',true);return;}
  try{await loadCharacters();}catch(error){status(error.message,true);$('noCharacters').hidden=false;}
  await refreshLobby(true);setInterval(()=>refreshLobby(),1500);
}
load();
