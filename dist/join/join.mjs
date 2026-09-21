const $=id=>document.getElementById(id),storageKey='pixel-dungeon-character-pass',params=new URLSearchParams(location.search);
const lobby=params.get('lobby'),slot=Number(params.get('slot')),slotToken=params.get('token');let pass;
function status(message,error=false){$('joinStatus').textContent=message;$('joinStatus').classList.toggle('error',error);}
function validInvite(){return /^[0-9a-f-]{36}$/i.test(lobby||'')&&slot>=1&&slot<=4&&typeof slotToken==='string'&&slotToken.length>10;}
function load(){
  $('slotNumber').textContent=slot>=1&&slot<=4?String(slot).padStart(2,'0'):'—';if(!validInvite()){$('joinCopy').textContent='Scan a player-slot QR from the matchmaking screen to join.';status('No active player invitation was found.',true);return;}
  try{pass=JSON.parse(localStorage.getItem(storageKey)||'null');}catch{pass=null;}if(!pass?.id||!pass?.claimToken){$('noPass').hidden=false;return;}$('savedPass').hidden=false;$('joinImage').src=pass.imageUrl;$('joinName').textContent=pass.name;$('joinSlotLabel').textContent=`Join as Player ${slot}.`;
}
$('claimSlot').onclick=async()=>{try{$('claimSlot').disabled=true;status('Joining the lobby…');const response=await fetch(`/api/lobbies/${encodeURIComponent(lobby)}/slots/${slot}/claim`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({slotToken,characterId:pass.id,claimToken:pass.claimToken})}),data=await response.json();if(!response.ok)throw new Error(data.error||'This slot could not be joined.');$('claimSlot').hidden=true;$('readySlot').hidden=false;$('clearPass').hidden=true;status(`${pass.name} is now Player ${slot}.`);}catch(error){$('claimSlot').disabled=false;status(error.message,true);}};
$('readySlot').onclick=async()=>{try{$('readySlot').disabled=true;const response=await fetch(`/api/lobbies/${encodeURIComponent(lobby)}/slots/${slot}/ready`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({slotToken,ready:true})}),data=await response.json();if(!response.ok)throw new Error(data.error||'Ready status could not be sent.');$('readySlot').textContent='✓ READY';status('You’re ready. Look at the game screen for the countdown.');}catch(error){$('readySlot').disabled=false;status(error.message,true);}};
$('clearPass').onclick=()=>{localStorage.removeItem(storageKey);location.reload();};
load();
