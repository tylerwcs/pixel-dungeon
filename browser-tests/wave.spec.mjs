import {expect,test} from '@playwright/test';
import fs from 'node:fs';
import {handleAppApi} from '../worker/app-api.mjs';
import {memoryJobStorage} from '../worker/character-jobs.mjs';

const walk=fs.readFileSync(new URL('../dist/assets/adventurer.png',import.meta.url));
// Distinct fixture artwork makes accidentally drawing the walk sheet detectable.
const wave=fs.readFileSync(new URL('../dist/assets/monster.png',import.meta.url));
async function mockBooth(context,{hold=false}={}){
  const id=crypto.randomUUID(),store=new Map([[id,{name:'Mina',createdAt:'2026-09-27',bytes:walk,waveBytes:wave,hasWave:'true',contentType:'image/png'}]]),lobbyStore=new Map(),jobStorage=memoryJobStorage(),tasks=[];let release,hideCatalog=false;const gate=hold?new Promise(resolve=>release=resolve):Promise.resolve();
  await context.route('**/api/**',async route=>{
    const incoming=route.request(),request=new Request(incoming.url(),{method:incoming.method(),headers:incoming.headers(),...(incoming.method()==='POST'?{body:incoming.postDataBuffer()}: {})});
    const response=hideCatalog&&new URL(request.url).pathname==='/api/characters'&&request.method==='GET'?Response.json({characters:[],count:0}):await handleAppApi(request,{OPENAI_API_KEY:'test'},{store,lobbyStore,jobStorage,defer:task=>tasks.push(task),rateLimiter:{hit:async()=>true},fetchImpl:async(url,{body})=>{await gate;return Response.json({data:[{b64_json:(body.get('prompt').includes('waving animation sheet')?wave:walk).toString('base64')}]});}});
    await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())});
  });
  await context.addInitScript(()=>{
    const draw=CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage=function(image,...args){
      if(image instanceof HTMLImageElement&&image.src.includes('/api/characters/')){
        this.canvas.dataset.sprite=image.src;
        if(image.src.includes('animation=wave'))this.canvas.dataset.waveFrames=String(Number(this.canvas.dataset.waveFrames||0)|(1<<Math.floor(args[0]/256)));
      }
      return draw.call(this,image,...args);
    };
  });
  return {finish:async()=>{release?.();await Promise.all(tasks);},hideCatalog:()=>hideCatalog=true};
}

