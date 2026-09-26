import {get,put} from '@vercel/blob';
import {Redis} from '@upstash/redis';
import {handleAppApi} from '../worker/app-api.mjs';

const redis=Redis.fromEnv();
const WEEK=7*24*60*60;

const characterStorage={
  async list(){const ids=await redis.lrange('characters:recent',0,59),items=await Promise.all(ids.map(id=>redis.get(`character:${id}`)));return items.map((item,index)=>item&&({id:ids[index],name:item.name,createdAt:item.createdAt,imageUrl:`/api/characters/${ids[index]}/image`,cols:4,rows:4,fps:8,layout:'directional'})).filter(Boolean);},
  async get(id){const metadata=await redis.get(`character:${id}`);if(!metadata)return null;const blob=await get(metadata.pathname,{access:'private'});if(!blob)return null;return {...metadata,bytes:blob.stream,contentType:'image/png'};},
  async put(id,bytes,metadata){const pathname=`characters/${id}.png`,blob=await put(pathname,bytes,{access:'private',addRandomSuffix:false,contentType:'image/png'});await redis.set(`character:${id}`,{...metadata,pathname:blob.pathname},{ex:WEEK});await redis.lpush('characters:recent',id);await redis.ltrim('characters:recent',0,99);}
};

// Writes the lobby only if its revision is unchanged since it was read, so concurrent slot updates cannot overwrite each other.
const WRITE_LOBBY=`local current=redis.call('GET',KEYS[2]) or '0'
if current~=ARGV[1] then return 0 end
redis.call('SET',KEYS[1],ARGV[3],'EX',ARGV[4])
redis.call('SET',KEYS[2],ARGV[2],'EX',ARGV[4])
return 1`;

const sessionStore={
  async read(id){const [lobby,revision]=await redis.mget(`lobby:${id}`,`lobby:${id}:rev`);return lobby?{lobby,version:String(revision??0)}:null;},
  async write(id,lobby,version){const expected=version??'0',seconds=Math.max(60,Math.ceil((Date.parse(lobby.expiresAt)-Date.now())/1000));return await redis.eval(WRITE_LOBBY,[`lobby:${id}`,`lobby:${id}:rev`],[expected,String(Number(expected)+1),JSON.stringify(lobby),String(seconds)])===1;}
};

const rateLimiter={
  async hit(key,now,limit,windowMs){const bucket=`ratelimit:generate:${key}:${Math.floor(now/windowMs)}`,count=await redis.incr(bucket);if(count===1)await redis.expire(bucket,Math.ceil(windowMs/1000));return count<=limit;}
};

export const vercelHandler={async fetch(request){return handleAppApi(request,process.env,{characterStorage,sessionStore,rateLimiter});}};
