import {readPass,savePass} from '../job-client.mjs?v=queue-1';
import {mountCharacterView} from '../character-view.mjs?v=queue-1';
const $=id=>document.getElementById(id),id=new URLSearchParams(location.search).get('character'),token=new URLSearchParams(location.hash.slice(1)).get('claim');
async function openPass(){
  try{
    const saved=readPass(),claim=token||(saved?.id===id||!id?saved?.claimToken:null),characterId=id||saved?.id;
    if(!characterId||!claim)throw new Error('Scan your personal QR from the booth to collect your character pass.');
    const character=await savePass({id:characterId},claim);$('passName').textContent=character.name;
    await mountCharacterView($('passPreviews'),character);$('passContent').hidden=false;$('passStatus').textContent='Ready for your next game.';
    history.replaceState(null,'',`${location.pathname}?character=${encodeURIComponent(character.id)}`);
  }catch(error){$('passStatus').textContent=error.message;$('passStatus').classList.add('error');}
  finally{$('passLoading').hidden=true;}
}
openPass();
