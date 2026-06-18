require("dotenv").config();

const axios = require("axios");
const { chromium } = require("playwright");
const ProxyChain = require("proxy-chain");

const URL = process.env.TARGET_URL;
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const INTERVAL_MIN = Number(process.env.CHECK_INTERVAL_MIN || 30);

const seen = new Set();
let dailySentDate = "";

async function tg(message) {
  await axios.post(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
    chat_id: CHAT_ID,
    text: message,
    parse_mode: "HTML",
    disable_web_page_preview: true
  });
}

async function getOffers() {
  const oldProxyUrl =
    `socks5://${encodeURIComponent(process.env.PROXY_USER)}:` +
    `${encodeURIComponent(process.env.PROXY_PASS)}@` +
    `${process.env.PROXY_HOST}:${process.env.PROXY_PORT}`;

  const newProxyUrl = await ProxyChain.anonymizeProxy(oldProxyUrl);

  const browser = await chromium.launch({
    headless: true,
    proxy: {
      server: newProxyUrl
    }
  });

  const page = await browser.newPage({
    locale: "en-US",
    timezoneId: "America/New_York",
    viewport: { width: 1366, height: 768 },
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
  });

  try {
    await page.goto(URL, {
      waitUntil: "domcontentloaded",
      timeout: 60000
    });

    await page.waitForTimeout(12000);

    const ipText = await page.evaluate(async () => {
      try {
        const r = await fetch("https://ipinfo.io/json");
        const j = await r.json();
        return `${j.ip || "unknown"} | ${j.country || "unknown"} | ${j.org || "unknown"}`;
      } catch {
        return "IP check failed";
      }
    });

    const offers = await page.evaluate(() => {
      const blockedWords = [
        "gemiwall",
        "offerwall",
        "privacy",
        "history",
        "navigation",
        "powered by",
        "checking",
        "loading"
      ];

      const nodes = document.querySelectorAll(
        "a, button, [class*='offer'], [class*='card'], [data-offer]"
      );

      const items = [];

      nodes.forEach((el) => {
        const text = (el.innerText || el.textContent || "")
          .replace(/\s+/g, " ")
          .trim();

        const low = text.toLowerCase();

        if (
          text.length >= 12 &&
          text.length <= 250 &&
          !blockedWords.some((w) => low.includes(w))
        ) {
          items.push({
            id: low,
            title: text,
            link: el.href || location.href
          });
        }
      });

      return [...new Map(items.map((item) => [item.id, item])).values()];
    });

    await browser.close();
    await ProxyChain.closeAnonymizedProxy(newProxyUrl, true);

    return { offers, ipText };
  } catch (error) {
    await browser.close();
    await ProxyChain.closeAnonymizedProxy(newProxyUrl, true);
    throw error;
  }
}

async function checkNewOffers() {
  try {
    await tg("⏰ Checking offers...");

    const { offers, ipText } = await getOffers();

    if (!ipText.includes("US")) {
      await tg(`⚠️ <b>Proxy/IP Warning</b>\n${ipText}`);
    }

    if (!offers.length) {
      await tg(
        "❌ Could not fetch offers.\n\nReason: no offer found after page load.\nMaybe proxy blocked, USA mismatch, or offerwall API not loading."
      );
      return;
    }

    let newCount = 0;

    for (const offer of offers) {
      if (!seen.has(offer.id)) {
        seen.add(offer.id);
        newCount++;

        await tg(
          `🆕 <b>New USA Offer Found</b>\n\n` +
          `${offer.title}\n\n` +
          `🌐 ${offer.link}\n\n` +
          `📡 ${ipText}`
        );
      }
    }

    if (newCount === 0) {
      console.log("No new offers.");
    }

    console.log(`Checked: ${offers.length}, New: ${newCount}`);
  } catch (error) {
    await tg(`❌ <b>Bot/IP Error</b>\n${error.message}`);
  }
}

async function dailyReport() {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const hour = new Date().getUTCHours();

    if (dailySentDate === today) return;
    if (hour !== 3) return;

    const { offers, ipText } = await getOffers();
    dailySentDate = today;

    let message =
      `🇺🇸 <b>Daily USA Offer Report</b>\n` +
      `Total Found: ${offers.length}\n` +
      `📡 ${ipText}\n\n`;

    offers.slice(0, 40).forEach((offer, index) => {
      message += `${index + 1}. ${offer.title}\n\n`;
    });

    await tg(message.slice(0, 3900));
  } catch (error) {
    await tg(`❌ Daily report failed:\n${error.message}`);
  }
}

async function run() {
  await tg("✅ GemiWall Monitor Bot started.");
  await checkNewOffers();

  setInterval(checkNewOffers, INTERVAL_MIN * 60 * 1000);
  setInterval(dailyReport, 30 * 60 * 1000);
}

run();
