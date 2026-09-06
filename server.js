"use strict";

const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

/* =========================================================
   KONFIGURATION
========================================================= */

const PORT = Number(process.env.PORT || 3000);
const TOKEN = process.env.FOOTBALL_DATA_TOKEN || "";

const VFB_TEAM_ID = 10;

const VFB_RSS_URL =
  "https://www.vfb.de/templates/generated/1/raw/de.xml";

const KICKER_RSS_URL =
  "https://www.kicker.de/vfb-stuttgart/news";

const FOOTBALL_DATA_BASE =
  "https://api.football-data.org/v4";

const BUNDESLIGA_BASE =
  "https://www.bundesliga.com/de/bundesliga/spieltag";

const CACHE_TIME =
  10 * 60 * 1000;

const MATCH_CACHE_TIME =
  2 * 60 * 1000;


/* =========================================================
   CACHE
========================================================= */

let dashboardCache = {
  data: null,
  time: 0
};

const matchCache = new Map();


/* =========================================================
   HTTP HELFER
========================================================= */

function httpsRequest(url, headers = {}) {
  return new Promise((resolve, reject) => {

    const request = https.get(
      url,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
          "Accept-Language": "de-DE,de;q=0.9,en;q=0.8",
          ...headers
        }
      },
      response => {

        let body = "";

        response.setEncoding("utf8");

        response.on("data", chunk => {
          body += chunk;
        });

        response.on("end", () => {

          const status =
            response.statusCode || 0;

          if (status >= 200 && status < 400) {
            resolve(body);
          } else {
            reject(
              new Error(
                `HTTP ${status} bei ${url}`
              )
            );
          }
        });
      }
    );

    request.on("error", reject);

    request.setTimeout(
      15000,
      () => {
        request.destroy(
          new Error(
            "Request Timeout"
          )
        );
      }
    );
  });
}


async function apiRequest(endpoint) {

  if (!TOKEN) {
    throw new Error(
      "FOOTBALL_DATA_TOKEN fehlt"
    );
  }

  return new Promise((resolve, reject) => {

    const request = https.get(
      `${FOOTBALL_DATA_BASE}${endpoint}`,
      {
        headers: {
          "X-Auth-Token": TOKEN,
          "User-Agent": "Cannstatt1893News/1.0",
          "Accept": "application/json"
        }
      },
      response => {

        let body = "";

        response.setEncoding("utf8");

        response.on(
          "data",
          chunk => {
            body += chunk;
          }
        );

        response.on(
          "end",
          () => {

            const status =
              response.statusCode || 0;

            if (
              status < 200 ||
              status >= 300
            ) {
              reject(
                new Error(
                  `Football-Data HTTP ${status}: ${body.slice(0, 300)}`
                )
              );
              return;
            }

            try {
              resolve(
                JSON.parse(body)
              );
            } catch (error) {
              reject(error);
            }
          }
        );
      }
    );

    request.on(
      "error",
      reject
    );

    request.setTimeout(
      15000,
      () => {
        request.destroy(
          new Error(
            "Football-Data Timeout"
          )
        );
      }
    );
  });
}


/* =========================================================
   XML / HTML HELFER
========================================================= */

function decodeHtml(text = "") {

  return String(text)
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#x27;/gi, "'")
    .replace(/&#x2F;/gi, "/")
    .replace(/&#(\d+);/g, (_, n) => {
      return String.fromCharCode(
        Number(n)
      );
    });
}


function stripHtml(text = "") {

  return decodeHtml(
    String(text)
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}


function xmlTag(block, tag) {

  const regex =
    new RegExp(
      `<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`,
      "i"
    );

  const match =
    String(block).match(regex);

  return match
    ? decodeHtml(
        stripHtml(match[1])
      )
    : "";
}


function xmlAttr(block, tag, attr) {

  const regex =
    new RegExp(
      `<${tag}[^>]*${attr}=["']([^"']+)["'][^>]*>`,
      "i"
    );

  const match =
    String(block).match(regex);

  return match
    ? decodeHtml(match[1])
    : "";
}


/* =========================================================
   DATUM
========================================================= */

function formatDate(value) {

  if (!value) {
    return "";
  }

  const date =
    new Date(value);

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return "";
  }

  return date.toLocaleDateString(
    "de-DE",
    {
      day: "2-digit",
      month: "2-digit",
      year: "numeric"
    }
  );
}


/* =========================================================
   SLUGS
========================================================= */

function slugify(name = "") {

  return String(name)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ß/g, "ss")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}


/* =========================================================
   NEWS
========================================================= */

function parseRss(xml, sourceName) {
  const items = [];

  const blocks = [
    ...(xml.match(/<item\b[\s\S]*?<\/item>/gi) || []),
    ...(xml.match(/<entry\b[\s\S]*?<\/entry>/gi) || [])
  ];

  for (const block of blocks) {
    const title = xmlTag(block, "title");
    const description =
      xmlTag(block, "description") ||
      xmlTag(block, "summary") ||
      xmlTag(block, "content");

    let link =
      xmlTag(block, "link") ||
      xmlTag(block, "guid");

    if (!link) {
      const hrefMatch =
        block.match(/<link\b[^>]*href=["']([^"']+)["']/i);
      if (hrefMatch) link = decodeHtml(hrefMatch[1]);
    }

    const pubDate =
      xmlTag(block, "pubDate") ||
      xmlTag(block, "published") ||
      xmlTag(block, "updated") ||
      xmlTag(block, "dc:date");

    const image =
      xmlAttr(block, "media:content", "url") ||
      xmlAttr(block, "media:thumbnail", "url") ||
      xmlAttr(block, "enclosure", "url");

    if (!title) continue;

    items.push({
      title,
      summary: stripHtml(description).slice(0, 320),
      url: link || "https://www.vfb.de/",
      date: pubDate ? formatDate(pubDate) : "",
      rawDate: pubDate || "",
      source: sourceName,
      image: image || ""
    });
  }

  return items;
}


