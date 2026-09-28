import {hashToken,randomToken,tokenMatches,validId} from './tokens.mjs';

export const BOOTH_SESSION_TTL_MS=12*60*60*1000;
const WRITE_ATTEMPTS=5;
const json=(body,status=200)=>Response.json(body,{status,headers:{'cache-control':'no-store'}});
const sameOrigin=request=>{const origin=request.headers.get('origin');return (!origin||origin===new URL(request.url).origin)&&request.headers.get('sec-fetch-site')!=='cross-site';};
const active=(session,now)=>session&&Date.parse(session.expiresAt)>now;

function memoryBoothSessionStorage(map){return {
  async read(id){const session=map.get(id);return session?{session:structuredClone(session),version:session.revision??0}:null;},
  async write(id,session,version){const current=map.get(id);if((current?(current.revision??0):null)!==version)return false;map.set(id,structuredClone({...session,revision:(version??0)+1}));return true;}
};}

function r2BoothSessionStorage(bucket){return {
  async read(id){const object=await bucket.get(`booth-sessions/${id}.json`);return object?{session:await object.json(),version:object.etag}:null;},
  async write(id,session,version){const result=await bucket.put(`booth-sessions/${id}.json`,JSON.stringify(session),{httpMetadata:{contentType:'application/json',cacheControl:'no-store'},...(version?{onlyIf:{etagMatches:version}}:{})});return !!result;}
};}

function storageFor(env,options){
  if(options.boothSessionStore)return options.boothSessionStore;
  if(options.boothSessionMap instanceof Map)return memoryBoothSessionStorage(options.boothSessionMap);
  if(env.LOBBIES)return r2BoothSessionStorage(env.LOBBIES);
  if(env.CHARACTERS)return r2BoothSessionStorage(env.CHARACTERS);
  return null;
}

function publicSession(session,includeTicket=false){
  return {id:session.id,createdAt:session.createdAt,expiresAt:session.expiresAt,phoneConnected:!!session.phoneConnectedAt,...(includeTicket?{ticketCipher:session.ticketCipher||null}:{})};
}

async function input(request){try{return await request.json();}catch{return null;}}
function bearer(request){return request.headers.get('authorization')?.replace(/^Bearer\s+/i,'')||'';}
function validCipher(value){return value&&['A256GCM','CHACHA20'].includes(value.algorithm)&&typeof value.iv==='string'&&/^[A-Za-z0-9_-]{16,32}$/.test(value.iv)&&typeof value.data==='string'&&/^[A-Za-z0-9_-]{16,2048}$/.test(value.data);}

async function createSession(request,storage,now){
  const id=crypto.randomUUID(),displayToken=randomToken(),captureToken=randomToken(),relayKey=randomToken(32),origin=new URL(request.url).origin;
  const session={id,createdAt:new Date(now).toISOString(),expiresAt:new Date(now+BOOTH_SESSION_TTL_MS).toISOString(),displayHash:await hashToken(displayToken),captureHash:await hashToken(captureToken),phoneConnectedAt:null,ticketCipher:null};
  if(!await storage.write(id,session,null))return json({error:'The booth display could not be created.'},500);
  return json({session:publicSession(session,true),displayToken,relayKey,captureUrl:`${origin}/booth-camera/?session=${id}#capture=${encodeURIComponent(captureToken)}&relay=${encodeURIComponent(relayKey)}`},201);
}

async function updateSession(storage,id,now,apply){
  for(let attempt=0;attempt<WRITE_ATTEMPTS;attempt++){
    const record=await storage.read(id);if(!active(record?.session,now))return json({error:'This booth pairing has expired. Refresh the display to create a new one.'},410);
    const failure=await apply(record.session);if(failure)return failure;
    if(await storage.write(id,record.session,record.version))return json({session:publicSession(record.session)});
  }
  return json({error:'The booth pairing is busy. Please try again.'},409);
}

export async function handleBoothSessionApi(request,env={},options={}){
  const url=new URL(request.url),storage=storageFor(env,options),now=options.now?.()??Date.now();
  if(!storage)return json({error:'Booth session storage is not configured.'},503);
  if(url.pathname==='/api/booth-sessions'&&request.method==='POST'){
    if(!sameOrigin(request))return json({error:'Cross-site requests are not allowed.'},403);
    return createSession(request,storage,now);
  }
  const match=url.pathname.match(/^\/api\/booth-sessions\/([^/]+)(?:\/(connect|ticket|reset))?$/);
  if(!match||!validId(match[1]))return json({error:'Booth pairing not found.'},404);
  const [,id,action]=match;
  if(!action&&request.method==='GET'){
    const record=await storage.read(id);if(!active(record?.session,now))return json({error:'This booth pairing has expired. Refresh the display to create a new one.'},410);
    if(!await tokenMatches(bearer(request),record.session.displayHash))return json({error:'This display cannot access that booth pairing.'},403);
    return json({session:publicSession(record.session,true)});
  }
  if(!action||request.method!=='POST')return json({error:'Not found.'},404);
  if(!sameOrigin(request))return json({error:'Cross-site requests are not allowed.'},403);
  const body=await input(request);if(!body)return json({error:'The request could not be read.'},400);
  return updateSession(storage,id,now,async session=>{
    const capture=await tokenMatches(body.captureToken,session.captureHash),display=await tokenMatches(bearer(request),session.displayHash);
    if(action==='reset'){
      if(!capture&&!display)return json({error:'This device is not paired with the booth display.'},403);
      session.ticketCipher=null;return;
    }
    if(!capture)return json({error:'This phone is not paired with the booth display.'},403);
    session.phoneConnectedAt=new Date(now).toISOString();
    if(action==='connect')return;
    if(!validCipher(body.ticketCipher))return json({error:'The encrypted character ticket could not be shared with the display.'},400);
    session.ticketCipher={algorithm:body.ticketCipher.algorithm,iv:body.ticketCipher.iv,data:body.ticketCipher.data};
  });
}

export {memoryBoothSessionStorage,publicSession};
