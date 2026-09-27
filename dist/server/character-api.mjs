import {hashToken,randomToken,tokenMatches,validId} from './tokens.mjs';

const MAX_PHOTO_BYTES=8*1024*1024;
const MAX_CHARACTER_BYTES=6*1024*1024;
const ALLOWED_PHOTO_TYPES=new Set(['image/jpeg','image/png','image/webp']);
const RATE_WINDOW_MS=10*60*1000;
// A photo booth is one device behind one IP, so the per-IP default must cover a busy booth.
const DEFAULT_RATE_LIMIT=20;
const buckets=new Map();

const json=(body,status=200,extra={})=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store',...extra}});
export const characterRecord=(id,name,createdAt,hasWave)=>({id,name,createdAt,imageUrl:`/api/characters/${id}/image`,cols:4,rows:4,fps:8,layout:'directional',...(hasWave==='true'?{wave:{imageUrl:`/api/characters/${id}/image?animation=wave`,cols:4,rows:4,fps:6,layout:'directional'}}:{})});

export function buildCharacterPrompt(){
  return `Edit the person in the supplied photo into one production-ready character sprite sheet for a cozy top-down dungeon chase game. Preserve their recognizable face, skin tone, hairstyle, hair color, body proportions, and distinctive visible accessories.

OUTFIT FIDELITY IS ESSENTIAL: reproduce the same visible outfit from the photo, including the exact garment types, colors, patterns, sleeves, trousers or skirt, footwear, headwear, eyewear, jewelry, and accessories. Simplify those real clothes into pixel art, but do not redesign or replace them with a fantasy costume. Do not invent a cape, armor, belt, boots, hat, weapon, bag, or accessory that is not visible in the source photo. If part of the outfit is obscured, continue it conservatively using the visible colors and materials.

Asset type: one 1024 by 1024 PNG sprite sheet containing exactly 16 full-body sprites in exactly 4 equal columns by 4 equal rows. Every cell is exactly 256 by 256 pixels. Cell centers are x=128, 384, 640, 896 and y=128, 384, 640, 896. Keep each complete character wholly inside its own cell; no pixel from one sprite may cross a cell boundary. Center every frame horizontally at x=128 within its cell, use one identical character scale, and keep the ground-contact foot and character pivot on the same y=232 baseline within every cell.

Direction order is strict. Row 1 faces DOWN toward the viewer. Row 2 faces LEFT in profile. Row 3 faces RIGHT in profile. Row 4 faces UP away from the viewer. Each row contains four consecutive walk-cycle poses: left step, passing pose, right step, passing pose. Only the limbs and clothing motion may change. The identity, outfit, scale, body center, and foot anchor must stay fixed across all 16 frames.

Style: cute tiny classic handheld RPG character, crisp 16-bit pixel art, simple readable chunky pixel clusters, hard pixel edges, limited colors, dark warm outline, and minimal shading. Suitable for a 24-to-32-pixel in-game character and an 80-pixel lobby portrait. No antialiasing, blur, soft painted edges, or subpixel detail.

The entire canvas outside the character must be true transparent alpha. No scenery, floor, glow, gradient, grid lines, labels, text, watermark, shadows, border, extra people, weapons, or loose objects.`;
}

export function buildWavePrompt(){
  return `Create a waving animation sheet using the supplied pixel character walk sheet as the exact visual reference. Preserve the same face, outfit, colors, pixel style, scale and proportions. Do not redesign the character.

Output one 1024 by 1024 PNG with true transparent alpha, exactly 4 equal columns by 4 equal rows, each cell 256 by 256 pixels. Row 1 faces DOWN toward the viewer. Row 2 faces LEFT. Row 3 faces RIGHT. Row 4 faces UP. Every row is a friendly hello wave, NOT a walk or run cycle. Keep both feet planted and the torso still in all frames. Columns show: 1 neutral arms resting, 2 one hand raised beside the head with palm outward, 3 raised hand tilted outward, 4 raised hand tilted inward. These poses will play forward and backward, then pause at neutral.

Center the torso (not the arm's bounding box) at x=128 within every cell and keep the feet on the same y=232 baseline. Only the greeting arm and hand move; keep the face, body and other arm fixed. Keep the raised hand wholly inside its cell. Use crisp chunky pixel clusters and hard edges. No background, floor, shadows, text, grid, labels or extra objects.`;
}

