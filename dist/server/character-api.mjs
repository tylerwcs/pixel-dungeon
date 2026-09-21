import {hashToken,randomToken,tokenMatches,validId} from './tokens.mjs';

const MAX_PHOTO_BYTES=8*1024*1024;
const MAX_CHARACTER_BYTES=6*1024*1024;
const ALLOWED_PHOTO_TYPES=new Set(['image/jpeg','image/png','image/webp']);
const RATE_WINDOW_MS=10*60*1000;
const RATE_LIMIT=3;
const buckets=new Map();

const json=(body,status=200,extra={})=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store',...extra}});
const characterRecord=(id,name,createdAt)=>({id,name,createdAt,imageUrl:`/api/characters/${id}/image`,cols:4,rows:4,fps:8,layout:'directional'});

export function buildCharacterPrompt(){
  return `Edit the person in the supplied photo into one production-ready character sprite sheet for a cozy top-down dungeon chase game. Preserve their recognizable face, skin tone, hairstyle, hair color, and distinctive visible accessories while simplifying them into crisp 16-bit pixel art. Dress them as a friendly fantasy dungeon adventurer with practical boots and a short cape. Do not add a weapon.

Layout is strict: exactly 4 equal columns by 4 equal rows, with 16 full-body sprites at identical scale and baseline. Row 1 faces DOWN toward the viewer. Row 2 faces LEFT in profile. Row 3 faces RIGHT in profile. Row 4 faces UP away from the viewer. Each row contains four consecutive walk-cycle poses: left step, passing pose, right step, passing pose.

Use chunky pixel clusters, hard pixel edges, a limited warm dungeon palette, a dark outline, and minimal shading. Keep generous transparent margins around every sprite. The entire canvas outside the character must be true transparent alpha. No scenery, floor, grid lines, labels, text, watermark, shadows, border, extra people, weapons, or loose objects.`;
}

export function validatePhoto(photo){
  if(!photo||typeof photo.size!=='number'||typeof photo.type!=='string')throw new Error('Choose a photo first.');
  if(!ALLOWED_PHOTO_TYPES.has(photo.type))throw new Error('Use a JPEG, PNG, or WebP photo.');
  if(photo.size<1)throw new Error('This photo is empty. Choose another image.');
  if(photo.size>MAX_PHOTO_BYTES)throw new Error('This photo is over 8 MB. Choose a smaller image.');
  return photo;
}

export function sanitizeCharacterName(value){const name=String(value||'').replace(/[\u0000-\u001f\u007f]/g,'').replace(/\s+/g,' ').trim().slice(0,28);if(name.length<1)throw new Error('Enter a character name.');return name;}

function clientKey(request){return request.headers.get('cf-connecting-ip')||request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()||'local';}
function withinRateLimit(request,now){
  const key=clientKey(request),recent=(buckets.get(key)||[]).filter(time=>now-time<RATE_WINDOW_MS);
  if(recent.length>=RATE_LIMIT){buckets.set(key,recent);return false;}
  recent.push(now);buckets.set(key,recent);
  if(buckets.size>1000)for(const [candidate,times]of buckets)if(!times.some(time=>now-time<RATE_WINDOW_MS))buckets.delete(candidate);
  return true;
}
export function resetGenerationRateLimits(){buckets.clear();}

function sameOrigin(request){const origin=request.headers.get('origin');if(origin&&origin!==new URL(request.url).origin)return false;return request.headers.get('sec-fetch-site')!=='cross-site';}
function friendlyOpenAIError(status,code){if(code==='credit_balance_exhausted'||code==='insufficient_quota')return 'The photo booth has no API credits remaining. Ask the event host to add credits before trying again.';if(status===429)return 'The character forge is busy right now. Wait a moment and try again.';if(status===400)return 'OpenAI could not use that photo. Try a clear, well-lit photo with one person.';if(status===401||status===403)return 'The character forge is not configured correctly yet.';return 'The character could not be generated. Please try again.';}
function decodeBase64(value){const binary=atob(value),bytes=new Uint8Array(binary.length);for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);return bytes;}
function memoryStorage(map){return {
  async list(){return [...map.entries()].map(([id,item])=>characterRecord(id,item.name,item.createdAt)).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));},
  async get(id){return map.get(id)||null;},
  async put(id,bytes,metadata){map.set(id,{bytes,...metadata,contentType:'image/png'});}
};}
function r2Storage(bucket){return {
  async list(){const listed=await bucket.list({prefix:'characters/',limit:100,include:['customMetadata']});return listed.objects.map(item=>{const id=item.key.slice('characters/'.length,-'.png'.length),meta=item.customMetadata||{};return characterRecord(id,meta.name||'Booth character',meta.createdAt||item.uploaded.toISOString());}).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));},
  async get(id){const object=await bucket.get(`characters/${id}.png`);if(!object)return null;return {bytes:object.body,contentType:object.httpMetadata?.contentType||'image/png',etag:object.httpEtag,...object.customMetadata};},
  async put(id,bytes,metadata){await bucket.put(`characters/${id}.png`,bytes,{httpMetadata:{contentType:'image/png',cacheControl:'public, max-age=31536000, immutable'},customMetadata:metadata});}
};}
export function createCharacterStorage(env={},options={}){if(options.characterStorage)return options.characterStorage;if(options.store instanceof Map)return memoryStorage(options.store);if(env.CHARACTERS)return r2Storage(env.CHARACTERS);return null;}