test('crew can accept two photos while attendees follow progress and collect MP4s and passes',async({page,context},testInfo)=>{
  test.setTimeout(240000);
  const backend=await mockBooth(context,{hold:true});await page.setViewportSize({width:1280,height:900});await page.goto('/booth/');
  const readQR=()=>page.locator('#progressQR').evaluate(async canvas=>{const {default:decode}=await import('/vendor/jsqr.mjs'),image=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height);return decode(image.data,image.width,image.height).data;});
  await expect(page.locator('#ticketCard')).toBeHidden();await expect(page.locator('#recentDialog')).toBeHidden();
  for(const width of [1280,695,390]){await page.setViewportSize({width,height:884});await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth)).toBe(width);await testInfo.attach('capture-'+width,{body:await page.screenshot({fullPage:true}),contentType:'image/png'});}
  async function submit(name){await page.locator('#characterName').fill(name);await page.locator('#photoFile').setInputFiles({name:'photo.png',mimeType:'image/png',buffer:walk});await expect(page.locator('#ticketCard')).toBeHidden();await page.locator('#generateCharacter').click();await expect(page.locator('#ticketName')).toHaveText(name);await expect(page.locator('#ticketCard')).toBeVisible();await expect(page.locator('#forge')).toBeHidden();return readQR();}
  const first=await submit('Hello Mina'),phone=await context.newPage();await phone.setViewportSize({width:390,height:844});await phone.emulateMedia({reducedMotion:'no-preference'});await phone.goto(first);
  await expect(phone.locator('#progressStatus')).toHaveText('Creating your pixel character');await expect(phone.locator('#characterReady')).toBeHidden();
  await page.bringToFront();await page.locator('#nextCharacter').click();await expect(page.locator('#forge')).toBeVisible();await expect(page.locator('#ticketCard')).toBeHidden();await expect(page.locator('#characterName')).toHaveValue('');await expect(page.locator('#photoFile')).toHaveValue('');const second=await submit('Hello Bob');expect(second).not.toBe(first);await expect(page.locator('#recentTickets li')).toHaveCount(2);
  for(const width of [1280,695,390]){await page.setViewportSize({width,height:884});await page.locator('#progressQR').scrollIntoViewIfNeeded();await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth)).toBe(width);await testInfo.attach('crew-'+width,{body:await page.screenshot({fullPage:true}),contentType:'image/png'});const qr=await page.locator('#progressQR').screenshot();expect(qr.length).toBeGreaterThan(1000);}
  await page.reload();await expect(page.locator('#ticketCard')).toBeHidden();await expect(page.locator('#recentDialog')).toBeHidden();await page.locator('#openRecent').click();await expect(page.locator('#recentDialog')).toBeVisible();await expect(page.locator('#recentTickets li')).toHaveCount(2);await testInfo.attach('recent-attendees',{body:await page.screenshot(),contentType:'image/png'});await page.locator('#closeRecent').click();await expect(page.locator('#forge')).toBeVisible();await page.locator('#openRecent').click();await page.locator('#recentTickets button').filter({hasText:'Hello Mina'}).click();await expect(page.locator('#recentDialog')).toBeHidden();await expect(page.locator('#ticketCard')).toBeVisible();expect(await readQR()).toBe(first);
  await page.close();await backend.finish();await phone.bringToFront();
  const preview=phone.locator('canvas[data-animation="wave"]');await expect(preview).toHaveAttribute('data-sprite',/animation=wave/);await expect.poll(()=>preview.getAttribute('data-wave-frames')).toBe('15');
  await expect(phone.locator('canvas[data-animation="walk"]')).toHaveAttribute('data-sprite',/\/image$/);
  await expect(phone.getByRole('heading',{name:'Hello!',exact:true})).toBeVisible();
  await expect(phone.getByRole('heading',{name:'Party time!',exact:true})).toBeVisible();await expect(phone.locator('canvas[data-animation=party]')).toHaveAttribute('data-sprite',/animation=party/);
  await expect(phone.locator('#createPass')).toHaveText('Join a game using this character');
  await phone.evaluate(()=>{Object.defineProperty(navigator,'share',{value:undefined,configurable:true});});
  await expect(phone.locator('button[data-background="black"]')).toHaveCount(0);
  for(const [animation,background]of [['wave','framed'],['walk','framed'],['party','framed']]){
    const card=phone.locator('article[data-animation="'+animation+'"]'),button=card.locator('button[data-background="'+background+'"]');
    const downloadPromise=phone.waitForEvent('download',{timeout:180000});await button.click();const download=await downloadPromise,path=testInfo.outputPath(animation+'-'+background+'.mp4');await download.saveAs(path);const bytes=fs.readFileSync(path);expect(bytes.subarray(4,8).toString()).toBe('ftyp');expect(bytes.includes(Buffer.from('avc1'))).toBe(true);
    const metadata=await phone.evaluate(source=>new Promise((resolve,reject)=>{const video=document.createElement('video');video.onloadeddata=()=>{video.currentTime=.2;};video.onseeked=()=>{const c=document.createElement('canvas');c.width=video.videoWidth;c.height=video.videoHeight;const ctx=c.getContext('2d');ctx.drawImage(video,0,0);resolve({duration:video.duration,width:video.videoWidth,height:video.videoHeight,corner:[...ctx.getImageData(100,200,1,1).data]});};video.onerror=()=>reject(new Error('MP4 is not playable'));video.src=source;}),'data:video/mp4;base64,'+bytes.toString('base64'));expect(metadata.duration).toBeCloseTo(6,1);expect(metadata.width).toBe(1080);expect(metadata.height).toBe(1920);if(background==='black')expect(Math.max(...metadata.corner.slice(0,3))).toBeLessThan(12);else expect(Math.max(...metadata.corner.slice(0,3))).toBeGreaterThan(20);
    await expect(card.locator('a')).toHaveCount(0);
  }
  await testInfo.attach('attendee-ready',{body:await phone.screenshot({fullPage:true}),contentType:'image/png'});
  await phone.emulateMedia({reducedMotion:'reduce'});await phone.waitForTimeout(200);const still=await preview.evaluate(canvas=>canvas.toDataURL());await phone.waitForTimeout(300);expect(await preview.evaluate(canvas=>canvas.toDataURL())).toBe(still);
  backend.hideCatalog();await phone.locator('#createPass').click();await expect(phone).toHaveURL(/\/join\/$/);await expect(phone.locator('#joinName')).toHaveText('Hello Mina');
  const game=await context.newPage();await game.goto('/');await expect(game.locator('#lobbyDialog')).toBeVisible();const qr=await game.locator('#lobbyQr').screenshot();
  await phone.bringToFront();await phone.locator('#scanLobby').click();await phone.locator('#lobbyScanner input[type=file]').setInputFiles({name:'lobby.png',mimeType:'image/png',buffer:qr});
  await expect(phone).toHaveURL(/\/join\/\?lobby=/);await expect(phone.locator('#joinName')).toHaveText('Hello Mina');await phone.getByRole('button',{name:'Player 2: available'}).click();await phone.locator('#readySlot').click();await expect(phone.locator('#readySlot')).toHaveText('✓ READY');
  await phone.close();await game.close();
});