async function getVfBNews() {
  try {
    const xml = await httpsRequest(VFB_RSS_URL);
    const rssNews = parseRss(xml, "VfB Stuttgart");
    if (rssNews.length) return rssNews;
  } catch (error) {
    console.warn("VfB RSS nicht verfügbar:", error.message);
  }

  try {
    const html = await httpsRequest(
      "https://www.vfb.de/de/1893/aktuell/news-archiv/"
    );

    const results = [];
    const seen = new Set();

    const re =
      /<a\b[^>]*href=["']([^"']*\/de\/vfb\/aktuell\/neues\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;

    let m;

    while ((m = re.exec(html)) !== null) {

      let url = decodeHtml(m[1]);
      const title = stripHtml(m[2]);

      if (!title || title.length < 15) continue;

      if (!url.startsWith("http")) {
        url =
          new URL(
            url,
            "https://www.vfb.de"
          ).toString();
      }

      if (seen.has(url)) continue;

      seen.add(url);

      results.push({
        title,
        summary: title,
        url,
        date: "",
        rawDate: "",
        source: "VfB Stuttgart",
        image: ""
      });

      if (results.length >= 10) break;
    }

    if (results.length) return results;

  } catch (error) {

    console.warn(
      "VfB News-Seite nicht verfügbar:",
      error.message
    );
  }

  return [

    {
      title:
        "Ein weiß-roter Festabend",

      summary:
        "Der VfB Stuttgart feiert nach dem Heimspiel gegen den 1. FC Köln einen starken Bundesliga-Abend.",

      url:
        "https://www.vfb.de/de/vfb/profis/saison/bundesliga/2627/2-vfb-stuttgart----1--fc-koeln/",

      date:
        "04.09.2026",

      rawDate:
        "2026-09-04T22:30:00+02:00",

      source:
        "VfB Stuttgart",

      image:
        ""
    },

    {
      title:
        "VfB verleiht Jeremy Arévalo",

      summary:
        "Der Stürmer wechselt auf Leihbasis zum portugiesischen Erstligisten Estrela Amadora.",

      url:
        "https://www.vfb.de/de/vfb/aktuell/neues/profis/2627/jeremy-arevalo-wird-verliehen/",

      date:
        "04.09.2026",

      rawDate:
        "2026-09-04T12:00:00+02:00",

      source:
        "VfB Stuttgart",

      image:
        ""
    },

    {
      title:
        "VfB testet in Weinstadt gegen Heidenheim",

      summary:
        "Der VfB trifft am 25. September 2026 in einem Testspiel auf den 1. FC Heidenheim.",

      url:
        "https://www.vfb.de/de/vfb/aktuell/neues/profis/2627/testspiel-ansetzung-vfb-gegen-heidenheim-in-weinstadt/",

      date:
        "04.09.2026",

      rawDate:
        "2026-09-04T10:00:00+02:00",

      source:
        "VfB Stuttgart",

      image:
        ""
    }

  ];
}


async function getKickerNews() {

  try {

    const html =
      await httpsRequest(
        "https://www.kicker.de/vfb-stuttgart/team-news"
      );

    const results = [];
    const seen = new Set();

    const anchorRegex =
      /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;

    let match;

    while (
      (match =
        anchorRegex.exec(html)) !== null
    ) {

      let url =
        decodeHtml(
          match[1] || ""
        );

      const title =
        stripHtml(
          match[2] || ""
        );

      if (
        !title ||
        title.length < 20
      ) {
        continue;
      }

      if (
        !url.includes(
          "kicker.de/"
        ) ||
        !(
          url.includes(
            "/artikel/"
          ) ||
          url.includes(
            "/video/"
          )
        )
      ) {
        continue;
      }

      if (
        !url.startsWith("http")
      ) {

        url =
          new URL(
            url,
            "https://www.kicker.de"
          ).toString();
      }

      if (
        seen.has(url)
      ) {
        continue;
      }

      seen.add(url);

      results.push({

        title:
          title
            .replace(
              /\s+/g,
              " "
            )
            .trim(),

        summary:
          title
            .replace(
              /\s+/g,
              " "
            )
            .trim(),

        url,

        date:
          "",

        rawDate:
          "",

        source:
          "Kicker",

        image:
          ""
      });

      if (
        results.length >= 10
      ) {
        break;
      }
    }

    return results;

  } catch (error) {

    console.warn(
      "Kicker News nicht verfügbar:",
      error.message
    );

    return [];
  }
}


async function getNews() {

  const [
    vfb,
    kicker
  ] =
    await Promise.all([
      getVfBNews(),
      getKickerNews()
    ]);

  const all = [
    ...vfb,
    ...kicker
  ];

  all.sort(
    (a, b) =>
      new Date(
        b.rawDate || 0
      ) -
      new Date(
        a.rawDate || 0
      )
  );

  const unique = [];
  const seen = new Set();

  for (
    const item of all
  ) {

    const key =
      `${item.title}|${item.url}`;

    if (
      seen.has(key)
    ) {
      continue;
    }

    seen.add(key);

    unique.push(item);
  }

  return unique.slice(
    0,
    20
  );
}


/* =========================================================
   OFFIZIELLE VFB SPIELERBILDER
========================================================= */

const OFFICIAL_ROSTER_URL =
  "https://www.vfb.de/de/1893/profis/kader/saisonen/2026-2027/kader/";

const OFFICIAL_STATS_URL =
  "https://www.vfb.de/de/1893/profis/kader/saisonen/2026-2027/statistik/";


const CURRENT_SQUAD = [

  ["Fabian Bredlow", "Tor", 1],
  ["Marius Funk", "Tor", 33],
  ["Dennis Seimen", "Tor", 41],
  ["Stefan Drljaca", "Tor", 46],

  ["Ameen Al-Dakhil", "Abwehr", 2],
  ["Ramon Hendriks", "Abwehr", 3],
  ["Josha Vagnoman", "Abwehr", 4],
  ["Maximilian Mittelstädt", "Abwehr", 7],
  ["Luca Jaquez", "Abwehr", 14],
  ["Leonidas Stergiou", "Abwehr", 20],
  ["Lorenz Assignon", "Abwehr", 22],
  ["Dan-Axel Zagadou", "Abwehr", 23],
  ["Jeff Chabot", "Abwehr", 24],
  ["Finn Jeltsch", "Abwehr", 29],

  ["Angelo Stiller", "Mittelfeld", 6],
  ["Chris Führich", "Mittelfeld", 10],
  ["Bilal El Khannouss", "Mittelfeld", 11],
  ["Atakan Karazor", "Mittelfeld", 16],
  ["Grischa Prömel", "Mittelfeld", 21],
  ["Nikolas Nartey", "Mittelfeld", 28],
  ["Ertugrul Yigit", "Mittelfeld", 39],
  ["Jarzinho Malanga", "Mittelfeld", 43],

  ["Tiago Tomás", "Sturm", 8],
  ["Ermedin Demirovic", "Sturm", 9],
  ["Dzenan Pejcinovic", "Sturm", 17],
  ["Jamie Leweling", "Sturm", 18],
  ["Deniz Undav", "Sturm", 26],
  ["Justin Diehl", "Sturm", 31],
  ["Leo Sauer", "Sturm", 44]

].map(
  ([name, position, number]) => ({
    name,
    position,
    number
  })
);


/* =========================================================
   OFFIZIELLE VFB SPIELERBILDER
========================================================= */

const FALLBACK_PHOTOS = {

  "Fabian Bredlow":
    "https://www.vfb.de/?proxy=sportdb%2Fspieler%2F06165-1_bredlow.png",

  "Marius Funk":
    "https://www.vfb.de/?proxy=sportdb%2Fspieler%2F6dd79-33_funk.png",

  "Dennis Seimen":
    "https://www.vfb.de/?proxy=sportdb%2Fspieler%2Fa1564-41_seimen.png",

  "Stefan Drljaca":
    "https://www.vfb.de/?proxy=sportdb%2Fspieler%2F26729-46_drljaca.png",

  "Ameen Al-Dakhil":
    "https://www.vfb.de/?proxy=sportdb%2Fspieler%2Fb6d82-2_al-dakhil.png",

  "Ramon Hendriks":
    "https://www.vfb.de/?proxy=sportdb%2Fspieler%2F37072-3_hendriks.png",

  "Josha Vagnoman":
    "https://www.vfb.de/?proxy=sportdb%2Fspieler%2F20236-4_vagnoman.png",

  "Maximilian Mittelstädt":
    "https://www.vfb.de/?proxy=sportdb%2Fspieler%2F0efee-7_mittelsta--dt.png",

  "Luca Jaquez":
    "https://www.vfb.de/?proxy=sportdb%2Fspieler%2F244f9-14_jaquez.png",

  "Leonidas Stergiou":
    "https://www.vfb.de/?proxy=sportdb%2Fspieler%2F029f7-20_stergiou.png",

  "Lorenz Assignon":
    "https://www.vfb.de/?proxy=sportdb%2Fspieler%2F38f68-22_assignon.png",

  "Dan-Axel Zagadou":
    "https://www.vfb.de/?proxy=img%2Fdummy.png",

  "Jeff Chabot":
    "https://www.vfb.de/?proxy=sportdb%2Fspieler%2Fa284d-24_chabot.png",

  "Finn Jeltsch":
    "https://www.vfb.de/?proxy=sportdb%2Fspieler%2Ff076a-29_jeltsch.png",

  "Angelo Stiller":
    "https://www.vfb.de/?proxy=sportdb%2Fspieler%2Fa2f7b-6_stiller.png",

  "Chris Führich":
    "https://www.vfb.de/?proxy=sportdb%2Fspieler%2F95b40-10_fu--hrich.png",

  "Bilal El Khannouss":
    "https://www.vfb.de/?proxy=sportdb%2Fspieler%2F1d484-11_el_khannouss.png",

  "Atakan Karazor":
    "https://www.vfb.de/?proxy=sportdb%2Fspieler%2F4b88f-16_karazor.png",

  "Grischa Prömel":
    "https://www.vfb.de/?proxy=sportdb%2Fspieler%2F9a7b9-21_pro--mel.png",

  "Nikolas Nartey":
    "https://www.vfb.de/?proxy=sportdb%2Fspieler%2F76cc5-28_nartey.png",

  "Ertugrul Yigit":
    "https://www.vfb.de/?proxy=sportdb%2Fspieler%2Fabfd0-yigit.png",

  "Jarzinho Malanga":
    "https://www.vfb.de/?proxy=sportdb%2Fspieler%2F55d47-malanga.png",

  "Tiago Tomás":
    "https://www.vfb.de/?proxy=sportdb%2Fspieler%2F49f37-8_tomas.png",

  "Ermedin Demirovic":
    "https://www.vfb.de/?proxy=sportdb%2Fspieler%2F0ba85-9_demirovic.png",

  "Dzenan Pejcinovic":
    "https://www.vfb.de/?proxy=sportdb%2Fspieler%2F4c4de-17_pejcinovic.png",

  "Jamie Leweling":
    "https://www.vfb.de/?proxy=sportdb%2Fspieler%2Fe4223-18_leweling.png",

  "Deniz Undav":
    "https://www.vfb.de/?proxy=sportdb%2Fspieler%2Fa56ab-22_undav.png",

  "Justin Diehl":
    "https://www.vfb.de/?proxy=img%2Fdummy.png",

  "Leo Sauer":
    "https://www.vfb.de/?proxy=sportdb%2Fspieler%2Fa1dfb-44_sauer.png"
};


async function getOfficialPlayerPhotos() {

  const photos =
    new Map();

  try {

    const html =
      await httpsRequest(
        OFFICIAL_ROSTER_URL
      );

    const matches = [
      ...html.matchAll(
        /(?:src|data-src)=["']([^"']*proxy=sportdb%2Fspieler%2F[^"']+)["']/gi
      )
    ];

    const urls = [];

    for (
      const match of matches
    ) {

      let url =
        decodeHtml(
          match[1]
        );

      if (
        !url.startsWith("http")
      ) {

        url =
          new URL(
            url,
            "https://www.vfb.de"
          ).toString();
      }

      if (
        !urls.includes(url)
      ) {
        urls.push(url);
      }
    }

    CURRENT_SQUAD.forEach(
      (
        player,
        index
      ) => {

        if (
          urls[index]
        ) {

          photos.set(
            player.name,
            urls[index]
          );
        }
      }
    );

    console.log(
      `VfB-Spielerbilder gefunden: ${photos.size}/${CURRENT_SQUAD.length}`
    );

  } catch (error) {

    console.warn(
      "VfB-Spielerbilder konnten nicht geladen werden:",
      error.message
    );
  }

  return photos;
}


/* =========================================================
   OFFIZIELLE STATISTIKEN
========================================================= */

const FALLBACK_STATS = {

  "Fabian Bredlow":
    {
      appearances: 2,
      goals: 0,
      assists: 0,
      minutes: 180
    },

  "Marius Funk":
    {
      appearances: 0,
      goals: 0,
      assists: 0,
      minutes: 0
    },

  "Dennis Seimen":
    {
      appearances: 0,
      goals: 0,
      assists: 0,
      minutes: 0
    },

  "Stefan Drljaca":
    {
      appearances: 0,
      goals: 0,
      assists: 0,
      minutes: 0
    },

  "Ameen Al-Dakhil":
    {
      appearances: 0,
      goals: 0,
      assists: 0,
      minutes: 0
    },

  "Ramon Hendriks":
    {
      appearances: 2,
      goals: 0,
      assists: 0,
      minutes: 102
    },

  "Josha Vagnoman":
    {
      appearances: 2,
      goals: 2,
      assists: 1,
      minutes: 180
    },

  "Maximilian Mittelstädt":
    {
      appearances: 2,
      goals: 0,
      assists: 1,
      minutes: 168
    },

  "Luca Jaquez":
    {
      appearances: 0,
      goals: 0,
      assists: 0,
      minutes: 0
    },

  "Leonidas Stergiou":
    {
      appearances: 1,
      goals: 0,
      assists: 0,
      minutes: 16
    },

  "Lorenz Assignon":
    {
      appearances: 0,
      goals: 0,
      assists: 0,
      minutes: 0
    },

  "Dan-Axel Zagadou":
    {
      appearances: 0,
      goals: 0,
      assists: 0,
      minutes: 0
    },

  "Jeff Chabot":
    {
      appearances: 2,
      goals: 0,
      assists: 0,
      minutes: 164
    },

  "Finn Jeltsch":
    {
      appearances: 2,
      goals: 0,
      assists: 1,
      minutes: 180
    },

  "Angelo Stiller":
    {
      appearances: 2,
      goals: 0,
      assists: 0,
      minutes: 177
    },

  "Chris Führich":
    {
      appearances: 1,
      goals: 0,
      assists: 0,
      minutes: 70
    },

  "Bilal El Khannouss":
    {
      appearances: 2,
      goals: 1,
      assists: 0,
      minutes: 94
    },

  "Atakan Karazor":
    {
      appearances: 0,
      goals: 0,
      assists: 0,
      minutes: 0
    },

  "Grischa Prömel":
    {
      appearances: 2,
      goals: 1,
      assists: 0,
      minutes: 180
    },

  "Nikolas Nartey":
    {
      appearances: 0,
      goals: 0,
      assists: 0,
      minutes: 0
    },

  "Ertugrul Yigit":
    {
      appearances: 0,
      goals: 0,
      assists: 0,
      minutes: 0
    },

  "Jarzinho Malanga":
    {
      appearances: 0,
      goals: 0,
      assists: 0,
      minutes: 0
    },

  "Tiago Tomás":
    {
      appearances: 1,
      goals: 0,
      assists: 0,
      minutes: 62
    },

  "Ermedin Demirovic":
    {
      appearances: 2,
      goals: 1,
      assists: 0,
      minutes: 47
    },

  "Dzenan Pejcinovic":
    {
      appearances: 2,
      goals: 0,
      assists: 0,
      minutes: 153
    },

  "Jamie Leweling":
    {
      appearances: 2,
      goals: 0,
      assists: 0,
      minutes: 48
    },

  "Deniz Undav":
    {
      appearances: 2,
      goals: 0,
      assists: 0,
      minutes: 144
    },

  "Justin Diehl":
    {
      appearances: 0,
      goals: 0,
      assists: 0,
      minutes: 0
    },

  "Leo Sauer":
    {
      appearances: 1,
      goals: 0,
      assists: 0,
      minutes: 12
    }
};


function cleanStatValue(value) {

  const v =
    String(
      value || ""
    ).trim();

  if (
    !v ||
    v === "-"
  ) {
    return 0;
  }

  const n =
    Number(
      v.replace(
        /[^\d]/g,
        ""
      )
    );

  return Number.isFinite(n)
    ? n
    : 0;
}


async function getOfficialSquadStats() {

  const stats =
    new Map();

  for (
    const player of CURRENT_SQUAD
  ) {

    const fallback =
      FALLBACK_STATS[
        player.name
      ] || {

        appearances:
          0,

        goals:
          0,

        assists:
          0,

        minutes:
          0
      };

    stats.set(
      player.name,
      {
        ...fallback
      }
    );
  }

  try {

    const html =
      await httpsRequest(
        OFFICIAL_STATS_URL
      );

    for (
      const player of CURRENT_SQUAD
    ) {

      const escaped =
        player.name.replace(
          /[.*+?^${}()|[\]\\]/g,
          "\\$&"
        );

      const rowMatch =
        html.match(
          new RegExp(
            `<tr[^>]*>[\\s\\S]*?${escaped}[\\s\\S]*?<\\/tr>`,
            "i"
          )
        );

      if (
        !rowMatch
      ) {
        continue;
      }

      const cells = [
        ...rowMatch[0].matchAll(
          /<td[^>]*>([\s\S]*?)<\/td>/gi
        )
      ].map(
        m =>
          stripHtml(
            m[1]
          )
      );

      if (
        cells.length < 4
      ) {
        continue;
      }

      const appearances =
        cleanStatValue(
          cells[1]
        );

      const goals =
        cleanStatValue(
          cells[2]
        );

      const assists =
        cleanStatValue(
          cells[3]
        );

      const minutes =
        cleanStatValue(
          cells[
            cells.length - 1
          ]
        );

      stats.set(
        player.name,
        {
          appearances,
          goals,
          assists,
          minutes
        }
      );
    }

  } catch (error) {

    console.warn(
      "Offizielle VfB-Statistik nicht erreichbar – verwende letzte verifizierte Werte:",
      error.message
    );
  }

  return stats;
}


/* =========================================================
   KADER AUFBAUEN
========================================================= */

async function buildSquad() {

  const [
    officialStats,
    officialPhotos
  ] =
    await Promise.all([
      getOfficialSquadStats(),
      getOfficialPlayerPhotos()
    ]);

  return CURRENT_SQUAD.map(
    player => {

      const stat =
        officialStats.get(
          player.name
        ) || {

          appearances:
            0,

          goals:
            0,

          assists:
            0,

          minutes:
            0
        };

      return {

        name:
          player.name,

        position:
          player.position,

        number:
          player.number,

        appearances:
          stat.appearances,

        goals:
          stat.goals,

        assists:
          stat.assists,

        minutes:
          stat.minutes,

        photo:
          officialPhotos.get(
            player.name
          ) ||
          FALLBACK_PHOTOS[
            player.name
          ] ||
          "",

        shirtNumber:
          player.number
      };
    }
  );
}


/* =========================================================
   SPIELE
========================================================= */

const CLUB_LOGOS = {

  "VfB Stuttgart":
    "https://www.vfb.de/?proxy=img%2Flogo.svg",

  "FC Bayern München":
    "https://commons.wikimedia.org/wiki/Special:FilePath/FC_Bayern_M%C3%BCnchen_logo_(2017).svg",

  "1. FC Köln":
    "https://commons.wikimedia.org/wiki/Special:FilePath/1._FC_K%C3%B6ln_Logo_2014.svg",

  "TSG Hoffenheim":
    "https://commons.wikimedia.org/wiki/Special:FilePath/TSG_1899_Hoffenheim.svg",

  "Borussia Dortmund":
    "https://commons.wikimedia.org/wiki/Special:FilePath/Borussia_Dortmund_logo.svg",

  "SC Paderborn 07":
    "https://commons.wikimedia.org/wiki/Special:FilePath/SC_Paderborn_07_Logo.svg",

  "Hamburger SV":
    "https://commons.wikimedia.org/wiki/Special:FilePath/Hamburger_SV_logo.svg",

  "Borussia Mönchengladbach":
    "https://commons.wikimedia.org/wiki/Special:FilePath/Borussia_M%C3%B6nchengladbach_logo.svg",

  "Bayer 04 Leverkusen":
    "https://commons.wikimedia.org/wiki/Special:FilePath/Bayer_04_Leverkusen_logo.svg",

  "SV Werder Bremen":
    "https://commons.wikimedia.org/wiki/Special:FilePath/SV-Werder-Bremen-Logo.svg",

  "FC Schalke 04":
    "https://commons.wikimedia.org/wiki/Special:FilePath/FC_Schalke_04_Logo.svg",

  "Eintracht Frankfurt":
    "https://commons.wikimedia.org/wiki/Special:FilePath/Eintracht_Frankfurt_Logo.svg",

  "SV Elversberg":
    "https://commons.wikimedia.org/wiki/Special:FilePath/SV_Elversberg_Logo.svg",

  "1. FC Union Berlin":
    "https://commons.wikimedia.org/wiki/Special:FilePath/1._FC_Union_Berlin_logo.svg",

  "SC Freiburg":
    "https://commons.wikimedia.org/wiki/Special:FilePath/SC_Freiburg_logo.svg",

  "FC Augsburg":
    "https://commons.wikimedia.org/wiki/Special:FilePath/FC_Augsburg_logo.svg",

  "RB Leipzig":
    "https://commons.wikimedia.org/wiki/Special:FilePath/RB_Leipzig_2014_logo.svg",

  "1. FSV Mainz 05":
    "https://commons.wikimedia.org/wiki/Special:FilePath/1._FSV_Mainz_05_Logo.svg",

  "Viking FK":
    "https://commons.wikimedia.org/wiki/Special:FilePath/Viking_FK_logo.svg",

  "Viking Stavanger":
    "https://commons.wikimedia.org/wiki/Special:FilePath/Viking_FK_logo.svg",

  "ŠK Slovan Bratislava":
    "https://commons.wikimedia.org/wiki/Special:FilePath/Slovan_Bratislava_logo.svg",

  "Atlético Madrid":
    "https://commons.wikimedia.org/wiki/Special:FilePath/Atletico_Madrid_2017_logo.svg",

  "Galatasaray":
    "https://commons.wikimedia.org/wiki/Special:FilePath/Galatasaray_Sports_Club_Logo.svg",

  "Inter Mailand":
    "https://commons.wikimedia.org/wiki/Special:FilePath/Inter_Milan_2021_logo.svg",

  "LOSC Lille":
    "https://commons.wikimedia.org/wiki/Special:FilePath/LOSC_Lille_logo.svg",

  "Club Brugge":
    "https://commons.wikimedia.org/wiki/Special:FilePath/Club_Brugge_KV_logo.svg",

  "PSV Eindhoven":
    "https://commons.wikimedia.org/wiki/Special:FilePath/PSV_Eindhoven.svg"
};


function crestForTeam(
  name,
  provided = ""
) {

  return (
    provided ||
    CLUB_LOGOS[name] ||
    ""
  );
}


function mapMatch(match) {

  const home =
    match.homeTeam ||
    {};

  const away =
    match.awayTeam ||
    {};

  const score =
    match.score ||
    {};

  return {

    id:
      match.id,

    utcDate:
      match.utcDate,

    rawDate:
      match.utcDate,

    date:
      formatDate(
        match.utcDate
      ),

    home:
      home.name ||
      "",

    away:
      away.name ||
      "",

    homeLogo:
      crestForTeam(
        home.name || "",
        home.crest || ""
      ),

    awayLogo:
      crestForTeam(
        away.name || "",
        away.crest || ""
      ),

    homeGoals:
      score.fullTime?.home ??
      score.halfTime?.home ??
      null,

    awayGoals:
      score.fullTime?.away ??
      score.halfTime?.away ??
      null,

    status:
      match.status ||
      "",

    competition:
      match.competition?.name ||
      "",

    league:
      match.competition?.name ||
      "",

    competitionCode:
      match.competition?.code ||
      "",

    matchday:
      match.matchday ??
      null,

    venue:
      match.venue ||
      ""
  };
}


function mapFallbackMatch(match) {

  return {

    id:
      match.id,

    utcDate:
      match.rawDate,

    rawDate:
      match.rawDate,

    date:
      formatDate(
        match.rawDate
      ),

    home:
      match.home,

    away:
      match.away,

    homeLogo:
      crestForTeam(
        match.home
      ),

    awayLogo:
      crestForTeam(
        match.away
      ),

    homeGoals:
      match.homeGoals ??
      null,

    awayGoals:
      match.awayGoals ??
      null,

    status:
      match.status,

    competition:
      match.competition,

    league:
      match.competition,

    competitionCode:
      match.competitionCode,

    matchday:
      match.matchday,

    venue:
      match.venue ||
      ""
  };
}


const FALLBACK_MATCHES = [

  {
    id:
      72513166,

    rawDate:
      "2026-08-28T20:30:00+02:00",

    home:
      "FC Bayern München",

    away:
      "VfB Stuttgart",

    homeGoals:
      5,

    awayGoals:
      1,

    status:
      "FINISHED",

    competition:
      "Bundesliga",

    competitionCode:
      "BL1",

    matchday:
      1,

    venue:
      "Allianz Arena"
  },

  {
    id:
      72513167,

    rawDate:
      "2026-09-04T20:30:00+02:00",

    home:
      "VfB Stuttgart",

    away:
      "1. FC Köln",

    homeGoals:
      4,

    awayGoals:
      1,

    status:
      "FINISHED",

    competition:
      "Bundesliga",

    competitionCode:
      "BL1",

    matchday:
      2,

    venue:
      "MHPArena"
  },

  {
    id:
      72513188,

    rawDate:
      "2026-09-12T15:30:00+02:00",

    home:
      "TSG Hoffenheim",

    away:
      "VfB Stuttgart",

    homeGoals:
      null,

    awayGoals:
      null,

    status:
      "SCHEDULED",

    competition:
      "Bundesliga",

    competitionCode:
      "BL1",

    matchday:
      3,

    venue:
      "SNP Arena"
  },

  {
    id:
      72513190,

    rawDate:
      "2026-09-19T18:30:00+02:00",

    home:
      "VfB Stuttgart",

    away:
      "Borussia Dortmund",

    homeGoals:
      null,

    awayGoals:
      null,

    status:
      "SCHEDULED",

    competition:
      "Bundesliga",

    competitionCode:
      "BL1",

    matchday:
      4,

    venue:
      "MHPArena"
  },

  {
    id:
      72513200,

    rawDate:
      "2026-10-10T15:30:00+02:00",

    home:
      "SC Paderborn 07",

    away:
      "VfB Stuttgart",

    homeGoals:
      null,

    awayGoals:
      null,

    status:
      "SCHEDULED",

    competition:
      "Bundesliga",

    competitionCode:
      "BL1",

    matchday:
      5,

    venue:
      "Home Deluxe Arena"
  },

  {
    id:
      72513201,

    rawDate:
      "2026-10-17T15:30:00+02:00",

    home:
      "Hamburger SV",

    away:
      "VfB Stuttgart",

    homeGoals:
      null,

    awayGoals:
      null,

    status:
      "SCHEDULED",

    competition:
      "Bundesliga",

    competitionCode:
      "BL1",

    matchday:
      6,

    venue:
      "Volksparkstadion"
  },

  {
    id:
      72513202,

    rawDate:
      "2026-10-24T15:30:00+02:00",

    home:
      "VfB Stuttgart",

    away:
      "Borussia Mönchengladbach",

    homeGoals:
      null,

    awayGoals:
      null,

    status:
      "SCHEDULED",

    competition:
      "Bundesliga",

    competitionCode:
      "BL1",

    matchday:
      7,

    venue:
      "MHPArena"
  },

  {
    id:
      74165882,

    rawDate:
      "2026-09-09T18:45:00+02:00",

    home:
      "VfB Stuttgart",

    away:
      "Viking Stavanger",

    homeGoals:
      null,

    awayGoals:
      null,

    status:
      "SCHEDULED",

    competition:
      "UEFA Champions League",

    competitionCode:
      "CL",

    matchday:
      1,

    venue:
      "MHPArena"
  },

  {
    id:
      74165891,

    rawDate:
      "2026-10-14T21:00:00+02:00",

    home:
      "ŠK Slovan Bratislava",

    away:
      "VfB Stuttgart",

    homeGoals:
      null,

    awayGoals:
      null,

    status:
      "SCHEDULED",

    competition:
      "UEFA Champions League",

    competitionCode:
      "CL",

    matchday:
      2,

    venue:
      "Tehelné pole"
  },

  {
    id:
      74165910,

    rawDate:
      "2026-10-20T21:00:00+02:00",

    home:
      "VfB Stuttgart",

    away:
      "Atlético Madrid",

    homeGoals:
      null,

    awayGoals:
      null,

    status:
      "SCHEDULED",

    competition:
      "UEFA Champions League",

    competitionCode:
      "CL",

    matchday:
      3,

    venue:
      "MHPArena"
  },

  {
    id:
      74165920,

    rawDate:
      "2026-11-03T18:45:00+01:00",

    home:
      "Galatasaray",

    away:
      "VfB Stuttgart",

    homeGoals:
      null,

    awayGoals:
      null,

    status:
      "SCHEDULED",

    competition:
      "UEFA Champions League",

    competitionCode:
      "CL",

    matchday:
      4,

    venue:
      "RAMS Park"
  },

  {
    id:
      74165930,

    rawDate:
      "2026-11-25T21:00:00+01:00",

    home:
      "Inter Mailand",

    away:
      "VfB Stuttgart",

    homeGoals:
      null,

    awayGoals:
      null,

    status:
      "SCHEDULED",

    competition:
      "UEFA Champions League",

    competitionCode:
      "CL",

    matchday:
      5,

    venue:
      "San Siro"
  },

  {
    id:
      74165940,

    rawDate:
      "2026-12-09T21:00:00+01:00",

    home:
      "VfB Stuttgart",

    away:
      "LOSC Lille",

    homeGoals:
      null,

    awayGoals:
      null,

    status:
      "SCHEDULED",

    competition:
      "UEFA Champions League",

    competitionCode:
      "CL",

    matchday:
      6,

    venue:
      "MHPArena"
  },

  {
    id:
      74165950,

    rawDate:
      "2027-01-19T21:00:00+01:00",

    home:
      "VfB Stuttgart",

    away:
      "Club Brugge",

    homeGoals:
      null,

    awayGoals:
      null,

    status:
      "SCHEDULED",

    competition:
      "UEFA Champions League",

    competitionCode:
      "CL",

    matchday:
      7,

    venue:
      "MHPArena"
  },

  {
    id:
      74165960,

    rawDate:
      "2027-01-27T21:00:00+01:00",

    home:
      "PSV Eindhoven",

    away:
      "VfB Stuttgart",

    homeGoals:
      null,

    awayGoals:
      null,

    status:
      "SCHEDULED",

    competition:
      "UEFA Champions League",

    competitionCode:
      "CL",

    matchday:
      8,

    venue:
      "Philips Stadion"
  }

].map(
  mapFallbackMatch
);


async function getMatches() {

  try {

    const data =
      await apiRequest(
        `/teams/${VFB_TEAM_ID}/matches?season=2026&status=FINISHED,SCHEDULED,IN_PLAY,PAUSED,POSTPONED`
      );

    const liveMatches =
      (
        data.matches ||
        []
      ).map(
        mapMatch
      );

    return liveMatches.length
      ? liveMatches
      : FALLBACK_MATCHES;

  } catch (error) {

    console.warn(
      "Spiele nicht verfügbar:",
      error.message
    );

    return FALLBACK_MATCHES;
  }
}


/* =========================================================
   NÄCHSTES SPIEL FALLBACK
========================================================= */

function fallbackNextGame() {

  return {

    id:
      null,

    rawDate:
      "2026-09-09T18:45:00+02:00",

    date:
      "09.09.2026",

    home:
      "VfB Stuttgart",

    away:
      "Viking Stavanger",

    homeLogo:
      crestForTeam(
        "VfB Stuttgart"
      ),

    awayLogo:
      crestForTeam(
        "Viking Stavanger"
      ),

    competition:
      "UEFA Champions League",

    league:
      "Champions League",

    status:
      "SCHEDULED",

    homeGoals:
      null,

    awayGoals:
      null,

    venue:
      "MHPArena"
  };
}


/* =========================================================
   TABELLE
========================================================= */

async function getTable() {

  try {

    const data =
      await apiRequest(
        "/competitions/BL1/standings?season=2026"
      );

    const standings =
      data.standings?.[0]?.table ||
      [];

    return standings.map(
      row => {

        const team =
          row.team ||
          {};

        return {

          position:
            row.position,

          team:
            team.name ||
            "",

          shortName:
            team.shortName ||
            team.name ||
            "",

          crest:
            team.crest ||
            "",

          playedGames:
            row.playedGames ||
            0,

          played:
            row.playedGames ||
            0,

          won:
            row.won ||
            0,

          wins:
            row.won ||
            0,

          draw:
            row.draw ||
            0,

          draws:
            row.draw ||
            0,

          lost:
            row.lost ||
            0,

          losses:
            row.lost ||
            0,

          goalsFor:
            row.goalsFor ||
            0,

          goalsAgainst:
            row.goalsAgainst ||
            0,

          goalDifference:
            row.goalDifference ||
            0,

          goalDiff:
            row.goalDifference ||
            0,

          points:
            row.points ||
            0
        };
      }
    );

  } catch (error) {

    console.warn(
      "Tabelle nicht verfügbar:",
      error.message
    );

    return [];
  }
}


/* =========================================================
   DASHBOARD
========================================================= */

async function buildDashboard() {

  console.log(
    "Dashboard wird aufgebaut..."
  );

  const [
    news,
    matches,
    table,
    squad
  ] =
    await Promise.all([
      getNews(),
      getMatches(),
      getTable(),
      buildSquad()
    ]);

  const now =
    Date.now();

  const upcoming =
    matches
      .filter(
        match =>
          match.rawDate &&
          new Date(
            match.rawDate
          ).getTime() >= now
      )
      .sort(
        (a, b) =>
          new Date(
            a.rawDate
          ) -
          new Date(
            b.rawDate
          )
      );

  const finished =
    matches
      .filter(
        match =>
          match.status ===
          "FINISHED"
      )
      .sort(
        (a, b) =>
          new Date(
            b.rawDate
          ) -
          new Date(
            a.rawDate
          )
      );

  let nextGame =
    upcoming[0] ||
    fallbackNextGame();

  if (
    !nextGame ||
    !nextGame.home
  ) {

    nextGame =
      fallbackNextGame();
  }

  const bundesliga =
    matches.filter(
      match =>
        String(
          match.competition ||
          ""
        )
          .toLowerCase()
          .includes(
            "bundesliga"
          )
    );

  const championsLeague =
    matches.filter(
      match =>
        String(
          match.competition ||
          ""
        )
          .toLowerCase()
          .includes(
            "champions"
          )
    );

  return {

    updatedAt:
      new Date().toISOString(),

    news:
      news,

    nextGame:
      nextGame,

    fixtures:
      bundesliga,

    championsLeague:
      championsLeague,

    results:
      finished,

    table:
      table,

    squad:
      squad,

    live:
      [],

    attribution:
      "Data provided by football-data.org"
  };
}


/* =========================================================
   MATCHDETAILS
========================================================= */

function normalizeMinute(event) {

  const minute =
    event?.minute ??
    event?.time?.elapsed ??
    null;

  const extra =
    event?.injuryTime ??
    event?.time?.extra ??
    null;

  if (
    minute === null ||
    minute === undefined
  ) {

    return "";
  }

  return extra
    ? `${minute}+${extra}.`
    : `${minute}.`;
}


function mapLineup(team) {

  return {

    formation:
      team?.formation ||
      null,

    coach:
      team?.coach?.name ||
      null,

    lineup:
      (
        team?.lineup ||
        []
      ).map(
        player => ({

          id:
            player.id ??
            null,

          name:
            player.name ||
            "",

          position:
            player.position ||
            "",

          shirtNumber:
            player.shirtNumber ??
            null
        })
      ),

    bench:
      (
        team?.bench ||
        []
      ).map(
        player => ({

          id:
            player.id ??
            null,

          name:
            player.name ||
            "",

          position:
            player.position ||
            "",

          shirtNumber:
            player.shirtNumber ??
            null
        })
      ),

    statistics:
      team?.statistics ||
      {}
  };
}


function mapMatchDetails(match) {

  const home =
    match.homeTeam ||
    {};

  const away =
    match.awayTeam ||
    {};

  const goals =
    (
      match.goals ||
      []
    ).map(
      goal => ({

        minute:
          goal.minute ??
          null,

        injuryTime:
          goal.injuryTime ??
          null,

        minuteLabel:
          normalizeMinute(
            goal
          ),

        type:
          goal.type ||
          "REGULAR",

        teamId:
          goal.team?.id ??
          null,

        team:
          goal.team?.name ||
          "",

        scorerId:
          goal.scorer?.id ??
          null,

        scorer:
          goal.scorer?.name ||
          "",

        assistId:
          goal.assist?.id ??
          null,

        assist:
          goal.assist?.name ||
          "",

        scoreHome:
          goal.score?.home ??
          null,

        scoreAway:
          goal.score?.away ??
          null
      })
    );

  const bookings =
    (
      match.bookings ||
      []
    ).map(
      booking => ({

        minute:
          booking.minute ??
          null,

        injuryTime:
          booking.injuryTime ??
          null,

        minuteLabel:
          normalizeMinute(
            booking
          ),

        teamId:
          booking.team?.id ??
          null,

        team:
          booking.team?.name ||
          "",

        playerId:
          booking.player?.id ??
          null,

        player:
          booking.player?.name ||
          "",

        card:
          booking.card ||
          ""
      })
    );

  const substitutions =
    (
      match.substitutions ||
      []
    ).map(
      substitution => ({

        minute:
          substitution.minute ??
          null,

        injuryTime:
          substitution.injuryTime ??
          null,

        minuteLabel:
          normalizeMinute(
            substitution
          ),

        teamId:
          substitution.team?.id ??
          null,

        team:
          substitution.team?.name ||
          "",

        playerInId:
          substitution.playerIn?.id ??
          null,

        playerIn:
          substitution.playerIn?.name ||
          "",

        playerOutId:
          substitution.playerOut?.id ??
          null,

        playerOut:
          substitution.playerOut?.name ||
          ""
      })
    );

  return {

    id:
      match.id ??
      null,

    utcDate:
      match.utcDate ||
      null,

    date:
      formatDate(
        match.utcDate
      ),

    status:
      match.status ||
      "",

    minute:
      match.minute ??
      null,

    injuryTime:
      match.injuryTime ??
      null,

    venue:
      match.venue ||
      "",

    attendance:
      match.attendance ??
      null,

    matchday:
      match.matchday ??
      null,

    stage:
      match.stage ||
      null,

    competition:
      match.competition?.name ||
      "",

    competitionCode:
      match.competition?.code ||
      "",

    homeTeam: {

      id:
        home.id ??
        null,

      name:
        home.name ||
        "",

      shortName:
        home.shortName ||
        home.name ||
        "",

      crest:
        home.crest ||
        "",

      formation:
        home.formation ||
        null
    },

    awayTeam: {

      id:
        away.id ??
        null,

      name:
        away.name ||
        "",

      shortName:
        away.shortName ||
        away.name ||
        "",

      crest:
        away.crest ||
        "",

      formation:
        away.formation ||
        null
    },

    score:
      match.score ||
      {},

    goals:
      goals,

    bookings:
      bookings,

    substitutions:
      substitutions,

    lineups: {

      home:
        mapLineup(
          home
        ),

      away:
        mapLineup(
          away
        )
    },

    statistics: {

      home:
        home.statistics ||
        {},

      away:
        away.statistics ||
        {}
    },

    referees:
      match.referees ||
      []
  };
}


/* =========================================================
   BUNDESLIGA MATCHSTATISTIK
========================================================= */

function extractPair(
  text,
  regex
) {

  const match =
    text.match(
      regex
    );

  if (!match) {
    return null;
  }

  return [

    Number(
      String(
        match[1]
      ).replace(
        ",",
        "."
      )
    ),

    Number(
      String(
        match[2]
      ).replace(
        ",",
        "."
      )
    )

  ];
}


async function getBundesligaMatchStats(
  details
) {

  try {

    if (
      !details ||
      details.competitionCode !==
        "BL1"
    ) {

      return null;
    }

    if (
      !details.matchday ||
      !details.homeTeam?.name ||
      !details.awayTeam?.name
    ) {

      return null;
    }

    const homeSlug =
      slugify(
        details.homeTeam.name
      );

    const awaySlug =
      slugify(
        details.awayTeam.name
      );

    const url =
      `${BUNDESLIGA_BASE}/2026-2027/${details.matchday}/${homeSlug}-vs-${awaySlug}/stats`;

    const html =
      await httpsRequest(
        url
      );

    const text =
      stripHtml(
        html
      );

    if (
      !text
    ) {

      return null;
    }

    const result = {

      home:
        {},

      away:
        {},

      source:
        "Bundesliga.com / DFL"
    };

    let pair;


    pair =
      extractPair(
        text,
        /Ballbesitz\s*\(%\)\s*(\d+(?:[.,]\d+)?)\s*(\d+(?:[.,]\d+)?)/i
      );

    if (pair) {

      result.home.possession =
        pair[0];

      result.away.possession =
        pair[1];
    }


    pair =
      extractPair(
        text,
        /Ecken\s*(\d+)\s*(\d+)/i
      );

    if (pair) {

      result.home.cornerKicks =
        pair[0];

      result.away.cornerKicks =
        pair[1];
    }


    pair =
      extractPair(
        text,
        /Abseits\s*(\d+)\s*(\d+)/i
      );

    if (pair) {

      result.home.offsides =
        pair[0];

      result.away.offsides =
        pair[1];
    }


    pair =
      extractPair(
        text,
        /begangene Fouls\s*(\d+)\s*(\d+)/i
      );

    if (pair) {

      result.home.fouls =
        pair[0];

      result.away.fouls =
        pair[1];
    }


    pair =
      extractPair(
        text,
        /gewonnene Zweikämpfe\s*(\d+)\s*(\d+)/i
      );

    if (pair) {

      result.home.wonDuels =
        pair[0];

      result.away.wonDuels =
        pair[1];
    }


    const shots =
      text.match(
        /(\d+)\s+neben das Tor\s+(\d+)\s+auf das Tor\s+(\d+)\s+neben das Tor\s+(\d+)\s+auf das Tor/i
      );

    if (shots) {

      result.home.shotsOffGoal =
        Number(
          shots[1]
        );

      result.home.shotsOnGoal =
        Number(
          shots[2]
        );

      result.away.shotsOffGoal =
        Number(
          shots[3]
        );

      result.away.shotsOnGoal =
        Number(
          shots[4]
        );

      result.home.shots =
        result.home.shotsOffGoal +
        result.home.shotsOnGoal;

      result.away.shots =
        result.away.shotsOffGoal +
        result.away.shotsOnGoal;
    }


    const passes =
      text.match(
        /Pässe\s+(\d+)\s+(\d+)\s+(\d+(?:[.,]\d+)?)\s*%\s*Passquote\s+(\d+(?:[.,]\d+)?)\s*%/i
      );

    if (passes) {

      result.home.passes =
        Number(
          passes[1]
        );

      result.away.passes =
        Number(
          passes[2]
        );

      result.home.passAccuracy =
        Number(
          String(
            passes[3]
          ).replace(
            ",",
            "."
          )
        );

      result.away.passAccuracy =
        Number(
          String(
            passes[4]
          ).replace(
            ",",
            "."
          )
        );
    }


    const xg =
      text.match(
        /xGoals\s+(\d+(?:[.,]\d+)?)\s+(\d+(?:[.,]\d+)?)/i
      );

    if (xg) {

      result.home.xGoals =
        Number(
          String(
            xg[1]
          ).replace(
            ",",
            "."
          )
        );

      result.away.xGoals =
        Number(
          String(
            xg[2]
          ).replace(
            ",",
            "."
          )
        );
    }


    return result;

  } catch (error) {

    console.warn(
      "Bundesliga Matchstatistik nicht verfügbar:",
      error.message
    );

    return null;
  }
}


async function getMatchDetails(
  matchId
) {

  const id =
    String(
      matchId || ""
    ).trim();

  if (
    !/^\d+$/.test(id)
  ) {

    throw new Error(
      "Ungültige Spiel-ID"
    );
  }

  const cached =
    matchCache.get(
      id
    );

  if (
    cached &&
    Date.now() -
      cached.time <
      MATCH_CACHE_TIME
  ) {

    return cached.data;
  }

  const match =
    await apiRequest(
      `/matches/${id}`
    );

  const details =
    mapMatchDetails(
      match
    );

  const extraStats =
    await getBundesligaMatchStats(
      details
    );

  if (
    extraStats
  ) {

    details.statistics = {

      ...details.statistics,

      home: {

        ...details.statistics.home,

        ...extraStats.home
      },

      away: {

        ...details.statistics.away,

        ...extraStats.away
      },

      source:
        extraStats.source
    };
  }

  matchCache.set(
    id,
    {
      time:
        Date.now(),

      data:
        details
    }
  );

  return details;
}


/* =========================================================
   DASHBOARD CACHE
========================================================= */

async function getDashboard() {

  if (
    dashboardCache.data &&
    Date.now() -
      dashboardCache.time <
      CACHE_TIME
  ) {

    return dashboardCache.data;
  }

  try {

    const data =
      await buildDashboard();

    dashboardCache = {

      data,

      time:
        Date.now()
    };

    return data;

  } catch (error) {

    console.error(
      "Dashboard ERROR:",
      error
    );

    const fallbackSquad =
      CURRENT_SQUAD.map(
        player => ({

          ...player,

          appearances:
            0,

          goals:
            0,

          assists:
            0,

          minutes:
            0,

          photo:
            FALLBACK_PHOTOS[
              player.name
            ] ||
            ""
        })
      );

    return {

      updatedAt:
        new Date().toISOString(),

      news:
        [],

      nextGame:
        fallbackNextGame(),

      fixtures:
        [],

      results:
        [],

      championsLeague:
        [],

      table:
        [],

      squad:
        fallbackSquad,

      live:
        [],

      error:
        error.message,

      attribution:
        "Data provided by football-data.org"
    };
  }
}


/* =========================================================
   JSON
========================================================= */

function sendJSON(
  res,
  data,
  statusCode = 200
) {

  const body =
    JSON.stringify(
      data
    );

  res.writeHead(
    statusCode,
    {

      "Content-Type":
        "application/json; charset=utf-8",

      "Cache-Control":
        "no-store",

      "Access-Control-Allow-Origin":
        "*",

      "Access-Control-Allow-Methods":
        "GET, OPTIONS",

      "Access-Control-Allow-Headers":
        "Content-Type"
    }
  );

  res.end(
    body
  );
}


/* =========================================================
   DATEIEN
========================================================= */

function getMimeType(
  filePath
) {

  const ext =
    path.extname(
      filePath
    ).toLowerCase();

  const types = {

    ".html":
      "text/html; charset=utf-8",

    ".css":
      "text/css; charset=utf-8",

    ".js":
      "application/javascript; charset=utf-8",

    ".json":
      "application/json; charset=utf-8",

    ".png":
      "image/png",

    ".jpg":
      "image/jpeg",

    ".jpeg":
      "image/jpeg",

    ".webp":
      "image/webp",

    ".svg":
      "image/svg+xml",

    ".ico":
      "image/x-icon",

    ".txt":
      "text/plain; charset=utf-8"
  };

  return (
    types[ext] ||
    "application/octet-stream"
  );
}


function serveFile(
  res,
  requestedPath
) {

  const clean =
    requestedPath
      .replace(
        /^\/+/,
        ""
      );

  if (
    clean.includes(
      ".."
    )
  ) {

    res.writeHead(
      403
    );

    res.end(
      "Forbidden"
    );

    return;
  }

  const filePath =
    path.join(
      __dirname,
      clean
    );

  if (
    !fs.existsSync(
      filePath
    )
  ) {

    res.writeHead(
      404,
      {
        "Content-Type":
          "text/plain; charset=utf-8"
      }
    );

    res.end(
      "Nicht gefunden"
    );

    return;
  }

  const stat =
    fs.statSync(
      filePath
    );

  if (
    !stat.isFile()
  ) {

    res.writeHead(
      404
    );

    res.end(
      "Nicht gefunden"
    );

    return;
  }

  res.writeHead(
    200,
    {

      "Content-Type":
        getMimeType(
          filePath
        ),

      "Cache-Control":
        "public, max-age=300"
    }
  );

  fs.createReadStream(
    filePath
  ).pipe(
    res
  );
}


/* =========================================================
   SERVER
========================================================= */

const server =
  http.createServer(
    async (
      req,
      res
    ) => {

      try {

        if (
          req.method ===
          "OPTIONS"
        ) {

          res.writeHead(
            204,
            {

              "Access-Control-Allow-Origin":
                "*",

              "Access-Control-Allow-Methods":
                "GET, OPTIONS",

              "Access-Control-Allow-Headers":
                "Content-Type"
            }
          );

          res.end();

          return;
        }

        const requestUrl =
          new URL(
            req.url,
            `http://${req.headers.host || "localhost"}`
          );

        const pathname =
          requestUrl.pathname;


        /* =========================================
           HEALTH
        ========================================= */

        if (
          pathname ===
          "/health"
        ) {

          sendJSON(
            res,
            {

              status:
                "ok",

              apiConfigured:
                Boolean(
                  TOKEN
                ),

              rssConfigured:
                Boolean(
                  VFB_RSS_URL
                ),

              indexExists:
                fs.existsSync(
                  path.join(
                    __dirname,
                    "index.html"
                  )
                ),

              serverTime:
                new Date().toISOString()
            }
          );

          return;
        }


        /* =========================================
           DASHBOARD
        ========================================= */

        if (
          pathname ===
          "/api/dashboard"
        ) {

          const data =
            await getDashboard();

          sendJSON(
            res,
            data
          );

          return;
        }


        /* =========================================
           MATCHDETAILS
        ========================================= */

        const matchPath =
          pathname.match(
            /^\/api\/match\/(\d+)$/
          );

        if (
          matchPath
        ) {

          const details =
            await getMatchDetails(
              matchPath[1]
            );

          sendJSON(
            res,
            {

              success:
                true,

              match:
                details,

              attribution:
                "Data provided by football-data.org"
            }
          );

          return;
        }


        /* =========================================
           HOMEPAGE
        ========================================= */

        if (
          pathname === "/" ||
          pathname ===
            "/index.html"
        ) {

          serveFile(
            res,
            "index.html"
          );

          return;
        }


        /* =========================================
           STATISCHE DATEIEN
        ========================================= */

        if (
          !pathname.startsWith(
            "/api/"
          )
        ) {

          const safePath =
            pathname
              .replace(
                /^\/+/,
                ""
              );

          if (
            safePath &&
            !safePath.includes(
              ".."
            )
          ) {

            const filePath =
              path.join(
                __dirname,
                safePath
              );

            if (
              fs.existsSync(
                filePath
              ) &&
              fs.statSync(
                filePath
              ).isFile()
            ) {

              serveFile(
                res,
                safePath
              );

              return;
            }
          }

          serveFile(
            res,
            "index.html"
          );

          return;
        }


        /* =========================================
           404
        ========================================= */

        sendJSON(
          res,
          {
            error:
              "Nicht gefunden"
          },
          404
        );

      } catch (error) {

        console.error(
          "SERVER ERROR:",
          error
        );

        sendJSON(
          res,
          {

            error:
              error.message ||
              "Interner Serverfehler"

          },
          500
        );
      }
    }
  );


/* =========================================================
   SERVER START
========================================================= */

server.listen(
  PORT,
  "0.0.0.0",
  () => {

    console.log(
      "========================================"
    );

    console.log(
      "  CANNSTATT 1893 NEWS"
    );

    console.log(
      "========================================"
    );

    console.log(
      `Port: ${PORT}`
    );

    console.log(
      "Football-Data Token:",
      TOKEN
        ? "vorhanden"
        : "FEHLT"
    );

    console.log(
      "VfB RSS:",
      VFB_RSS_URL
    );

    console.log(
      "Index:",
      fs.existsSync(
        path.join(
          __dirname,
          "index.html"
        )
      )
        ? "vorhanden"
        : "FEHLT"
    );

    console.log(
      "========================================"
    );
  }
);
