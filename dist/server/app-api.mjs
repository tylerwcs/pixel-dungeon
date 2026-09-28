import {createCharacterStorage,handleCharacterApi} from './character-api.mjs';
import {handleLobbyApi} from './lobby-api.mjs';
import {handleCharacterJobs} from './character-jobs.mjs';
import {handleBoothSessionApi} from './booth-session-api.mjs';

export async function handleAppApi(request,env={},options={}){
  const path=new URL(request.url).pathname,characterStorage=createCharacterStorage(env,options);
  if(path.startsWith('/api/booth-sessions'))return handleBoothSessionApi(request,env,options);
  if(path.startsWith('/api/character-jobs'))return handleCharacterJobs(request,env,{...options,characterStorage});
  if(path.startsWith('/api/characters'))return handleCharacterApi(request,env,{...options,characterStorage});
  if(path.startsWith('/api/lobbies'))return handleLobbyApi(request,env,{...options,characterStorage});
  return new Response(JSON.stringify({error:'Not found.'}),{status:404,headers:{'content-type':'application/json; charset=utf-8'}});
}
