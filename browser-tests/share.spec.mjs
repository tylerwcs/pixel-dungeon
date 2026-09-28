import {expect,test} from '@playwright/test';

test('native sharing uses the prepared named MP4 on a fresh tap, and cancellation permits retry',async({page})=>{
  test.setTimeout(180000);
  await page.addInitScript(()=>{
    window.shared=[];window.encodingCount=0;const OriginalWorker=window.Worker;
    window.Worker=class extends OriginalWorker{constructor(...args){super(...args);window.encodingCount++;}};
    Object.defineProperty(navigator,'userActivation',{value:{isActive:false},configurable:true});
    Object.defineProperty(navigator,'canShare',{value:({files})=>files?.[0]?.type==='video/mp4',configurable:true});
    Object.defineProperty(navigator,'share',{value:async({files,title})=>{window.shared.push({file:files[0],title});if(window.shared.length===1)throw new DOMException('Cancelled','AbortError');},configurable:true});
  });
  await page.route('**/share-test',route=>route.fulfill({contentType:'text/html',body:'<link rel="stylesheet" href="/character.css?v=share-1"><main id="view" class="animation-previews"></main>'}));
  await page.goto('/share-test');
  await page.evaluate(async()=>{const {mountCharacterView}=await import('/character-view.mjs?v=share-1');await mountCharacterView(document.querySelector('#view'),{name:'Mina 星',imageUrl:'/assets/adventurer.png',cols:4,rows:4,fps:8,layout:'directional',wave:{imageUrl:'/assets/monster.png',cols:4,rows:4,fps:6,layout:'directional'}});});
  const card=page.locator('article[data-animation="wave"]'),button=card.getByRole('button',{name:'Share with event frame',exact:true});
  await button.click();await expect(card.locator('[role=status]')).toContainText('Ready. Tap',{timeout:150000});expect(await page.evaluate(()=>window.shared.length)).toBe(0);
  await page.evaluate(()=>navigator.userActivation.isActive=true);await button.click();await expect(card.locator('[role=status]')).toHaveText('Ready whenever you want to share.');
  await button.click();await expect(card.locator('[role=status]')).toContainText('ready to share again');
  expect(await page.evaluate(()=>({calls:window.shared.length,encodes:window.encodingCount,sameFile:window.shared[0].file===window.shared[1].file,title:window.shared[0].title}))).toEqual({calls:2,encodes:1,sameFile:true,title:'Mina 星 · Ecopialand'});
  const metadata=await page.evaluate(()=>new Promise(resolve=>{const url=URL.createObjectURL(window.shared[0].file),video=document.createElement('video');video.onloadedmetadata=()=>{resolve({width:video.videoWidth,height:video.videoHeight,duration:video.duration});URL.revokeObjectURL(url);};video.src=url;}));expect(metadata).toEqual({width:1080,height:1920,duration:6});
  await expect(page.getByRole('link',{name:/Save/})).toHaveCount(0);
  const measured=await page.evaluate(async()=>{const {drawVideoBackground}=await import('/animation-export.mjs?v=share-1'),canvas=document.createElement('canvas'),ctx=canvas.getContext('2d'),fill=ctx.fillText.bind(ctx),calls=[];ctx.fillText=(text,x,y,max)=>{calls.push({text,width:ctx.measureText(text).width,max});fill(text,x,y,max);};drawVideoBackground(ctx,1080,1920,'ABCDEFGHIJKLMNOPQRSTUVWXYZ 星','black');return calls;});expect(measured[0].text).toBe('ABCDEFGHIJKLMNOPQRSTUVWXYZ 星');expect(measured[0].width).toBeLessThanOrEqual(measured[0].max);
});
