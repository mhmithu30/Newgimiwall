require("dotenv").config();

const axios = require("axios");
const { chromium } = require("playwright");

const URL = process.env.TARGET_URL;
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const INTERVAL_MIN = Number(process.env.CHECK_INTERVAL_MIN || 30);

const seen = new Set();
let dailySentDate = "";

async function tg(msg) {
  await axios.post(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
    chat_id: CHAT_ID,
    text: msg,
    parse_mode: "HTML",
    disable_web_page_preview: true
  });
}

async function getOffers() {
  const browser = await chromium.launch({
    headless: true,
    proxy: {
      server: `socks5://${process.env.PROXY_HOST}:${process.env.PROXY_PORT}`,
      username: process.env.PROXY_USER,
      password: process.env.PROXY_PASS
    }
  });

  const page = await browser.newPage({
    locale: "en-US",
    timezoneId: "America/New_York",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36"
  });

  try {
    await page.goto(URL, { waitUntil: "networkidle", timeout: 60000 });
    await page.waitForTimeout(8000);

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
      const items = [];
      const nodes = document.querySelectorAll("a, button, [class*='offer'], [data-offer]");

      nodes.forEach((el) => {
        const text = (el.innerText || el.textContent || "")
          .replace(/\s+/g, " ")
          .trim();

        if (
          text.length >= 12 &&
          text.length <= 250 &&
          !text.toLowerCase().includes("privacy") &&
          !text.toLowerCase().includes("history") &&
          !text.toLowerCase().includes("gemiwall")
        ) {
          items.push({
            title: text,
            id: text.toLowerCase(),
            link: el.href || location.href
          });
        }
      });

      return [...new Map(items.map(i => [i.id, i])).values()];
    });

    await browser.close();
    return { offers, ipText };
  } catch (e) {
    await browser.close();
    throw e;
  }
}

async function checkNewOffers() {
  try {
    const { offers, ipText } = await getOffers();

    if (!ipText.includes("US")) {
      await tg(`⚠️ <b>Proxy/IP Warning</b>\n${ipText}`);
    }

    if (!offers.length) {
      await tg("⚠️ Page loaded but no offers found. Maybe offerwall blocked, proxy mismatch, or no USA offers.");
      return;
    }

    let newCount = 0;

    for (const offer of offers) {
      if (!seen.has(offer.id)) {
        seen.add(offer.id);
        newCount++;

        await tg(
          `🆕 <b>New USA Offer Found</b>\n\n${offer.title}\n\n🌐 ${offer.link}\n\n📡 ${ipText}`
        );
      }
    }

    console.log(`Checked ${offers.length}, new ${newCount}`);
  } catch (e) {
    await tg(`❌ <b>Bot/IP Error</b>\n${e.message}`);
  }
}

async function dailyReport() {
  try {
    const today = new Date().toISOString().slice(0, 10);
    if (dailySentDate === today) return;

    const hour = new Date().getUTCHours();
    if (hour !== 3) return;

    const { offers, ipText } = await getOffers();
    dailySentDate = today;

    let msg = `🇺🇸 <b>Daily USA Offer Report</b>\nTotal: ${offers.length}\n📡 ${ipText}\n\n`;

    offers.slice(0, 40).forEach((o, i) => {
      msg += `${i + 1}. ${o.title}\n\n`;
    });

    await tg(msg.slice(0, 3900));
  } catch (e) {
    await tg(`❌ Daily report failed:\n${e.message}`);
  }
}

async function run() {
  await tg("✅ GemiWall Monitor Bot started.");
  await checkNewOffers();

  setInterval(checkNewOffers, INTERVAL_MIN * 60 * 1000);
  setInterval(dailyReport, 30 * 60 * 1000);
}

run();
