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
  assert.match(page,/get\('id'\)/);assert.match(page,/\/api\/characters\/\$\{encodeURIComponent\(characterId\)\}/);
  assert.ok(fs.existsSync(new URL('../api/characters/[id].mjs',import.meta.url)));
});