test('live camera capture immediately accepts a job and releases the booth',async({page,context},testInfo)=>{
  const backend=await mockBooth(context,{hold:true});await page.addInitScript(()=>{navigator.mediaDevices.getUserMedia=async()=>{window.cameraStarts=(window.cameraStarts||0)+1;const canvas=document.createElement('canvas');canvas.width=640;canvas.height=480;canvas.getContext('2d').fillRect(0,0,640,480);return canvas.captureStream(5);};});await page.setViewportSize({width:568,height:884});await page.goto('/booth/');
  await expect(page.locator('#startCamera')).toHaveCount(0);await expect(page.locator('#forge')).not.toContainText('1 · PHOTO');await expect(page.locator('.name-field')).toContainText('Name your character');await expect.poll(()=>page.locator('#cameraPreview').evaluate(video=>video.videoWidth)).toBe(640);const stage=await page.locator('.booth-stage').boundingBox(),upload=await page.locator('.upload-icon').boundingBox(),masthead=await page.locator('.booth-masthead').boundingBox();expect(stage.width/stage.height).toBeCloseTo(.75,2);expect(upload.x).toBeLessThan(20);expect(upload.y).toBeLessThan(20);expect(upload.x+upload.width).toBeLessThanOrEqual(masthead.x);await testInfo.attach('portrait-booth',{body:await page.screenshot({fullPage:true}),contentType:'image/png'});await page.locator('#characterName').fill('Camera guest');await page.locator('#capturePhoto').click();
  await expect(page.locator('#ticketName')).toHaveText('Camera guest');await expect(page.locator('#forge')).toBeHidden();await expect(page.locator('#photoPicker')).toBeHidden();await expect(page.locator('#ticketCard')).toBeVisible();await expect(page.locator('#ticketCard .eyebrow')).toHaveCount(0);await expect(page.locator('#ticketCard p')).toHaveCount(1);await expect(page.locator('#nextCharacter')).toHaveCSS('justify-content','center');await page.locator('#nextCharacter').click();await expect(page.locator('#characterName')).toHaveValue('');await expect(page.locator('#photoPicker')).toBeVisible();await expect.poll(()=>page.evaluate(()=>window.cameraStarts)).toBe(2);await expect(page.locator('#activeCount')).toHaveText('1 generating');await backend.finish();
});

