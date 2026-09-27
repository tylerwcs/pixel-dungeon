import {loadCharacterAsset,drawGreeting,drawSprite,cache} from './render.mjs?v=wave-1';
import {createAnimationVideo} from './animation-export.mjs?v=queue-1';

export async function mountCharacterView(container,character){
  const asset=await loadCharacterAsset(character),urls=[];let frameId,exporting=false;
  container.replaceChildren();
  const cards=[];
  for(const animation of ['wave','walk']){
    const card=document.createElement('article');card.className='animation-card';
    const title=document.createElement('h3');title.textContent=animation==='wave'?'Hello, you!':'Ready to explore';
    const canvas=document.createElement('canvas');canvas.width=320;canvas.height=320;canvas.dataset.animation=animation;canvas.setAttribute('aria-label',`${character.name} ${animation==='wave'?'waving':'walking'}`);
    const button=document.createElement('button');button.type='button';button.className='download-button';button.textContent=`↓ Download ${animation} MP4`;
    const save=document.createElement('a');save.className='download-button';save.hidden=true;save.textContent=`↓ Save ${animation} MP4`;
    const share=document.createElement('button');share.type='button';share.className='download-button';share.textContent='Share video';share.hidden=true;
    const status=document.createElement('p');status.className='download-status';status.setAttribute('role','status');
    card.append(title,canvas,button,save,share,status);container.append(card);cards.push({canvas,animation,button});
    if(animation==='wave'&&(!asset.wave||!cache.has(asset.wave.src))){button.disabled=true;status.textContent='A wave is not available for this character.';}
    button.onclick=async()=>{
      if(exporting)return;exporting=true;cards.forEach(item=>item.button.disabled=true);status.textContent='Preparing your video…';
      try{
        const blob=await createAnimationVideo(asset,animation,progress=>status.textContent=`Preparing video · ${progress}%`),name=`${character.name.replace(/[^a-z0-9]+/gi,'-').replace(/^-|-$/g,'')||'character'}-${animation}.mp4`,url=URL.createObjectURL(blob);urls.push(url);save.href=url;save.download=name;save.hidden=false;button.hidden=true;
        const file=new File([blob],name,{type:'video/mp4'});if(navigator.canShare?.({files:[file]})){share.hidden=false;share.onclick=async()=>{try{await navigator.share({files:[file]});}catch(error){if(error.name!=='AbortError')status.textContent='Sharing is unavailable. Use Save MP4 instead.';}};}
        status.textContent='Video ready. Tap Save MP4 to keep it.';
      }catch(error){status.textContent=error.message;}
      finally{exporting=false;cards.forEach(item=>item.button.disabled=item.animation==='wave'&&(!asset.wave||!cache.has(asset.wave.src)));}
    };
  }
  const reduced=matchMedia('(prefers-reduced-motion: reduce)'),start=performance.now();
  function render(now){const time=(now-start)/1000;for(const {canvas,animation}of cards){const ctx=canvas.getContext('2d');ctx.clearRect(0,0,320,320);if(animation==='wave')drawGreeting(ctx,asset,160,160,300,time);else drawSprite(ctx,asset,160,160,300,reduced.matches?0:time,['down','left','right','up'][Math.floor(time/1.5)%4],!reduced.matches);}frameId=requestAnimationFrame(render);}
  frameId=requestAnimationFrame(render);
  const cleanup=()=>{cancelAnimationFrame(frameId);urls.forEach(url=>URL.revokeObjectURL(url));};window.addEventListener('pagehide',cleanup,{once:true});return cleanup;
}

window.addEventListener('pageshow',event=>{if(event.persisted)location.reload();});
