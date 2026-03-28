// formboost-sender/server.js v3.0
// AI-Powered Form Submission Worker (Cloud Run)
// Playwright + Claude DOM解析 + Webhook通知 + リトライ

const express = require('express');
const { chromium } = require('playwright');

const app = express();
app.use(express.json({ limit: '10mb' }));

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || '';
const PORT = process.env.PORT || 8080;

// ─── CAPTCHA検出 ───
const CAPTCHA_INDICATORS = [
  'g-recaptcha', 'h-captcha', 'cf-turnstile',
  'recaptcha', 'hcaptcha', 'turnstile',
  'captcha-container', 'challenge-form',
];

function detectCaptcha(html) {
  const lower = html.toLowerCase();
  return CAPTCHA_INDICATORS.some(ind => lower.includes(ind));
}

// ─── 送信完了キーワード ───
const COMPLETE_KEYWORDS = [
  '\u3042\u308a\u304c\u3068\u3046\u3054\u3056\u3044\u307e\u3059',
  '\u9001\u4fe1\u5b8c\u4e86', '\u304a\u554f\u3044\u5408\u308f\u305b\u3092\u53d7\u3051\u4ed8\u3051',
  '\u53d7\u4ed8\u3051\u307e\u3057\u305f', '\u9001\u4fe1\u3057\u307e\u3057\u305f',
  'thank you', 'thanks for', 'successfully sent',
  'message has been sent', 'we will get back',
  '\u304a\u554f\u5408\u305b\u3044\u305f\u3060\u304d', '\u62c5\u5f53\u8005\u3088\u308a',
  '\u56de\u7b54\u3044\u305f\u3057\u307e\u3059',
];

// ─── フォームURL発見用パス ───
const CONTACT_PATHS = [
  '/contact', '/contact/', '/contact-us', '/contact-us/',
  '/inquiry', '/inquiry/', '/inquire',
  '/contactus', '/form', '/form/', '/forms',
  '/support', '/support/', '/help', '/request',
  '/otoiawase', '/toiawase', '/soudan',
  '/mail', '/mailform', '/mail-form',
  '/about/contact', '/company/contact', '/ir/contact',
  '/contents/contact', '/page/contact',
  '/contacts', '/contacts/',
];

const CONTACT_LINK_PATTERNS = [
  /contact/i, /inquiry/i, /inquire/i,
  /\u304a\u554f\u3044\u5408\u308f\u305b/,
  /\u554f\u3044\u5408\u308f\u305b/,
  /\u304a\u554f\u5408\u305b/,
  /\u3054\u76f8\u8ac7/,
  /\u8cc7\u6599\u8acb\u6c42/,
];

// ─── Browser Pool ───
let browserInstance = null;

async function getBrowser() {
  if (!browserInstance || !browserInstance.isConnected()) {
    browserInstance = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--single-process'],
    });
  }
  return browserInstance;
}

// ─── Claude API ───
async function callClaude(prompt, maxTokens = 2000) {
  if (!ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not set');
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`Claude API error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.content?.[0]?.text || '';
}

// ─── フォームDOM解析 ───
async function extractFormFields(page) {
  return await page.evaluate(() => {
    const fields = [];
    const forms = document.querySelectorAll('form');
    const scope = forms.length > 0 ? forms[0] : document;
    const inputs = scope.querySelectorAll('input, textarea, select');

    for (const el of inputs) {
      const type = el.tagName === 'SELECT' ? 'select'
        : el.tagName === 'TEXTAREA' ? 'textarea'
        : (el.getAttribute('type') || 'text');

      if (['hidden', 'submit', 'button', 'image', 'file', 'reset'].includes(type)) continue;
      if (el.name && /csrf|token|_wpnonce|nonce/i.test(el.name)) continue;

      let label = '';
      const id = el.id;
      if (id) {
        const labelEl = document.querySelector(`label[for="${id}"]`);
        if (labelEl) label = labelEl.textContent.trim();
      }
      if (!label) {
        const parent = el.closest('label, .form-group, .form-field, .field, tr, .wpcf7-form-control-wrap');
        if (parent) {
          const labelEl = parent.querySelector('label, .label, th, dt, legend');
          if (labelEl) label = labelEl.textContent.trim();
        }
      }
      if (!label) label = el.getAttribute('placeholder') || el.getAttribute('aria-label') || '';

      const field = {
        tag: el.tagName.toLowerCase(), type,
        name: el.name || '', id: el.id || '',
        label: label.replace(/\s+/g, ' ').slice(0, 100),
        placeholder: el.getAttribute('placeholder') || '',
        required: el.required || el.getAttribute('aria-required') === 'true',
        selector: el.id ? `#${el.id}` : (el.name ? `[name="${el.name}"]` : ''),
      };

      if (type === 'select') {
        field.options = [];
        for (const opt of el.querySelectorAll('option')) {
          if (opt.value) field.options.push({ value: opt.value, text: opt.textContent.trim() });
        }
      }

      if (type === 'radio' || type === 'checkbox') {
        if (el.name) {
          const existing = fields.find(f => f.name === el.name && f.type === type);
          if (existing) {
            existing.options = existing.options || [];
            existing.options.push({ value: el.value, text: el.nextSibling?.textContent?.trim() || el.value });
            continue;
          }
          field.options = [{ value: el.value, text: el.nextSibling?.textContent?.trim() || el.value }];
        }
      }

      if (field.selector) fields.push(field);
    }
    return fields;
  });
}

