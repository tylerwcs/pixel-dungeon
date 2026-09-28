import {expect,test} from '@playwright/test';

test('a paired phone sends a photo ticket to the big display and resets for the next guest',async({context},testInfo)=>{
  const root=process.env.BOOTH_TEST_ORIGIN||'';
  const id='11111111-1111-4111-8111-111111111111',token='j'.repeat(48),createdAt=new Date().toISOString();
  await context.route(/\/api\/character-jobs(?:\/|$)/,async route=>{
    const job={id,name:'Mina',createdAt,status:route.request().method()==='POST'?'accepted':'designing'};
    await route.fulfill({status:route.request().method()==='POST'?202:200,contentType:'application/json',body:JSON.stringify({job})});
  });
  const display=await context.newPage();await display.setViewportSize({width:1920,height:1080});await display.goto(`${root}/booth-display/`);await expect(display.locator('#pairQR')).toBeVisible();
  const captureUrl=await display.evaluate(()=>JSON.parse(localStorage.getItem('pixel-dungeon-booth-display-session')).captureUrl);expect(captureUrl).toContain('/booth-camera/');
  const phone=await context.newPage();await phone.setViewportSize({width:390,height:844});await phone.goto(captureUrl);await expect(phone.locator('#pairState')).toHaveText('CONNECTED');await expect(display.locator('#pairStatus')).toContainText('Phone connected',{timeout:7000});
  await phone.locator('#characterName').fill('Mina');await phone.locator('#libraryFile').setInputFiles({name:'guest.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64')});await expect(phone.locator('#photoPreview')).toBeVisible();await phone.locator('#sendPhoto').click();
  await expect(phone.locator('#sentPanel')).toBeVisible();await expect(display.locator('#ticketPanel')).toBeVisible({timeout:7000});await expect(display.locator('#ticketName')).toHaveText('Mina');await expect(display.locator('#jobStatus')).toContainText('pixel character');
  await testInfo.attach('paired-display-1920',{body:await display.screenshot(),contentType:'image/png'});await testInfo.attach('paired-phone-390',{body:await phone.screenshot({fullPage:true}),contentType:'image/png'});
  await phone.locator('#nextGuest').click();await expect(phone.locator('#capturePanel')).toBeVisible();await expect(display.locator('#pairPanel')).toBeVisible({timeout:7000});
});
