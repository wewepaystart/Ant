/**
 * Vercel Serverless Function: /api/notify
 * Receives "visit" and "download" events from index.html and forwards them
 * securely to Telegram using server-side environment variables.
 *
 * Required Vercel Environment Variables:
 * - TELEGRAM_BOT_TOKEN
 * - TELEGRAM_CHAT_ID
 */

const ALLOWED_EVENTS = new Set(["visit", "download"]);

export function sanitizeField(value, maxLen = 64) {
  if (typeof value !== "string") {
    return "";
  }
  return value
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, maxLen);
}

export function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function parseUserAgent(uaRaw) {
  const ua = sanitizeField(uaRaw || "", 300);
  if (!ua) {
    return "Unknown Device";
  }

  let os = "Desktop";
  if (/android/i.test(ua)) {
    const match = ua.match(/Android\s+([\d.]+)/i);
    os = match ? `Android ${match[1]}` : "Android";
  } else if (/iPhone|iPad|iPod/i.test(ua)) {
    os = "iOS";
  } else if (/Windows/i.test(ua)) {
    os = "Windows";
  } else if (/Macintosh|Mac OS X/i.test(ua)) {
    os = "macOS";
  } else if (/Linux/i.test(ua)) {
    os = "Linux";
  }

  let browser = "Browser";
  if (/Telegram/i.test(ua)) {
    browser = "Telegram In-App";
  } else if (/FBAN|FBAV/i.test(ua)) {
    browser = "Facebook In-App";
  } else if (/Edg/i.test(ua)) {
    browser = "Edge";
  } else if (/Chrome|CriOS/i.test(ua)) {
    browser = "Chrome";
  } else if (/Firefox|FxiOS/i.test(ua)) {
    browser = "Firefox";
  } else if (/Safari/i.test(ua)) {
    browser = "Safari";
  }

  return `${os} · ${browser}`;
}

export function extractRequestMeta(headers = {}) {
  const lower = {};
  for (const [key, val] of Object.entries(headers)) {
    lower[key.toLowerCase()] = Array.isArray(val) ? val[0] : val;
  }

  const forwardedFor = sanitizeField(lower["x-forwarded-for"] || "", 128);
  const ip = forwardedFor
    ? forwardedFor.split(",")[0].trim()
    : sanitizeField(lower["x-real-ip"] || "Unknown", 64);

  const country = sanitizeField(lower["x-vercel-ip-country"] || "", 16);
  let city = sanitizeField(lower["x-vercel-ip-city"] || "", 64);
  if (city) {
    try {
      city = decodeURIComponent(city);
    } catch {
      // Keep raw sanitized city if malformed percent-encoding
    }
  }

  const location =
    city && country
      ? `${city}, ${country}`
      : country || city || "Unknown";

  const device = parseUserAgent(lower["user-agent"] || "");
  return { ip, location, device };
}

export function formatTelegramMessage({
  event,
  visitorId = "",
  button = "",
  ref = "",
  ip = "",
  location = "",
  device = "",
  timestamp = "",
}) {
  const safeVisitor = escapeHtml(sanitizeField(visitorId, 32) || "Unknown");
  const safeButton = escapeHtml(sanitizeField(button, 48) || "Download Button");
  const safeRef = escapeHtml(sanitizeField(ref, 48) || "direct");
  const safeIp = escapeHtml(sanitizeField(ip, 64) || "Unknown");
  const safeLocation = escapeHtml(sanitizeField(location, 80) || "Unknown");
  const safeDevice = escapeHtml(sanitizeField(device, 64) || "Unknown");
  const safeTime = escapeHtml(
    sanitizeField(timestamp, 40) || new Date().toISOString()
  );

  if (event === "download") {
    return [
      "⬇️ <b>APK Download နှိပ်သွားပါပြီ</b>",
      `🆔 <b>Visitor ID:</b> <code>#${safeVisitor}</code>`,
      `🔘 <b>Button:</b> ${safeButton}`,
      `📍 <b>Location:</b> ${safeLocation}`,
      `📱 <b>Device:</b> ${safeDevice}`,
      `🌐 <b>IP:</b> <code>${safeIp}</code>`,
      `🔗 <b>Source:</b> ${safeRef}`,
      `🕒 <b>Time:</b> ${safeTime}`,
    ].join("\n");
  }

  return [
    "👀 <b>Website ဝင်ရောက်ကြည့်ရှုမှု</b>",
    `🆔 <b>Visitor ID:</b> <code>#${safeVisitor}</code>`,
    `📍 <b>Location:</b> ${safeLocation}`,
    `📱 <b>Device:</b> ${safeDevice}`,
    `🌐 <b>IP:</b> <code>${safeIp}</code>`,
    `🔗 <b>Source:</b> ${safeRef}`,
    `🕒 <b>Time:</b> ${safeTime}`,
  ].join("\n");
}

function parseJsonBody(rawBody) {
  if (!rawBody) {
    return {};
  }
  if (Buffer.isBuffer(rawBody)) {
    try {
      return JSON.parse(rawBody.toString("utf8"));
    } catch {
      return null;
    }
  }
  if (typeof rawBody === "object") {
    return rawBody;
  }
  if (typeof rawBody === "string") {
    try {
      return JSON.parse(rawBody);
    } catch {
      return null;
    }
  }
  return null;
}

async function readStreamBody(req) {
  if (req.body !== undefined) {
    return req.body;
  }
  if (typeof req[Symbol.asyncIterator] !== "function") {
    return undefined;
  }
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return chunks.length > 0 ? Buffer.concat(chunks).toString("utf8") : undefined;
}

export default async function handler(req, res) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (req.method === "GET") {
    return res.status(200).json({
      ok: true,
      configured: Boolean(token && chatId),
    });
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const rawBody = await readStreamBody(req);
  const body = parseJsonBody(rawBody);
  if (!body || typeof body !== "object") {
    return res.status(400).json({ ok: false, error: "Invalid JSON body" });
  }

  const event = sanitizeField(body.event, 16);
  if (!ALLOWED_EVENTS.has(event)) {
    return res.status(400).json({ ok: false, error: "Invalid event type" });
  }

  if (!token || !chatId) {
    return res
      .status(503)
      .json({ ok: false, error: "Telegram notification is not configured" });
  }

  const meta = extractRequestMeta(req.headers);
  const text = formatTelegramMessage({
    event,
    visitorId: body.visitorId,
    button: body.button,
    ref: body.ref,
    ip: meta.ip,
    location: meta.location,
    device: meta.device,
    timestamp: new Date().toISOString(),
  });

  try {
    const tgResponse = await fetch(
      `https://api.telegram.org/bot${token}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: "HTML",
          disable_web_page_preview: true,
        }),
      }
    );

    if (!tgResponse.ok) {
      let reason = `HTTP ${tgResponse.status}`;
      try {
        const errJson = await tgResponse.json();
        if (errJson && typeof errJson.description === "string") {
          reason = sanitizeField(errJson.description, 120);
        }
      } catch {
        // Ignore JSON parse errors
      }
      return res.status(502).json({ ok: false, error: reason });
    }

    return res.status(200).json({ ok: true });
  } catch {
    return res
      .status(502)
      .json({ ok: false, error: "Failed to reach Telegram API" });
  }
}