export function validatePhoto(photo){
  if(!photo||typeof photo.size!=='number'||typeof photo.type!=='string')throw new Error('Choose a photo first.');
  if(!ALLOWED_PHOTO_TYPES.has(photo.type))throw new Error('Use a JPEG, PNG, or WebP photo.');
  if(photo.size<1)throw new Error('This photo is empty. Choose another image.');
  if(photo.size>MAX_PHOTO_BYTES)throw new Error('This photo is over 8 MB. Choose a smaller image.');
  return photo;
}

export function sanitizeCharacterName(value){const name=String(value||'').replace(/[\u0000-\u001f\u007f]/g,'').replace(/\s+/g,' ').trim().slice(0,28);if(name.length<1)throw new Error('Enter a character name.');return name;}

export function clientKey(request){return request.headers.get('cf-connecting-ip')||request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()||'local';}
export function generationRateLimit(env={}){const limit=Number(env.CHARACTER_RATE_LIMIT);return Number.isInteger(limit)&&limit>0?limit:DEFAULT_RATE_LIMIT;}
// In-process limiter for the local server and tests. Multi-instance hosts pass options.rateLimiter backed by shared storage.
export const memoryRateLimiter={async hit(key,now,limit,windowMs){
  const recent=(buckets.get(key)||[]).filter(time=>now-time<windowMs);
  if(recent.length>=limit){buckets.set(key,recent);return false;}
  recent.push(now);buckets.set(key,recent);
  if(buckets.size>1000)for(const [candidate,times]of buckets)if(!times.some(time=>now-time<windowMs))buckets.delete(candidate);
  return true;
}};
export function resetGenerationRateLimits(){buckets.clear();}

export function sameOrigin(request){const origin=request.headers.get('origin');if(origin&&origin!==new URL(request.url).origin)return false;return request.headers.get('sec-fetch-site')!=='cross-site';}
function friendlyOpenAIError(status,code){if(code==='credit_balance_exhausted'||code==='insufficient_quota')return 'The photo booth has no API credits remaining. Ask the event host to add credits before trying again.';if(status===429)return 'The character forge is busy right now. Wait a moment and try again.';if(status===400)return 'OpenAI could not use that photo. Try a clear, well-lit photo with one person.';if(status===401||status===403)return 'The character forge is not configured correctly yet.';return 'The character could not be generated. Please try again.';}
function decodeBase64(value){const binary=atob(value),bytes=new Uint8Array(binary.length);for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);return bytes;}
function memoryStorage(map){return {
  async list(){return [...map.entries()].map(([id,item])=>characterRecord(id,item.name,item.createdAt,item.hasWave)).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));},
  async get(id,animation){const item=map.get(id);return animation==='wave'?(item?.waveBytes?{...item,bytes:item.waveBytes}:null):item||null;},
  async put(id,bytes,metadata,waveBytes){map.set(id,{bytes,waveBytes,...metadata,contentType:'image/png'});}
};}
function r2Storage(bucket){return {
  async list(){const listed=await bucket.list({prefix:'characters/',limit:100,include:['customMetadata']});return listed.objects.map(item=>{const id=item.key.slice('characters/'.length,-'.png'.length),meta=item.customMetadata||{};return characterRecord(id,meta.name||'Booth character',meta.createdAt||item.uploaded.toISOString(),meta.hasWave);}).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));},
  async get(id,animation){const object=await bucket.get(`${animation==='wave'?'character-waves':'characters'}/${id}.png`);if(!object)return null;return {bytes:object.body,contentType:object.httpMetadata?.contentType||'image/png',etag:object.httpEtag,...object.customMetadata};},
  async put(id,bytes,metadata,waveBytes){const settings={httpMetadata:{contentType:'image/png',cacheControl:'public, max-age=31536000, immutable'},customMetadata:metadata};if(waveBytes)await bucket.put(`character-waves/${id}.png`,waveBytes,settings);await bucket.put(`characters/${id}.png`,bytes,settings);}
};}
export function createCharacterStorage(env={},options={}){if(options.characterStorage)return options.characterStorage;if(options.store instanceof Map)return memoryStorage(options.store);if(env.CHARACTERS)return r2Storage(env.CHARACTERS);return null;}

