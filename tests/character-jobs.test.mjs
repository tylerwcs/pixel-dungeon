import test from 'node:test';
import assert from 'node:assert/strict';
import {handleAppApi} from '../worker/app-api.mjs';
import {memoryJobStorage,JOB_DURATION_MS,JOB_TTL_MS} from '../worker/character-jobs.mjs';
import {lobbyInvite} from '../dist/lobby-scanner.mjs';

const origin='https://game.test',token='a'.repeat(48);
function createRequest(id,name='Mina',accessToken=token){const form=new FormData();form.append('name',name);form.append('photo',new Blob(['private photo'],{type:'image/jpeg'}),'photo.jpg');form.append('requestId',id);form.append('accessToken',accessToken);return new Request(`${origin}/api/character-jobs`,{method:'POST',body:form});}
const statusRequest=(id,accessToken=token)=>new Request(`${origin}/api/character-jobs/${id}`,{headers:{authorization:`Bearer ${accessToken}`}});
function setup(fetchImpl){const records=new Map(),store=new Map(),tasks=[];let time=Date.now(),hits=0;const options={store,jobStorage:memoryJobStorage(records),now:()=>time,rateLimiter:{hit:async()=>{hits++;return true;}},fetchImpl:fetchImpl||(async()=>Response.json({data:[{b64_json:btoa('artwork')}]})),defer:task=>tasks.push(task)};return {records,store,tasks,options,call:request=>handleAppApi(request,{OPENAI_API_KEY:'test'},options),advance:ms=>time+=ms,hits:()=>hits};}

test('two attendees receive private QR receipts before either generation finishes',async()=>{
  const release=[];const harness=setup(async()=>{await new Promise(resolve=>release.push(resolve));return Response.json({data:[{b64_json:btoa('artwork')}]});});
  const first=crypto.randomUUID(),second=crypto.randomUUID();
  const a=await harness.call(createRequest(first,'Mina')),b=await harness.call(createRequest(second,'Bob','b'.repeat(48)));
  assert.equal(a.status,202);assert.equal(b.status,202);assert.equal(harness.store.size,0);assert.equal(harness.tasks.length,2);
  assert.match((await a.json()).progressUrl,new RegExp(`/character/\\?job=${first}#access=`));
  await new Promise(resolve=>setImmediate(resolve));assert.equal(release.length,2);
  assert.equal((await (await harness.call(statusRequest(first))).json()).job.status,'walking');
  assert.equal((await harness.call(statusRequest(first,'bad'))).status,404);
  assert.equal(JSON.stringify([...harness.records.values()]).includes(token),false);assert.equal(JSON.stringify([...harness.records.values()]).includes('private photo'),false);
  release.splice(0).forEach(resolve=>resolve());await new Promise(resolve=>setImmediate(resolve));
  assert.equal((await (await harness.call(statusRequest(first))).json()).job.status,'waving');
  release.splice(0).forEach(resolve=>resolve());await Promise.all(harness.tasks);
  const ready=(await (await harness.call(statusRequest(first))).json()).job;assert.equal(ready.status,'complete');assert.equal(ready.character.id,first);assert.equal(harness.store.size,2);
  const pass=await harness.call(new Request(`${origin}/api/characters/${first}/pass`,{method:'POST',body:JSON.stringify({claimToken:token})}));assert.equal(pass.status,200);
});

test('duplicate and concurrent submission retries never launch another generation',async()=>{
  const harness=setup(),id=crypto.randomUUID();
  const responses=await Promise.all([harness.call(createRequest(id)),harness.call(createRequest(id))]);assert.deepEqual(responses.map(item=>item.status),[202,202]);await Promise.all(harness.tasks);assert.equal(harness.tasks.length,1);
  assert.equal((await harness.call(createRequest(id))).status,202);assert.equal(harness.tasks.length,1);
  assert.equal((await harness.call(createRequest(id,'Mina','b'.repeat(48)))).status,409);
});

test('failed and interrupted jobs report a terminal state without publishing a character',async()=>{
  const harness=setup(async()=>Response.json({error:{code:'insufficient_quota'}},{status:429})),id=crypto.randomUUID();await harness.call(createRequest(id));await Promise.all(harness.tasks);
  const failed=(await (await harness.call(statusRequest(id))).json()).job;assert.equal(failed.status,'failed');assert.match(failed.error,/credits/);assert.equal(harness.store.size,0);
  const stalledId=crypto.randomUUID(),stalled=setup();stalled.options.defer=()=>{};
  // Simulate a host dying after accepting the job by supplying a never-resolving image request.
  stalled.options.fetchImpl=()=>new Promise(()=>{});await stalled.call(createRequest(stalledId));stalled.advance(JOB_DURATION_MS+1);
  const timeout=(await (await stalled.call(statusRequest(stalledId))).json()).job;assert.equal(timeout.status,'failed');assert.match(timeout.error,/too long/);
  stalled.advance(JOB_TTL_MS);assert.equal((await stalled.call(statusRequest(stalledId))).status,410);
});

test('unsupported hosts, invalid tickets and rejected quotas do not accept jobs',async()=>{
  const harness=setup(),id=crypto.randomUUID();delete harness.options.defer;assert.equal((await harness.call(createRequest(id))).status,503);assert.equal(harness.records.size,0);
  harness.options.defer=task=>harness.tasks.push(task);assert.equal((await harness.call(createRequest('bad'))).status,400);assert.equal((await harness.call(createRequest(id,'Mina','short'))).status,400);
  harness.options.rateLimiter={hit:async()=>false};assert.equal((await harness.call(createRequest(id))).status,429);assert.equal(harness.tasks.length,0);
  assert.equal((await harness.call(new Request(`${origin}/api/character-jobs`,{method:'POST',headers:{origin:'https://other.test'}}))).status,403);
});

test('scanner accepts only well-formed lobby invitations from the current event site',()=>{
  const id=crypto.randomUUID(),url=`${origin}/join/?lobby=${id}&token=${token}`;assert.equal(lobbyInvite(url,origin),url);
  for(const bad of [`https://evil.test/join/?lobby=${id}&token=${token}`,`javascript:alert(1)`,`${origin}/character/?job=${id}`,`${origin}/join/?lobby=${id}&token=short`,`${origin}/join/?lobby=bad&token=${token}`])assert.equal(lobbyInvite(bad,origin),null);
});