test('scanner handles denied cameras and stops an opened camera on close',async({page,context})=>{
  await mockBooth(context);await page.goto('/join/');await page.locator('#scanLobby').click();
  await page.evaluate(()=>{navigator.mediaDevices.getUserMedia=async()=>{throw new DOMException('Denied','NotAllowedError');};});await page.getByRole('button',{name:'Open camera',exact:true}).click();await expect(page.locator('.scanner-status')).toContainText('Allow camera access');
  await page.evaluate(()=>{navigator.mediaDevices.getUserMedia=async()=>{const canvas=document.createElement('canvas');canvas.width=100;canvas.height=100;canvas.getContext('2d').fillRect(0,0,100,100);const stream=canvas.captureStream(5);for(const track of stream.getTracks()){const stop=track.stop.bind(track);track.stop=()=>{window.cameraStopped=true;stop();};}return stream;};});
  await page.getByRole('button',{name:'Open camera',exact:true}).click();await expect(page.locator('#lobbyScanner video')).toBeVisible();await page.getByRole('button',{name:'Close scanner'}).click();await expect.poll(()=>page.evaluate(()=>window.cameraStopped)).toBe(true);
});

for(const viewport of [{width:1920,height:1080},{width:390,height:844}]){
  test(`greetings reach lobby, phone and podium; gameplay walks at ${viewport.width}px`,async({page,context},testInfo)=>{
    await mockBooth(context);await page.setViewportSize(viewport);await page.emulateMedia({reducedMotion:'no-preference'});await page.goto('/');await expect(page.locator('#lobbyDialog')).toBeVisible();
    const joinUrl=await page.locator('#lobbyJoin').getAttribute('href'),phone=await context.newPage();await phone.setViewportSize({width:390,height:844});await phone.goto(joinUrl);
    await expect(phone.locator('#joinImage')).toHaveAttribute('data-sprite',/animation=wave/);await phone.getByRole('button',{name:'Player 2: available'}).click();await phone.locator('#readySlot').click();
    await expect(phone.locator('.slot-choice.yours canvas')).toHaveAttribute('data-sprite',/animation=wave/);
    await testInfo.attach(`phone-lobby-${viewport.width}`,{body:await phone.screenshot(),contentType:'image/png'});
    await page.bringToFront();await expect(page.locator('.portrait').nth(1)).toHaveAttribute('data-sprite',/animation=wave/);
    await testInfo.attach(`lobby-wave-${viewport.width}`,{body:await page.screenshot(),contentType:'image/png'});
    for(const slot of [3,4])await page.locator('.player-card').nth(slot-1).getByRole('button',{name:/add ai/i}).click();
    await page.locator('.player-card').first().getByRole('button',{name:/press ready/i}).click();await expect(page.locator('#play')).toBeEnabled();await page.locator('#play').click();
    await expect(page.locator('#lobbyDialog')).not.toBeVisible();await expect(page.locator('.game-portrait[data-player="1"]')).toHaveAttribute('data-sprite',/\/image$/);
    await page.waitForTimeout(5300);await testInfo.attach(`gameplay-${viewport.width}`,{body:await page.screenshot(),contentType:'image/png'});
    // The real app's animation loop draws the same podium canvas generated by its result cards.
    await page.evaluate(()=>{const screen=document.querySelector('#podiumScreen');screen.innerHTML='<canvas class="podium-portrait" data-podium-player="1" width="220" height="220"></canvas>';screen.hidden=false;});
    await expect(page.locator('.podium-portrait')).toHaveAttribute('data-sprite',/animation=wave/);await expect.poll(()=>page.locator('.podium-portrait').getAttribute('data-wave-frames')).toBe('15');
    await phone.close();
  });
}
