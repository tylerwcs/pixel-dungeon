const $=id=>document.getElementById(id),storageKey='pixel-dungeon-character-pass';
const params=new URLSearchParams(location.search),fragment=new URLSearchParams(location.hash.slice(1));
const id=params.get('character'),claimToken=fragment.get('claim');
function showError(message){$('passLoading').hidden=true;$('passStatus').textContent=message;$('passStatus').classList.add('error');}
async function openPass(){
  if(!id||!claimToken){const saved=localStorage.getItem(storageKey);if(saved){location.replace(`../join/`);return;}showError('This character pass is incomplete. Scan the QR shown by the photo booth again.');return;}
  try{const response=await fetch(`/api/characters/${encodeURIComponent(id)}/pass`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({claimToken})}),data=await response.json();if(!response.ok)throw new Error(data.error||'This pass could not be opened.');const pass={id,claimToken,name:data.character.name,imageUrl:data.character.imageUrl,createdAt:data.character.createdAt};localStorage.setItem(storageKey,JSON.stringify(pass));$('passImage').src=pass.imageUrl;$('passName').textContent=pass.name;$('passDownload').href=pass.imageUrl;$('passDownload').download=`${pass.name.replace(/[^a-z0-9]+/gi,'-').replace(/^-|-$/g,'').toLowerCase()||'pixel-dungeon-character'}.png`;$('passLoading').hidden=true;$('passContent').hidden=false;$('passStatus').textContent='Character saved on this phone.';history.replaceState(null,'',`${location.pathname}?character=${encodeURIComponent(id)}`);}catch(error){showError(error.message);}
}
openPass();