// ─── Claude フィールドマッピング ───
async function getFieldMapping(fields, sender) {
  const fieldSummary = fields.map((f, i) => {
    let desc = `[${i}] ${f.type} | name="${f.name}" | label="${f.label}"`;
    if (f.placeholder) desc += ` | placeholder="${f.placeholder}"`;
    if (f.required) desc += ' | REQUIRED';
    if (f.options) desc += ` | options: ${f.options.map(o => `"${o.value}:${o.text}"`).join(', ')}`;
    return desc;
  }).join('\n');

  const prompt = `You are a form-filling assistant. Map sender info to form fields.

SENDER INFO:
- Company: ${sender.company || ''}
- Name: ${sender.name || ''}
- Email: ${sender.email || ''}
- Phone: ${sender.phone || ''}
- Message: ${(sender.message || '').slice(0, 500)}

FORM FIELDS:
${fieldSummary}

RULES:
- For each field, decide the best value from sender info
- For select/radio with options, pick the MOST APPROPRIATE option value
- For "inquiry type" selects, pick "other", "general", "partnership", "business" etc.
- For name fields: if separate family/given name, split "${sender.name}" (first char = family for Japanese)
- For checkbox "agree to privacy policy": set to true
- Skip fields you cannot fill (return null)

Return ONLY a JSON array: [{"index": <N>, "value": "<val>"}]
For checkboxes: {"index": <N>, "value": "true"}
JSON only, no explanation:`;

  const response = await callClaude(prompt, 1500);
  const jsonMatch = response.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error('Claude returned no valid JSON');
  return JSON.parse(jsonMatch[0]);
}

// ─── フィールド入力 ───
async function fillFields(page, fields, mapping) {
  const filled = [];
  for (const m of mapping) {
    if (m.value === null || m.value === undefined) continue;
    const field = fields[m.index];
    if (!field?.selector) continue;
    try {
      const sel = field.selector;
      if (field.type === 'select') {
        await page.selectOption(sel, m.value);
      } else if (field.type === 'radio') {
        await page.check(`input[name="${field.name}"][value="${m.value}"]`);
      } else if (field.type === 'checkbox') {
        if (m.value === 'true' || m.value === true) await page.check(sel);
      } else {
        await page.fill(sel, String(m.value));
      }
      filled.push({ field: field.label || field.name, selector: sel, value: String(m.value).slice(0, 80) });
      await page.waitForTimeout(100);
    } catch (e) {
      console.warn(`[fill] Failed ${field.selector}: ${e.message}`);
    }
  }
  return filled;
}

// ─── 送信ボタン検出 ───
async function findSubmitButton(page) {
  return await page.evaluate(() => {
    const btn = document.querySelector('form button[type="submit"], form input[type="submit"]');
    if (btn) return btn.id ? `#${btn.id}` : `${btn.tagName.toLowerCase()}[type="submit"]`;
    const buttons = document.querySelectorAll('form button, form a.btn, form .submit');
    const kw = ['送信', '確認', 'submit', 'send', '問い合わせ', '申し込み', '次へ'];
    for (const b of buttons) {
      if (kw.some(k => b.textContent.trim().toLowerCase().includes(k))) {
        return b.id ? `#${b.id}` : null;
      }
    }
    return null;
  });
}

// ─── 確認画面処理 ───
async function handleConfirmationPage(page) {
  const kw = ['送信', '確定', '送信する', '上記内容で送信', 'submit', 'send'];
  const buttons = await page.$$('button, input[type="submit"], a.btn');
  for (const btn of buttons) {
    const text = await btn.textContent().catch(() => '');
    if (kw.some(k => (text || '').toLowerCase().includes(k))) {
      await btn.click();
      await page.waitForTimeout(3000);
      return true;
    }
  }
  return false;
}