async function generateCharacter(request,env,options,storage){
  if(!sameOrigin(request))return json({error:'Cross-site requests are not allowed.'},403);
  const contentLength=Number(request.headers.get('content-length')||0);if(contentLength>MAX_PHOTO_BYTES+1024*1024)return json({error:'This upload is too large.'},413);
  if(!env.OPENAI_API_KEY)return json({error:'The character forge is not configured yet.'},503);
  if(!await (options.rateLimiter||memoryRateLimiter).hit(clientKey(request),options.now?.()??Date.now(),generationRateLimit(env),RATE_WINDOW_MS))return json({error:'This booth has made several characters recently. Try again in a few minutes.'},429);
  let input;try{input=await request.formData();}catch{return json({error:'The photo upload could not be read.'},400);}
  let name,photo;try{name=sanitizeCharacterName(input.get('name'));photo=validatePhoto(input.get('photo'));}catch(error){return json({error:error.message},400);}

  const bytes=await generateSheet(photo,buildCharacterPrompt(),env,options);if(bytes instanceof Response)return bytes;
  const waveBytes=await generateSheet(new Blob([bytes],{type:'image/png'}),buildWavePrompt(),env,options);if(waveBytes instanceof Response)return waveBytes;
  const id=crypto.randomUUID(),createdAt=new Date(options.now?.()??Date.now()).toISOString(),claimToken=randomToken(),claimHash=await hashToken(claimToken);
  await storage.put(id,bytes,{name,createdAt,claimHash,hasWave:'true'},waveBytes);
  const character=characterRecord(id,name,createdAt,'true'),origin=new URL(request.url).origin;return json({character,claimToken,passUrl:`${origin}/pass/?character=${id}#claim=${encodeURIComponent(claimToken)}`},201);
}

export async function generateSheet(photo,prompt,env,options){
  const payload=new FormData();payload.append('model',env.OPENAI_IMAGE_MODEL||'gpt-image-2.5-sunburst');payload.append('image',photo,photo.name||'character.png');payload.append('prompt',prompt);payload.append('size','1024x1024');payload.append('quality','medium');payload.append('background','transparent');payload.append('output_format','png');
  const fetchImpl=options.fetchImpl||fetch;let generated;
  try{generated=await fetchImpl('https://api.openai.com/v1/images/edits',{method:'POST',headers:{authorization:`Bearer ${env.OPENAI_API_KEY}`},body:payload,...(options.signal?{signal:options.signal}:{})});}catch{return json({error:options.signal?.aborted?'Generation took too long. Please ask the booth crew to try again.':'The character service could not be reached. Please try again.'},502);}
  if(!generated.ok){let failure;try{failure=await generated.json();}catch{}const code=failure?.error?.code||failure?.error?.type;return json({error:friendlyOpenAIError(generated.status,code)},code==='credit_balance_exhausted'||code==='insufficient_quota'?503:generated.status===429?429:502);}
  let result;try{result=await generated.json();}catch{return json({error:'The character service returned an unreadable image.'},502);}
  const encoded=result?.data?.[0]?.b64_json;if(typeof encoded!=='string'||!encoded.length)return json({error:'No character image was returned. Please try again.'},502);
  let bytes;try{bytes=decodeBase64(encoded);}catch{return json({error:'The generated image could not be decoded.'},502);}if(bytes.byteLength>MAX_CHARACTER_BYTES)return json({error:'The generated character was too large to save. Please try again.'},502);
  return bytes;
}

export async function handleCharacterApi(request,env={},options={}){
  const url=new URL(request.url),storage=createCharacterStorage(env,options);if(!storage)return json({error:'Shared character storage is not configured.'},503);
  if(url.pathname==='/api/characters'&&request.method==='GET'){const characters=(await storage.list()).slice(0,60);return json({count:characters.length,characters});}
  if(url.pathname==='/api/characters/generate'&&request.method==='POST')return generateCharacter(request,env,options,storage);
  const pass=url.pathname.match(/^\/api\/characters\/([^/]+)\/pass$/);if(pass&&request.method==='POST'){
    if(!sameOrigin(request))return json({error:'Cross-site requests are not allowed.'},403);const id=pass[1];if(!validId(id))return json({error:'Character not found.'},404);let input;try{input=await request.json();}catch{return json({error:'The character pass could not be read.'},400);}const item=await storage.get(id);if(!item||!await tokenMatches(input.claimToken,item.claimHash))return json({error:'This character pass is invalid.'},403);return json({character:characterRecord(id,item.name||'Player character',item.createdAt||new Date().toISOString(),item.hasWave)});
  }
  const image=url.pathname.match(/^\/api\/characters\/([^/]+)\/image$/);if(image&&request.method==='GET'){
    const id=image[1];if(!validId(id))return new Response('Not found',{status:404});const item=await storage.get(id,url.searchParams.get('animation'));if(!item)return new Response('Not found',{status:404});return new Response(item.bytes,{headers:{'content-type':item.contentType||'image/png','cache-control':'public, max-age=31536000, immutable',...(item.etag?{etag:item.etag}:{})}});
  }
  return json({error:'Not found.'},404);
}
