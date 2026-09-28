import test from 'node:test';
import assert from 'node:assert/strict';
import {handleAppApi} from '../worker/app-api.mjs';
import {BOOTH_SESSION_TTL_MS} from '../worker/booth-session-api.mjs';

const origin='https://game.test';
function setup(){let now=1700000000000;const boothSessionMap=new Map(),call=request=>handleAppApi(request,{}, {boothSessionMap,now:()=>now});return {boothSessionMap,call,advance:value=>now+=value};}
const post=(url,body,headers={})=>new Request(`${origin}${url}`,{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(body)});

test('a display pairs one phone without exposing raw pairing tokens',async()=>{
  const harness=setup(),created=await harness.call(post('/api/booth-sessions',{})),data=await created.json();assert.equal(created.status,201);assert.equal(data.session.phoneConnected,false);assert.equal(data.session.ticketCipher,null);
  const captureUrl=new URL(data.captureUrl),fragment=new URLSearchParams(captureUrl.hash.slice(1)),captureToken=fragment.get('capture'),relayKey=fragment.get('relay'),id=data.session.id;assert.equal(captureUrl.pathname,'/booth-camera/');assert.equal(captureUrl.searchParams.get('session'),id);assert.ok(captureToken.length>=32);assert.ok(data.displayToken.length>=32);assert.equal(relayKey,data.relayKey);
  const stored=JSON.stringify([...harness.boothSessionMap.values()]);assert.equal(stored.includes(captureToken),false);assert.equal(stored.includes(data.displayToken),false);assert.equal(stored.includes(relayKey),false);
  assert.equal((await harness.call(new Request(`${origin}/api/booth-sessions/${id}`))).status,403);
  assert.equal((await harness.call(post(`/api/booth-sessions/${id}/connect`,{captureToken:'wrong'}))).status,403);
  const connected=await harness.call(post(`/api/booth-sessions/${id}/connect`,{captureToken}));assert.equal(connected.status,200);assert.equal((await connected.json()).session.phoneConnected,true);
  const ticketCipher={algorithm:'A256GCM',iv:'i'.repeat(16),data:'d'.repeat(64)};assert.equal((await harness.call(post(`/api/booth-sessions/${id}/ticket`,{captureToken,ticketCipher:{algorithm:'bad',iv:'short',data:'bad'}}))).status,400);
  assert.equal((await harness.call(post(`/api/booth-sessions/${id}/ticket`,{captureToken,ticketCipher}))).status,200);
  const display=await harness.call(new Request(`${origin}/api/booth-sessions/${id}`,{headers:{authorization:`Bearer ${data.displayToken}`}})),displayData=await display.json();assert.equal(display.status,200);assert.deepEqual(displayData.session.ticketCipher,ticketCipher);assert.equal(JSON.stringify([...harness.boothSessionMap.values()]).includes('j'.repeat(48)),false);
  const reset=await harness.call(post(`/api/booth-sessions/${id}/reset`,{captureToken}));assert.equal(reset.status,200);
  const empty=await harness.call(new Request(`${origin}/api/booth-sessions/${id}`,{headers:{authorization:`Bearer ${data.displayToken}`}}));assert.equal((await empty.json()).session.ticketCipher,null);
});

test('booth pairings reject cross-site creation and expire after the event window',async()=>{
  const harness=setup();assert.equal((await harness.call(post('/api/booth-sessions',{}, {origin:'https://elsewhere.test'}))).status,403);
  const data=await (await harness.call(post('/api/booth-sessions',{}))).json();harness.advance(BOOTH_SESSION_TTL_MS+1);
  assert.equal((await harness.call(new Request(`${origin}/api/booth-sessions/${data.session.id}`,{headers:{authorization:`Bearer ${data.displayToken}`}}))).status,410);
});