// ─── Mode B: HP URL → フォーム発見 ───
async function discoverFormUrl(page, hpUrl) {
  try {
    await page.goto(hpUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
  } catch { return null; }

  const links = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('a[href]')).map(a => ({ href: a.href, text: a.textContent.trim() }));
  });

  for (const link of links) {
    if (CONTACT_LINK_PATTERNS.some(p => p.test(link.href) || p.test(link.text)) && link.href.startsWith('http')) {
      return link.href;
    }
  }

  const base = new URL(hpUrl);
  for (const path of CONTACT_PATHS) {
    try {
      const res = await page.context().request.head(`${base.protocol}//${base.hostname}${path}`, { timeout: 5000 });
      if (res.ok()) return `${base.protocol}//${base.hostname}${path}`;
    } catch { continue; }
  }
  return null;
}

// ─── Webhook通知 ───
async function notifyWebhook(webhookUrl, result) {
  if (!webhookUrl) return;
  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-webhook-secret': WEBHOOK_SECRET,
      },
      body: JSON.stringify(result),
      signal: AbortSignal.timeout(10000),
    });
  } catch (e) {
    console.warn(`[webhook] notify failed: ${e.message}`);
  }
}

// ─── メイン送信フロー ───
async function submitForm(formUrl, sender, options = {}) {
  const { mode = 'A', hpUrl = null, dryRun = false, targetId = null, campaignId = null } = options;
  const startTime = Date.now();
  const browser = await getBrowser();
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    locale: 'ja-JP',
    viewport: { width: 1280, height: 720 },
  });
  const page = await context.newPage();

  try {
    let targetUrl = formUrl;

    if (mode === 'B' && hpUrl && !formUrl) {
      targetUrl = await discoverFormUrl(page, hpUrl);
      if (!targetUrl) {
        return { success: false, error: '\u30d5\u30a9\u30fc\u30e0\u30da\u30fc\u30b8\u304c\u898b\u3064\u304b\u308a\u307e\u305b\u3093', mode, target_id: targetId, campaign_id: campaignId, elapsed_ms: Date.now() - startTime };
      }
    }

    if (!targetUrl) return { success: false, error: 'form_url is required', target_id: targetId, campaign_id: campaignId };

    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(2000);

    const html = await page.content();
    if (detectCaptcha(html)) {
      return { success: false, error: 'CAPTCHA\u691c\u51fa', captcha_detected: true, form_url: targetUrl, mode, target_id: targetId, campaign_id: campaignId, elapsed_ms: Date.now() - startTime };
    }

    const fields = await extractFormFields(page);
    if (fields.length === 0) {
      return { success: false, error: '\u30d5\u30a9\u30fc\u30e0\u30d5\u30a3\u30fc\u30eb\u30c9\u304c\u898b\u3064\u304b\u308a\u307e\u305b\u3093', form_url: targetUrl, mode, target_id: targetId, campaign_id: campaignId, elapsed_ms: Date.now() - startTime };
    }

    const mapping = await getFieldMapping(fields, sender);
    const filledFields = await fillFields(page, fields, mapping);

    if (filledFields.length === 0) {
      return { success: false, error: '\u5165\u529b\u3067\u304d\u308b\u30d5\u30a3\u30fc\u30eb\u30c9\u306a\u3057', fields_detected: fields.length, form_url: targetUrl, mode, target_id: targetId, campaign_id: campaignId, elapsed_ms: Date.now() - startTime };
    }

    if (dryRun) {
      const ss = await page.screenshot({ type: 'png', fullPage: false });
      return { success: true, dry_run: true, filled_fields: filledFields, form_url: targetUrl, mode, target_id: targetId, campaign_id: campaignId, screenshot_url: `data:image/png;base64,${ss.toString('base64')}`, elapsed_ms: Date.now() - startTime };
    }

    const submitSel = await findSubmitButton(page);
    if (submitSel) await page.click(submitSel);
    else await page.evaluate(() => { const f = document.querySelector('form'); if (f) f.submit(); });

    await page.waitForTimeout(4000);

    // 確認画面チェック
    const pageText = await page.evaluate(() => document.body?.innerText?.slice(0, 2000) || '');
    if (['\u5165\u529b\u5185\u5bb9\u306e\u78ba\u8a8d', '\u78ba\u8a8d\u753b\u9762', '\u4ee5\u4e0b\u306e\u5185\u5bb9', '\u9001\u4fe1\u3057\u3066\u3088\u308d\u3057\u3044'].some(k => pageText.includes(k))) {
      await handleConfirmationPage(page);
      await page.waitForTimeout(3000);
    }

    const finalText = await page.evaluate(() => document.body?.innerText?.slice(0, 3000) || '');
    const completeKeyword = COMPLETE_KEYWORDS.find(kw => finalText.includes(kw));
    const ss = await page.screenshot({ type: 'png', fullPage: false });

    return {
      success: true,
      complete_detected: !!completeKeyword,
      complete_keyword: completeKeyword || null,
      filled_fields: filledFields,
      form_url: targetUrl,
      final_url: page.url(),
      page_title: await page.title(),
      mode,
      target_id: targetId,
      campaign_id: campaignId,
      sent_content: { company: sender.company || '', name: sender.name || '', email: sender.email || '', phone: sender.phone || '', message: (sender.message || '').slice(0, 200) },
      screenshot_url: `data:image/png;base64,${ss.toString('base64')}`,
      elapsed_ms: Date.now() - startTime,
    };
  } catch (e) {
    return { success: false, error: e.message, form_url: formUrl, mode, target_id: targetId, campaign_id: campaignId, elapsed_ms: Date.now() - startTime };
  } finally {
    await context.close().catch(() => {});
  }
}

