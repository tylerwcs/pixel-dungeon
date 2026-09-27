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

export function buildCharacterPrompt(){
  return `Edit the person in IMAGE 1 (the attendee photo) into one production-ready sprite sheet in the pixel-art drawing style of IMAGE 2 (the selected STYLE A character illustration). IMAGE 1 is the ONLY source for the person's identity, skin tone, face, hairstyle, hair color, gender presentation, outfit and accessories. IMAGE 2 is a STYLE REFERENCE ONLY: transfer its drawing technique, proportions, facial appeal, outlines and pixel shading. Do not copy the reference person's identity, cap, ponytail, white top, jeans, bag, watch or other belongings unless they also appear in IMAGE 1. Preserve the attendee's recognizable face and clothing. Reinterpret their anatomy with Style A chibi proportions rather than copying the photo's realistic body proportions. The output must depict only the attendee, not both reference people.

CHIBI SHAPE AND CAMERA ARE ESSENTIAL: make the entire character approximately two-and-a-half heads tall. The rounded head, hair and any headwear occupy about 40 percent of the complete silhouette. Give them a short but distinct torso, gently rounded shoulders, compact arms, shortened legs and small rounded shoes. Leave enough body length to recognize the actual outfit, waistline, trouser shape and accessories; do not squash the body into a tiny blob beneath the head. Use a gentle, slightly elevated RPG viewpoint, with only a little of the crown and shoulder tops visible. The down-facing view should show the face clearly, almost front-on, rather than looking steeply down onto the scalp. Keep this subtle camera elevation consistent in every direction. No realistic adult body proportions, elongated fashion-model anatomy, extreme overhead foreshortening, or isometric diagonal facing.

FACE AND PERSONALITY: a rounded cheek silhouette, large expressive eyes with dark irises and small clean white highlights, readable eyebrows, a tiny nose and small friendly mouth. Add restrained warm blush and a few carefully placed facial shading clusters. Translate the person's own eye shape, brows, hair framing and other recognizable facial features into this cute style; do not turn everyone into the same generic face or change their gender presentation. Keep facial details stable across the animation.

OUTFIT FIDELITY IS ESSENTIAL: reproduce the same visible outfit from the photo, including the exact garment types, colors, patterns, sleeves, trousers or skirt, footwear, headwear, eyewear, jewelry, and accessories. Simplify those real clothes into pixel art, but do not redesign or replace them with a fantasy costume. Do not invent a cape, armor, belt, boots, hat, weapon, bag, or accessory that is not visible in the source photo. If part of the outfit is obscured, continue it conservatively using the visible colors and materials.

Asset type: one 1024 by 1024 PNG sprite sheet containing exactly 16 complete chibi sprites in exactly 4 equal columns by 4 equal rows. Include each character from the top of the head to the tiny feet without cropping. Every cell is exactly 256 by 256 pixels. Cell centers are x=128, 384, 640, 896 and y=128, 384, 640, 896. Keep each complete character wholly inside its own cell; no pixel from one sprite may cross a cell boundary. Center every frame horizontally at x=128 within its cell, use one identical character scale, and keep the ground-contact foot and character pivot on the same y=232 baseline within every cell.

Direction order is strict. Row 1 faces DOWN toward the viewer. Row 2 faces LEFT. Row 3 faces RIGHT. Row 4 faces UP away from the viewer. All four directions retain the same slightly elevated camera angle and chibi proportions. Each row contains four consecutive walk-cycle poses: left step, passing pose, right step, passing pose. Only the limbs and clothing motion may change. The identity, outfit, scale, body center, and foot anchor must stay fixed across all 16 frames.

Style A: match IMAGE 2 as closely as possible in drawing technique, approximately 2.5-head-tall proportions, facial appeal and pixel texture. Detailed handcrafted pixel illustration with the visual detail density of a roughly 96-to-128-pixel-tall character, enlarged with visibly square crisp pixels. Rich but controlled stepped shades in skin, hair and the attendee's clothing; warm dark-brown selective outlines. Reproduce the reference's gentle dimensional shading using pixel clusters, not smooth paint. Keep the down-facing view almost straight-on with minimal camera elevation. Do not simplify it into a tiny chunky 16-bit sprite, flatten its shading, or turn it into a smooth vector cartoon. Preserve a clear silhouette when reduced for gameplay while retaining the reference's charming detail in a larger preview. No blur, soft painted edges, antialiasing, or subpixel detail.

The entire canvas outside the character must be true transparent alpha. No scenery, floor, glow, gradient, grid lines, labels, text, watermark, shadows, border, extra people, weapons, or loose objects.`;
}

export function buildWavePrompt(){
  return `Create a waving animation sheet using the supplied pixel character walk sheet as the exact visual reference. Preserve the same face, outfit, colors, pixel style, scale and proportions. Match its detailed chibi silhouette exactly: oversized rounded head, short distinct torso, compact limbs, expressive eyes, subtle blush and carefully shaded hair and clothing. Retain the same gentle, slightly elevated camera angle. Do not lengthen or squash the body, shrink the head, simplify away the outfit detail, or introduce a steeper overhead view. Do not redesign the character.

Output one 1024 by 1024 PNG with true transparent alpha, exactly 4 equal columns by 4 equal rows, each cell 256 by 256 pixels. Row 1 faces DOWN toward the viewer. Row 2 faces LEFT. Row 3 faces RIGHT. Row 4 faces UP. Every row is a friendly hello wave, NOT a walk or run cycle. Keep both feet planted and the torso still in all frames. Columns show: 1 neutral arms resting, 2 one hand raised beside the head with palm outward, 3 raised hand tilted outward, 4 raised hand tilted inward. These poses will play forward and backward, then pause at neutral.

Center the torso (not the arm's bounding box) at x=128 within every cell and keep the feet on the same y=232 baseline. Only the greeting arm and hand move; keep the face, body and other arm fixed. Keep the raised hand wholly inside its cell. Retain the walk sheet's fine pixel clusters, layered material shading and crisp square edges without coarsening the artwork. No background, floor, shadows, text, grid, labels or extra objects.`;
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

  const bytes=await generateSheet(photo,buildCharacterPrompt(),env,options,true);if(bytes instanceof Response)return bytes;
  const waveBytes=await generateSheet(new Blob([bytes],{type:'image/png'}),buildWavePrompt(),env,options);if(waveBytes instanceof Response)return waveBytes;
  const id=crypto.randomUUID(),createdAt=new Date(options.now?.()??Date.now()).toISOString(),claimToken=randomToken(),claimHash=await hashToken(claimToken);
  await storage.put(id,bytes,{name,createdAt,claimHash,hasWave:'true'},waveBytes);
  const character=characterRecord(id,name,createdAt,'true'),origin=new URL(request.url).origin;return json({character,claimToken,passUrl:`${origin}/pass/?character=${id}#claim=${encodeURIComponent(claimToken)}`},201);
}

export async function generateSheet(photo,prompt,env,options,useStyleReference=false){
  const payload=new FormData();payload.append('model',env.OPENAI_IMAGE_MODEL||'gpt-image-2.5-sunburst');
  // Keep the attendee first; the second image supplies style, never identity or clothes.
  payload.append(useStyleReference?'image[]':'image',photo,photo.name||'character.png');
  if(useStyleReference)payload.append('image[]',characterStyleReference(),'style-a.png');
  payload.append('prompt',prompt);payload.append('size','1024x1024');payload.append('quality','medium');payload.append('background','transparent');payload.append('output_format','png');
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
