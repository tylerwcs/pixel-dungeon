const $=id=>document.getElementById(id),storageKey='pixel-dungeon-character-pass',params=new URLSearchParams(location.search);
const lobby=params.get('lobby'),lobbyToken=params.get('token'),colors=['#bade80','#c7a7ff','#ff9f82','#84e8ff'];
let pass,currentLobby,selectedSlot=0,pollPending=false;

function status(message,error=false){$('joinStatus').textContent=message;$('joinStatus').classList.toggle('error',error);}
function validInvite(){return /^[0-9a-f-]{36}$/i.test(lobby||'')&&typeof lobbyToken==='string'&&lobbyToken.length>10;}
function loadPass(){try{pass=JSON.parse(localStorage.getItem(storageKey)||'null');}catch{pass=null;}return !!(pass?.id&&pass?.claimToken);}
function slotState(slot){if(pass?.id&&slot.character?.id===pass.id)return 'yours';if(slot.status==='joined')return 'occupied';if(slot.status==='ai')return 'ai';return 'open';}

function renderSlots(){
  const grid=$('slotGrid');grid.replaceChildren();if(!currentLobby)return;
  selectedSlot=pass?.id?currentLobby.slots.find(slot=>slot.character?.id===pass.id)?.slot||0:0;
  for(const slot of currentLobby.slots){
    const state=slotState(slot),button=document.createElement('button');button.type='button';button.className=`slot-choice ${state}`;button.style.setProperty('--player',colors[slot.slot-1]);button.setAttribute('aria-label',`Player ${slot.slot}: ${state==='open'?'available':state}`);
    const sprite=slot.character?.imageUrl||(state==='occupied'&&slot.slot===1?'../assets/adventurer.png':'');
    const image=sprite?`<span class="slot-avatar" role="img" aria-label="${slot.character?.name||`Player ${slot.slot}`} character" style="--sprite:url('${sprite}')"></span>`:'<span class="slot-silhouette" aria-hidden="true">?</span>';
    const label=state==='yours'?'YOUR CHARACTER':state==='open'?'TAP TO JOIN':state==='ai'?'AI PLAYER':slot.slot===1&&!slot.character?'HOST PLAYER':'OCCUPIED';
    button.innerHTML=`<span class="slot-badge">${slot.slot}</span>${image}<strong>PLAYER ${slot.slot}</strong><small>${label}</small>`;
    button.disabled=!pass||state==='occupied'||state==='ai'||state==='yours';if(!button.disabled)button.onclick=()=>claim(slot.slot);grid.append(button);
  }
  $('readySlot').hidden=!selectedSlot;$('changeSlot').hidden=!selectedSlot;$('readySlot').textContent=currentLobby.slots[selectedSlot-1]?.ready?'✓ READY':'I’M READY  ✓';$('readySlot').disabled=!!currentLobby.slots[selectedSlot-1]?.ready;
  $('joinCopy').textContent=selectedSlot?`You are Player ${selectedSlot}. Choose another open quadrant to switch.`:'Tap an available quadrant to join the game.';
}

async function refreshLobby(showErrors=false){if(!validInvite()||pollPending)return;pollPending=true;try{const response=await fetch(`/api/lobbies/${encodeURIComponent(lobby)}`,{cache:'no-store'}),data=await response.json();if(!response.ok)throw new Error(data.error||'The lobby could not be loaded.');currentLobby=data.lobby;renderSlots();}catch(error){if(showErrors)status(error.message,true);}finally{pollPending=false;}}

async function claim(slot){try{status(`Moving ${pass.name} to Player ${slot}…`);const response=await fetch(`/api/lobbies/${encodeURIComponent(lobby)}/slots/${slot}/claim`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({lobbyToken,characterId:pass.id,claimToken:pass.claimToken})}),data=await response.json();if(!response.ok)throw new Error(data.error||'That slot could not be joined.');currentLobby=data.lobby;renderSlots();status(`${pass.name} is now Player ${slot}.`);}catch(error){status(error.message,true);await refreshLobby();}}

$('readySlot').onclick=async()=>{if(!selectedSlot)return;try{$('readySlot').disabled=true;const response=await fetch(`/api/lobbies/${encodeURIComponent(lobby)}/slots/${selectedSlot}/ready`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({lobbyToken,characterId:pass.id,claimToken:pass.claimToken,ready:true})}),data=await response.json();if(!response.ok)throw new Error(data.error||'Ready status could not be sent.');currentLobby=data.lobby;renderSlots();status('You’re ready. Look at the game screen for the countdown.');}catch(error){$('readySlot').disabled=false;status(error.message,true);}};
$('changeSlot').onclick=()=>{document.querySelector('.slot-choice.open')?.focus();status('Choose any glowing available quadrant.');};
$('clearPass').onclick=()=>{localStorage.removeItem(storageKey);location.reload();};

async function load(){
  if(!validInvite()){$('joinCopy').textContent='Scan the shared lobby QR from the matchmaking screen.';status('No active lobby invitation was found.',true);return;}
  if(loadPass()){$('savedPass').hidden=false;$('joinImage').style.setProperty('--sprite',`url('${pass.imageUrl}')`);$('joinName').textContent=pass.name;}else $('noPass').hidden=false;
  await refreshLobby(true);setInterval(()=>refreshLobby(),1500);
}
load();
