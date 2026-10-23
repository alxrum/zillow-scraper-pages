#!/usr/bin/env node
'use strict';
/*
 * Рисует иллюстрации welcome-страницы из tools/shots.html в welcome/*.png (2x).
 *
 * Запуск: node tools/render-shots.js
 *
 * Берёт Chrome for Testing и клиент CDP из репозитория расширения — ставить
 * puppeteer ради двух снимков незачем. Фон прозрачный: карточка сама рисует
 * свою подложку, лишний белый прямоугольник на тёмной странице был бы виден.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const EXT = path.resolve(__dirname, '..', '..', 'zillow scraper');
const { Cdp, httpJson, sleep, waitFor } = require(path.join(EXT, 'tools', 'e2e', 'cdp'));

function findChrome() {
  if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
  const root = path.join(os.homedir(), 'Library', 'Caches', 'puppeteer', 'chrome');
  if (!fs.existsSync(root)) return null;
  for (const ver of fs.readdirSync(root).sort().reverse()) {
    const p = path.join(root, ver, 'chrome-mac-arm64',
      'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing');
    if (fs.existsSync(p)) return p;
  }
  return null;
}

(async () => {
  const chrome = findChrome();
  if (!chrome) {
    console.error('Chrome for Testing не найден: npx @puppeteer/browsers install chrome@stable');
    process.exit(1);
  }
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'zs-shots-'));
  const PORT = 9447;
  const b = spawn(chrome, [
    `--user-data-dir=${profile}`,
    `--remote-debugging-port=${PORT}`,
    '--headless=new',
    '--hide-scrollbars',
    '--force-device-scale-factor=2',
    '--no-first-run',
    'about:blank'
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  b.stderr.on('data', () => {});

  const v = await waitFor(async () => {
    try { return await httpJson(PORT, '/json/version'); } catch { return null; }
  }, { what: 'отладочный порт', timeout: 20000 });
  const c = await new Cdp(v.webSocketDebuggerUrl).connect();

  const { targetId } = await c.send('Target.createTarget', {
    url: 'file://' + path.join(__dirname, 'shots.html')
  });
  const s = await c.attach(targetId);
  await sleep(1200);
  await c.send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } }, s);

  for (const [id, file] of [['step-1', 'steps-1-2.png'], ['step-2', 'step-3.png']]) {
    const box = await c.eval(s, `(() => {
      const r = document.getElementById('${id}').getBoundingClientRect();
      return JSON.stringify({ x: r.x, y: r.y, width: r.width, height: r.height });
    })()`);
    const { x, y, width, height } = JSON.parse(box);
    const shot = await c.send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: true,
      clip: { x, y, width, height, scale: 2 }
    }, s);
    const out = path.join(__dirname, '..', 'welcome', file);
    fs.writeFileSync(out, Buffer.from(shot.data, 'base64'));
    console.log(`welcome/${file} — ${Math.round(width)}×${Math.round(height)} @2x, ${fs.statSync(out).size} байт`);
  }

  c.close();
  b.kill();
  await sleep(600);
  fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
