import {drawQR} from '../qr.mjs';
import {readJob,stageLabels} from '../job-client.mjs?v=design-1';
const $=id=>document.getElementById(id),historyKey='pixel-dungeon-booth-tickets';
let photoFile=null,cameraStream=null,busy=false,preparing=false,pendingTicket=null,selectedId=null,polling=false;
let tickets=[];try{tickets=JSON.parse(localStorage.getItem(historyKey)||'[]').filter(item=>item.id&&item.token&&Date.now()-Date.parse(item.createdAt)<86400000).slice(0,40);}catch{}
function persist(){try{localStorage.setItem(historyKey,JSON.stringify(tickets));}catch{$('boothError').textContent='This browser cannot save recent QR tickets. Keep each QR open until the attendee has scanned it.';}}
function controls(){const name=!!$('characterName').value.trim();$('generateCharacter').disabled=busy||preparing||!photoFile||!name;$('capturePhoto').disabled=busy||preparing||!name;$('photoFile').disabled=busy||preparing;$('startCamera').disabled=busy||preparing;$('characterName').disabled=busy;$('clearPhoto').disabled=busy||preparing;$('openRecent').disabled=busy||preparing;$('generateCharacter').textContent=busy?'Uploading photo…':'Start generation & show QR';}
function stopCamera(){cameraStream?.getTracks().forEach(track=>track.stop());cameraStream=null;$('cameraPreview').srcObject=null;$('cameraPreview').hidden=true;$('capturePhoto').hidden=true;$('startCamera').hidden=!navigator.mediaDevices?.getUserMedia;}
function clearPhoto(){photoFile=null;pendingTicket=null;$('photoFile').value='';$('photoPreview').removeAttribute('src');$('photoPreview').hidden=true;$('photoPlaceholder').hidden=false;}
async function choosePhoto(file){
  if(!file)return false;preparing=true;controls();$('boothError').textContent='';
  try{
    if(!['image/jpeg','image/png','image/webp'].includes(file.type))throw new Error('Choose a JPEG, PNG, or WebP photo.');
    if(file.size>8*1024*1024)throw new Error('Choose a photo smaller than 8 MB.');
    const url=URL.createObjectURL(file),image=new Image();try{image.src=url;await image.decode();}finally{URL.revokeObjectURL(url);}
    const scale=Math.min(1,1024/Math.max(image.width,image.height)),canvas=document.createElement('canvas');canvas.width=Math.round(image.width*scale);canvas.height=Math.round(image.height*scale);canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.9));if(!blob)throw new Error('This photo could not be prepared. Try another.');
    stopCamera();photoFile=new File([blob],'attendee.jpg',{type:'image/jpeg'});pendingTicket=null;
    $('photoPreview').src=canvas.toDataURL('image/jpeg',.8);$('photoPreview').hidden=false;$('photoPlaceholder').hidden=true;return true;
  }catch(error){$('boothError').textContent=error.message;return false;}
  finally{preparing=false;controls();}
}
function showTicket(ticket){
  stopCamera();selectedId=ticket.id;$('recentDialog').close();$('forge').hidden=true;$('ticketCard').hidden=false;$('ticketName').textContent=ticket.name;
  const url=`${location.origin}/character/?job=${ticket.id}#access=${encodeURIComponent(ticket.token)}`;
  drawQR($('progressQR'),url);$('ticketStatus').textContent=stageLabels[ticket.status]||'Photo received';$('ticketTitle').focus();window.scrollTo(0,0);
}
function nextCharacter(){stopCamera();clearPhoto();selectedId=null;$('characterName').value='';$('boothError').textContent='';$('ticketCard').hidden=true;$('forge').hidden=false;controls();$('characterName').focus();window.scrollTo(0,0);}
function renderTickets(){
  const list=$('recentTickets');list.replaceChildren();
  $('recentEmpty').hidden=tickets.length>0;
  for(const ticket of tickets){const item=document.createElement('li'),button=document.createElement('button'),name=document.createElement('strong'),status=document.createElement('small');button.type='button';name.textContent=ticket.name;status.textContent=`${new Date(ticket.createdAt).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})} · ${stageLabels[ticket.status]||'Photo received'}`;button.append(name,status);button.onclick=()=>showTicket(ticket);item.append(button);list.append(item);}
  $('activeCount').textContent=`${tickets.filter(item=>!['complete','failed'].includes(item.status)).length} generating`;
  const selected=tickets.find(item=>item.id===selectedId);if(selected)$('ticketStatus').textContent=stageLabels[selected.status]||'Photo received';
}
async function submit(){
  if(busy||preparing||!photoFile||!$('characterName').value.trim())return;
  busy=true;controls();$('boothError').textContent='';
  pendingTicket||={id:crypto.randomUUID(),token:crypto.randomUUID().replaceAll('-','')+crypto.randomUUID().replaceAll('-','')};
  try{
    const form=new FormData();form.append('name',$('characterName').value.trim());form.append('photo',photoFile);form.append('requestId',pendingTicket.id);form.append('accessToken',pendingTicket.token);
    const response=await fetch('/api/character-jobs',{method:'POST',body:form}),data=await response.json();if(!response.ok)throw new Error(data.error||'The upload failed. Try again.');
    const ticket={...pendingTicket,...data.job};tickets=[ticket,...tickets.filter(item=>item.id!==ticket.id)].slice(0,40);persist();showTicket(ticket);renderTickets();
    clearPhoto();$('characterName').value='';
  }catch(error){$('boothError').textContent=error.message||'Upload interrupted. Try again with the same photo; it will not create a duplicate.';}
  finally{busy=false;controls();if(!$('forge').hidden)$('characterName').focus();}
}
async function pollTickets(){
  if(polling||document.hidden)return;polling=true;
  try{await Promise.all(tickets.filter(item=>!['complete','failed'].includes(item.status)).map(async ticket=>{try{Object.assign(ticket,await readJob(ticket));}catch(error){if([404,410].includes(error.status))ticket.status='failed';}}));persist();renderTickets();}finally{polling=false;}
}
$('photoFile').onchange=()=>choosePhoto($('photoFile').files[0]);$('characterName').oninput=controls;$('generateCharacter').onclick=submit;
$('startCamera').hidden=!navigator.mediaDevices?.getUserMedia;
$('startCamera').onclick=async()=>{stopCamera();$('boothError').textContent='';try{cameraStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'user'},audio:false});$('cameraPreview').srcObject=cameraStream;$('cameraPreview').hidden=false;$('photoPreview').hidden=true;$('photoPlaceholder').hidden=true;$('capturePhoto').hidden=false;await $('cameraPreview').play();controls();}catch{$('boothError').textContent='Camera access is unavailable. Allow camera access or choose a photo.';stopCamera();}};
$('capturePhoto').onclick=async()=>{const video=$('cameraPreview');if(!video.videoWidth)return;const canvas=document.createElement('canvas'),scale=Math.min(1,1024/Math.max(video.videoWidth,video.videoHeight));canvas.width=Math.round(video.videoWidth*scale);canvas.height=Math.round(video.videoHeight*scale);canvas.getContext('2d').drawImage(video,0,0,canvas.width,canvas.height);const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.9));if(blob&&await choosePhoto(new File([blob],'attendee.jpg',{type:'image/jpeg'})))await submit();};
$('clearPhoto').onclick=()=>{if(busy)return;stopCamera();clearPhoto();controls();};
$('nextCharacter').onclick=nextCharacter;
$('openRecent').onclick=()=>{$('recentDialog').showModal();};
$('closeRecent').onclick=()=>$('recentDialog').close();
const pollTimer=setInterval(pollTickets,3000);window.addEventListener('pagehide',()=>{stopCamera();clearInterval(pollTimer);},{once:true});
renderTickets();controls();pollTickets();

window.addEventListener('pageshow',event=>{if(event.persisted)location.reload();});
