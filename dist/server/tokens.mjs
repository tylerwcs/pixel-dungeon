const encoder=new TextEncoder();

export function randomToken(bytes=24){const value=new Uint8Array(bytes);crypto.getRandomValues(value);return btoa(String.fromCharCode(...value)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');}

export async function hashToken(value){const digest=await crypto.subtle.digest('SHA-256',encoder.encode(String(value||'')));return btoa(String.fromCharCode(...new Uint8Array(digest))).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');}

export async function tokenMatches(value,expected){if(typeof value!=='string'||!value||typeof expected!=='string'||!expected)return false;const actual=await hashToken(value);if(actual.length!==expected.length)return false;let difference=0;for(let i=0;i<actual.length;i++)difference|=actual.charCodeAt(i)^expected.charCodeAt(i);return difference===0;}

export function validId(value){return /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(String(value||''));}