async function generateCharacter(request,env,options,storage){
  if(!sameOrigin(request))return json({error:'Cross-site requests are not allowed.'},403);
  const contentLength=Number(request.headers.get('content-length')||0);if(contentLength>MAX_PHOTO_BYTES+1024*1024)return json({error:'This upload is too large.'},413);
  if(!env.OPENAI_API_KEY)return json({error:'The character forge is not configured yet.'},503);
  if(!withinRateLimit(request,options.now?.()??Date.now()))return json({error:'This booth has made several characters recently. Try again in a few minutes.'},429);
  let input;try{input=await request.formData();}catch{return json({error:'The photo upload could not be read.'},400);}
  let name,photo;try{name=sanitizeCharacterName(input.get('name'));photo=validatePhoto(input.get('photo'));}catch(error){return json({error:error.message},400);}

  const payload=new FormData();payload.append('model',env.OPENAI_IMAGE_MODEL||'gpt-image-2.5-sunburst');payload.append('image',photo,photo.name||'booth-photo.jpg');payload.append('prompt',buildCharacterPrompt());payload.append('size','1024x1024');payload.append('quality','medium');payload.append('background','transparent');payload.append('output_format','png');
  const fetchImpl=options.fetchImpl||fetch;let generated;
  try{generated=await fetchImpl('https://api.openai.com/v1/images/edits',{method:'POST',headers:{authorization:`Bearer ${env.OPENAI_API_KEY}`},body:payload});}catch{return json({error:'The character service could not be reached. Please try again.'},502);}
  if(!generated.ok){let failure;try{failure=await generated.json();}catch{}const code=failure?.error?.code||failure?.error?.type;return json({error:friendlyOpenAIError(generated.status,code)},code==='credit_balance_exhausted'||code==='insufficient_quota'?503:generated.status===429?429:502);}
  let result;try{result=await generated.json();}catch{return json({error:'The character service returned an unreadable image.'},502);}
  const encoded=result?.data?.[0]?.b64_json;if(typeof encoded!=='string'||!encoded.length)return json({error:'No character image was returned. Please try again.'},502);
  let bytes;try{bytes=decodeBase64(encoded);}catch{return json({error:'The generated image could not be decoded.'},502);}if(bytes.byteLength>MAX_CHARACTER_BYTES)return json({error:'The generated character was too large to save. Please try again.'},502);
  const id=crypto.randomUUID(),createdAt=new Date(options.now?.()??Date.now()).toISOString(),claimToken=randomToken(),claimHash=await hashToken(claimToken);await storage.put(id,bytes,{name,createdAt,claimHash});const character=characterRecord(id,name,createdAt),origin=new URL(request.url).origin;return json({character,claimToken,passUrl:`${origin}/pass/?character=${id}#claim=${encodeURIComponent(claimToken)}`},201);
}

export async function handleCharacterApi(request,env={},options={}){
  const url=new URL(request.url),storage=createCharacterStorage(env,options);if(!storage)return json({error:'Shared character storage is not configured.'},503);
  if(url.pathname==='/api/characters'&&request.method==='GET'){const characters=await storage.list();return json({count:Math.min(characters.length,60)});}
  if(url.pathname==='/api/characters/generate'&&request.method==='POST')return generateCharacter(request,env,options,storage);
  const pass=url.pathname.match(/^\/api\/characters\/([^/]+)\/pass$/);if(pass&&request.method==='POST'){
    if(!sameOrigin(request))return json({error:'Cross-site requests are not allowed.'},403);const id=pass[1];if(!validId(id))return json({error:'Character not found.'},404);let input;try{input=await request.json();}catch{return json({error:'The character pass could not be read.'},400);}const item=await storage.get(id);if(!item||!await tokenMatches(input.claimToken,item.claimHash))return json({error:'This character pass is invalid.'},403);return json({character:characterRecord(id,item.name||'Player character',item.createdAt||new Date().toISOString())});
  }
  const image=url.pathname.match(/^\/api\/characters\/([^/]+)\/image$/);if(image&&request.method==='GET'){
    const id=image[1];if(!validId(id))return new Response('Not found',{status:404});const item=await storage.get(id);if(!item)return new Response('Not found',{status:404});return new Response(item.bytes,{headers:{'content-type':item.contentType||'image/png','cache-control':'public, max-age=31536000, immutable',...(item.etag?{etag:item.etag}:{})}});
  }
  return json({error:'Not found.'},404);
}
