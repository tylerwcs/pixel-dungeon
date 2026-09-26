import { expect, test } from '@playwright/test';

async function expectNoPageOverflow(page) {
  const dimensions = await page.evaluate(() => {
    const root = document.documentElement;
    return {
      clientWidth: root.clientWidth,
      clientHeight: root.clientHeight,
      scrollWidth: root.scrollWidth,
      scrollHeight: root.scrollHeight,
    };
  });
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
  expect(dimensions.scrollHeight).toBeLessThanOrEqual(dimensions.clientHeight);
}

async function openLobby(page) {
  await page.goto('/');
  await expect(page.locator('#lobbyDialog')).toBeVisible();
  await expect(page.locator('.player-card')).toHaveCount(4);
  await expect(page.locator('.yep-event-logo').first()).toBeVisible();
}

function podiumMarkup() {
  const colors = ['#ffe49b', '#f59b83', '#b8a2ee', '#88cddd', '#bade80'];
  const confetti = Array.from({ length: 42 }, (_, index) => `<i style="--x:${(index * 37) % 101}%;--static-y:${8 + (index * 29) % 84}%;--tilt:${(index * 47) % 180}deg;--delay:-${(index % 11) * .43}s;--duration:${4.6 + (index % 7) * .34}s;--drift:${(index % 2 ? -1 : 1) * (18 + (index % 5) * 8)}px;--color:${colors[index % colors.length]}"></i>`).join('');
  const card = (player, place, score, detail, role = 'pursuer', compact = false) => `<article class="podium-entry rank-${place}${compact ? ' podium-fourth' : ''}" style="--player:${['#bade80', '#b8a2ee', '#f59b83', '#88cddd'][player - 1]}"><span class="podium-place">${place}</span><div class="podium-player"><canvas class="podium-portrait" data-podium-player="${player - 1}" data-role="${role}" width="220" height="220" aria-label="Player ${player} character"></canvas><strong>PLAYER ${player}</strong><span>${score} GOLD</span>${compact ? '' : `<small>${detail}</small>`}</div>${compact ? '' : `<div class="podium-step"><b>${place}</b></div>`}</article>`;
  return `<div class="podium-panel"><img class="podium-event-logo" src="assets/yep-event-logo.webp" alt="Ecopiana Year End Party 2026"><div class="podium-confetti" aria-hidden="true">${confetti}</div><header class="podium-heading"><span class="eyebrow">GAME COMPLETE · FINAL RANKINGS</span><h2 id="podiumTitle">PLAYER 2 WINS!</h2></header><div class="podium-results"><div class="podium-stage"><div class="podium-top-three">${card(3, 2, 32, '17 collected · +15 catches')}${card(2, 1, 47, '17 collected · +30 catches')}${card(1, 3, 38, '38 collected', 'collector')}</div>${card(4, 4, 17, '', 'pursuer', true)}</div></div><footer class="podium-actions"><button class="primary-button">PLAY AGAIN <span>▶</span></button><button class="secondary-button">RETURN TO LOBBY</button></footer></div>`;
}

async function showPodiumFixture(page, viewport) {
  await page.setViewportSize(viewport);
  await openLobby(page);
  await page.evaluate((markup) => {
    const lobby = document.querySelector('#lobbyDialog');
    if (lobby?.open) lobby.close();
    const screen = document.querySelector('#podiumScreen');
    screen.innerHTML = markup;
    screen.hidden = false;
  }, podiumMarkup());
  await expect(page.getByRole('heading', { name: 'PLAYER 2 WINS!' })).toBeVisible();
  await expect(page.locator('.podium-event-logo')).toBeVisible();
}

test('fullscreen matchmaking lobby fits inside the browser', async ({ page }) => {
  await openLobby(page);

  const cardBoxes = await page.locator('.player-card').evaluateAll((cards) => cards.map((card) => {
    const box = card.getBoundingClientRect();
    return { left: box.left, top: box.top, right: box.right, bottom: box.bottom };
  }));
  for (const box of cardBoxes) {
    expect(box.left).toBeGreaterThanOrEqual(0);
    expect(box.top).toBeGreaterThanOrEqual(0);
    expect(box.right).toBeLessThanOrEqual(1920);
    expect(box.bottom).toBeLessThanOrEqual(1080);
  }
  await expectNoPageOverflow(page);
});

test('matchmaking remains usable at the 150-percent zoom-sized viewport', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await openLobby(page);

  const footer = await page.locator('.lobby-footer').boundingBox();
  expect(footer).not.toBeNull();
  expect(footer.y + footer.height).toBeLessThanOrEqual(720);
  await expect(page.getByRole('button', { name: /start chase/i })).toBeVisible();
  await expectNoPageOverflow(page);
});

test('a host can fill empty slots with AI and start a real game', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await openLobby(page);

  for (const slot of [2, 3, 4]) {
    const card = page.locator('.player-card').nth(slot - 1);
    await card.getByRole('button', { name: /add ai/i }).click();
    await expect(card.getByRole('button', { name: /ai player/i })).toBeVisible();
  }
  await page.locator('.player-card').first().getByRole('button', { name: /press ready/i }).click();
  const start = page.getByRole('button', { name: /start chase/i });
  await expect(start).toBeEnabled();
  await start.click();

  await expect(page.locator('#lobbyDialog')).not.toBeVisible();
  await expect(page.locator('#game')).toBeVisible();
  await expect(page.locator('.hud-score')).toHaveCount(4);
  await expect(page.locator('.hud-score').first()).toContainText('0 GOLD');
});

for (const viewport of [
  { width: 1920, height: 1080, label: 'fullscreen' },
  { width: 1280, height: 720, label: 'zoomed desktop' },
]) {
  test(`final podium is centered and contained at ${viewport.label}`, async ({ page }, testInfo) => {
    await showPodiumFixture(page, viewport);

    const layout = await page.evaluate(() => {
      const panel = document.querySelector('.podium-panel').getBoundingClientRect();
      const logo = document.querySelector('.podium-event-logo').getBoundingClientRect();
      const actions = document.querySelector('.podium-actions').getBoundingClientRect();
      return {
        viewportHeight: innerHeight,
        composition: { top: Math.min(panel.top, logo.top), bottom: panel.bottom },
        panel: { top: panel.top, bottom: panel.bottom, left: panel.left, right: panel.right },
        logo: { top: logo.top, bottom: logo.bottom },
        actions: { top: actions.top, bottom: actions.bottom },
        confetti: document.querySelectorAll('.podium-confetti i').length,
      };
    });

    expect(layout.confetti).toBe(42);
    const verticalOffset = (layout.composition.top + layout.composition.bottom) / 2 - layout.viewportHeight / 2;
    expect(verticalOffset).toBeGreaterThanOrEqual(-48);
    expect(verticalOffset).toBeLessThanOrEqual(8);
    if (viewport.width >= 1500) expect(layout.panel.right - layout.panel.left).toBeGreaterThanOrEqual(1280);
    expect(layout.logo.bottom).toBeLessThanOrEqual(layout.panel.top);
    expect(layout.actions.top).toBeGreaterThan(layout.panel.top);
    expect(layout.actions.bottom).toBeLessThan(layout.panel.bottom);
    await expectNoPageOverflow(page);
    await testInfo.attach(`podium-${viewport.width}x${viewport.height}`, {
      body: await page.screenshot({ animations: 'disabled' }),
      contentType: 'image/png',
    });
  });
}
