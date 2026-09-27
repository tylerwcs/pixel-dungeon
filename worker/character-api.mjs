import {hashToken,randomToken,tokenMatches,validId} from './tokens.mjs';
import {characterStyleReference} from './character-style-reference.mjs';

const MAX_PHOTO_BYTES=8*1024*1024;
const MAX_CHARACTER_BYTES=6*1024*1024;
const ALLOWED_PHOTO_TYPES=new Set(['image/jpeg','image/png','image/webp']);
const RATE_WINDOW_MS=10*60*1000;
// A photo booth is one device behind one IP, so the per-IP default must cover a busy booth.
const DEFAULT_RATE_LIMIT=20;
const buckets=new Map();

const json=(body,status=200,extra={})=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store',...extra}});
export const characterRecord=(id,name,createdAt,hasWave)=>({id,name,createdAt,imageUrl:`/api/characters/${id}/image`,cols:4,rows:4,fps:8,layout:'directional',...(hasWave==='true'?{wave:{imageUrl:`/api/characters/${id}/image?animation=wave`,cols:4,rows:4,fps:6,layout:'directional'}}:{})});

// Design once before asking the model for motion: combining these tasks changes the silhouette.
export function buildCharacterPortraitPrompt(){return `Create ONE isolated single-character pixel illustration. IMAGE 1 is the attendee photo: use this person's recognizable face, skin tone, hairstyle, clothes and worn accessories. IMAGE 2 is the approved STYLE A drawing: match its proportions, pose, facial appeal, pixel texture and shading as closely as possible. Transfer the drawing style, not the reference person's clothing or identity. Remove held drinks and the photographic background.
Match IMAGE 2's cute approximately 2.5-head-tall silhouette, including hat and hair. Oversized head, large dark expressive eyes with small white highlights, warm rosy cheeks, tiny smiling mouth. Short yet clearly defined torso and legs so clothing remains legible. Almost straight-on view, minimal camera elevation. Detailed handcrafted pixel illustration at roughly 96–128 logical pixels character height, enlarged into visible crisp square pixels. Rich controlled stepped shades, warm dark-brown selective outlines, dimensional shading made of pixel clusters. Do not simplify into a tiny 16-bit sprite or a smooth vector cartoon.
Front-facing neutral standing pose, arms relaxed, feet close together. Complete head-to-shoes figure centered, filling about 80 percent of canvas height with generous transparent padding. No sprite sheet, multiple poses, cast shadow, floor, glow, text or background.`;}

export function buildCharacterPrompt(){return `The supplied image is a FINISHED APPROVED CHARACTER DESIGN. Animate this exact artwork; do not redesign, restyle or change its proportions. Preserve the exact front-facing face shape, eye size and spacing, hair silhouette, head-to-body ratio, torso length, leg length, outfit, palette, fine square pixel texture and shading. The reference's head must not become larger, cheeks rounder, eyes wider, limbs shorter or detail simpler. Treat the original character as the neutral animation keyframe. Keep its front-on camera angle. Infer consistent side and back views.
Output one transparent 2048 by 2048 PNG sprite sheet with exactly 4 columns by 4 rows; cells 512 by 512. Each character is fully inside its cell, horizontally centered at local x=256, ground-contact foot on local y=464. Use identical scale in every cell, roughly 410 pixels from head to shoes. Row 1 faces DOWN toward viewer, row 2 LEFT, row 3 RIGHT, row 4 UP away. Each row shows four walk poses: left step, passing, right step, passing. Small natural steps and arm swings, no running. Change only what motion or direction requires. No backgrounds, shadows, grid lines, text or extra objects.`;}

export function buildWavePrompt(){return `The supplied image is a FINISHED APPROVED CHARACTER DESIGN. Animate this exact artwork; do not redesign, restyle or change its proportions. Preserve the exact front-facing face shape, eye size and spacing, hair silhouette, head-to-body ratio, torso length, leg length, outfit, palette, fine square pixel texture and shading. The reference's head must not become larger, cheeks rounder, eyes wider, limbs shorter or detail simpler. Treat the original character as the neutral animation keyframe. Keep its front-on camera angle. Infer consistent side and back views.
Output one transparent 2048 by 2048 PNG sprite sheet with exactly 4 columns by 4 rows; cells 512 by 512. Each character is fully inside its cell, horizontally centered at local x=256, ground-contact foot on local y=464. Use identical scale in every cell, roughly 410 pixels from head to shoes. Row 1 faces DOWN toward viewer, row 2 LEFT, row 3 RIGHT, row 4 UP away. Each row is a waving animation sheet sequence: column 1 neutral arms resting, column 2 one hand raised beside the head palm outward, column 3 raised hand tilted outward, column 4 raised hand tilted inward. Keep both feet planted and the torso still; only the greeting arm and hand move. Center the torso, not the raised arm bounding box. Keep the raised hand inside its cell. Change only what the greeting or direction requires. No backgrounds, shadows, grid lines, text or extra objects.`;}

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

  const portrait=await generateSheet(photo,buildCharacterPortraitPrompt(),env,{...options,imageSize:'1024x1024'},true);if(portrait instanceof Response)return portrait;
  photo=null;const design=new Blob([portrait],{type:'image/png'});
  const bytes=await generateSheet(design,buildCharacterPrompt(),env,options);if(bytes instanceof Response)return bytes;
  const waveBytes=await generateSheet(design,buildWavePrompt(),env,options);if(waveBytes instanceof Response)return waveBytes;
  const id=crypto.randomUUID(),createdAt=new Date(options.now?.()??Date.now()).toISOString(),claimToken=randomToken(),claimHash=await hashToken(claimToken);
  await storage.put(id,bytes,{name,createdAt,claimHash,hasWave:'true'},waveBytes);
  const character=characterRecord(id,name,createdAt,'true'),origin=new URL(request.url).origin;return json({character,claimToken,passUrl:`${origin}/pass/?character=${id}#claim=${encodeURIComponent(claimToken)}`},201);
}

export async function generateSheet(photo,prompt,env,options,useStyleReference=false){
  const payload=new FormData();payload.append('model',env.OPENAI_IMAGE_MODEL||'gpt-image-2.5-sunburst');
  // Keep the attendee first; the second image supplies style, never identity or clothes.
  payload.append(useStyleReference?'image[]':'image',photo,photo.name||'character.png');
  if(useStyleReference)payload.append('image[]',characterStyleReference(),'style-a.png');
  payload.append('prompt',prompt);payload.append('size',options.imageSize||'2048x2048');payload.append('quality','high');payload.append('background','transparent');payload.append('output_format','png');
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
