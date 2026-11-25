import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import handler, {
  escapeHtml,
  extractRequestMeta,
  formatTelegramMessage,
  parseUserAgent,
} from '../api/notify.js';

const htmlPath = path.resolve(process.cwd(), 'index.html');
const html = fs.readFileSync(htmlPath, 'utf8');

test('index.html contains required editable config constants', () => {
  assert.match(html, /const BANNER_URL\s*=\s*"Bunner\.jpg";/);
  assert.match(
    html,
    /const APK_URL\s*=\s*\n?\s*"https:\/\/pub-025bdd4f665b4e54a87bfcedeed54a91\.r2\.dev\/Apk%20link\/base%20\(2\)\.apk";/
  );
  assert.match(html, /const ICON_URL\s*=\s*"antlogo\.jpg";/);
  assert.match(html, /const APP_NAME\s*=\s*"ပုရွတ်ဆိက်";/);
});

test('index.html includes viewport, title, and Open Graph tags', () => {
  assert.match(html, /<meta\s+name="viewport"/);
  assert.match(html, /<title>.*<\/title>/);
  assert.match(html, /property="og:title"/);
  assert.match(html, /property="og:description"/);
  assert.match(html, /property="og:type"/);
  assert.match(html, /property="og:image"/);
});

test('index.html includes both download buttons, toast text, and Telegram notify hook', () => {
  assert.match(html, /id="heroDownloadBtn"[\s\S]*?download/);
  assert.match(html, /id="barDownloadBtn"[\s\S]*?download/);
  assert.match(html, /DOWNLOAD APP/);
  assert.match(
    html,
    /Download starting\.\.\. If blocked, allow installs from this browser in Android settings\./
  );
  assert.match(html, /\/api\/notify/);
  assert.match(html, /wg_visitor_id/);
  assert.match(html, /id="inAppBanner"/);
  assert.match(html, /Open in Browser \(Chrome\)/);
  assert.match(html, /FBAN\|FBAV/);
});

test('index.html uses no external JS/CSS frameworks', () => {
  assert.doesNotMatch(html, /tailwindcss|bootstrap|react|vue|jquery/i);
});

test('notify helper parses user agent and Vercel geo headers safely', () => {
  assert.equal(
    parseUserAgent(
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36'
    ),
    'Android 14 · Chrome'
  );
  assert.equal(
    parseUserAgent(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1'
    ),
    'iOS · Safari'
  );

  const meta = extractRequestMeta({
    'x-forwarded-for': '103.10.20.30, 10.0.0.1',
    'x-vercel-ip-country': 'MM',
    'x-vercel-ip-city': 'Yangon',
    'user-agent': 'Mozilla/5.0 (Linux; Android 13) Chrome/120.0',
  });
  assert.equal(meta.ip, '103.10.20.30');
  assert.equal(meta.location, 'Yangon, MM');
  assert.equal(meta.device, 'Android 13 · Chrome');
});

test('formatTelegramMessage escapes HTML injection and formats visit vs download', () => {
  const visitMsg = formatTelegramMessage({
    event: 'visit',
    visitorId: 'V-123456',
    ref: '<script>alert(1)</script>',
    ip: '103.1.2.3',
    location: 'Yangon, MM',
    device: 'Android 14 · Chrome',
    timestamp: '2026-11-22T10:00:00.000Z',
  });
  assert.match(visitMsg, /Website ဝင်ရောက်ကြည့်ရှုမှု/);
  assert.match(visitMsg, /#V-123456/);
  assert.doesNotMatch(visitMsg, /<script>/);
  assert.match(visitMsg, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);

  const dlMsg = formatTelegramMessage({
    event: 'download',
    visitorId: 'V-123456',
    button: 'Hero Download',
    ref: 'tg',
    ip: '103.1.2.3',
    location: 'Yangon, MM',
    device: 'Android 14 · Chrome',
    timestamp: '2026-11-22T10:00:05.000Z',
  });
  assert.match(dlMsg, /APK Download နှိပ်သွားပါပြီ/);
  assert.match(dlMsg, /Hero Download/);
  assert.equal(escapeHtml('a & b < c'), 'a &amp; b &lt; c');
});

test('notify handler rejects non-POST and invalid events', async () => {
  function createRes() {
    const headers: Record<string, string> = {};
    return {
      statusCode: 0,
      headers,
      body: null as unknown,
      setHeader(k: string, v: string) {
        this.headers[k] = v;
      },
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json(data: unknown) {
        this.body = data;
        return this;
      },
    };
  }

  const resGet = createRes();
  await handler({ method: 'GET', headers: {} }, resGet);
  assert.equal(resGet.statusCode, 200);
  assert.deepEqual(resGet.body, { ok: true, configured: false });

  const resPut = createRes();
  await handler({ method: 'PUT', headers: {} }, resPut);
  assert.equal(resPut.statusCode, 405);

  const resBadEvent = createRes();
  await handler({ method: 'POST', headers: {}, body: { event: 'hack' } }, resBadEvent);
  assert.equal(resBadEvent.statusCode, 400);
});
