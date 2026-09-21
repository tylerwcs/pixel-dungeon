import {copyFileSync,mkdirSync,readdirSync,readFileSync,writeFileSync} from 'node:fs';
import {extname,join,relative,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const publicRoot=join(root,'dist'),outputRoot=join(publicRoot,'server');
const types={'.css':'text/css; charset=utf-8','.html':'text/html; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.png':'image/png'};
const textTypes=new Set(['.css','.html','.mjs']);
const files=[];
function walk(directory){for(const entry of readdirSync(directory,{withFileTypes:true})){const path=join(directory,entry.name),name=relative(publicRoot,path).split(sep).join('/');if(name==='server'||name.startsWith('server/')||name==='.openai'||name.startsWith('.openai/'))continue;if(entry.isDirectory())walk(path);else files.push(path);}}
walk(publicRoot);
const assets={};
for(const path of files){const extension=extname(path).toLowerCase(),pathname='/'+relative(publicRoot,path).split(sep).join('/'),contents=readFileSync(path);assets[pathname]={type:types[extension]||'application/octet-stream',body:textTypes.has(extension)?contents.toString('utf8'):contents.toString('base64'),base64:!textTypes.has(extension)};}
mkdirSync(outputRoot,{recursive:true});mkdirSync(join(publicRoot,'.openai'),{recursive:true});
copyFileSync(join(root,'worker','index.mjs'),join(outputRoot,'index.js'));
copyFileSync(join(root,'worker','character-api.mjs'),join(outputRoot,'character-api.mjs'));
writeFileSync(join(outputRoot,'assets.generated.mjs'),`export const ASSETS=${JSON.stringify(assets)};\n`);
copyFileSync(join(root,'.openai','hosting.json'),join(publicRoot,'.openai','hosting.json'));
console.log(`Built Worker with ${files.length} static assets.`);
