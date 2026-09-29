import {expect,test} from '@playwright/test';

test('Party poses advance at 6 FPS, remain front facing, and reduced motion holds still',async({page})=>{
 await page.goto('/');
 const drawn=await page.evaluate(async()=>{
  const {loadImage}=await import('/render.mjs?v=burst-1'),{drawVideoCharacter}=await import('/animation-export.mjs?v=party-1');
  await loadImage('/assets/adventurer.png');
  const party={src:'/assets/adventurer.png',cols:4,rows:4,fps:6,layout:'directional',anchor:'cell'},asset={party};
  const canvas=document.createElement('canvas');canvas.width=360;canvas.height=640;const ctx=canvas.getContext('2d'),calls=[],draw=ctx.drawImage.bind(ctx);
  ctx.drawImage=(image,...args)=>{calls.push({col:args[0]/(image.width/4),row:args[1]/(image.height/4)});draw(image,...args);};
  for(let tick=0;tick<144;tick++)drawVideoCharacter(ctx,asset,'party',360,640,tick/24);
  for(const time of [0,1,3,5.9])drawVideoCharacter(ctx,asset,'party',360,640,time,true);
  return calls;
 });
 expect(drawn).toHaveLength(148);
 for(let tick=0;tick<144;tick++)expect(drawn[tick]).toEqual({col:Math.floor(tick/4)%4,row:0});
 for(const still of drawn.slice(144))expect(still).toEqual({col:0,row:0});
});

test('three share cards fit desktop and phone, while legacy and failed party assets stay usable',async({page},testInfo)=>{
 await page.route('**/party-view',route=>route.fulfill({contentType:'text/html',body:'<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css?v=auto-ready-1"><link rel="stylesheet" href="/character.css?v=party-1"><main class="character-shell"><section class="character-panel"><h1>Meet Party guest</h1><div id="view" class="animation-previews"></div></section></main>'}));
 await page.goto('/party-view');
 const mount=async(mode)=>page.evaluate(async mode=>{
  window.dispose?.();const {mountCharacterView}=await import('/character-view.mjs?v=party-1');
  const motion={cols:4,rows:4,fps:6,layout:'directional'};
  window.dispose=await mountCharacterView(document.querySelector('#view'),{name:'Party guest',imageUrl:'/assets/adventurer.png',...motion,fps:8,wave:{imageUrl:'/assets/monster.png',...motion},...(mode==='legacy'?{}:{party:{imageUrl:mode==='failed'?'/missing-party.png':'/assets/adventurer.png',...motion}})});
 },mode);
 await mount('ready');await expect(page.locator('.animation-card')).toHaveCount(3);
 for(const width of [1440,390]){await page.setViewportSize({width,height:900});await expect(page.getByRole('heading',{name:'Party time!'})).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(width);await testInfo.attach('party-cards-'+width,{body:await page.screenshot({fullPage:true}),contentType:'image/png'});}
 await mount('legacy');await expect(page.locator('.animation-card')).toHaveCount(2);await expect(page.getByRole('button',{name:/with event frame/}).first()).toBeEnabled();
 await mount('failed');const party=page.locator('[data-animation=party]').first();await expect(party.getByRole('button')).toBeDisabled();await expect(party.getByRole('status')).toContainText('Refresh');await expect(page.locator('[data-animation=walk]').first().getByRole('button')).toBeEnabled();
});
