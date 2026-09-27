import {buildCharacterPrompt,buildWavePrompt,characterRecord,clientKey,generateSheet,generationRateLimit,memoryRateLimiter,sameOrigin,sanitizeCharacterName,validatePhoto} from './character-api.mjs';
import {hashToken,tokenMatches,validId} from './tokens.mjs';

export const JOB_TTL_MS=24*60*60*1000;
export const JOB_DURATION_MS=270000;
const json=(body,status=200)=>Response.json(body,{status,headers:{'cache-control':'no-store'}});
const timeoutMessage='Generation took too long. Please return to the booth so the crew can try again.';
export function memoryJobStorage(map=new Map()){return {
  async get(id){return structuredClone(map.get(id)||null);},
  async create(id,job){if(map.has(id))return false;map.set(id,structuredClone(job));return true;},
  async put(id,job){map.set(id,structuredClone(job));}
};}
function publicJob(job,now){
  const overdue=!['complete','failed'].includes(job.status)&&now>Date.parse(job.deadlineAt);
  return {id:job.id,name:job.name,createdAt:job.createdAt,status:overdue?'failed':job.status,...(overdue?{error:timeoutMessage}:job.error?{error:job.error}:{}),...(job.status==='complete'?{character:characterRecord(job.id,job.name,job.createdAt,'true')}:{})};
}
function receipt(job,token,origin,now){return {job:publicJob(job,now),progressUrl:`${origin}/character/?job=${job.id}#access=${encodeURIComponent(token)}`};}

async function runJob(job,photo,env,options){
  const storage=options.jobStorage,now=()=>options.now?.()??Date.now();
  const signal=AbortSignal.timeout(Math.max(1,Date.parse(job.deadlineAt)-now()));
  const update=async(status,extra={})=>{job={...job,status,...extra};await storage.put(job.id,job);};
  const failure=message=>Object.assign(new Error(message),{publicMessage:message});
  const ensureTime=()=>{if(signal.aborted||now()>Date.parse(job.deadlineAt))throw failure(timeoutMessage);};
  const generate=async(image,prompt)=>{ensureTime();const result=await generateSheet(image,prompt,env,{...options,signal});if(result instanceof Response)throw failure((await result.json()).error);ensureTime();return result;};
  try{
    await update('walking');const walk=await generate(photo,buildCharacterPrompt());photo=null;
    await update('waving');const wave=await generate(new Blob([walk],{type:'image/png'}),buildWavePrompt());
    await update('saving');ensureTime();
    await options.characterStorage.put(job.id,walk,{name:job.name,createdAt:job.createdAt,claimHash:job.tokenHash,hasWave:'true'},wave);
    await update('complete');
  }catch(error){await update('failed',{error:error.publicMessage||'Generation failed. Please ask the booth crew to try again.'}).catch(()=>{});}
}

export async function handleCharacterJobs(request,env,options){
  const url=new URL(request.url),storage=options.jobStorage,now=options.now?.()??Date.now();
  if(!storage)return json({error:'Background character generation is not configured on this host.'},503);
  const match=url.pathname.match(/^\/api\/character-jobs\/([^/]+)$/);
  if(match&&request.method==='GET'){
    const id=match[1],token=request.headers.get('authorization')?.replace(/^Bearer /,'');
    const job=validId(id)?await storage.get(id):null;
    if(!job||!await tokenMatches(token,job.tokenHash))return json({error:'This progress link is invalid or expired. Ask the booth crew for your QR again.'},404);
    if(now>Date.parse(job.expiresAt))return json({error:'This progress link has expired. Please visit the booth.'},410);
    return json({job:publicJob(job,now)});
  }
  if(url.pathname!=='/api/character-jobs'||request.method!=='POST')return json({error:'Not found.'},404);
  if(!sameOrigin(request))return json({error:'Cross-site requests are not allowed.'},403);
  if(!options.defer)return json({error:'This host cannot run background generation. Use the event photo booth deployment.'},503);
  if(!env.OPENAI_API_KEY||!options.characterStorage)return json({error:'The character forge is not configured yet.'},503);
  if(Number(request.headers.get('content-length')||0)>9*1024*1024)return json({error:'This upload is too large.'},413);
  let form,photo,name,id,token;
  try{form=await request.formData();photo=validatePhoto(form.get('photo'));name=sanitizeCharacterName(form.get('name'));id=form.get('requestId');token=form.get('accessToken');if(!validId(id)||typeof token!=='string'||!/^[A-Za-z0-9_-]{32,128}$/.test(token))throw new Error('The upload ticket is invalid. Please reload the booth.');}catch(error){return json({error:error.message||'The photo upload could not be read.'},400);}
  const existing=await storage.get(id);
  if(existing){if(!await tokenMatches(token,existing.tokenHash))return json({error:'That upload ticket is already in use.'},409);return json(receipt(existing,token,url.origin,now),202);}
  if(!await (options.rateLimiter||memoryRateLimiter).hit(clientKey(request),now,generationRateLimit(env),10*60*1000))return json({error:'The booth has reached its generation limit. Wait a few minutes before trying again.'},429);
  const job={id,name,status:'accepted',createdAt:new Date(now).toISOString(),deadlineAt:new Date(now+JOB_DURATION_MS).toISOString(),expiresAt:new Date(now+JOB_TTL_MS).toISOString(),tokenHash:await hashToken(token)};
  if(!await storage.create(id,job)){const current=await storage.get(id);return current&&await tokenMatches(token,current.tokenHash)?json(receipt(current,token,url.origin,now),202):json({error:'That upload ticket is already in use.'},409);}
  // Host must explicitly keep this task alive after sending the QR receipt.
  options.defer(runJob(job,photo,env,options));
  return json(receipt(job,token,url.origin,now),202);
}
