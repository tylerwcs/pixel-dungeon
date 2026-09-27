import {expect,test} from '@playwright/test';
import fs from 'node:fs';
import {handleAppApi} from '../worker/app-api.mjs';

const walk=fs.readFileSync(new URL('../dist/assets/adventurer.png',import.meta.url));
// Distinct fixture artwork makes accidentally drawing the walk sheet detectable.
const wave=fs.readFileSync(new URL('../dist/assets/monster.png',import.meta.url));
async function mockBooth(context){
  const id=crypto.randomUUID(),store=new Map([[id,{name:'Mina',createdAt:'2026-09-27',bytes:walk,waveBytes:wave,hasWave:'true',contentType:'image/png'}]]),lobbyStore=new Map();let generations=0;
  await context.route('**/api/**',async route=>{
    const incoming=route.request(),request=new Request(incoming.url(),{method:incoming.method(),headers:incoming.headers(),...(incoming.method()==='POST'?{body:incoming.postDataBuffer()}: {})});
    const response=await handleAppApi(request,{OPENAI_API_KEY:'test'},{store,lobbyStore,rateLimiter:{hit:async()=>true},fetchImpl:async()=>Response.json({data:[{b64_json:(++generations%2?walk:wave).toString('base64')}]})});
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
}

test('booth reveal waves, offers both sheets and respects reduced motion',async({page,context},testInfo)=>{
  await mockBooth(context);await page.emulateMedia({reducedMotion:'no-preference'});await page.goto('/booth/');
  await page.locator('#photoFile').setInputFiles({name:'photo.png',mimeType:'image/png',buffer:walk});await page.locator('#characterName').fill('Hello Mina');await page.locator('#generateCharacter').click();
  const preview=page.locator('#resultPreview');await expect(preview).toHaveAttribute('data-sprite',/animation=wave/);
  await expect.poll(()=>preview.getAttribute('data-wave-frames')).toBe('15');
  await expect(page.locator('#downloadWave')).toHaveAttribute('href',/animation=wave/);await expect(page.locator('#downloadCharacter')).not.toHaveAttribute('href',/animation=wave/);
  for(const width of [1280,390]){await page.setViewportSize({width,height:900});await testInfo.attach(`booth-wave-${width}`,{body:await page.screenshot(),contentType:'image/png'});}
  await page.emulateMedia({reducedMotion:'reduce'});await page.waitForTimeout(250);const still=await preview.evaluate(canvas=>canvas.toDataURL());await page.waitForTimeout(250);expect(await preview.evaluate(canvas=>canvas.toDataURL())).toBe(still);
  await page.locator('#makeAnother').click();await expect(page.locator('#forge')).toBeVisible();
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
