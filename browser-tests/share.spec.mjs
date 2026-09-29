import {expect,test} from '@playwright/test';

test('shifted wave cells and differently sized sheets stay centered at the same visible height',async({page})=>{
  await page.goto('/');
  const results=await page.evaluate(async()=>{
    const {cache}=await import('/render.mjs?v=burst-1'),{drawVideoCharacter}=await import('/animation-export.mjs?v=party-1');
    for(const animation of ['wave','walk']){
      const sheet=document.createElement('canvas');sheet.width=sheet.height=512;const ink=sheet.getContext('2d');ink.fillStyle='#fff';
      for(let row=0;row<4;row++)for(let col=0;col<4;col++){
        ink.save();ink.translate(col*128+[0,-13,8,-5][col],row*128+[0,-4,5,-2][col]);
        // The walk's artwork is much smaller inside its cells; waves also drift.
        if(animation==='walk'){ink.translate(20,20);ink.scale(.65,.65);}
        ink.fillRect(48,24,32,50);ink.fillRect(50,74,10,40);ink.fillRect(68,74,10,40);if(col%2)ink.fillRect(80,35,30,10);ink.restore();
      }
      const image=new Image();image.src=sheet.toDataURL();await image.decode();cache.set(animation+'-fixture',image);
    }
    const asset={src:'walk-fixture',cols:4,rows:4,fps:8,layout:'directional',wave:{src:'wave-fixture',cols:4,rows:4,fps:6,layout:'directional',anchor:'cell'}},results=[];
    for(const [width,height]of [[360,640],[1080,1920]])for(const animation of ['wave','walk'])for(const time of [0,.2,.35,.5,1.7,3.2,4.7]){
      const c=document.createElement('canvas');c.width=width;c.height=height;const ctx=c.getContext('2d');drawVideoCharacter(ctx,asset,animation,width,height,time);const rgba=ctx.getImageData(0,0,width,height).data;let top=height,bottom=-1,left=width,right=-1;
      for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(rgba[(y*width+x)*4+3]>24){top=Math.min(top,y);bottom=y;}
      for(let y=bottom-4;y<=bottom;y++)for(let x=0;x<width;x++)if(rgba[(y*width+x)*4+3]>24){left=Math.min(left,x);right=Math.max(right,x);}
      results.push({animation,time,width,height,visibleHeight:bottom-top+1,bottom:bottom+1,center:(left+right+1)/2});
    }
    return results;
  });
  for(const result of results){expect(Math.abs(result.bottom-result.height*.745)).toBeLessThanOrEqual(3);expect(Math.abs(result.center-result.width/2)).toBeLessThanOrEqual(3);expect(Math.abs(result.visibleHeight-result.width*.84)).toBeLessThanOrEqual(5);}
});

test('native sharing uses the prepared named MP4 on a fresh tap, and cancellation permits retry',async({page})=>{
  test.setTimeout(180000);
  await page.addInitScript(()=>{
    window.shared=[];window.encodingCount=0;const OriginalWorker=window.Worker;
    window.Worker=class extends OriginalWorker{constructor(...args){super(...args);window.encodingCount++;}};
    Object.defineProperty(navigator,'userActivation',{value:{isActive:false},configurable:true});
    Object.defineProperty(navigator,'canShare',{value:({files})=>files?.[0]?.type==='video/mp4',configurable:true});
    Object.defineProperty(navigator,'share',{value:async({files,title})=>{window.shared.push({file:files[0],title});if(window.shared.length===1)throw new DOMException('Cancelled','AbortError');},configurable:true});
  });
  await page.route('**/share-test',route=>route.fulfill({contentType:'text/html',body:'<link rel="stylesheet" href="/character.css?v=party-1"><main id="view" class="animation-previews"></main>'}));
  await page.goto('/share-test');
  await page.evaluate(async()=>{const {mountCharacterView}=await import('/character-view.mjs?v=party-1');await mountCharacterView(document.querySelector('#view'),{name:'Mina 星',imageUrl:'/assets/adventurer.png',cols:4,rows:4,fps:8,layout:'directional',wave:{imageUrl:'/assets/monster.png',cols:4,rows:4,fps:6,layout:'directional'}});});
  const card=page.locator('article[data-animation="wave"]'),button=card.getByRole('button',{name:'Share with event frame',exact:true});
  await expect(page.getByRole('button',{name:/on black/i})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Share with event frame',exact:true})).toHaveCount(2);
  await button.click();await expect(card.locator('[role=status]')).toContainText('Ready. Tap',{timeout:150000});expect(await page.evaluate(()=>window.shared.length)).toBe(0);
  await page.evaluate(()=>navigator.userActivation.isActive=true);await button.click();await expect(card.locator('[role=status]')).toHaveText('Ready whenever you want to share.');
  await button.click();await expect(card.locator('[role=status]')).toContainText('ready to share again');
  expect(await page.evaluate(()=>({calls:window.shared.length,encodes:window.encodingCount,sameFile:window.shared[0].file===window.shared[1].file,title:window.shared[0].title}))).toEqual({calls:2,encodes:1,sameFile:true,title:'Mina 星 · Ecopialand'});
  const metadata=await page.evaluate(()=>new Promise(resolve=>{const url=URL.createObjectURL(window.shared[0].file),video=document.createElement('video');video.onloadedmetadata=()=>{resolve({width:video.videoWidth,height:video.videoHeight,duration:video.duration});URL.revokeObjectURL(url);};video.src=url;}));expect(metadata).toEqual({width:1080,height:1920,duration:6});
  await expect(page.getByRole('link',{name:/Save/})).toHaveCount(0);
  const measured=await page.evaluate(async()=>{const {drawVideoBackground}=await import('/animation-export.mjs?v=party-1'),canvas=document.createElement('canvas'),ctx=canvas.getContext('2d'),fill=ctx.fillText.bind(ctx),calls=[];ctx.fillText=(text,x,y,max)=>{calls.push({text,width:ctx.measureText(text).width,max});fill(text,x,y,max);};drawVideoBackground(ctx,1080,1920,'ABCDEFGHIJKLMNOPQRSTUVWXYZ 星','black');return calls;});expect(measured[0].text).toBe('ABCDEFGHIJKLMNOPQRSTUVWXYZ 星');expect(measured[0].width).toBeLessThanOrEqual(measured[0].max);
});
