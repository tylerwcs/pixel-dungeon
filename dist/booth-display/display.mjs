import {drawQR} from '../qr.mjs';
import {readJob,stageLabels} from '../job-client.mjs?v=design-1';
import {decryptTicket} from '../ticket-crypto.mjs?v=remote-1';

const $=id=>document.getElementById(id),storageKey='pixel-dungeon-booth-display-session';
let pairing=null,currentTicketId=null,polling=false,installPrompt=null;

function storedPairing(){try{const value=JSON.parse(localStorage.getItem(storageKey)||'null');return value?.id&&value?.displayToken&&value?.relayKey&&value?.captureUrl?value:null;}catch{return null;}}
function savePairing(){try{localStorage.setItem(storageKey,JSON.stringify(pairing));}catch{}}
function clearPairing(){pairing=null;try{localStorage.removeItem(storageKey);}catch{}}
async function responseJson(response){const data=await response.json().catch(()=>({}));if(!response.ok)throw Object.assign(new Error(data.error||'The booth display could not connect.'),{status:response.status});return data;}
async function createPairing(){
  const data=await responseJson(await fetch('/api/booth-sessions',{method:'POST'}));pairing={id:data.session.id,displayToken:data.displayToken,relayKey:data.relayKey,captureUrl:data.captureUrl,expiresAt:data.session.expiresAt};savePairing();return data.session;
}
async function readPairing(){return (await responseJson(await fetch(`/api/booth-sessions/${encodeURIComponent(pairing.id)}`,{headers:{authorization:`Bearer ${pairing.displayToken}`},cache:'no-store'}))).session;}
function renderPairing(session){
  $('pairPanel').hidden=false;$('ticketPanel').hidden=true;$('connectionPill').textContent=session.phoneConnected?'PHONE PAIRED':'WAITING FOR PHONE';$('connectionPill').classList.toggle('ready',session.phoneConnected);
  $('pairStatus').textContent=session.phoneConnected?'Phone connected. Take the next guest’s photo when ready.':'Scan this QR with the booth phone to connect its camera.';$('pairCode').textContent=`BOOTH ${pairing.id.slice(0,8).toUpperCase()}`;drawQR($('pairQR'),pairing.captureUrl,{cell:5,quiet:4});currentTicketId=null;
}
function progressUrl(ticket){return `${location.origin}/character/?job=${encodeURIComponent(ticket.id)}#access=${encodeURIComponent(ticket.token)}`;}
async function drawCharacter(character){
  if(!character?.imageUrl)return;const image=new Image();image.decoding='async';image.src=character.imageUrl;await image.decode();if(currentTicketId!==character.id)return;
  const canvas=$('characterPreview'),ctx=canvas.getContext('2d');ctx.imageSmoothingEnabled=false;ctx.clearRect(0,0,canvas.width,canvas.height);ctx.drawImage(image,0,0,image.naturalWidth/(character.cols||4),image.naturalHeight/(character.rows||4),0,0,canvas.width,canvas.height);canvas.hidden=false;canvas.parentElement.classList.add('has-character');
}
async function renderTicket(ticket){
  $('pairPanel').hidden=true;$('ticketPanel').hidden=false;$('connectionPill').textContent='PHONE PAIRED';$('ticketName').textContent=ticket.name;drawQR($('progressQR'),progressUrl(ticket),{cell:5,quiet:4});
  if(currentTicketId!==ticket.id){currentTicketId=ticket.id;$('characterPreview').hidden=true;$('characterPreview').parentElement.classList.remove('has-character');$('ticketTitle').textContent='Photo received';$('jobStatus').textContent=stageLabels.accepted;}
  try{
    const job=await readJob(ticket);if(currentTicketId!==ticket.id)return;$('jobStatus').textContent=job.error||stageLabels[job.status]||'Photo received';
    $('ticketTitle').textContent=job.status==='complete'?'Your character is ready':job.status==='failed'?'Please ask the booth crew for help':'Your character is being forged';
    $('guestInstruction').textContent=job.status==='complete'?'Scan the QR to save your animations and character pass.':job.status==='failed'?'The paired phone has the details and can start the next guest when ready.':'Scan the QR to follow your character, then enjoy the event while the forge works.';
    if(job.status==='complete')drawCharacter(job.character).catch(()=>{});
  }catch(error){$('jobStatus').textContent=error.message;}
}
async function ensurePairing(){
  pairing=storedPairing();if(pairing){try{return await readPairing();}catch(error){if(![403,404,410].includes(error.status))throw error;clearPairing();}}
  return createPairing();
}
async function poll(){
  if(polling||document.hidden)return;polling=true;
  try{const session=pairing?await readPairing():await ensurePairing();$('displayError').textContent='';if(session.ticketCipher)await renderTicket(await decryptTicket(session.ticketCipher,pairing.relayKey));else renderPairing(session);}
  catch(error){$('displayError').textContent=`${error.message} Reconnecting…`;if([403,404,410].includes(error.status)){clearPairing();try{renderPairing(await createPairing());}catch{}}}
  finally{polling=false;}
}

$('fullscreenDisplay').onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch{$('displayError').textContent='Use Chrome’s “Add to Home screen” option to launch without the address bar.';}};
window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();installPrompt=event;$('installDisplay').hidden=false;});
$('installDisplay').onclick=async()=>{if(!installPrompt)return;installPrompt.prompt();await installPrompt.userChoice;installPrompt=null;$('installDisplay').hidden=true;};
if('serviceWorker'in navigator)navigator.serviceWorker.register('/booth-display/sw.js').catch(()=>{});
document.addEventListener('visibilitychange',()=>{if(!document.hidden)poll();});
const timer=setInterval(poll,2000);window.addEventListener('pagehide',()=>clearInterval(timer),{once:true});
try{renderPairing(await ensurePairing());poll();}catch(error){$('displayError').textContent=error.message;}
