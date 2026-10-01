import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {handleCharacterApi} from '../worker/character-api.mjs';

const catalog=count=>new Map(Array.from({length:count},(_,index)=>[crypto.randomUUID(),{name:`Guest ${index}`,createdAt:new Date(Date.UTC(2026,8,30,10,index)).toISOString(),hasWave:'true',hasParty:'true'}]));
const list=async(store,query='')=>(await handleCharacterApi(new Request(`https://game.test/api/characters${query}`),{},{store})).json();

test('the character catalog shows 60 by default and up to 100 on request',async()=>{
  const store=catalog(120);
  assert.equal((await list(store)).count,60);
  assert.equal((await list(store,'?limit=100')).count,100);
  assert.equal((await list(store,'?limit=500')).count,100);
  assert.equal((await list(store,'?limit=nope')).count,60);
  assert.equal((await list(store,'?limit=5')).count,5);
});

test('the catalog passes its limit to storage so hosted lists can read further back',async()=>{
  let asked;const characterStorage={async list(limit){asked=limit;return [];}};
  await handleCharacterApi(new Request('https://game.test/api/characters?limit=100'),{},{characterStorage});assert.equal(asked,100);
  await handleCharacterApi(new Request('https://game.test/api/characters'),{},{characterStorage});assert.equal(asked,60);
});

test('a character can be opened by id without its claim token',async()=>{
  const store=catalog(1),[id]=store.keys(),response=await handleCharacterApi(new Request(`https://game.test/api/characters/${id}`),{},{store}),body=await response.json();
  assert.equal(response.status,200);assert.equal(body.character.id,id);assert.equal(body.character.name,'Guest 0');assert.ok(body.character.party);
  assert.equal(JSON.stringify(body).includes('claimHash'),false);
  assert.equal((await handleCharacterApi(new Request(`https://game.test/api/characters/${crypto.randomUUID()}`),{},{store})).status,404);
  assert.equal((await handleCharacterApi(new Request('https://game.test/api/characters/not-an-id'),{},{store})).status,404);
});

test('the gallery lists every character and links to its download page',()=>{
  const read=path=>fs.readFileSync(new URL(`../dist/${path}`,import.meta.url),'utf8'),html=read('gallery/index.html'),gallery=read('gallery/gallery.mjs'),page=read('character/character.mjs');
  assert.match(gallery,/\/api\/characters\?limit=100/);
  assert.match(gallery,/\/character\/\?id=\$\{encodeURIComponent\(character\.id\)\}/);
  assert.match(html,/gallery\.mjs\?v=gallery-2/);
  // The crew's post-event test character stays out of the list.
  assert.match(gallery,/hidden=new Set\(\['962ce8d0-7a02-4d33-9f16-17fc76a4e09d'\]\)/);assert.match(gallery,/characters\.filter\(character=>!hidden\.has\(character\.id\)\)/);
  assert.match(read('character/index.html'),/character\.mjs\?v=gallery-2/);assert.match(page,/import \{loadSheets\} from '\.\/sheet-loader\.mjs\?v=gallery-1'/);assert.match(page,/await loadSheets\(urls,value=>\{shown=value\*100;paintProgress\(\);\}\)/);
  assert.match(page,/get\('id'\)/);assert.match(page,/\/api\/characters\/\$\{encodeURIComponent\(characterId\)\}/);
  assert.ok(fs.existsSync(new URL('../api/characters/[id].mjs',import.meta.url)));
});

test('character images report their size so pages can show download progress',async()=>{
  const id=crypto.randomUUID(),store=new Map([[id,{name:'Mina',createdAt:'2026-09-30',bytes:new Uint8Array(1234),partyBytes:new Uint8Array(77),hasParty:'true'}]]);
  const walk=await handleCharacterApi(new Request(`https://game.test/api/characters/${id}/image`),{},{store});assert.equal(walk.headers.get('content-length'),'1234');
  const party=await handleCharacterApi(new Request(`https://game.test/api/characters/${id}/image?animation=party`),{},{store});assert.equal(party.headers.get('content-length'),'77');
  const streamed=await handleCharacterApi(new Request(`https://game.test/api/characters/${id}/image`),{},{characterStorage:{async get(){return {bytes:new ReadableStream({start(c){c.enqueue(new Uint8Array(3));c.close();}}),size:3};}}});assert.equal(streamed.headers.get('content-length'),'3');
});

test('sprite sheets load with combined byte progress and become local object URLs',async()=>{
  const {loadSheets}=await import('../dist/character/sheet-loader.mjs');
  const body=(chunks,length)=>new Response(new ReadableStream({start(c){for(const n of chunks)c.enqueue(new Uint8Array(n));c.close();}}),{headers:length?{'content-length':String(length)}:{}});
  const seen=[],urls=await loadSheets(['/a','/b'],value=>seen.push(value),{fetchImpl:async url=>url==='/a'?body([50,50],100):body([100],100),createUrl:blob=>`blob:${blob.size}`});
  assert.deepEqual(urls,['blob:100','blob:100']);
  assert.ok(seen.every((value,index)=>index===0||value>=seen[index-1]),'progress never goes backwards');
  assert.equal(seen.at(-1),1);assert.ok(seen.includes(.25));
  // Without a size header, an estimate keeps the bar moving but never claims completion early.
  const estimated=[];await loadSheets(['/c'],value=>estimated.push(value),{fetchImpl:async()=>body([9e6]),createUrl:()=>'blob:x'});
  assert.ok(estimated.slice(0,-1).every(value=>value<1));assert.equal(estimated.at(-1),1);
  await assert.rejects(loadSheets(['/d'],()=>{},{fetchImpl:async()=>new Response('',{status:404}),createUrl:()=>''}),/no longer available/);
});
