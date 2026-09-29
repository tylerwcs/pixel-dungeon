import {expect,test} from '@playwright/test';

for(const trailing of ['', '/'])test(`event pages load their styling and scripts ${trailing?'with':'without'} a trailing slash`,async({page},testInfo)=>{
  const broken=[];page.on('response',response=>{if(/\.(css|mjs|js)(\?|$)/.test(response.url())&&response.status()>=400)broken.push(response.url());});
  for(const route of ['booth','booth-display','booth-camera','character','pass','join']){
    await page.goto('/'+route+trailing);
    if(route==='booth'){
      await expect(page.locator('.booth-shell')).toHaveCSS('display','grid');
      await expect(page.locator('.booth-masthead')).toHaveCSS('object-fit','contain');
      for(const width of [1920,390]){
        await page.setViewportSize({width,height:1080});
        const bounds=await page.locator('.booth-masthead').boundingBox();expect(bounds.height).toBeLessThanOrEqual(80);expect(bounds.width).toBeLessThanOrEqual(420);
        await expect(page.locator('.booth-stage')).toHaveCSS('display','grid');
        expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(width);
        await testInfo.attach(`booth-${width}`,{body:await page.screenshot({fullPage:true}),contentType:'image/png'});
      }
      await page.locator('#openRecent').click();await expect(page.locator('#recentDialog')).toBeVisible();await page.locator('#closeRecent').click();
    }else if(route==='booth-display'){
      await expect(page.locator('.remote-display-shell')).toBeVisible();await expect(page.locator('#pairQR')).toBeVisible();await expect(page.locator('#pairStatus')).toContainText(/Scan this QR|Phone connected/);
    }else if(route==='booth-camera'){
      await expect(page.locator('.phone-booth-shell')).toBeVisible();await expect(page.locator('#cameraError')).toContainText('pairing link is incomplete');
    }else if(route==='character'){
      await expect(page.locator('#progressStatus')).toContainText('progress link is incomplete');
      await expect(page.locator('.character-shell')).toHaveCSS('display','grid');
    }else if(route==='pass'){
      await expect(page.locator('#passLoading')).toBeHidden();await expect(page.locator('#passStatus')).toContainText('Scan your personal QR');
    }else{
      await expect(page.locator('#slotPickerTitle')).toHaveText('Join the dungeon');await expect(page.locator('#lobbyScanner')).toBeVisible();
    }
  }
  expect(broken).toEqual([]);
});
