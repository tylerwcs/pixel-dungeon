import {defaults,loadImage,drawSprite} from './render.mjs?v=sprite-anchor-1';
export function validateSettings(asset){
  for(const [field,max]of [['cols',32],['rows',32],['fps',24]])if(!Number.isInteger(asset[field])||asset[field]<1||asset[field]>max)throw new Error(`${field==='cols'?'Columns':field==='rows'?'Rows':'Frames per second'} must be a whole number from 1 to ${max}.`);
  if(!['single','directional'].includes(asset.layout))throw new Error('Choose an animation layout.');
  if(asset.layout==='directional'&&asset.rows!==4)throw new Error('Four-direction animation needs exactly 4 rows: down, left, right, up.');
  if(asset.layout==='single'&&asset.rows!==1)throw new Error('Single-row animation needs 1 row. Choose four directions for a 4-row sheet.');
  return asset;
}
export function validatePNG(bytes,size){
  if(size>5*1024*1024)throw new Error('This file is over 5 MB. Choose a smaller PNG.');
  const a=new Uint8Array(bytes);if(a.length<24||![137,80,78,71,13,10,26,10].every((v,i)=>a[i]===v))throw new Error('Choose a PNG image. GIF and other formats are not supported.');
  const view=new DataView(bytes),width=view.getUint32(16),height=view.getUint32(20);if(width<1||height<1||width>4096||height>4096)throw new Error('PNG dimensions must be between 1 and 4096 pixels.');return {width,height};
}
let dbPromise;
function db(){return dbPromise??=new Promise((resolve,reject)=>{if(!globalThis.indexedDB){reject(new Error('Storage unavailable'));return;}const r=indexedDB.open('pixel-dungeon-chase',1);r.onupgradeneeded=()=>r.result.createObjectStore('settings');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);r.onblocked=()=>reject(new Error('Storage blocked'));});}
export async function readSettings(){const database=await db();return new Promise((resolve,reject)=>{const r=database.transaction('settings').objectStore('settings').get('party');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
export async function writeSettings(settings){const database=await db();return new Promise((resolve,reject)=>{const tx=database.transaction('settings','readwrite');tx.objectStore('settings').put(settings,'party');tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});}
const dataURL=file=>new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('This file could not be read.'));reader.readAsDataURL(file);});
export function createCharacterEditor(players,{changed,notify}){
  const $=id=>document.getElementById(id);let editor=null,draft=null,loading=false,fileSequence=0;
  const settings=()=>({...draft,cols:Number($('columns').value),rows:Number($('rows').value),fps:Number($('fps').value),layout:$('layout').value});
  function showRole(role){fileSequence++;loading=false;editor.role=role;draft={...(players[editor.player][role]||defaults[role])};$('columns').value=draft.cols;$('rows').value=draft.rows;$('fps').value=draft.fps;$('layout').value=draft.layout;$('assetName').textContent=draft.name;$('spriteFile').value='';$('importError').textContent='';$('saveCharacter').disabled=false;document.querySelectorAll('[data-role]').forEach(b=>b.classList.toggle('selected',b.dataset.role===role));}
  function check(){if(!draft)return;try{validateSettings(settings());$('importError').textContent='';$('saveCharacter').disabled=loading;}catch(e){$('importError').textContent=e.message;$('saveCharacter').disabled=true;}}
  for(const id of ['columns','rows','fps','layout'])$(id).addEventListener('input',check);
  document.querySelectorAll('[data-role]').forEach(b=>b.onclick=()=>showRole(b.dataset.role));
  $('spriteFile').onchange=async()=>{const file=$('spriteFile').files[0];if(!file)return;const sequence=++fileSequence;loading=true;$('saveCharacter').disabled=true;$('importError').textContent='';
    try{validatePNG(await file.slice(0,24).arrayBuffer(),file.size);const src=await dataURL(file);await loadImage(src);if(sequence!==fileSequence)return;draft={src,name:file.name,cols:1,rows:1,fps:8,layout:'single'};$('columns').value=1;$('rows').value=1;$('fps').value=8;$('layout').value='single';$('assetName').textContent=file.name;$('previewHint').textContent='Set the grid below if this is a sprite sheet.';}
    catch(e){if(sequence!==fileSequence)return;$('importError').textContent=e.message;}
    finally{if(sequence===fileSequence){loading=false;checkAfterUpload();}}
  };
  function checkAfterUpload(){if($('importError').textContent){$('saveCharacter').disabled=true;return;}check();}
  $('saveCharacter').onclick=async()=>{if(loading||!editor)return;try{const asset=validateSettings(settings());await loadImage(asset.src);players[editor.player][editor.role]={...asset};players[editor.player].boothCharacterId=null;await changed();$('characterDialog').close();notify('Character ready for the next chase.');}catch(e){$('importError').textContent=e.message;}};
  $('resetCharacter').onclick=async()=>{if(!editor)return;players[editor.player][editor.role]=null;showRole(editor.role);await changed();notify('Default character restored.');};
  $('characterDialog').addEventListener('close',()=>{fileSequence++;editor=null;});
  return {
    open(i){editor={player:i,role:'collector'};$('characterTitle').textContent=`Player ${i+1} characters`;$('previewHint').textContent='Your character, your adventure.';showRole('collector');$('characterDialog').showModal();},
    render(time){if(!editor||!draft)return;const c=$('spritePreview'),ctx=c.getContext('2d');ctx.clearRect(0,0,c.width,c.height);let a;try{a=validateSettings(settings());}catch{a=draft;}const facing=['down','left','right','up'][Math.floor(time/2)%4];drawSprite(ctx,a,96,96,176,time,facing,true);}
  };
}
