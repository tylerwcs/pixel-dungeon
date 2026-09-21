import {createCharacterStorage,handleCharacterApi} from './character-api.mjs';
import {handleLobbyApi} from './lobby-api.mjs';

export async function handleAppApi(request,env={},options={}){
  const path=new URL(request.url).pathname,characterStorage=createCharacterStorage(env,options);
  if(path.startsWith('/api/characters'))return handleCharacterApi(request,env,{...options,characterStorage});
  if(path.startsWith('/api/lobbies'))return handleLobbyApi(request,env,{...options,characterStorage});
  return new Response(JSON.stringify({error:'Not found.'}),{status:404,headers:{'content-type':'application/json; charset=utf-8'}});
}
