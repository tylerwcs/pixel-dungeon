function encodeBase64Url(value){let binary='';for(const byte of new Uint8Array(value))binary+=String.fromCharCode(byte);return btoa(binary).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');}
function decodeBase64Url(value){const padded=value.replaceAll('-','+').replaceAll('_','/')+'==='.slice((value.length+3)%4),binary=atob(padded);return Uint8Array.from(binary,character=>character.charCodeAt(0));}
const rotate=(value,bits)=>((value<<bits)|(value>>>(32-bits)))>>>0;
function quarter(words,a,b,c,d){words[a]=(words[a]+words[b])>>>0;words[d]=rotate(words[d]^words[a],16);words[c]=(words[c]+words[d])>>>0;words[b]=rotate(words[b]^words[c],12);words[a]=(words[a]+words[b])>>>0;words[d]=rotate(words[d]^words[a],8);words[c]=(words[c]+words[d])>>>0;words[b]=rotate(words[b]^words[c],7);}
function word(bytes,offset){return (bytes[offset]|bytes[offset+1]<<8|bytes[offset+2]<<16|bytes[offset+3]<<24)>>>0;}
function writeWord(bytes,offset,value){bytes[offset]=value;bytes[offset+1]=value>>>8;bytes[offset+2]=value>>>16;bytes[offset+3]=value>>>24;}
function chachaBlock(key,nonce,counter){
  const state=new Uint32Array([0x61707865,0x3320646e,0x79622d32,0x6b206574,word(key,0),word(key,4),word(key,8),word(key,12),word(key,16),word(key,20),word(key,24),word(key,28),counter,word(nonce,0),word(nonce,4),word(nonce,8)]),mixed=state.slice();
  for(let round=0;round<10;round++){quarter(mixed,0,4,8,12);quarter(mixed,1,5,9,13);quarter(mixed,2,6,10,14);quarter(mixed,3,7,11,15);quarter(mixed,0,5,10,15);quarter(mixed,1,6,11,12);quarter(mixed,2,7,8,13);quarter(mixed,3,4,9,14);}
  const output=new Uint8Array(64);for(let index=0;index<16;index++)writeWord(output,index*4,(mixed[index]+state[index])>>>0);return output;
}
function chachaXor(input,key,nonce){const output=new Uint8Array(input.length);for(let offset=0,counter=1;offset<input.length;offset+=64,counter++){const block=chachaBlock(key,nonce,counter);for(let index=0;index<64&&offset+index<input.length;index++)output[offset+index]=input[offset+index]^block[index];}return output;}

export function randomUUID(){if(globalThis.crypto?.randomUUID)return crypto.randomUUID();const bytes=crypto.getRandomValues(new Uint8Array(16));bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;const hex=[...bytes].map(value=>value.toString(16).padStart(2,'0')).join('');return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;}
export function randomToken(bytes=48){return encodeBase64Url(crypto.getRandomValues(new Uint8Array(bytes)));}
export async function encryptTicket(ticket,relayKey,subtle=globalThis.crypto?.subtle){
  const keyBytes=decodeBase64Url(relayKey),plain=new TextEncoder().encode(JSON.stringify(ticket)),iv=crypto.getRandomValues(new Uint8Array(12));
  if(subtle){const key=await subtle.importKey('raw',keyBytes,'AES-GCM',false,['encrypt']),data=await subtle.encrypt({name:'AES-GCM',iv},key,plain);return {algorithm:'A256GCM',iv:encodeBase64Url(iv),data:encodeBase64Url(data)};}
  return {algorithm:'CHACHA20',iv:encodeBase64Url(iv),data:encodeBase64Url(chachaXor(plain,keyBytes,iv))};
}
export async function decryptTicket(cipher,relayKey,subtle=globalThis.crypto?.subtle){
  const keyBytes=decodeBase64Url(relayKey),iv=decodeBase64Url(cipher.iv),data=decodeBase64Url(cipher.data);let plain;
  if(cipher.algorithm==='A256GCM'){if(!subtle)throw new Error('Open the booth display over HTTPS, then pair the phone again.');const key=await subtle.importKey('raw',keyBytes,'AES-GCM',false,['decrypt']);plain=new Uint8Array(await subtle.decrypt({name:'AES-GCM',iv},key,data));}
  else if(cipher.algorithm==='CHACHA20')plain=chachaXor(data,keyBytes,iv);else throw new Error('The phone sent an unsupported character ticket.');
  const ticket=JSON.parse(new TextDecoder().decode(plain));if(!ticket?.id||!ticket?.token||!ticket?.name)throw new Error('The phone sent an unreadable character ticket. Pair the phone again.');return ticket;
}
