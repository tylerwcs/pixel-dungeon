import './tests/character-jobs.test.mjs';
import './tests/booth-sessions.test.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {MAP,open,distanceField,newRound,step,position,sweptContact,nextCollector,aiDirection,DIRS,key,roundScores,rankScores,CATCH_BONUS,GAME_ROUNDS,dashReady,dashSpeedFactor,DASH_BOOST,DASH_TIME,DASH_COOLDOWN,neighbors,WIDTH,HEIGHT,aiWantsDash} from './dist/engine.mjs';
import {connectedPads,controlsAvailable,gamepadDirection,controlOrder,controlName,padPressed,gamepadDash,gamepadStart} from './dist/input.mjs';
import {detectSpriteFrames,identityAsset,defaults,cache,characterAsset,drawGreeting,drawSprite,waveFrame} from './dist/render.mjs';
import {buildCharacterPortraitPrompt,buildCharacterPrompt,buildWavePrompt,buildPartyPrompt,createCharacterStorage,generationRateLimit,handleCharacterApi,resetGenerationRateLimits,sanitizeCharacterName,validatePhoto} from './worker/character-api.mjs';
import {handleAppApi} from './worker/app-api.mjs';
import {cacheControlFor,resolveStaticRoute} from './worker/static-routing.mjs';
import {decryptTicket,encryptTicket,randomToken,randomUUID} from './dist/ticket-crypto.mjs';
import {dashStatus} from './dist/labels.mjs';
const party=()=>[{control:'wasd'},{control:'arrows'},{control:'ai'},{control:'ai'}];
test('local-network booth tickets use a Web Crypto-free encrypted fallback',async()=>{const relay=randomToken(32),ticket={id:randomUUID(),token:randomToken(),name:'Mina',createdAt:new Date().toISOString()},cipher=await encryptTicket(ticket,relay,null);assert.equal(cipher.algorithm,'CHACHA20');assert.notEqual(cipher.data,btoa(JSON.stringify(ticket)));assert.deepEqual(await decryptTicket(cipher,relay,null),ticket);});
test('greetings use a stationary wave sheet, characters without one walk in place, and gameplay keeps its directional walk',()=>{
  const walk={width:1024,height:1024},wave={width:1024,height:1024};cache.set('test-walk',walk);cache.set('test-wave',wave);
  const asset=characterAsset({imageUrl:'test-walk',cols:4,rows:4,fps:8,layout:'directional',wave:{imageUrl:'test-wave',cols:4,rows:4,fps:6,layout:'directional'}}),calls=[],ctx={drawImage:(...args)=>calls.push(args)};
  try{
    drawGreeting(ctx,asset,110,110,220,0);drawGreeting(ctx,asset,110,110,220,.5);
    assert.equal(calls[0][0],wave);assert.equal(calls[0][1],0);assert.equal(calls[1][1],768);assert.equal(calls[1][2],0);
    assert.deepEqual(calls[0].slice(5),calls[1].slice(5),'the body anchor stays fixed as the hand moves');
    drawSprite(ctx,asset,110,110,220,.25,'left',true);assert.equal(calls[2][0],walk);assert.equal(calls[2][1],512);assert.equal(calls[2][2],256);
    cache.delete('test-wave');drawGreeting(ctx,asset,110,110,220,.25);assert.equal(calls[3][0],walk);assert.equal(calls[3][1],512,'walks through its frames');assert.equal(calls[3][2],0,'facing the camera');
    assert.equal(waveFrame(2),0);assert.equal(waveFrame(3),0);assert.equal(waveFrame(-1),0);
  }finally{cache.delete('test-walk');cache.delete('test-wave');}
});

test('new characters animate one finished portrait into all three sheets, with one rate-limit hit',async()=>{
  const store=new Map(),requests=[];let hits=0;
  const form=new FormData();form.append('name','Waver');form.append('photo',new Blob(['original photo'],{type:'image/jpeg'}),'photo.jpg');
  const response=await handleCharacterApi(new Request('https://game.test/api/characters/generate',{method:'POST',body:form}),{OPENAI_API_KEY:'test'}, {store,rateLimiter:{hit:async()=>{hits++;return true;}},fetchImpl:async(url,{body})=>{requests.push(body);return Response.json({data:[{b64_json:btoa(['portrait bytes','walk bytes','wave bytes','party bytes'][requests.length-1])}]});}});
  assert.equal(response.status,201);assert.equal(hits,1);assert.equal(requests.length,4);
  const walkInputs=requests[0].getAll('image[]');assert.equal(walkInputs.length,2);assert.equal(await walkInputs[0].text(),'original photo');assert.equal(walkInputs[1].name,'style-a.png');assert.equal(walkInputs[1].type,'image/png');assert.equal(walkInputs[1].size,678168);assert.deepEqual([...new Uint8Array(await walkInputs[1].slice(0,8).arrayBuffer())],[137,80,78,71,13,10,26,10]);assert.equal(requests[0].get('image'),null);
  assert.equal(requests[0].get('prompt'),buildCharacterPortraitPrompt());assert.equal(requests[0].get('size'),'1024x1024');
  for(const [index,prompt]of [[1,buildCharacterPrompt()],[2,buildWavePrompt()],[3,buildPartyPrompt()]]){assert.equal(await requests[index].get('image').text(),'portrait bytes');assert.equal(requests[index].getAll('image[]').length,0);assert.equal(requests[index].get('image').type,'image/png');assert.equal(requests[index].get('prompt'),prompt);assert.equal(requests[index].get('size'),'2048x2048');}
  for(const request of requests)assert.equal(request.get('quality'),'high');
  assert.match(buildWavePrompt(),/both feet planted/);assert.match(buildWavePrompt(),/4 columns by 4 rows/);
  const {character,claimToken}=await response.json();
  for(const [url,expected] of [[character.imageUrl,'walk bytes'],[character.wave.imageUrl,'wave bytes'],[character.party.imageUrl,'party bytes']]){const image=await handleCharacterApi(new Request(`https://game.test${url}`),{}, {store});assert.equal(image.status,200);assert.equal(await image.text(),expected);}
  const pass=await handleCharacterApi(new Request(`https://game.test/api/characters/${character.id}/pass`,{method:'POST',body:JSON.stringify({claimToken})}),{}, {store});const savedCharacter=(await pass.json()).character;assert.deepEqual(savedCharacter.wave,character.wave);assert.deepEqual(savedCharacter.party,character.party);assert.equal(character.party.fps,6);
  const catalog=await handleCharacterApi(new Request('https://game.test/api/characters'),{}, {store});assert.deepEqual((await catalog.json()).characters,[character]);
  assert.equal(JSON.stringify([...store.values()]).includes('original photo'),false);assert.equal(JSON.stringify([...store.values()]).includes('portrait bytes'),false);
});

test('failure at any generation stage never publishes an incomplete character',async()=>{
  for(const failedStage of [1,2,3,4])for(const failure of [()=>Response.json({error:{code:'insufficient_quota'}},{status:429}),()=>Response.json({data:[]}),()=>{throw new Error('offline');}]){
    const store=new Map(),form=new FormData();form.append('name','Mina');form.append('photo',new Blob(['photo'],{type:'image/jpeg'}),'photo.jpg');let calls=0;
    const response=await handleCharacterApi(new Request('https://game.test/api/characters/generate',{method:'POST',body:form}),{OPENAI_API_KEY:'test'}, {store,rateLimiter:{hit:async()=>true},fetchImpl:async()=>++calls<failedStage?Response.json({data:[{b64_json:btoa(calls===1?'portrait bytes':'walk bytes')}]}):failure()});
    assert.ok(response.status>=500);assert.equal(calls,failedStage);assert.equal(store.size,0);
  }
});

