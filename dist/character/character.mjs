import {readJob,savePass,stageLabels} from '../job-client.mjs?v=party-1';
import {mountCharacterView} from '../character-view.mjs?v=icon-1';
const $=id=>document.getElementById(id),id=new URLSearchParams(location.search).get('job'),token=new URLSearchParams(location.hash.slice(1)).get('access');
// Shared with the join page: it links back here for the videos, and this page links back to its lobby.
const characterPageKey='pixel-dungeon-character-page',lobbyReturnKey='pixel-dungeon-lobby-return';
let readyCharacter=null,polling=false,done=false,timer;

// The API reports stages, not percentages. Each stage owns a range the counter eases through, so it keeps moving during long stages.
const ranges={accepted:[0,8],designing:[8,40],walking:[40,60],waving:[60,78],partying:[78,92],saving:[92,99],complete:[100,100]},reduced=matchMedia('(prefers-reduced-motion: reduce)');
let shown=0,stage='accepted',stageStart=performance.now(),finish=null;
function paintProgress(){const value=Math.floor(shown);$('progressValue').textContent=`${value}%`;$('progressValue').setAttribute('aria-valuenow',String(value));$('progressFill').style.width=`${value}%`;}
function setStage(next){if(next===stage||!ranges[next])return;stage=next;stageStart=performance.now();}
const progressTimer=setInterval(()=>{
  const [low,high]=ranges[stage],target=Math.max(low,low+(high-low)*(1-Math.exp(-(performance.now()-stageStart)/30000)));
  if(target>shown)shown=reduced.matches?target:Math.min(target,shown+Math.max(stage==='complete'?3:.4,(target-shown)*(stage==='complete'?.35:.15)));
  paintProgress();if(shown>=100&&finish){finish();finish=null;}
},80);
const reachFull=()=>new Promise(resolve=>{if(shown>=100)resolve();else finish=resolve;});

function lobbyReturn(){try{const url=new URL(sessionStorage.getItem(lobbyReturnKey)||'',location.href);return url.origin===location.origin&&url.pathname==='/join/'?url.href:null;}catch{return null;}}
async function refresh(){
  if(polling||done)return;polling=true;$('retryProgress').hidden=true;
  try{
    if(!id||!token){done=true;throw new Error('This progress link is incomplete. Ask the booth crew to show your QR again.');}
    const job=await readJob({id,token});$('characterTitle').textContent=job.status==='complete'?`Meet ${job.name}`:`Creating ${job.name}`;
    $('progressStatus').textContent=job.error||'';$('progressStatus').classList.remove('error');setStage(job.status);
    if(job.status==='failed'){done=true;clearInterval(progressTimer);$('jobProgress').hidden=true;$('progressCopy').textContent='Show this page to the booth crew. They can take another photo and start a new character.';$('progressStatus').textContent=job.error||stageLabels.failed;$('progressStatus').classList.add('error');}
    if(job.status==='complete'){
      readyCharacter=job.character;done=true;
      try{localStorage.setItem(characterPageKey,JSON.stringify({id:job.character.id,url:location.href}));}catch{}
      if(lobbyReturn())$('createPass').textContent='Back to the lobby';
      await Promise.all([mountCharacterView($('animationPreviews'),job.character),reachFull()]);
      clearInterval(progressTimer);$('jobProgress').hidden=true;$('progressCopy').hidden=true;$('characterReady').hidden=false;
    }
  }catch(error){if([404,410].includes(error.status))done=true;if(done){clearInterval(progressTimer);$('jobProgress').hidden=true;}$('progressStatus').textContent=error.message;$('progressStatus').classList.add('error');$('retryProgress').hidden=done;}
  finally{polling=false;if(!done)timer=setTimeout(refresh,3000);}
}
$('retryProgress').onclick=()=>{clearTimeout(timer);refresh();};
$('createPass').onclick=async()=>{if(!readyCharacter)return;$('createPass').disabled=true;try{await savePass(readyCharacter,token);location.assign(lobbyReturn()||'../join/');}catch(error){$('progressStatus').textContent=error.message;$('progressStatus').classList.add('error');$('createPass').disabled=false;}};
window.addEventListener('pagehide',()=>{clearTimeout(timer);clearInterval(progressTimer);},{once:true});refresh();
window.addEventListener('pageshow',event=>{if(event.persisted)location.reload();});
