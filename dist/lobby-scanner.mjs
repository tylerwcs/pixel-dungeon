export function lobbyInvite(value,origin=location.origin){
  try{const url=new URL(value);if(url.origin!==origin||!['/join','/join/'].includes(url.pathname)||!/^https?:$/.test(url.protocol))return null;const lobby=url.searchParams.get('lobby'),token=url.searchParams.get('token');if(!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(lobby||'')||!/^[A-Za-z0-9_-]{20,128}$/.test(token||''))return null;return `${origin}/join/?lobby=${encodeURIComponent(lobby)}&token=${encodeURIComponent(token)}`;}catch{return null;}
}

// The viewfinder lives in the page; it pauses while the tab is hidden and resumes when it returns.
export function mountLobbyScanner(container,onScan){
  container.innerHTML='<div class="scanner-view"><video playsinline muted aria-label="Lobby QR camera preview" hidden></video><span class="scanner-frame" aria-hidden="true"></span><button class="secondary-button scanner-start" type="button" hidden>Turn on camera</button></div><p class="scanner-status" role="status"></p>';
  const video=container.querySelector('video'),status=container.querySelector('.scanner-status'),start=container.querySelector('.scanner-start'),canvas=document.createElement('canvas'),ctx=canvas.getContext('2d',{willReadFrequently:true});let stream=null,timer=null,session=0,active=false,decoder;
  const decode=async image=>{decoder||=(await import('./vendor/jsqr.mjs')).default;const width=image.videoWidth||image.naturalWidth,height=image.videoHeight||image.naturalHeight,scale=Math.min(1,800/Math.max(width,height));if(!width||!height)return null;canvas.width=Math.round(width*scale);canvas.height=Math.round(height*scale);ctx.drawImage(image,0,0,canvas.width,canvas.height);return decoder(ctx.getImageData(0,0,canvas.width,canvas.height).data,canvas.width,canvas.height,{inversionAttempts:'dontInvert'})?.data;};
  function release(){session++;clearTimeout(timer);stream?.getTracks().forEach(track=>track.stop());stream=null;video.srcObject=null;video.hidden=true;}
  function stop(){active=false;release();}
  function accept(text){const url=lobbyInvite(text);if(!url){status.textContent='That is not a lobby QR for this event.';return false;}stop();onScan(url);return true;}
  async function scan(current){if(current!==session)return;try{if(video.readyState>=2){const text=await decode(video);if(current!==session)return;if(text&&accept(text))return;}}catch{release();start.hidden=false;status.textContent='Could not read the camera. Tap to try again.';return;}timer=setTimeout(()=>scan(current),180);}
  async function open(){
    release();active=true;const current=session;start.hidden=true;status.textContent='Opening camera…';
    try{if(!navigator.mediaDevices?.getUserMedia)throw new Error('unavailable');const next=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'}},audio:false});if(current!==session||!active){next.getTracks().forEach(track=>track.stop());return;}stream=next;video.srcObject=stream;video.hidden=false;await video.play();if(current!==session)return;status.textContent='Point at the lobby QR on the game screen.';scan(current);}catch{if(current===session){release();start.hidden=false;status.textContent='Allow camera access to scan the lobby QR.';}}
  }
  start.onclick=open;
  window.addEventListener('pagehide',stop);
  document.addEventListener('visibilitychange',()=>{if(!active)return;if(document.hidden)release();else if(!stream)open();});
  return {start:open,stop};
}
