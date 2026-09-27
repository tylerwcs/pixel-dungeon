import {readJob,savePass,stageLabels} from '../job-client.mjs?v=design-1';
import {mountCharacterView} from '../character-view.mjs?v=queue-1';
const $=id=>document.getElementById(id),id=new URLSearchParams(location.search).get('job'),token=new URLSearchParams(location.hash.slice(1)).get('access');
let readyCharacter=null,polling=false,done=false,timer;
async function refresh(){
  if(polling||done)return;polling=true;$('retryProgress').hidden=true;
  try{
    if(!id||!token){done=true;throw new Error('This progress link is incomplete. Ask the booth crew to show your QR again.');}
    const job=await readJob({id,token});$('characterTitle').textContent=job.status==='complete'?`Meet ${job.name}`:`Creating ${job.name}`;
    $('progressStatus').textContent=job.error||stageLabels[job.status];
    const stages=['accepted','designing','walking','waving','saving','complete'],index=stages.indexOf(job.status);
    document.querySelectorAll('[data-stage]').forEach(item=>{const position=stages.indexOf(item.dataset.stage);item.classList.toggle('done',position<index||job.status==='complete');item.classList.toggle('current',position===index);if(position===index)item.setAttribute('aria-current','step');else item.removeAttribute('aria-current');});
    if(job.status==='failed'){done=true;$('progressCopy').textContent='Show this page to the booth crew. They can take another photo and start a new character.';$('progressStatus').classList.add('error');}
    if(job.status==='complete'){
      readyCharacter=job.character;await mountCharacterView($('animationPreviews'),job.character);done=true;$('jobProgress').hidden=true;$('characterReady').hidden=false;$('progressCopy').textContent='Your adventure starts here. Say hello and take a little walk.';
    }
  }catch(error){if([404,410].includes(error.status))done=true;$('progressStatus').textContent=error.message;$('retryProgress').hidden=done;}
  finally{polling=false;if(!done)timer=setTimeout(refresh,3000);}
}
$('retryProgress').onclick=()=>{clearTimeout(timer);refresh();};
$('createPass').onclick=async()=>{if(!readyCharacter)return;$('createPass').disabled=true;try{await savePass(readyCharacter,token);location.assign('../join/');}catch(error){$('progressStatus').textContent=error.message;$('createPass').disabled=false;}};
window.addEventListener('pagehide',()=>clearTimeout(timer),{once:true});refresh();
window.addEventListener('pageshow',event=>{if(event.persisted)location.reload();});
