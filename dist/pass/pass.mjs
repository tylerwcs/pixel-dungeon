import {readPass,savePass} from '../job-client.mjs?v=party-1';
import {mountCharacterView} from '../character-view.mjs?v=icon-1';
const $=id=>document.getElementById(id),id=new URLSearchParams(location.search).get('character'),token=new URLSearchParams(location.hash.slice(1)).get('claim');
async function openPass(){
  try{
    const saved=readPass(),claim=token||(saved?.id===id||!id?saved?.claimToken:null),characterId=id||saved?.id;
    if(!characterId||!claim)throw new Error('Scan your personal QR from the booth to collect your character pass.');
    const character=await savePass({id:characterId},claim);$('passName').textContent=character.name;
    await mountCharacterView($('passPreviews'),character);$('passContent').hidden=false;
    // The join page records its lobby so guests who came here for their videos can go straight back.
    try{const back=new URL(sessionStorage.getItem('pixel-dungeon-lobby-return')||'',location.href);if(back.origin===location.origin&&back.pathname==='/join/'){$('passJoin').href=back.href;$('passJoin').textContent='Back to the lobby →';}}catch{}
    history.replaceState(null,'',`${location.pathname}?character=${encodeURIComponent(character.id)}`);
  }catch(error){$('passStatus').textContent=error.message;$('passStatus').classList.add('error');}
  finally{$('passLoading').hidden=true;}
}
openPass();
