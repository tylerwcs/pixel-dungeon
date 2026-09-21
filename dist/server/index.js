import {handleAppApi} from './app-api.mjs';
import {ASSETS} from './assets.generated.mjs';
import {cacheControlFor,resolveStaticRoute} from './static-routing.mjs';

function decodeBase64(value){const binary=atob(value),bytes=new Uint8Array(binary.length);for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);return bytes;}

export default {
  async fetch(request,env){
    const url=new URL(request.url);
    if(url.pathname.startsWith('/api/'))return handleAppApi(request,env);
    if(!['GET','HEAD'].includes(request.method))return new Response('Method not allowed',{status:405});
    const route=resolveStaticRoute(url.pathname,ASSETS);
    if(!route)return new Response('Not found',{status:404});
    if(route.redirect){url.pathname=route.redirect;return Response.redirect(url.toString(),308);}
    const pathname=route.pathname,asset=ASSETS[pathname];
    const headers={'content-type':asset.type,'x-content-type-options':'nosniff','cache-control':cacheControlFor(pathname)};
    return new Response(request.method==='HEAD'?null:asset.base64?decodeBase64(asset.body):asset.body,{headers});
  }
};
