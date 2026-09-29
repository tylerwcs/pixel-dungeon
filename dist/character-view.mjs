import {loadCharacterAsset,loadImage,cache} from './render.mjs?v=walk-1';
// Pixel-drawn download arrow over a tray; crisp edges keep it blocky at any size.
const downloadIcon='<svg viewBox="0 0 16 16" fill="currentColor" shape-rendering="crispEdges" aria-hidden="true"><path d="M7 1h2v7H7zM4 8h8v1H4zM5 9h6v1H5zM6 10h4v1H6zM7 11h2v1H7zM2 13h12v2H2z"/></svg>';
import {createAnimationVideo,loadSocialFrame,drawVideoBackground,drawVideoCharacter} from './animation-export.mjs?v=walk-1';

export async function mountCharacterView(container,character){
  const asset=await loadCharacterAsset(character),urls=[],cards=[];let frameId,exporting=false,disposed=false,frame=null;
  if(character.party){asset.party={...character.party,src:character.party.imageUrl,anchor:'cell'};await loadImage(asset.party.src).catch(()=>{});}
  container.replaceChildren();
  // A failed decorative asset must not block joining.
  loadSocialFrame().then(image=>{frame=image;}).catch(()=>{});
  const supportsShare=()=>typeof navigator.share==='function'&&typeof navigator.canShare==='function';
  for(const animation of ['wave','walk',...(character.party?['party']:[])]){
    const card=document.createElement('article');card.className='animation-card';card.dataset.animation=animation;
    const title=document.createElement('h3');title.textContent={wave:'Hello!',walk:'Ready to explore',party:'Party time!'}[animation];
    const canvas=document.createElement('canvas');canvas.width=360;canvas.height=640;canvas.dataset.animation=animation;canvas.setAttribute('aria-label',`${character.name} ${{wave:'waving',walk:'walking',party:'dancing'}[animation]} in the event frame`);
    const status=document.createElement('p');status.className='download-status';status.setAttribute('role','status');
    const stage=document.createElement('div');stage.className='animation-stage';stage.append(canvas);
    const item={canvas,animation,buttons:[],files:new Map(),available:animation==='walk'||!!(asset[animation]&&cache.has(asset[animation].src))};cards.push(item);
    {
      const background='framed';
      const button=document.createElement('button');button.type='button';button.className='download-button';button.dataset.background=background;
      const idle=()=>{button.innerHTML=downloadIcon;button.setAttribute('aria-label','Download');button.title='Download video';button.classList.remove('preparing');};
      const preparing=progress=>{button.textContent=`${progress}%`;button.setAttribute('aria-label',`Preparing ${progress}%`);button.classList.add('preparing');};
      idle();button.disabled=!item.available;item.buttons.push(button);stage.append(button);
      button.onclick=async()=>{
        if(exporting||disposed)return;exporting=true;cards.forEach(c=>c.buttons.forEach(b=>b.disabled=true));
        try{
          let file=item.files.get(background);
          if(!file){
            preparing(0);status.textContent='';
            const blob=await createAnimationVideo(asset,animation,progress=>{if(!disposed)preparing(progress);},{name:character.name,background});
            if(disposed)return;
            const filename=`${character.name.replace(/[^a-z0-9]+/gi,'-').replace(/^-|-$/g,'')||'character'}-${animation}-${background}.mp4`;
            file=new File([blob],filename,{type:'video/mp4'});item.files.set(background,file);
          }
          if(supportsShare()&&navigator.canShare({files:[file]})){
            // Preparation can outlast the browser's user gesture. A second tap uses the cached File immediately.
            if(navigator.userActivation&&!navigator.userActivation.isActive){status.textContent='Your video is ready. Tap Download again to save it.';return;}
            await navigator.share({files:[file],title:`${character.name} · Ecopialand`});status.textContent='';
          }else{
            const link=document.createElement('a'),url=URL.createObjectURL(file);urls.push(url);link.href=url;link.download=file.name;document.body.append(link);link.click();link.remove();status.textContent='';
          }
        }catch(error){status.textContent=error.name==='AbortError'?'':error.name==='NotAllowedError'?'Tap Download again to save your video.':error.message||'The download did not start. Please try again.';}
        finally{exporting=false;idle();cards.forEach(c=>c.buttons.forEach(b=>b.disabled=!c.available));}
      };
    }
    if(!item.available)status.textContent=animation==='party'?'The party animation could not load. Refresh to try again.':'A wave is not available for this character.';
    card.append(title,stage,status);container.append(card);
  }
  const reduced=matchMedia('(prefers-reduced-motion: reduce)'),start=performance.now();
  function render(now){
    const time=(now-start)/1000;
    for(const {canvas,animation}of cards){const ctx=canvas.getContext('2d');drawVideoBackground(ctx,360,640,character.name,frame?'framed':'black',frame);drawVideoCharacter(ctx,asset,animation,360,640,time,reduced.matches,frame?'framed':'black');}
    frameId=requestAnimationFrame(render);
  }
  frameId=requestAnimationFrame(render);
  const cleanup=()=>{disposed=true;cancelAnimationFrame(frameId);urls.forEach(url=>URL.revokeObjectURL(url));cards.forEach(card=>card.files.clear());};window.addEventListener('pagehide',cleanup,{once:true});return cleanup;
}
window.addEventListener('pageshow',event=>{if(event.persisted)location.reload();});
