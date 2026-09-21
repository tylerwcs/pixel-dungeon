import {hashToken,randomToken,tokenMatches,validId} from './tokens.mjs';

const LOBBY_TTL_MS=4*60*60*1000;
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
const sameOrigin=request=>{const origin=request.headers.get('origin');return (!origin||origin===new URL(request.url).origin)&&request.headers.get('sec-fetch-site')!=='cross-site';};

function memoryLobbyStorage(map){return {async get(id){return map.get(id)||null;},async put(id,lobby){map.set(id,structuredClone(lobby));}};}
function r2LobbyStorage(bucket){return {async get(id){const object=await bucket.get(`lobbies/${id}.json`);return object?object.json():null;},async put(id,lobby){await bucket.put(`lobbies/${id}.json`,JSON.stringify(lobby),{httpMetadata:{contentType:'application/json',cacheControl:'no-store'}});}};}
function storageFor(env,options){if(options.sessionStore)return options.sessionStore;if(options.lobbyStore instanceof Map)return memoryLobbyStorage(options.lobbyStore);if(env.LOBBIES)return r2LobbyStorage(env.LOBBIES);if(env.CHARACTERS)return r2LobbyStorage(env.CHARACTERS);return null;}
function publicSlot(slot){return {slot:slot.slot,status:slot.status,ready:!!slot.ready,character:slot.character||null};}
function publicLobby(lobby){return {id:lobby.id,createdAt:lobby.createdAt,expiresAt:lobby.expiresAt,slots:lobby.slots.map(publicSlot)};}
async function body(request){try{return await request.json();}catch{return null;}}
function active(lobby,now){return lobby&&Date.parse(lobby.expiresAt)>now;}

async function createLobby(request,storage,now){
  const id=crypto.randomUUID(),hostToken=randomToken(),origin=new URL(request.url).origin,slots=[];
  for(let index=0;index<4;index++){const joinToken=randomToken();slots.push({slot:index+1,status:index===0?'joined':'open',ready:false,joinHash:await hashToken(joinToken),character:null,joinToken});}
  const lobby={id,createdAt:new Date(now).toISOString(),expiresAt:new Date(now+LOBBY_TTL_MS).toISOString(),hostHash:await hashToken(hostToken),slots:slots.map(({joinToken,...slot})=>slot)};
  await storage.put(id,lobby);
  return json({lobby:publicLobby(lobby),hostToken,slots:slots.map(slot=>({slot:slot.slot,joinToken:slot.joinToken,joinUrl:`${origin}/join/?lobby=${id}&slot=${slot.slot}&token=${encodeURIComponent(slot.joinToken)}`}))},201);
}

export async function handleLobbyApi(request,env={},options={}){
  const url=new URL(request.url),storage=storageFor(env,options),now=options.now?.()??Date.now();if(!storage)return json({error:'Lobby session storage is not configured.'},503);
  if(url.pathname==='/api/lobbies'&&request.method==='POST'){if(!sameOrigin(request))return json({error:'Cross-site requests are not allowed.'},403);return createLobby(request,storage,now);}
  const lobbyMatch=url.pathname.match(/^\/api\/lobbies\/([^/]+)$/);if(lobbyMatch&&request.method==='GET'){
    if(!validId(lobbyMatch[1]))return json({error:'Lobby not found.'},404);const lobby=await storage.get(lobbyMatch[1]);if(!active(lobby,now))return json({error:'This lobby has expired.'},410);return json({lobby:publicLobby(lobby)});
  }
  const slotMatch=url.pathname.match(/^\/api\/lobbies\/([^/]+)\/slots\/([1-4])\/(claim|ready|ai)$/);if(!slotMatch||request.method!=='POST')return json({error:'Not found.'},404);
  if(!sameOrigin(request))return json({error:'Cross-site requests are not allowed.'},403);
  const [,id,slotValue,action]=slotMatch;if(!validId(id))return json({error:'Lobby not found.'},404);const lobby=await storage.get(id);if(!active(lobby,now))return json({error:'This lobby has expired.'},410);const slot=lobby.slots[Number(slotValue)-1],input=await body(request);if(!input)return json({error:'The request could not be read.'},400);
  if(action==='claim'){
    if(!await tokenMatches(input.slotToken,slot.joinHash))return json({error:'This player invitation is invalid or expired.'},403);
    const character=await options.characterStorage?.get(input.characterId);if(!character||!await tokenMatches(input.claimToken,character.claimHash))return json({error:'This character pass is invalid.'},403);
    slot.status='joined';slot.ready=false;slot.character={id:input.characterId,name:character.name||'Player character',imageUrl:`/api/characters/${input.characterId}/image`,cols:4,rows:4,fps:8,layout:'directional'};
  }
  if(action==='ready'){
    if(!await tokenMatches(input.slotToken,slot.joinHash))return json({error:'This player invitation is invalid or expired.'},403);if(slot.status!=='joined')return json({error:'Join this player slot before getting ready.'},409);slot.ready=!!input.ready;
  }
  if(action==='ai'){
    if(!await tokenMatches(input.hostToken,lobby.hostHash))return json({error:'Only this game screen can change AI players.'},403);slot.status=input.ai===false?'open':'ai';slot.ready=input.ai===false?false:true;slot.character=null;
  }
  await storage.put(id,lobby);return json({lobby:publicLobby(lobby),slot:publicSlot(slot)});
}

export {publicLobby};