// ─── API Endpoints ───

app.get('/', (req, res) => {
  res.json({ service: 'formboost-sender', version: '3.0.0', status: 'ok', features: ['claude-dom', 'mode-a-b', 'captcha-detect', 'confirmation', 'webhook', 'retry', 'dry-run'] });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', browser: !!browserInstance?.isConnected(), uptime: process.uptime() });
});

// 1社送信
app.post('/submit', async (req, res) => {
  const { form_url, hp_url, sender, mode, dry_run, target_id, campaign_id, webhook_url } = req.body;
  if (!form_url && !hp_url) return res.json({ success: false, error: 'form_url or hp_url required' });
  if (!sender) return res.json({ success: false, error: 'sender required' });

  const effectiveMode = mode || (form_url ? 'A' : 'B');
  console.log(`[submit] mode=${effectiveMode} | url=${form_url || hp_url} | company=${sender.company}`);

  const result = await submitForm(form_url, sender, { mode: effectiveMode, hpUrl: hp_url, dryRun: dry_run || false, targetId: target_id, campaignId: campaign_id });

  // Webhook通知
  if (webhook_url) await notifyWebhook(webhook_url, result);

  res.json(result);
});

// バッチ送信（リトライ付き）
app.post('/submit-batch', async (req, res) => {
  const { targets, sender, target_messages, dry_run, interval_ms = 3000, webhook_url, max_retry = 1 } = req.body;
  if (!Array.isArray(targets) || !targets.length) return res.json({ success: false, error: 'targets required' });

  // 即レスポンス（バックグラウンド処理）
  res.json({ success: true, message: `${targets.length}社のバッチ送信を開始`, total: targets.length });

  // バックグラウンドで順次送信
  (async () => {
    for (let i = 0; i < targets.length; i++) {
      const t = targets[i];
      console.log(`[batch] ${i + 1}/${targets.length}: ${t.company || t.form_url || t.hp_url}`);

      let result = null;
      const effectiveMode = t.form_url ? 'A' : 'B';

      // per-target custom_message がある場合、sender.messageを上書き
      const effectiveSender = (target_messages && target_messages[t.id])
        ? { ...sender, message: target_messages[t.id] }
        : sender;

      // 送信（リトライ付き）
      for (let attempt = 0; attempt <= max_retry; attempt++) {
        result = await submitForm(t.form_url, effectiveSender, {
          mode: effectiveMode,
          hpUrl: t.hp_url,
          dryRun: dry_run || false,
          targetId: t.id,
          campaignId: t.campaign_id,
        });

        if (result.success || result.captcha_detected || result.error?.includes('\u30d5\u30a3\u30fc\u30eb\u30c9')) break;
        if (attempt < max_retry) {
          console.log(`[batch] retry ${attempt + 1} for ${t.company}`);
          await new Promise(r => setTimeout(r, 3000));
        }
      }

      // Webhook通知（1社ごと）
      if (webhook_url && result) await notifyWebhook(webhook_url, result);

      // 送信間隔
      if (i < targets.length - 1) await new Promise(r => setTimeout(r, interval_ms));
    }
    console.log(`[batch] completed: ${targets.length} targets`);
  })();
});

// フォーム解析のみ
app.post('/analyze', async (req, res) => {
  const { form_url } = req.body;
  if (!form_url) return res.json({ success: false, error: 'form_url required' });

  const browser = await getBrowser();
  const ctx = await browser.newContext({ userAgent: 'Mozilla/5.0', locale: 'ja-JP' });
  const page = await ctx.newPage();
  try {
    await page.goto(form_url, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(2000);
    const fields = await extractFormFields(page);
    res.json({ success: true, form_url, fields, field_count: fields.length, captcha_detected: detectCaptcha(await page.content()) });
  } catch (e) {
    res.json({ success: false, error: e.message });
  } finally {
    await ctx.close().catch(() => {});
  }
});

app.listen(PORT, () => {
  console.log(`formboost-sender v3.0.0 on port ${PORT}`);
});

process.on('SIGTERM', async () => {
  if (browserInstance) await browserInstance.close().catch(() => {});
  process.exit(0);
});
