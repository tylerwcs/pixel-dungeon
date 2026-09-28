import {loadCharacterAsset,cache} from './render.mjs?v=wave-1';
import {createAnimationVideo,loadSocialFrame,drawVideoBackground,drawVideoCharacter} from './animation-export.mjs?v=position-1';

export async function mountCharacterView(container,character){
  const asset=await loadCharacterAsset(character),urls=[],cards=[];let frameId,exporting=false,disposed=false,frame=null;
  container.replaceChildren();
  // A failed decorative asset must not block joining or the plain video option.
  loadSocialFrame().then(image=>{frame=image;}).catch(()=>{});
  const supportsShare=()=>typeof navigator.share==='function'&&typeof navigator.canShare==='function';
  for(const animation of ['wave','walk']){
    const card=document.createElement('article');card.className='animation-card';card.dataset.animation=animation;
    const title=document.createElement('h3');title.textContent=animation==='wave'?'Hello!':'Ready to explore';
    const canvas=document.createElement('canvas');canvas.width=360;canvas.height=640;canvas.dataset.animation=animation;canvas.setAttribute('aria-label',`${character.name} ${animation==='wave'?'waving':'walking'} in the event frame`);
    const status=document.createElement('p');status.className='download-status';status.setAttribute('role','status');
    const actions=document.createElement('div');actions.className='video-actions';
    const item={canvas,animation,buttons:[],files:new Map(),available:animation!=='wave'||!!(asset.wave&&cache.has(asset.wave.src))};cards.push(item);
    for(const background of ['framed','black']){
      const button=document.createElement('button');button.type='button';button.className=`download-button ${background==='framed'?'share-primary':'share-secondary'}`;button.dataset.background=background;
      const label=()=>`${supportsShare()?'Share':'Download'} ${background==='framed'?'with event frame':'on black'}`;
      button.textContent=label();button.disabled=!item.available;item.buttons.push(button);actions.append(button);
      button.onclick=async()=>{
        if(exporting||disposed)return;exporting=true;cards.forEach(c=>c.buttons.forEach(b=>b.disabled=true));
        try{
          let file=item.files.get(background);
          if(!file){
            button.textContent='Preparing…';status.textContent='Preparing your video…';
            const blob=await createAnimationVideo(asset,animation,progress=>{if(!disposed){button.textContent=`Preparing ${progress}%`;status.textContent=`Preparing your video · ${progress}%`;}},{name:character.name,background});
            if(disposed)return;
            const filename=`${character.name.replace(/[^a-z0-9]+/gi,'-').replace(/^-|-$/g,'')||'character'}-${animation}-${background}.mp4`;
            file=new File([blob],filename,{type:'video/mp4'});item.files.set(background,file);
          }
          if(supportsShare()&&navigator.canShare({files:[file]})){
            // Preparation can outlast the browser's user gesture. A second tap uses the cached File immediately.
            if(navigator.userActivation&&!navigator.userActivation.isActive){status.textContent=`Ready. Tap “${label()}” to share your video.`;return;}
            await navigator.share({files:[file],title:`${character.name} · Ecopialand`});status.textContent='Your video is ready to share again.';
          }else{
            const link=document.createElement('a'),url=URL.createObjectURL(file);urls.push(url);link.href=url;link.download=file.name;document.body.append(link);link.click();link.remove();status.textContent='Your video has been downloaded.';
          }
        }catch(error){status.textContent=error.name==='AbortError'?'Ready whenever you want to share.':error.name==='NotAllowedError'?`Tap “${label()}” again to open sharing.`:error.message||'Sharing did not open. Please try again.';}
        finally{exporting=false;button.textContent=label();cards.forEach(c=>c.buttons.forEach(b=>b.disabled=!c.available));}
      };
    }
    if(!item.available)status.textContent='A wave is not available for this character.';
    card.append(title,canvas,actions,status);container.append(card);
  }
  const reduced=matchMedia('(prefers-reduced-motion: reduce)'),start=performance.now();
  function render(now){
    const time=(now-start)/1000;
    for(const {canvas,animation}of cards){const ctx=canvas.getContext('2d');drawVideoBackground(ctx,360,640,character.name,frame?'framed':'black',frame);drawVideoCharacter(ctx,asset,animation,360,640,time,reduced.matches);}
    frameId=requestAnimationFrame(render);
  }
  frameId=requestAnimationFrame(render);
  const cleanup=()=>{disposed=true;cancelAnimationFrame(frameId);urls.forEach(url=>URL.revokeObjectURL(url));cards.forEach(card=>card.files.clear());};window.addEventListener('pagehide',cleanup,{once:true});return cleanup;
}
window.addEventListener('pageshow',event=>{if(event.persisted)location.reload();});