test('R2 stores extra animations outside the gallery prefix and legacy characters remain compatible',async()=>{
  const objects=new Map(),bucket={async put(key,bytes,settings){objects.set(key,{key,body:bytes,...settings});},async get(key){return objects.get(key)||null;},async list({prefix}){return {objects:[...objects.values()].filter(item=>item.key.startsWith(prefix))};}},storage=createCharacterStorage({CHARACTERS:bucket}),id=crypto.randomUUID(),legacyId=crypto.randomUUID();
  await storage.put(id,new Uint8Array([1]),{name:'New',createdAt:'2026-09-27',hasWave:'true',hasParty:'true'},new Uint8Array([2]),new Uint8Array([4]));await storage.put(legacyId,new Uint8Array([3]),{name:'Old',createdAt:'2026-09-26'});
  const records=await storage.list();assert.equal(records.length,2);assert.ok(records[0].wave);assert.equal(records[0].party.fps,6);assert.equal(records[1].wave,undefined);assert.equal(records[1].party,undefined);assert.deepEqual((await storage.get(id,'party')).bytes,new Uint8Array([4]));assert.equal(await storage.get(legacyId,'party'),null);assert.deepEqual((await storage.get(id,'wave')).bytes,new Uint8Array([2]));assert.equal(await storage.get(legacyId,'wave'),null);
  const memory=new Map([[legacyId,{name:'Old',createdAt:'2026-09-26',bytes:new Uint8Array([3])}]]);
  for(const animation of ['wave','party']){const response=await handleCharacterApi(new Request(`https://game.test/api/characters/${legacyId}/image?animation=${animation}`),{}, {store:memory});assert.equal(response.status,404);}
});
function live(){const s=newRound(party());s.phase='playing';s.actors.forEach(a=>{a.human=true;a.dir=null;});return s;}
test('all coins and spawns are connected and the maze has escape loops',()=>{const count=MAP.flat().filter(c=>c==='.').length,dist=distanceField(1,19);assert.equal(dist.size,count);const s=newRound(party());for(const a of s.actors)assert.ok(dist.has(key(a.x,a.y)));assert.ok(count>150);});
test('one to four people always have one collector and three pursuers',()=>{for(let n=1;n<=4;n++){const p=Array.from({length:4},(_,i)=>({control:i<n?['wasd','arrows','pad:0','pad:1'][i]:'ai'})),s=newRound(p,2);assert.equal(s.actors.filter(a=>a.human).length,n);assert.equal(s.actors.filter(a=>a.collector).length,1);assert.equal(s.collector,2);assert.equal(s.actors.filter(a=>!a.collector).length,3);}});
test('five-second countdown prevents movement and coins, then starts gameplay',()=>{const s=newRound(party());s.actors[0].queued='down';for(let i=0;i<299;i++)step(s,1/60);assert.equal(s.phase,'countdown');assert.deepEqual(position(s.actors[0]),{x:1,y:1});for(let i=0;i<2;i++)step(s,1/60);assert.equal(s.phase,'playing');});
test('walls stop movement and buffered turns happen at the next open junction',()=>{const s=live(),a=s.actors[0];a.queued='left';step(s,1/60);assert.equal(a.x,1);assert.equal(a.target,null);a.queued='right';for(let i=0;i<14;i++)step(s,1/60);a.queued='up';for(let i=0;i<50;i++)step(s,1/60);assert.equal(a.x,5);assert.ok(position(a).y<19);assert.ok(s.coins.size<s.total);});
test('fixed simulation is deterministic and pause freezes it',()=>{const a=live(),b=live();a.actors[0].queued='up';b.actors[0].queued='up';for(let i=0;i<60;i++){step(a,1/60);step(b,1/60);}assert.deepEqual(position(a.actors[0]),position(b.actors[0]));a.phase='paused';const before=structuredClone(a);for(let i=0;i<600;i++)step(a,1/60);assert.deepEqual(a,before);});
test('crossing and touching characters are caught; separated paths are safe',()=>{assert.ok(sweptContact({x:0,y:0},{x:1,y:0},{x:1,y:0},{x:0,y:0}));assert.ok(!sweptContact({x:0,y:0},{x:1,y:0},{x:0,y:1},{x:1,y:1}));});
test('catch ends the round, records every catcher and takes precedence over the final coin',()=>{const s=live();s.coins=new Set(['1,1']);for(const index of [1,2]){s.actors[index].x=1;s.actors[index].y=1;}assert.deepEqual(step(s,1/60),['caught']);assert.equal(s.winner,'pursuers');assert.deepEqual(s.catchers,[1,2]);assert.equal(s.coins.size,1);});
test('collecting the final coin wins and cannot score twice',()=>{const s=live();s.coins=new Set(['1,1']);assert.deepEqual(step(s,1/60),['coin','win']);assert.equal(s.phase,'result');assert.equal(s.winner,'collector');assert.deepEqual(step(s,1/60),[]);});
test('four rounds rotate the collector while every player keeps their corner and controls',()=>{const p=party(),corners=[[1,1],[23,1],[1,19],[23,19]];let collector=0;const order=[];for(let round=1;round<=GAME_ROUNDS;round++){const s=newRound(p,collector,round);order.push(s.collector);assert.equal(s.round,round);assert.equal(s.elapsed,0);assert.equal(s.collected,0);assert.equal(s.countdown,5);assert.deepEqual(s.actors.map(actor=>[actor.x,actor.y]),corners);assert.deepEqual(s.actors.map(actor=>actor.control),p.map(player=>player.control));collector=nextCollector(p,collector);}assert.deepEqual(order,[0,1,2,3]);});
test('player character identity does not change when collector duty rotates',()=>{const mina={src:'/api/characters/mina/image'},p=[{control:'wasd',booth:null},{control:'arrows',booth:mina},{control:'ai',booth:null},{control:'ai',booth:null}];assert.equal(identityAsset(p,0),defaults.collector);assert.equal(identityAsset(p,1),mina);assert.equal(identityAsset(p,2),defaults.pursuer);const lobbySlots=[{slotStatus:'ai',booth:null},{slotStatus:'joined',booth:null},{slotStatus:'ai',booth:null},{slotStatus:'joined',booth:mina}];assert.deepEqual(lobbySlots.map((_,index)=>identityAsset(lobbySlots,index)),[defaults.pursuer,defaults.collector,defaults.pursuer,mina]);for(let collector=0;collector<4;collector++)assert.deepEqual(newRound(p,collector).actors.map(actor=>actor.id),[0,1,2,3]);});
test('round scoring awards collected gold and 15 gold to each catcher',()=>{const s=newRound(party(),0,1);s.collected=23;s.catchers=[1,3];assert.equal(CATCH_BONUS,15);assert.deepEqual(roundScores(s),[23,15,0,15]);assert.deepEqual(rankScores([23,15,0,15]).map(entry=>entry.index),[0,1,3,2]);});
test('score ranking breaks ties by player number',()=>{assert.deepEqual(rankScores([20,30,30,10]).map(entry=>entry.index),[1,2,0,3]);});
test('AI paths stay on the maze and a stationary collector is caught',()=>{const s=newRound([{control:'wasd'},{control:'ai'},{control:'ai'},{control:'ai'}]);s.phase='playing';for(let i=0;i<3600&&s.phase==='playing';i++){for(const a of s.actors.filter(a=>!a.human)){const dir=aiDirection(a,s),d=DIRS[dir];assert.ok(open(a.x+d.x,a.y+d.y));}step(s,1/60);}assert.equal(s.winner,'pursuers');assert.ok(s.elapsed<30);});
test('custom art does not change gameplay or collision geometry',()=>{const p=party();p[0].booth={src:'arbitrary.png',cols:32,rows:4,fps:24,layout:'directional'};const s=newRound(p),plain=newRound(party());assert.deepEqual(s.actors,plain.actors);});
test('mixed keyboard/gamepad controls need all assigned devices connected',()=>{const p=[{control:'wasd'},{control:'arrows'},{control:'pad:0'},{control:'pad:2'}],pads=[{index:0,connected:true},null,{index:2,connected:true}];assert.ok(controlsAvailable(p,connectedPads(pads)));pads[2].connected=false;assert.ok(!controlsAvailable(p,connectedPads(pads)));pads[2].connected=true;assert.ok(controlsAvailable(p,connectedPads(pads)));assert.ok(!controlsAvailable(Array(4).fill({control:'ai'}),[]));});
test('gamepad deadzone, dominant stick axis, and D-pad override',()=>{assert.equal(gamepadDirection({axes:[.2,-.2]}),null);assert.equal(gamepadDirection({axes:[-.9,.2]}),'left');assert.equal(gamepadDirection({axes:[.2,.8]}),'down');assert.equal(gamepadDirection({axes:[.8,0],buttons:Array.from({length:16},(_,i)=>({pressed:i===12}))}),'up');});
const dashParty=()=>[{control:'wasd'},{control:'arrows'},{control:'pad:0'},{control:'pad:1'}];
const playing=(players=dashParty(),collector=0)=>{const s=newRound(players,collector);s.phase='playing';s.countdown=0;return s;};
const openDirection=a=>Object.keys(DIRS).find(name=>open(a.x+DIRS[name].x,a.y+DIRS[name].y));
test('a dash bursts to peak speed on its first step',()=>{
  const plain=playing(),dashing=playing();
  for(const s of [plain,dashing])s.actors[0].queued=openDirection(s.actors[0]);
  dashing.actors[0].dashRequested=true;
  step(plain,1/60);const events=step(dashing,1/60);
  assert.ok(events.includes('dash'));
  assert.ok(Math.abs(dashing.actors[0].progress/plain.actors[0].progress-DASH_BOOST)<1e-9);
});
test('the collector can dash again 8 seconds after a dash ends',()=>{
  const s=playing(),dashes=[];
  for(let i=0;i<1200;i++){s.actors[0].dashRequested=true;if(step(s,1/60).includes('dash'))dashes.push(i);}
  assert.equal(dashes[0],0);
  assert.equal(dashes[1]-dashes[0],Math.round((DASH_TIME+DASH_COOLDOWN)*60));
});
test('each pursuer dashes once per round and dash state resets every round',()=>{
  const players=dashParty(),s=playing(players);
  s.actors[1].dashRequested=true;assert.ok(step(s,1/60).includes('dash'));assert.equal(s.actors[1].dashesLeft,0);
  for(let i=0;i<200;i++)step(s,1/60);
  s.actors[1].dashRequested=true;assert.ok(!step(s,1/60).includes('dash'));assert.equal(dashReady(s.actors[1]),false);
  const next=newRound(players,1,2);
  assert.equal(next.actors[0].dashesLeft,1);assert.equal(next.actors[1].dashesLeft,null);
  assert.ok(next.actors.every(a=>a.dashTime===0&&a.dashCooldown===0&&dashReady(a)));
});
test('dash requests during the countdown are dropped',()=>{
  const s=newRound(dashParty());s.actors[0].dashRequested=true;
  step(s,1/60);assert.equal(s.actors[0].dashTime,0);assert.equal(s.actors[0].dashRequested,false);
  s.phase='playing';s.countdown=0;assert.ok(!step(s,1/60).includes('dash'));
});
test('a dashing pursuer still catches the collector',()=>{
  const s=playing(),c=s.actors[0],p=s.actors[1],field=distanceField(c.x,c.y);
  let start=null;for(let y=0;y<HEIGHT&&!start;y++)for(let x=0;x<WIDTH;x++)if(field.get(key(x,y))===3){start={x,y};break;}
  Object.assign(p,start,{target:null,progress:0,dir:null});p.dashRequested=true;
  for(let i=0;i<60&&s.phase==='playing';i++){if(!p.target)p.queued=neighbors(p.x,p.y).sort((a,b)=>field.get(key(a.x,a.y))-field.get(key(b.x,b.y)))[0].name;step(s,1/60);}
  assert.equal(s.phase,'result');assert.deepEqual(s.catchers,[1]);
});
const findRow=clear=>{for(let y=1;y<HEIGHT-1;y++)for(let x=1;x<WIDTH-5;x++){if(!open(x,y)||!open(x+4,y))continue;const between=[1,2,3].map(i=>open(x+i,y));if(clear?between.every(Boolean):between.some(v=>!v))return {x,y};}return null;};
test('the AI collector dashes when a pursuer is within 3 tiles',()=>{
  const s=playing([{control:'ai'},{control:'arrows'},{control:'pad:0'},{control:'pad:1'}]),c=s.actors[0];
  for(const a of s.actors.slice(1))Object.assign(a,{x:c.x+10,y:c.y+10});
  assert.equal(aiWantsDash(c,s),false);
  Object.assign(s.actors[2],{x:c.x+2,y:c.y+1});assert.equal(aiWantsDash(c,s),true);
  c.dashTime=1;assert.equal(aiWantsDash(c,s),false);
});
test('an AI pursuer saves its dash for a clear straight line within 5 tiles',()=>{
  const s=playing([{control:'wasd'},{control:'ai'},{control:'pad:0'},{control:'pad:1'}]),c=s.actors[0],p=s.actors[1];
  const clear=findRow(true),blocked=findRow(false);assert.ok(clear&&blocked);
  Object.assign(c,{x:clear.x,y:clear.y,target:null});Object.assign(p,{x:clear.x+4,y:clear.y,target:null});assert.equal(aiWantsDash(p,s),true);
  Object.assign(c,{x:blocked.x,y:blocked.y});Object.assign(p,{x:blocked.x+4,y:blocked.y});assert.equal(aiWantsDash(p,s),false);
  Object.assign(c,{x:clear.x,y:clear.y});Object.assign(p,{x:clear.x+4,y:clear.y+1});assert.equal(aiWantsDash(p,s),false);
  Object.assign(p,{x:clear.x+4,y:clear.y,dashesLeft:0});assert.equal(aiWantsDash(p,s),false);
});
test('AI players use their dash inside step',()=>{
  const s=playing([{control:'ai'},{control:'arrows'},{control:'pad:0'},{control:'pad:1'}]),c=s.actors[0];
  Object.assign(s.actors[1],{x:c.x+1,y:c.y+1});
  assert.ok(step(s,1/60).includes('dash'));assert.ok(c.dashTime>0);
});
test('gamepads are offered before keyboards and every control has a visible name',()=>{assert.deepEqual(controlOrder([{index:0},{index:3}]),['pad:0','pad:3','wasd','arrows']);assert.deepEqual(controlOrder([]),['wasd','arrows']);assert.equal(controlName('pad:0'),'PAD 1');assert.equal(controlName('pad:3'),'PAD 4');assert.equal(controlName('wasd'),'WASD KEYS');assert.equal(controlName('arrows'),'ARROW KEYS');assert.equal(controlName('ai'),'');});
test('any gamepad button or direction identifies the pad, including axis-only D-pads',()=>{const idle={axes:[0,0],buttons:Array.from({length:10},()=>({pressed:false}))};assert.equal(padPressed(idle),false);assert.equal(padPressed({...idle,axes:[0,-1]}),true);assert.equal(padPressed({...idle,buttons:idle.buttons.map((button,i)=>({pressed:i===1}))}),true);});
test('portrait prompts separate attendee identity from style and sheets preserve the finished design',()=>{const portrait=buildCharacterPortraitPrompt(),walk=buildCharacterPrompt();assert.match(portrait,/IMAGE 1 is the attendee photo/);assert.match(portrait,/IMAGE 2 is the approved STYLE A drawing/);assert.match(portrait,/not the reference person's clothing or identity/);for(const prompt of [walk,buildWavePrompt()]){assert.match(prompt,/FINISHED APPROVED CHARACTER DESIGN/);assert.match(prompt,/2048 by 2048/);assert.match(prompt,/4 columns by 4 rows/);assert.match(prompt,/local x=256/);assert.match(prompt,/local y=464/);assert.match(prompt,/Row 1 faces DOWN/);assert.match(prompt,/transparent/);}});
test('misaligned transparent sprite frames are detected and given stable anchors',()=>{const width=40,height=40,alpha=new Uint8Array(width*height),starts=[1,10,20,31],widths=[6,7,6,7];for(let row=0;row<4;row++)for(let col=0;col<4;col++)for(let y=row*10+1;y<=row*10+8;y++)for(let x=starts[col];x<starts[col]+widths[col];x++)alpha[y*width+x]=255;const atlas=detectSpriteFrames(alpha,width,height,4,4);assert.ok(atlas);assert.equal(atlas.frames.length,4);assert.deepEqual(atlas.frames.map(row=>row.length),[4,4,4,4]);assert.equal(atlas.maxWidth,7);assert.equal(atlas.maxHeight,8);assert.deepEqual(atlas.frames[0][3],{x:31,y:1,width:7,height:8});});
test('photo booth input validation accepts safe values and rejects unsafe uploads',()=>{assert.ok(validatePhoto(new Blob(['photo'],{type:'image/jpeg'})));assert.throws(()=>validatePhoto(new Blob(['photo'],{type:'image/gif'})),/JPEG, PNG, or WebP/);assert.throws(()=>validatePhoto({size:9*1024*1024,type:'image/png'}),/8 MB/);assert.equal(sanitizeCharacterName('  Mina   Swift  '),'Mina Swift');assert.throws(()=>sanitizeCharacterName('   '),/name/);});
test('photo booth publishes a default pass and adds its sprite to the shared gallery',async()=>{resetGenerationRateLimits();const store=new Map(),crossSite=await handleCharacterApi(new Request('https://game.test/api/characters/generate',{method:'POST',headers:{origin:'https://elsewhere.test'}}),{OPENAI_API_KEY:'test'},{store});assert.equal(crossSite.status,403);const form=new FormData();form.append('photo',new Blob(['photo'],{type:'image/jpeg'}),'player.jpg');form.append('name','Mina');let sent;const request=new Request('https://game.test/api/characters/generate',{method:'POST',headers:{origin:'https://game.test','cf-connecting-ip':'192.0.2.20'},body:form});const response=await handleCharacterApi(request,{OPENAI_API_KEY:'test-key'},{store,now:()=>1700000000000,fetchImpl:async(url,options)=>{sent={url,options};return new Response(JSON.stringify({data:[{b64_json:'iVBORw0KGgo='}]}),{status:200,headers:{'content-type':'application/json'}});}});assert.equal(response.status,201);const body=await response.json();assert.equal(body.character.name,'Mina');assert.equal(body.character.layout,'directional');assert.ok(body.claimToken.length>20);assert.match(body.passUrl,/\/pass\/\?character=.*#claim=/);assert.equal(sent.url,'https://api.openai.com/v1/images/edits');assert.equal(sent.options.body.get('model'),'gpt-image-2.5-sunburst');const catalog=await handleCharacterApi(new Request('https://game.test/api/characters'),{}, {store}),catalogBody=await catalog.json();assert.equal(catalogBody.count,1);assert.deepEqual(catalogBody.characters,[body.character]);assert.equal(JSON.stringify(catalogBody).includes(body.claimToken),false);const pass=await handleCharacterApi(new Request(`https://game.test/api/characters/${body.character.id}/pass`,{method:'POST',headers:{origin:'https://game.test','content-type':'application/json'},body:JSON.stringify({claimToken:body.claimToken})}),{}, {store});assert.equal(pass.status,200);const image=await handleCharacterApi(new Request(`https://game.test${body.character.imageUrl}`),{}, {store});assert.equal(image.status,200);assert.equal(image.headers.get('content-type'),'image/png');});
test('one lobby invitation and device controller can use any gallery character and switch slots',async()=>{
  resetGenerationRateLimits();const store=new Map(),lobbyStore=new Map(),form=new FormData();form.append('photo',new Blob(['photo'],{type:'image/jpeg'}),'player.jpg');form.append('name','Mina');
  const generated=await handleAppApi(new Request('https://game.test/api/characters/generate',{method:'POST',headers:{origin:'https://game.test','cf-connecting-ip':'192.0.2.30'},body:form}),{OPENAI_API_KEY:'test-key'},{store,lobbyStore,now:()=>1700000000000,fetchImpl:async()=>new Response(JSON.stringify({data:[{b64_json:'iVBORw0KGgo='}]}),{status:200,headers:{'content-type':'application/json'}})}),character=await generated.json();
  const created=await handleAppApi(new Request('https://game.test/api/lobbies',{method:'POST',headers:{origin:'https://game.test','content-type':'application/json'},body:'{}'}),{}, {store,lobbyStore,now:()=>1700000000000}),session=await created.json();
  assert.equal(created.status,201);assert.equal(session.lobby.slots[1].status,'open');assert.match(session.joinUrl,/\/join\/\?lobby=.*&token=/);assert.equal('slots' in session,false);
  const invitation=new URL(session.joinUrl),lobbyToken=invitation.searchParams.get('token');
  const guestToken=crypto.randomUUID(),claim=await handleAppApi(new Request(`https://game.test/api/lobbies/${session.lobby.id}/slots/2/claim`,{method:'POST',headers:{origin:'https://game.test','content-type':'application/json'},body:JSON.stringify({lobbyToken,characterId:character.character.id,guestToken})}),{}, {store,lobbyStore,now:()=>1700000000000}),claimed=await claim.json();
  assert.equal(claim.status,200);assert.equal(claimed.slot.character.name,'Mina');assert.deepEqual(claimed.slot.character.wave,character.character.wave);assert.equal(claimed.slot.ready,false);
  const occupied=await handleAppApi(new Request(`https://game.test/api/lobbies/${session.lobby.id}/slots/1/claim`,{method:'POST',headers:{origin:'https://game.test','content-type':'application/json'},body:JSON.stringify({lobbyToken,characterId:character.character.id,guestToken})}),{}, {store,lobbyStore,now:()=>1700000000000});
  assert.equal(occupied.status,409);
  const ready=await handleAppApi(new Request(`https://game.test/api/lobbies/${session.lobby.id}/slots/2/ready`,{method:'POST',headers:{origin:'https://game.test','content-type':'application/json'},body:JSON.stringify({lobbyToken,guestToken,ready:true})}),{}, {store,lobbyStore,now:()=>1700000000000}),readyBody=await ready.json();
  assert.equal(readyBody.slot.ready,true);
  const openedOne=await handleAppApi(new Request(`https://game.test/api/lobbies/${session.lobby.id}/slots/1/ai`,{method:'POST',headers:{origin:'https://game.test','content-type':'application/json'},body:JSON.stringify({hostToken:session.hostToken,ai:false})}),{}, {store,lobbyStore,now:()=>1700000000000}),openedOneBody=await openedOne.json();
  assert.equal(openedOneBody.slot.status,'open');
  const claimedOne=await handleAppApi(new Request(`https://game.test/api/lobbies/${session.lobby.id}/slots/1/claim`,{method:'POST',headers:{origin:'https://game.test','content-type':'application/json'},body:JSON.stringify({lobbyToken,characterId:character.character.id,guestToken})}),{}, {store,lobbyStore,now:()=>1700000000000}),claimedOneBody=await claimedOne.json();
  assert.equal(claimedOneBody.lobby.slots[0].status,'joined');assert.equal(claimedOneBody.lobby.slots[0].character.name,'Mina');assert.equal(claimedOneBody.lobby.slots[1].status,'open');
  const moved=await handleAppApi(new Request(`https://game.test/api/lobbies/${session.lobby.id}/slots/3/claim`,{method:'POST',headers:{origin:'https://game.test','content-type':'application/json'},body:JSON.stringify({lobbyToken,characterId:character.character.id,guestToken})}),{}, {store,lobbyStore,now:()=>1700000000000}),movedBody=await moved.json();
  assert.equal(movedBody.lobby.slots[0].status,'open');assert.equal(movedBody.lobby.slots[2].character.name,'Mina');assert.equal(movedBody.lobby.slots[2].ready,false);
});
test('the game screen adds default characters and clears every slot for the next group',async()=>{
  const store=new Map(),lobbyStore=new Map(),options={store,lobbyStore,now:()=>1700000000000};
  const post=async(path,body)=>{const response=await handleAppApi(new Request(`https://game.test${path}`,{method:'POST',headers:{origin:'https://game.test','content-type':'application/json'},body:JSON.stringify(body)}),{},options);return {status:response.status,body:await response.json()};};
  const created=await post('/api/lobbies',{}),{id}=created.body.lobby,hostToken=created.body.hostToken;
  const added=await post(`/api/lobbies/${id}/slots/2/default`,{hostToken});
  assert.equal(added.status,200);assert.deepEqual(added.body.slot,{slot:2,status:'joined',ready:false,character:null});
  assert.equal((await post(`/api/lobbies/${id}/slots/3/default`,{hostToken:'not-the-host-token'})).status,403);
  await post(`/api/lobbies/${id}/slots/3/ai`,{hostToken,ai:true});await post(`/api/lobbies/${id}/slots/2/ready`,{hostToken,ready:true});
  assert.equal((await post(`/api/lobbies/${id}/clear`,{hostToken:'not-the-host-token'})).status,403);
  const cleared=await post(`/api/lobbies/${id}/clear`,{hostToken});
  assert.equal(cleared.status,200);assert.deepEqual(cleared.body.lobby.slots.map(slot=>[slot.status,slot.ready,slot.character]),Array(4).fill(['open',false,null]));
});
test('photo booth reports exhausted API credits accurately',async()=>{resetGenerationRateLimits();const form=new FormData();form.append('photo',new Blob(['photo'],{type:'image/jpeg'}),'player.jpg');form.append('name','Mina');const request=new Request('https://game.test/api/characters/generate',{method:'POST',headers:{origin:'https://game.test','cf-connecting-ip':'192.0.2.21'},body:form}),response=await handleCharacterApi(request,{OPENAI_API_KEY:'test-key'},{store:new Map(),fetchImpl:async()=>new Response(JSON.stringify({error:{type:'insufficient_quota',code:'credit_balance_exhausted'}}),{status:429,headers:{'content-type':'application/json'}})});assert.equal(response.status,503);assert.match((await response.json()).error,/no API credits/);});
test('static routing serves booth, pass and join directory indexes',()=>{const assets={'/index.html':{},'/booth/index.html':{},'/booth-display/index.html':{},'/booth-camera/index.html':{},'/pass/index.html':{},'/join/index.html':{},'/booth/booth.css':{}};assert.deepEqual(resolveStaticRoute('/',assets),{pathname:'/index.html'});for(const route of ['booth','booth-display','booth-camera','pass','join']){assert.deepEqual(resolveStaticRoute(`/${route}/`,assets),{pathname:`/${route}/index.html`});assert.deepEqual(resolveStaticRoute(`/${route}`,assets),{redirect:`/${route}/`});}assert.deepEqual(resolveStaticRoute('/booth/booth.css',assets),{pathname:'/booth/booth.css'});assert.equal(resolveStaticRoute('/missing',assets),null);});
test('Vercel exposes explicit functions for every nested API route',()=>{const routes=['api/booth-sessions.mjs','api/booth-sessions/[id].mjs','api/booth-sessions/[id]/[action].mjs','api/character-jobs.mjs','api/character-jobs/[id].mjs','api/characters.mjs','api/characters/generate.mjs','api/characters/[id]/image.mjs','api/characters/[id]/pass.mjs','api/lobbies.mjs','api/lobbies/[id].mjs','api/lobbies/[id]/slots/[slot]/[action].mjs','api/lobbies/[id]/[action].mjs'];for(const route of routes)assert.ok(fs.existsSync(new URL(`./${route}`,import.meta.url)),`${route} is missing`);assert.ok(fs.existsSync(new URL('./api/_runtime.mjs',import.meta.url)));assert.equal(fs.existsSync(new URL('./api/[...path].mjs',import.meta.url)),false);const config=JSON.parse(fs.readFileSync(new URL('./vercel.json',import.meta.url),'utf8'));assert.equal(config.functions['api/**/*.mjs'].maxDuration,60);assert.equal(config.functions['api/characters/generate.mjs'].maxDuration,300);assert.equal(config.functions['api/character-jobs.mjs'].maxDuration,300);});
test('browser code and styles revalidate after deployments',()=>{assert.equal(cacheControlFor('/index.html'),'no-cache');assert.equal(cacheControlFor('/app.mjs'),'no-cache');assert.equal(cacheControlFor('/animation-worker.js'),'no-cache');assert.equal(cacheControlFor('/style.css'),'no-cache');assert.equal(cacheControlFor('/assets/adventurer.png'),'public, max-age=3600');const html=fs.readFileSync(new URL('./dist/index.html',import.meta.url),'utf8');assert.match(html,/style\.css\?v=roomy-1/);assert.match(html,/app\.mjs\?v=walk-1/);assert.match(html,/assets\/yep-event-logo\.webp/);});
test('shared lobby QR uses exact high-contrast modules sized for camera scanning',()=>{const qr=fs.readFileSync(new URL('./dist/qr.mjs',import.meta.url),'utf8'),app=fs.readFileSync(new URL('./dist/app.mjs',import.meta.url),'utf8');assert.match(qr,/qrcode\(0,'L'\)/);assert.match(qr,/cell=4,size=total\*cell/);assert.match(qr,/fillRect\(\(column\+quiet\)\*cell,\(row\+quiet\)\*cell,cell,cell\)/);assert.match(app,/dark:'#070914',light:'#ffffff'/);});
test('lobby controls reconnect instead of silently ignoring an AI click',()=>{const app=fs.readFileSync(new URL('./dist/app.mjs',import.meta.url),'utf8');assert.match(app,/if\(!lobbySession&&!await ensureLobby\(\)\)throw new Error/);assert.match(app,/lobbyRetryTimer=setTimeout\(\(\)=>ensureLobby\(\),2500\)/);});
test('a remote character reclaiming Player 1 is restored as a human player',()=>{const app=fs.readFileSync(new URL('./dist/app.mjs',import.meta.url),'utf8');assert.match(app,/if\(previousStatus!==['"]joined['"]\|\|player\.control===['"]ai['"]\)assignControl\(index\)/);assert.doesNotMatch(app,/if\(index>0&&\(previousStatus/);});
test('lobby shows player numbers and fixed character names without role subtitles',()=>{const app=fs.readFileSync(new URL('./dist/app.mjs',import.meta.url),'utf8'),html=fs.readFileSync(new URL('./dist/index.html',import.meta.url),'utf8');assert.match(app,/<strong>PLAYER \$\{index\+1\}<\/strong>/);assert.match(app,/characterLabel\(playerAsset\(index\)\)/);assert.match(app,/identityAsset\(players,index\)/);assert.doesNotMatch(app,/COIN COLLECTOR|AI PURSUER|<small>\$\{role\}<\/small>/);assert.doesNotMatch(html,/booth-link|Open photo booth|Choose any available player slot/);assert.match(html,/SCAN TO<br>JOIN LOBBY/);});
test('join empty state opens the shared character lobby instead of the photo booth',()=>{const html=fs.readFileSync(new URL('./dist/join/index.html',import.meta.url),'utf8'),join=fs.readFileSync(new URL('./dist/join/join.mjs',import.meta.url),'utf8');assert.doesNotMatch(html,/href="\.\.\/booth\/"|Create a character/);assert.match(html,/id="browseCharacters"/);assert.match(html,/Open character lobby/);assert.match(html,/handoff\.css\?v=gallery-3/);assert.match(html,/join\.mjs\?v=walk-1/);assert.match(join,/\$\('browseCharacters'\)\.onclick=openCharacterLibrary/);assert.match(join,/await loadCharacters\(\);\$\('characterLibrary'\)\.showModal\(\)/);});
test('character pages count progress in pixels, offer plain Download buttons and link back from the lobby',()=>{const read=path=>fs.readFileSync(new URL(`./dist/${path}`,import.meta.url),'utf8'),html=read('character/index.html'),page=read('character/character.mjs'),view=read('character-view.mjs'),join=read('join/join.mjs'),joinHtml=read('join/index.html');assert.doesNotMatch(html,/progress-steps|data-stage|download-note/);assert.match(html,/id="progressValue"[^>]*role="progressbar"/);assert.match(view,/setAttribute\('aria-label','Download'\)/);assert.match(view,/stage\.append\(button\)/);assert.doesNotMatch(view,/with event frame/);assert.match(page,/localStorage\.setItem\(characterPageKey/);assert.match(joinHtml,/id="myVideos"/);assert.doesNotMatch(joinHtml,/<dialog id="lobbyScanner"/);assert.match(join,/mountLobbyScanner\(\$\('lobbyScanner'\)/);});
test('join page changes slots through quadrants without a redundant change button',()=>{const html=fs.readFileSync(new URL('./dist/join/index.html',import.meta.url),'utf8'),join=fs.readFileSync(new URL('./dist/join/join.mjs',import.meta.url),'utf8'),css=fs.readFileSync(new URL('./dist/handoff.css',import.meta.url),'utf8');assert.doesNotMatch(html,/changeSlot|Change slot/);assert.doesNotMatch(join,/changeSlot/);assert.match(css,/\.slot-picker-actions\{display:grid;grid-template-columns:1fr;/);});
test('game shell uses a fullscreen matchmaking dialog without the removed page chrome',()=>{const html=fs.readFileSync(new URL('./dist/index.html',import.meta.url),'utf8');assert.match(html,/id="lobbyDialog"/);assert.match(html,/Ecopiana Year End Party matchmaking/);assert.match(html,/class="lobby-grid"/);assert.match(html,/class="player-rail/);assert.doesNotMatch(html,/class="topbar"/);assert.doesNotMatch(html,/class="heading"/);assert.doesNotMatch(html,/class="bottom-row"/);});
test('game HUD shows gold scores and final results use a vertically centered framed panel',()=>{const html=fs.readFileSync(new URL('./dist/index.html',import.meta.url),'utf8'),app=fs.readFileSync(new URL('./dist/app.mjs',import.meta.url),'utf8'),css=fs.readFileSync(new URL('./dist/style.css',import.meta.url),'utf8');assert.equal((html.match(/class="hud-score"/g)||[]).length,4);assert.match(html,/id="podiumScreen"/);assert.match(app,/GAME_ROUNDS/);assert.match(app,/podium-stage/);assert.match(app,/podium-top-three/);assert.match(app,/podium-fourth/);assert.match(css,/\.podium-results\{[^}]*place-items:center/);assert.match(css,/\.podium-top-three\{[^}]*width:min\(820px/);assert.match(css,/width:min\(1580px/);assert.match(css,/celestial-podium-outer-frame-v1\.png/);assert.doesNotMatch(css,/celestial-podium-card-frame-v1\.png/);assert.match(css,/\.podium-stage\{[^}]*flex-direction:column/);assert.match(css,/\.podium-fourth\{[^}]*flex-direction:row/);assert.doesNotMatch(css,/\.podium-fourth\{[^}]*position:absolute/);assert.match(css,/\.podium-fourth\{[^}]*grayscale\(1\)/);assert.ok(fs.existsSync(new URL('./dist/assets/celestial-podium-outer-frame-v1.png',import.meta.url)));assert.doesNotMatch(app,/Most gold after every player took one turn as collector/);});
test('podium celebration stays inside its frame with masthead and moving confetti',()=>{const app=fs.readFileSync(new URL('./dist/app.mjs',import.meta.url),'utf8'),css=fs.readFileSync(new URL('./dist/style.css',import.meta.url),'utf8');assert.match(app,/class="podium-event-logo"/);assert.match(app,/class="podium-confetti"/);assert.match(app,/length:42/);assert.match(css,/\.podium-screen\{[^}]*overflow:hidden/);assert.match(css,/\.podium-panel\{[^}]*padding-block:calc\(var\(--frame-h\)/);assert.match(css,/\.podium-panel:after\{[^}]*inset:calc\(var\(--frame-h\)/);assert.match(css,/animation:podium-confetti-fall/);assert.match(css,/@keyframes podium-confetti-fall/);assert.match(css,/top:calc\(100% \+ 24px\)/);assert.match(css,/@media\(prefers-reduced-motion:reduce\)\{\.podium-confetti i\{animation-duration:9s/);});

const generateRequest=(ip,name='Mina')=>{const form=new FormData();form.append('photo',new Blob(['photo'],{type:'image/jpeg'}),'player.jpg');form.append('name',name);return new Request('https://game.test/api/characters/generate',{method:'POST',headers:{origin:'https://game.test','cf-connecting-ip':ip},body:form});};
const fakeOpenAI=async()=>new Response(JSON.stringify({data:[{b64_json:'iVBORw0KGgo='}]}),{status:200,headers:{'content-type':'application/json'}});
test('a single photo booth device can make a steady stream of characters, with a configurable limit',async()=>{
  resetGenerationRateLimits();assert.equal(generationRateLimit({}),20);assert.equal(generationRateLimit({CHARACTER_RATE_LIMIT:'5'}),5);assert.equal(generationRateLimit({CHARACTER_RATE_LIMIT:'nope'}),20);
  const store=new Map(),env={OPENAI_API_KEY:'test-key'};
  for(let i=0;i<20;i++)assert.equal((await handleCharacterApi(generateRequest('192.0.2.40'),env,{store,fetchImpl:fakeOpenAI})).status,201);
  assert.equal((await handleCharacterApi(generateRequest('192.0.2.40'),env,{store,fetchImpl:fakeOpenAI})).status,429);
  resetGenerationRateLimits();const strict={...env,CHARACTER_RATE_LIMIT:'2'};
  for(let i=0;i<2;i++)assert.equal((await handleCharacterApi(generateRequest('192.0.2.41'),strict,{store,fetchImpl:fakeOpenAI})).status,201);
  assert.equal((await handleCharacterApi(generateRequest('192.0.2.41'),strict,{store,fetchImpl:fakeOpenAI})).status,429);
});
test('a shared rate limiter replaces the in-process one when a host provides it',async()=>{
  resetGenerationRateLimits();const hits=[],rateLimiter={async hit(key,now,limit,windowMs){hits.push({key,limit,windowMs});return false;}};
  const response=await handleCharacterApi(generateRequest('192.0.2.42'),{OPENAI_API_KEY:'test-key',CHARACTER_RATE_LIMIT:'7'},{store:new Map(),fetchImpl:fakeOpenAI,rateLimiter});
  assert.equal(response.status,429);assert.deepEqual(hits,[{key:'192.0.2.42',limit:7,windowMs:600000}]);
});
async function lobbyWithCharacter(){
  resetGenerationRateLimits();const store=new Map(),lobbyStore=new Map(),options={store,lobbyStore,now:()=>1700000000000,fetchImpl:fakeOpenAI};
  const character=(await (await handleAppApi(generateRequest('192.0.2.50'),{OPENAI_API_KEY:'test-key'},options)).json()).character;
  const session=await (await handleAppApi(new Request('https://game.test/api/lobbies',{method:'POST',headers:{origin:'https://game.test','content-type':'application/json'},body:'{}'}),{},options)).json();
  const lobbyToken=new URL(session.joinUrl).searchParams.get('token');
  const post=(slot,action,payload)=>handleAppApi(new Request(`https://game.test/api/lobbies/${session.lobby.id}/slots/${slot}/${action}`,{method:'POST',headers:{origin:'https://game.test','content-type':'application/json'},body:JSON.stringify(payload)}),{},options);
  const claim=(slot,guestToken=crypto.randomUUID())=>post(slot,'claim',{lobbyToken,characterId:character.id,guestToken});
  const read=async()=>(await (await handleAppApi(new Request(`https://game.test/api/lobbies/${session.lobby.id}`),{},options)).json()).lobby;
  return {session,claim,post,read};
}
test('simultaneous lobby updates from different phones are all kept',async()=>{
  const {session,claim,post,read}=await lobbyWithCharacter();
  const responses=await Promise.all([claim(2),claim(3),claim(4),post(1,'ready',{hostToken:session.hostToken,ready:true})]);
  assert.deepEqual(responses.map(response=>response.status),[200,200,200,200]);
  const lobby=await read();assert.deepEqual(lobby.slots.map(slot=>slot.status),['joined','joined','joined','joined']);assert.equal(lobby.slots[0].ready,true);
});
test('two phones racing for the same slot cannot both win it',async()=>{
  const {claim,read}=await lobbyWithCharacter();
  const statuses=(await Promise.all([claim(2),claim(2)])).map(response=>response.status).sort();
  assert.deepEqual(statuses,[200,409]);assert.equal((await read()).slots[1].status,'joined');
});
test('the removed PNG editor and control picker leave no dead code behind',()=>{
  const app=fs.readFileSync(new URL('./dist/app.mjs',import.meta.url),'utf8'),html=fs.readFileSync(new URL('./dist/index.html',import.meta.url),'utf8'),booth=fs.readFileSync(new URL('./dist/booth/booth.mjs',import.meta.url),'utf8');
  assert.equal(fs.existsSync(new URL('./dist/characters.mjs',import.meta.url)),false);assert.doesNotMatch(html,/characterDialog/);assert.doesNotMatch(app,/characterEditor|control-select|lobbyStartTimer|controlLabel/);
  const tags=['app.mjs','join/join.mjs','character-view.mjs','animation-export.mjs'].flatMap(path=>[...fs.readFileSync(new URL(`./dist/${path}`,import.meta.url),'utf8').matchAll(/render\.mjs\?v=([\w-]+)/g)].map(match=>match[1]));assert.equal(tags.length,4);assert.equal(new Set(tags).size,1);
});
test('in-game names use the character name and number only the names that repeat',async()=>{
  const {playerNames}=await import('./dist/render.mjs');const mina={src:'m.png',name:'Mina'},bob={src:'b.png',name:'Bob'};
  assert.deepEqual(playerNames([{booth:mina},{booth:bob},{booth:null},{booth:null}]),['Mina','Bob','Dungeon monster 3','Dungeon monster 4']);
  assert.deepEqual(playerNames([{booth:null},{booth:null},{booth:null},{booth:null}]),['Dungeon adventurer','Dungeon monster 2','Dungeon monster 3','Dungeon monster 4']);
  assert.deepEqual(playerNames([{booth:mina},{booth:{...mina}},{booth:{src:'x',name:'  mina '}},{booth:bob}]),['Mina 1','Mina 2','mina 3','Bob']);
  assert.deepEqual(playerNames([{booth:{src:'x',name:''}},{booth:bob},{booth:null},{booth:null}])[0],'Player 1');
});
test('round results say who caught whom and what everyone earned',async()=>{
  const {roundHeadline,roundRows}=await import('./dist/labels.mjs');const names=['Mina','Bob','Zed','Ada'];
  const caught={collector:0,collected:12,catchers:[1],winner:'pursuers',actors:Array(4).fill({})};
  assert.equal(roundHeadline(caught,names),'Bob caught Mina!');
  assert.equal(roundHeadline({...caught,catchers:[1,3]},names),'Bob & Ada caught Mina!');
  assert.equal(roundHeadline({...caught,catchers:[1,2,3]},names),'Bob, Zed & Ada caught Mina!');
  assert.equal(roundHeadline({...caught,collector:2,catchers:[],winner:'collector',collected:234},names),'Zed escaped with all 234 gold!');
  assert.deepEqual(roundRows(caught,names,[12,45,0,15]),[
    {index:0,name:'Mina',action:'Collector · 12 gold collected',earned:12,total:12,collector:true},
    {index:1,name:'Bob',action:'Caught Mina',earned:15,total:45,collector:false},
    {index:2,name:'Zed',action:'No catch',earned:0,total:0,collector:false},
    {index:3,name:'Ada',action:'No catch',earned:0,total:15,collector:false}]);
});
test('a dash eases from its peak back to normal speed',()=>{
  assert.equal(DASH_BOOST,3.5);assert.equal(DASH_TIME,.7);
  const a={dashTime:0};assert.equal(dashSpeedFactor(a),1);
  a.dashTime=DASH_TIME;assert.equal(dashSpeedFactor(a),DASH_BOOST);
  a.dashTime=DASH_TIME/2;assert.ok(Math.abs(dashSpeedFactor(a)-(1+DASH_BOOST)/2)<1e-9);
  const s=playing(),c=s.actors[0];c.dashRequested=true;step(s,1/60);const early=dashSpeedFactor(c);for(let i=0;i<20;i++)step(s,1/60);assert.ok(dashSpeedFactor(c)<early);
});
test('Start on a gamepad is button 9 only',()=>{
  const pad=pressed=>({axes:[0,0],buttons:Array.from({length:10},(_,i)=>({pressed:i===pressed}))});
  assert.equal(gamepadStart(pad(9)),true);for(const i of [0,1,3,8,-1])assert.equal(gamepadStart(pad(i)),false);
});
test('Start toggles ready for the joined player on that pad, one press at a time',()=>{
  const app=fs.readFileSync(new URL('./dist/app.mjs',import.meta.url),'utf8');
  assert.match(app,/if\(held&&!startHeld\[control\]\)pressedStart\.add\(control\);startHeld\[control\]=held;/);
  assert.match(app,/player\.slotStatus==='joined'&&pressedStart\.has\(player\.control\)\)setReady\(index,!player\.ready\)/);
});
test('Start on the next collector pad continues after a round, never from the podium',()=>{
  const app=fs.readFileSync(new URL('./dist/app.mjs',import.meta.url),'utf8');
  assert.match(app,/function canContinue\(control\)\{if\(state\.round>=GAME_ROUNDS\)return true;const next=players\[nextCollector\(players,state\.collector\)\];return next\.slotStatus!=='joined'\|\|!next\.control\.startsWith\('pad:'\)\|\|next\.control===control;\}/);
  assert.match(app,/!lobby&&state\.phase==='result'&&\$\('podiumScreen'\)\.hidden&&\[\.\.\.pressedStart\]\.some\(canContinue\)\)\$\('continue'\)\?\.click\(\)/);
});
test('the lobby auto-starts 3 s after everyone is ready and cancels if someone un-readies',()=>{
  const app=fs.readFileSync(new URL('./dist/app.mjs',import.meta.url),'utf8');
  assert.match(app,/AUTO_START_DELAY=3000/);
  assert.match(app,/const armed=lobby&&lobbyDialog\.open&&!lobbyResetting&&humanCount\(\)>0&&everyoneReady\(\);if\(!armed\)\{if\(autoStartAt!==null\)\{autoStartAt=null;renderPlayers\(\);\}return;\}/);
  assert.match(app,/if\(now>=autoStartAt\)\{autoStartAt=null;start\(\);\}/);assert.match(app,/updateAutoStart\(now\)/);
});
test('the podium only returns to the lobby, by button or Start on any controller',()=>{
  const app=fs.readFileSync(new URL('./dist/app.mjs',import.meta.url),'utf8'),css=fs.readFileSync(new URL('./dist/style.css',import.meta.url),'utf8');
  assert.doesNotMatch(app,/playAgain|PLAY AGAIN/);
  assert.match(app,/<button id="podiumLobby" class="primary-button">RETURN TO LOBBY <span>▶<\/span><\/button><small class="podium-hint">or press START on any controller<\/small>/);
  assert.match(app,/else if\(!\$\('podiumScreen'\)\.hidden&&pressedStart\.size\)returnLobby\(\);/);
  assert.match(css,/\.podium-actions \.podium-hint\{/);
});
test('returning to the lobby opens it before resetting readiness, so the maze never flashes',()=>{
  const app=fs.readFileSync(new URL('./dist/app.mjs',import.meta.url),'utf8');
  assert.match(app,/async function returnLobby\(\)\{lobby=true;hidePodium\(\);resetScoring\(\);state=newRound\(players,0,1\);lastPhase='';autoStartAt=null;renderPlayers\(\);updateOverlay\(\);openLobby\(\);lobbyResetting=true;try\{await resetLobbyReadiness\(\);\}finally\{lobbyResetting=false;\}renderPlayers\(\);\}/);
});
test('a dash plays a whoosh and draws afterimages and a burst puff',()=>{
  const app=fs.readFileSync(new URL('./dist/app.mjs',import.meta.url),'utf8'),render=fs.readFileSync(new URL('./dist/render.mjs',import.meta.url),'utf8');
  assert.match(app,/if\(kind==='dash'\)return whoosh\(\)/);assert.match(app,/createBufferSource/);assert.doesNotMatch(app,/drawDashTrails/);
  assert.match(render,/function drawAfterimages/);assert.match(render,/function drawPuffs/);
});
test('any face button requests a dash; Select and Start do not',()=>{
  const pad=pressed=>({axes:[0,0],buttons:Array.from({length:10},(_,i)=>({pressed:i===pressed}))});
  for(const i of [0,1,2,3])assert.equal(gamepadDash(pad(i)),true);
  for(const i of [4,8,9,-1])assert.equal(gamepadDash(pad(i)),false);
});
test('keyboard dash keys are wired and edge-triggered',()=>{
  const app=fs.readFileSync(new URL('./dist/app.mjs',import.meta.url),'utf8');
  assert.match(app,/KeyQ:\['wasd','dash'\]/);assert.match(app,/Slash:\['arrows','dash'\]/);assert.doesNotMatch(app,/ShiftRight/);
  assert.match(app,/if\(!event\.repeat\)actor\.dashRequested=true/);
});
test('HUD dash status reads ready, dashing, recharging and used',()=>{
  const collector={collector:true,dashTime:0,dashCooldown:0,dashesLeft:null},pursuer={collector:false,dashTime:0,dashCooldown:0,dashesLeft:1};
  assert.deepEqual(dashStatus(collector),{text:'⚡ DASH',charge:1,dashing:false,spent:false});
  assert.deepEqual(dashStatus({...collector,dashTime:1}),{text:'⚡ DASHING',charge:1,dashing:true,spent:false});
  assert.deepEqual(dashStatus({...collector,dashCooldown:6}),{text:'⚡ 6s',charge:.25,dashing:false,spent:false});
  assert.deepEqual(dashStatus(pursuer),{text:'⚡ DASH ×1',charge:1,dashing:false,spent:false});
  assert.deepEqual(dashStatus({...pursuer,dashesLeft:0}),{text:'DASH USED',charge:0,dashing:false,spent:true});
  assert.deepEqual(dashStatus({...collector,dashTime:1},'result'),{text:'⚡ DASH',charge:1,dashing:false,spent:false});
  assert.deepEqual(dashStatus({...pursuer,dashesLeft:0},'result'),{text:'DASH USED',charge:0,dashing:false,spent:true});
});
test('each player panel has a dash line and the help explains the dash',()=>{
  const html=fs.readFileSync(new URL('./dist/index.html',import.meta.url),'utf8'),css=fs.readFileSync(new URL('./dist/style.css',import.meta.url),'utf8');
  for(let i=0;i<4;i++)assert.match(html,new RegExp(`id="hudDash${i}" class="hud-dash"`));
  assert.match(html,/<kbd>Q<\/kbd>/);assert.match(html,/Dash/);
  assert.match(css,/\.hud-dash\{/);assert.match(css,/\.hud-dash\.is-dashing\{/);
});
