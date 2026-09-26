import {hashToken,randomToken,tokenMatches,validId} from './tokens.mjs';

const LOBBY_TTL_MS=4*60*60*1000;
const WRITE_ATTEMPTS=5;
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
const sameOrigin=request=>{const origin=request.headers.get('origin');return (!origin||origin===new URL(request.url).origin)&&request.headers.get('sec-fetch-site')!=='cross-site';};

// Lobby stores expose compare-and-set writes: read() returns {lobby,version} and write(id,lobby,version)
// only succeeds when the stored version still matches. A null version creates a new lobby.
function memoryLobbyStorage(map){return {
  async read(id){const lobby=map.get(id);return lobby?{lobby:structuredClone(lobby),version:lobby.revision??0}:null;},
  async write(id,lobby,version){const current=map.get(id);if((current?(current.revision??0):null)!==version)return false;map.set(id,structuredClone({...lobby,revision:(version??0)+1}));return true;}
};}
function r2LobbyStorage(bucket){return {
  async read(id){const object=await bucket.get(`lobbies/${id}.json`);return object?{lobby:await object.json(),version:object.etag}:null;},
  async write(id,lobby,version){const result=await bucket.put(`lobbies/${id}.json`,JSON.stringify(lobby),{httpMetadata:{contentType:'application/json',cacheControl:'no-store'},...(version?{onlyIf:{etagMatches:version}}:{})});return !!result;}
};}
function storageFor(env,options){if(options.sessionStore)return options.sessionStore;if(options.lobbyStore instanceof Map)return memoryLobbyStorage(options.lobbyStore);if(env.LOBBIES)return r2LobbyStorage(env.LOBBIES);if(env.CHARACTERS)return r2LobbyStorage(env.CHARACTERS);return null;}
function publicSlot(slot){return {slot:slot.slot,status:slot.status,ready:!!slot.ready,character:slot.character||null};}
function publicLobby(lobby){return {id:lobby.id,createdAt:lobby.createdAt,expiresAt:lobby.expiresAt,slots:lobby.slots.map(publicSlot)};}
async function body(request){try{return await request.json();}catch{return null;}}
function active(lobby,now){return lobby&&Date.parse(lobby.expiresAt)>now;}

async function createLobby(request,storage,now){
  const id=crypto.randomUUID(),hostToken=randomToken(),joinToken=randomToken(),origin=new URL(request.url).origin;
  const slots=Array.from({length:4},(_,index)=>({slot:index+1,status:index===0?'joined':'open',ready:false,character:null}));
  const lobby={id,createdAt:new Date(now).toISOString(),expiresAt:new Date(now+LOBBY_TTL_MS).toISOString(),hostHash:await hashToken(hostToken),joinHash:await hashToken(joinToken),slots};
  if(!await storage.write(id,lobby,null))return json({error:'The lobby could not be created.'},500);
  return json({lobby:publicLobby(lobby),hostToken,joinUrl:`${origin}/join/?lobby=${id}&token=${encodeURIComponent(joinToken)}`},201);
}

// Applies one slot action against the latest stored lobby, re-reading and retrying when another write lands first.
async function updateSlot(storage,id,slotIndex,now,apply){
  for(let attempt=0;attempt<WRITE_ATTEMPTS;attempt++){
    const record=await storage.read(id);if(!active(record?.lobby,now))return json({error:'This lobby has expired.'},410);
    const lobby=record.lobby,slot=lobby.slots[slotIndex],failure=await apply(lobby,slot);if(failure)return failure;
    if(await storage.write(id,lobby,record.version))return json({lobby:publicLobby(lobby),slot:publicSlot(slot)});
  }
  return json({error:'The lobby is busy. Please try again.'},409);
}

export async function handleLobbyApi(request,env={},options={}){
  const url=new URL(request.url),storage=storageFor(env,options),now=options.now?.()??Date.now();if(!storage)return json({error:'Lobby session storage is not configured.'},503);
  if(url.pathname==='/api/lobbies'&&request.method==='POST'){if(!sameOrigin(request))return json({error:'Cross-site requests are not allowed.'},403);return createLobby(request,storage,now);}
  const lobbyMatch=url.pathname.match(/^\/api\/lobbies\/([^/]+)$/);if(lobbyMatch&&request.method==='GET'){
    if(!validId(lobbyMatch[1]))return json({error:'Lobby not found.'},404);const record=await storage.read(lobbyMatch[1]);if(!active(record?.lobby,now))return json({error:'This lobby has expired.'},410);return json({lobby:publicLobby(record.lobby)});
  }
  const slotMatch=url.pathname.match(/^\/api\/lobbies\/([^/]+)\/slots\/([1-4])\/(claim|ready|ai)$/);if(!slotMatch||request.method!=='POST')return json({error:'Not found.'},404);
  if(!sameOrigin(request))return json({error:'Cross-site requests are not allowed.'},403);
  const [,id,slotValue,action]=slotMatch;if(!validId(id))return json({error:'Lobby not found.'},404);const input=await body(request);if(!input)return json({error:'The request could not be read.'},400);
  if(action==='claim'){
    if(typeof input.guestToken!=='string'||input.guestToken.length<20)return json({error:'This device could not control a player slot.'},403);
    const character=await options.characterStorage?.get(input.characterId),guestHash=await hashToken(input.guestToken);
    return updateSlot(storage,id,Number(slotValue)-1,now,async(lobby,slot)=>{
      if(!await tokenMatches(input.lobbyToken,lobby.joinHash))return json({error:'This lobby invitation is invalid or expired.'},403);
      if(!character)return json({error:'That character is no longer available.'},404);
      const previous=lobby.slots.find(candidate=>candidate.guestHash===guestHash);
      if(slot.status==='ai'||(slot.status==='joined'&&slot!==previous))return json({error:'That player slot is already occupied.'},409);
      if(previous&&previous!==slot){previous.status='open';previous.ready=false;previous.character=null;delete previous.guestHash;}
      slot.status='joined';slot.ready=false;slot.guestHash=guestHash;slot.character={id:input.characterId,name:character.name||'Player character',imageUrl:`/api/characters/${input.characterId}/image`,cols:4,rows:4,fps:8,layout:'directional'};
    });
  }
  if(action==='ready')return updateSlot(storage,id,Number(slotValue)-1,now,async(lobby,slot)=>{
    const host=await tokenMatches(input.hostToken,lobby.hostHash),guest=await tokenMatches(input.lobbyToken,lobby.joinHash);
    if(!host&&!guest)return json({error:'This lobby invitation is invalid or expired.'},403);
    if(slot.status!=='joined')return json({error:'Join this player slot before getting ready.'},409);
    if(!host&&(!slot.guestHash||!await tokenMatches(input.guestToken,slot.guestHash)))return json({error:'This device does not control that slot.'},403);
    slot.ready=!!input.ready;
  });
  return updateSlot(storage,id,Number(slotValue)-1,now,async(lobby,slot)=>{
    if(!await tokenMatches(input.hostToken,lobby.hostHash))return json({error:'Only this game screen can change AI players.'},403);slot.status=input.ai===false?'open':'ai';slot.ready=input.ai===false?false:true;slot.character=null;delete slot.guestHash;
  });
}

export {publicLobby};
