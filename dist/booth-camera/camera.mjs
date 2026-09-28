import {readJob,stageLabels} from '../job-client.mjs?v=design-1';
import {encryptTicket,randomToken,randomUUID} from '../ticket-crypto.mjs?v=remote-1';

const $=id=>document.getElementById(id),params=new URLSearchParams(location.search),sessionId=params.get('session'),fragment=new URLSearchParams(location.hash.slice(1));
const tokenKey=sessionId?`pixel-dungeon-booth-camera-token:${sessionId}`:'',relayKeyName=sessionId?`pixel-dungeon-booth-camera-relay:${sessionId}`:'',ticketKey=sessionId?`pixel-dungeon-booth-camera-ticket:${sessionId}`:'';
let captureToken=fragment.get('capture'),relayKey=fragment.get('relay'),photoFile=null,currentTicket=null,busy=false,polling=false;
if(captureToken&&relayKey&&tokenKey){try{localStorage.setItem(tokenKey,captureToken);localStorage.setItem(relayKeyName,relayKey);}catch{}history.replaceState(null,'',location.pathname+location.search);}else if(tokenKey){try{captureToken=localStorage.getItem(tokenKey);relayKey=localStorage.getItem(relayKeyName);}catch{}}
try{currentTicket=JSON.parse(localStorage.getItem(ticketKey)||'null');}catch{}

function paired(){return /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(sessionId||'')&&/^[A-Za-z0-9_-]{32,128}$/.test(captureToken||'')&&/^[A-Za-z0-9_-]{40,64}$/.test(relayKey||'');}
async function responseJson(response){const data=await response.json().catch(()=>({}));if(!response.ok)throw Object.assign(new Error(data.error||'The booth phone could not connect.'),{status:response.status});return data;}
async function sessionAction(action,body={}){return responseJson(await fetch(`/api/booth-sessions/${encodeURIComponent(sessionId)}/${action}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({captureToken,...body})}));}
function persistTicket(){try{if(currentTicket)localStorage.setItem(ticketKey,JSON.stringify(currentTicket));else localStorage.removeItem(ticketKey);}catch{}}
function updateControls(){const ready=paired()&&!busy&&photoFile&&$('characterName').value.trim();$('sendPhoto').disabled=!ready;$('characterName').disabled=busy;$('cameraFile').disabled=busy;$('libraryFile').disabled=busy;$('clearPhoto').disabled=busy;$('sendPhoto').textContent=busy?'Sending photo…':'Send photo to the big display';}
function clearPhoto(){photoFile=null;for(const id of ['cameraFile','libraryFile'])$(id).value='';$('photoPreview').removeAttribute('src');$('photoPreview').hidden=true;$('photoPlaceholder').hidden=false;updateControls();}
async function choosePhoto(file){
  if(!file)return;$('cameraError').textContent='';busy=true;updateControls();
  try{
    if(!['image/jpeg','image/png','image/webp'].includes(file.type))throw new Error('Use a JPEG, PNG, or WebP photo.');if(file.size>8*1024*1024)throw new Error('Choose a photo smaller than 8 MB.');
    const url=URL.createObjectURL(file),image=new Image();try{image.src=url;await image.decode();}finally{URL.revokeObjectURL(url);}const scale=Math.min(1,1024/Math.max(image.width,image.height)),canvas=document.createElement('canvas');canvas.width=Math.round(image.width*scale);canvas.height=Math.round(image.height*scale);canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.9));if(!blob)throw new Error('This photo could not be prepared. Try another.');photoFile=new File([blob],'attendee.jpg',{type:'image/jpeg'});$('photoPreview').src=canvas.toDataURL('image/jpeg',.78);$('photoPreview').hidden=false;$('photoPlaceholder').hidden=true;
  }catch(error){$('cameraError').textContent=error.message;clearPhoto();}finally{busy=false;updateControls();}
}
function showTicket(){
  $('capturePanel').hidden=true;$('sentPanel').hidden=false;$('sentName').textContent=currentTicket.name;$('sentStatus').textContent=stageLabels[currentTicket.status]||'Photo received';$('pairState').textContent='CONNECTED';pollTicket();
}
async function pollTicket(){
  if(!currentTicket||polling||document.hidden)return;polling=true;try{const job=await readJob(currentTicket);Object.assign(currentTicket,job);persistTicket();$('sentStatus').textContent=job.error||stageLabels[job.status]||'Photo received';$('sentTitle').textContent=job.status==='complete'?'Character ready on the big display':job.status==='failed'?'Generation needs attention':'The character is being forged';}catch(error){$('sentError').textContent=error.message;}finally{polling=false;}
}
async function sendPhoto(){
  const name=$('characterName').value.trim();if(!photoFile||!name||busy)return;busy=true;updateControls();$('cameraError').textContent='';
  try{
    currentTicket||={id:randomUUID(),token:randomToken(),name,createdAt:new Date().toISOString(),status:'accepted'};
    const form=new FormData();form.append('name',name);form.append('photo',photoFile);form.append('requestId',currentTicket.id);form.append('accessToken',currentTicket.token);const data=await responseJson(await fetch('/api/character-jobs',{method:'POST',body:form}));currentTicket={...currentTicket,...data.job};persistTicket();await sessionAction('ticket',{ticketCipher:await encryptTicket(currentTicket,relayKey)});showTicket();
  }catch(error){$('cameraError').textContent=`${error.message} Tap send again to retry safely.`;persistTicket();}
  finally{busy=false;updateControls();}
}
async function nextGuest(){
  if(busy)return;busy=true;$('nextGuest').disabled=true;$('sentError').textContent='';try{await sessionAction('reset');currentTicket=null;persistTicket();clearPhoto();$('characterName').value='';$('sentPanel').hidden=true;$('capturePanel').hidden=false;$('characterName').focus();}catch(error){$('sentError').textContent=error.message;}finally{busy=false;$('nextGuest').disabled=false;updateControls();}
}

$('cameraFile').onchange=()=>choosePhoto($('cameraFile').files[0]);$('libraryFile').onchange=()=>choosePhoto($('libraryFile').files[0]);$('clearPhoto').onclick=clearPhoto;$('characterName').oninput=updateControls;$('sendPhoto').onclick=sendPhoto;$('nextGuest').onclick=nextGuest;
const timer=setInterval(pollTicket,3000);window.addEventListener('pagehide',()=>clearInterval(timer),{once:true});document.addEventListener('visibilitychange',()=>{if(!document.hidden)pollTicket();});
if(!paired()){$('pairState').textContent='NOT PAIRED';$('cameraError').textContent='This pairing link is incomplete. Scan the QR shown on the big display.';updateControls();}else try{await sessionAction('connect');$('pairState').textContent='CONNECTED';if(currentTicket){await sessionAction('ticket',{ticketCipher:await encryptTicket(currentTicket,relayKey)});showTicket();}else updateControls();}catch(error){$('pairState').textContent='OFFLINE';$('cameraError').textContent=error.message;updateControls();}
