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

const sessionStore={
  async get(id){return redis.get(`lobby:${id}`);},
  async put(id,lobby){const seconds=Math.max(60,Math.ceil((Date.parse(lobby.expiresAt)-Date.now())/1000));await redis.set(`lobby:${id}`,lobby,{ex:seconds});}
};

export default {async fetch(request){return handleAppApi(request,process.env,{characterStorage,sessionStore});}};
