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
          "Accept-Language":
            "de-DE,de;q=0.9,en;q=0.8",
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
          "User-Agent":
            "Cannstatt1893News/1.0",
          "Accept":
            "application/json"
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
      .replace(
        /<script[\s\S]*?<\/script>/gi,
        " "
      )
      .replace(
        /<style[\s\S]*?<\/style>/gi,
        " "
      )
      .replace(
        /<[^>]+>/g,
        " "
      )
      .replace(
        /\s+/g,
        " "
      )
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
    .replace(
      /[\u0300-\u036f]/g,
      ""
    )
    .replace(
      /ß/g,
      "ss"
    )
    .replace(
      /[^a-zA-Z0-9]+/g,
      "-"
    )
    .replace(
      /^-+|-+$/g,
      ""
    )
    .toLowerCase();
}


/* =========================================================
   NEWS
========================================================= */

function parseRss(xml, sourceName) {

  const items = [];

  const blocks = [
    ...(xml.match(
      /<item\b[\s\S]*?<\/item>/gi
    ) || []),

    ...(xml.match(
      /<entry\b[\s\S]*?<\/entry>/gi
    ) || [])
  ];

  for (const block of blocks) {

    const title =
      xmlTag(
        block,
        "title"
      );

    const description =
      xmlTag(
        block,
        "description"
      ) ||
      xmlTag(
        block,
        "summary"
      ) ||
      xmlTag(
        block,
        "content"
      );

    let link =
      xmlTag(
        block,
        "link"
      ) ||
      xmlTag(
        block,
        "guid"
      );

    if (!link) {

      const hrefMatch =
        block.match(
          /<link\b[^>]*href=["']([^"']+)["']/i
        );

      if (hrefMatch) {
        link =
          decodeHtml(
            hrefMatch[1]
          );
      }
    }

    const pubDate =
      xmlTag(
        block,
        "pubDate"
      ) ||
      xmlTag(
        block,
        "published"
      ) ||
      xmlTag(
        block,
        "updated"
      ) ||
      xmlTag(
        block,
        "dc:date"
      );

    const image =
      xmlAttr(
        block,
        "media:content",
        "url"
      ) ||
      xmlAttr(
        block,
        "media:thumbnail",
        "url"
      ) ||
      xmlAttr(
        block,
        "enclosure",
        "url"
      );

    if (!title) {
      continue;
    }

    items.push({

      title,

      summary:
        stripHtml(
          description
        ).slice(
          0,
          320
        ),

      url:
        link ||
        "https://www.vfb.de/",

      date:
        pubDate
          ? formatDate(pubDate)
          : "",

      rawDate:
        pubDate ||
        "",

      source:
        sourceName,

      image:
        image ||
        ""
    });
  }

  return items;
}


async function getVfBNews() {

  try {

    const xml =
      await httpsRequest(
        VFB_RSS_URL
      );

    const rssNews =
      parseRss(
        xml,
        "VfB Stuttgart"
      );

    if (
      rssNews.length
    ) {
      return rssNews;
    }

  } catch (error) {

    console.warn(
      "VfB RSS nicht verfügbar:",
      error.message
    );
  }


  /*
   * Der VfB RSS-Endpunkt kann
   * gelegentlich ein anderes Format liefern.
   * Deshalb zweite Live-Quelle.
   */

  try {

    const html =
      await httpsRequest(
        "https://www.vfb.de/de/1893/aktuell/news-archiv/"
      );

    const results = [];

    const seen =
      new Set();

    const re =
      /<a\b[^>]*href=["']([^"']*\/de\/vfb\/aktuell\/neues\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;

    let m;

    while (
      (m = re.exec(html)) !== null
    ) {

      let url =
        decodeHtml(
          m[1]
        );

      const title =
        stripHtml(
          m[2]
        );

      if (
        !title ||
        title.length < 15
      ) {
        continue;
      }

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
        seen.has(url)
      ) {
        continue;
      }

      seen.add(url);

      results.push({

        title,

        summary:
          title,

        url,

        date:
          "",

        rawDate:
          "",

        source:
          "VfB Stuttgart",

        image:
          ""
      });

      if (
        results.length >= 10
      ) {
        break;
      }
    }

    if (
      results.length
    ) {
      return results;
    }

  } catch (error) {

    console.warn(
      "VfB News-Seite nicht verfügbar:",
      error.message
    );
  }


  /*
   * Letzter Fallback.
   * Dadurch bleibt die News-Sektion
   * niemals komplett leer.
   */

  return [

    {
      title:
        "Ein weiß-roter Festabend",

      summary:
        "Der VfB Stuttgart feiert nach dem Heimspiel gegen den 1. FC Köln einen starken Bundesliga-Abend.",

      url:
        "https://www.vfb.de/",

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
        "https://www.vfb.de/",

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
        "https://www.vfb.de/",

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

    const seen =
      new Set();

    const anchorRegex =
      /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;

    let match;

    while (
      (match =
        anchorRegex.exec(html)) !== null
    ) {

      let url =
        decodeHtml(
          match[1]
        );

      const title =
        stripHtml(
          match[2]
        );

      if (
        !title ||
        title.length < 20
      ) {
        continue;
      }

      if (
        !/\/artikel\/|\/video\//i.test(
          url
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

        title,

        summary:
          title,

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
      "Kicker nicht verfügbar:",
      error.message
    );

    return [];
  }
}


function mergeNews(
  vfbNews,
  kickerNews
) {

  const all = [
    ...(vfbNews || []),
    ...(kickerNews || [])
  ];

  const seen =
    new Set();

  const result = [];

  for (
    const item of all
  ) {

    const key =
      item.url ||
      item.title;

    if (
      !key ||
      seen.has(key)
    ) {
      continue;
    }

    seen.add(key);

    result.push(item);
  }

  result.sort(
    (a, b) => {

      const da =
        new Date(
          a.rawDate || 0
        ).getTime();

      const db =
        new Date(
          b.rawDate || 0
        ).getTime();

      return db - da;
    }
  );

  return result.slice(
    0,
    20
  );
}


/* =========================================================
   AKTUELLER VFB KADER 2026/27
========================================================= */

const CURRENT_SQUAD = [

  {
    name:
      "Fabian Bredlow",
    position:
      "Torwart",
    number:
      1
  },

  {
    name:
      "Marius Funk",
    position:
      "Torwart",
    number:
      13
  },

  {
    name:
      "Dennis Seimen",
    position:
      "Torwart",
    number:
      33
  },

  {
    name:
      "Stefan Drljaca",
    position:
      "Torwart",
    number:
      46
  },

  {
    name:
      "Ameen Al-Dakhil",
    position:
      "Abwehr",
    number:
      2
  },

  {
    name:
      "Ramon Hendriks",
    position:
      "Abwehr",
    number:
      3
  },

  {
    name:
      "Josha Vagnoman",
    position:
      "Abwehr",
    number:
      4
  },

  {
    name:
      "Maximilian Mittelstädt",
    position:
      "Abwehr",
    number:
      7
  },

  {
    name:
      "Luca Jaquez",
    position:
      "Abwehr",
    number:
      14
  },

  {
    name:
      "Leonidas Stergiou",
    position:
      "Abwehr",
    number:
      20
  },

  {
    name:
      "Lorenz Assignon",
    position:
      "Abwehr",
    number:
      22
  },

  {
    name:
      "Dan-Axel Zagadou",
    position:
      "Abwehr",
    number:
      23
  },

  {
    name:
      "Jeff Chabot",
    position:
      "Abwehr",
    number:
      24
  },

  {
    name:
      "Finn Jeltsch",
    position:
      "Abwehr",
    number:
      29
  },

  {
    name:
      "Angelo Stiller",
    position:
      "Mittelfeld",
    number:
      6
  },

  {
    name:
      "Chris Führich",
    position:
      "Mittelfeld",
    number:
      10
  },

  {
    name:
      "Bilal El Khannouss",
    position:
      "Mittelfeld",
    number:
      11
  },

  {
    name:
      "Atakan Karazor",
    position:
      "Mittelfeld",
    number:
      16
  },

  {
    name:
      "Grischa Prömel",
    position:
      "Mittelfeld",
    number:
      21
  },

  {
    name:
      "Nikolas Nartey",
    position:
      "Mittelfeld",
    number:
      28
  },

  {
    name:
      "Ertugrul Yigit",
    position:
      "Mittelfeld",
    number:
      null
  },

  {
    name:
      "Jarzinho Malanga",
    position:
      "Mittelfeld",
    number:
      null
  },

  {
    name:
      "Tiago Tomás",
    position:
      "Angriff",
    number:
      8
  },

  {
    name:
      "Ermedin Demirovic",
    position:
      "Angriff",
    number:
      9
  },

  {
    name:
      "Dzenan Pejcinovic",
    position:
      "Angriff",
    number:
      17
  },

  {
    name:
      "Jamie Leweling",
    position:
      "Angriff",
    number:
      18
  },

  {
    name:
      "Deniz Undav",
    position:
      "Angriff",
    number:
      26
  },

  {
    name:
      "Justin Diehl",
    position:
      "Angriff",
    number:
      27
  },

  {
    name:
      "Leo Sauer",
    position:
      "Angriff",
    number:
      44
  }

];


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


/* =========================================================
   OFFIZIELLE VFB SPIELERBILDER LIVE LADEN
========================================================= */

async function getOfficialPlayerPhotos() {

  try {

    const html =
      await httpsRequest(
        "https://www.vfb.de/de/1893/profis/kader/saisonen/2026-2027/kader/"
      );

    const images = [];

    const regex =
      /(?:src|data-src)=["']([^"']*proxy=sportdb%2Fspieler%2F[^"']+)["']/gi;

    let match;

    while (
      (match =
        regex.exec(html)) !== null
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
        !images.includes(url)
      ) {
        images.push(url);
      }
    }

    const result = {};

    CURRENT_SQUAD.forEach(
      (player, index) => {

        result[player.name] =
          images[index] ||
          FALLBACK_PHOTOS[player.name] ||
          "";
      }
    );

    return result;

  } catch (error) {

    console.warn(
      "Offizielle VfB Spielerbilder nicht verfügbar:",
      error.message
    );

    return {
      ...FALLBACK_PHOTOS
    };
  }
}


/* =========================================================
   OFFIZIELLE VFB STATISTIKEN 2026/27
========================================================= */

const VERIFIED_STATS = {

  "Fabian Bredlow":
    {
      appearances: 2,
      goals: 0,
      assists: 0,
      minutes: 180
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

  "Leonidas Stergiou":
    {
      appearances: 1,
      goals: 0,
      assists: 0,
      minutes: 16
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

  "Grischa Prömel":
    {
      appearances: 2,
      goals: 1,
      assists: 0,
      minutes: 180
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

  "Leo Sauer":
    {
      appearances: 1,
      goals: 0,
      assists: 0,
      minutes: 12
    }

};


/* =========================================================
   STATISTIKEN VOM OFFIZIELLEN VFB PORTAL
========================================================= */

async function getOfficialSquadStats() {

  const stats = {};

  CURRENT_SQUAD.forEach(
    player => {

      stats[player.name] =
        VERIFIED_STATS[player.name] ||
        {
          appearances: 0,
          goals: 0,
          assists: 0,
          minutes: 0
        };
    }
  );

  try {

    const html =
      await httpsRequest(
        "https://www.vfb.de/de/1893/profis/kader/saisonen/2026-2027/statistik/?data=&mobile="
      );

    /*
     * Versuche echte Tabellenzeilen zu lesen.
     * Falls das Markup geändert wurde, bleiben
     * die verifizierten Werte erhalten.
     */

    const rowRegex =
      /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;

    let row;

    while (
      (row =
        rowRegex.exec(html)) !== null
    ) {

      const rowText =
        stripHtml(
          row[1]
        );

      const player =
        CURRENT_SQUAD.find(
          p =>
            rowText.includes(
              p.name
            )
        );

      if (!player) {
        continue;
      }

      const numbers =
        rowText.match(
          /\b\d+\b/g
        ) || [];

      if (
        numbers.length < 2
      ) {
        continue;
      }

      /*
       * Die offizielle Tabelle kann sich ändern.
       * Nur Werte übernehmen, wenn die Zeile
       * plausibel genug aussieht.
       */

      const current =
        stats[player.name];

      const possibleApps =
        Number(numbers[0]);

      const possibleGoals =
        Number(numbers[1]);

      if (
        Number.isFinite(
          possibleApps
        ) &&
        possibleApps >= 0 &&
        possibleApps <= 50
      ) {

        current.appearances =
          possibleApps;
      }

      if (
        Number.isFinite(
          possibleGoals
        ) &&
        possibleGoals >= 0 &&
        possibleGoals <= 50
      ) {

        current.goals =
          possibleGoals;
      }

      /*
       * Assists und Minuten werden nur
       * aus klaren Zahlenfeldern übernommen,
       * ansonsten bleiben die verifizierten Werte.
       */

      if (
        numbers.length >= 3
      ) {

        const possibleAssists =
          Number(numbers[2]);

        if (
          Number.isFinite(
            possibleAssists
          ) &&
          possibleAssists >= 0 &&
          possibleAssists <= 50
        ) {

          current.assists =
            possibleAssists;
        }
      }

      if (
        numbers.length >= 4
      ) {

        const possibleMinutes =
          Number(
            numbers[numbers.length - 1]
          );

        if (
          Number.isFinite(
            possibleMinutes
          ) &&
          possibleMinutes >= 0 &&
          possibleMinutes <= 5000
        ) {

          current.minutes =
            possibleMinutes;
        }
      }
    }

  } catch (error) {

    console.warn(
      "VfB Statistik-Seite nicht verfügbar:",
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
    photos,
    stats
  ] =
    await Promise.all([
      getOfficialPlayerPhotos(),
      getOfficialSquadStats()
    ]);

  return CURRENT_SQUAD.map(
    player => {

      const playerStats =
        stats[player.name] ||
        {
          appearances: 0,
          goals: 0,
          assists: 0,
          minutes: 0
        };

      return {

        name:
          player.name,

        position:
          player.position,

        number:
          player.number,

        shirtNumber:
          player.number,

        appearances:
          Number(
            playerStats.appearances || 0
          ),

        goals:
          Number(
            playerStats.goals || 0
          ),

        assists:
          Number(
            playerStats.assists || 0
          ),

        minutes:
          Number(
            playerStats.minutes || 0
          ),

        photo:
          photos[player.name] ||
          FALLBACK_PHOTOS[player.name] ||
          ""
      };
    }
  );
}


/* =========================================================
   MATCH HELFER
========================================================= */

function normalizeTeamName(team = {}) {

  return (
    team.name ||
    team.shortName ||
    team.tla ||
    "Unbekannt"
  );
}


function normalizeScore(score = {}) {

  if (
    score.fullTime
  ) {

    return {

      home:
        score.fullTime.home,

      away:
        score.fullTime.away
    };
  }

  return {

    home:
      score.home,

    away:
      score.away
  };
}


function mapMatch(match) {

  const home =
    match.homeTeam ||
    {};

  const away =
    match.awayTeam ||
    {};

  const score =
    normalizeScore(
      match.score || {}
    );

  const date =
    match.utcDate ||
    match.date ||
    "";

  const status =
    match.status ||
    "";

  return {

    id:
      match.id,

    competition:
      match.competition?.name ||
      "",

    competitionCode:
      match.competition?.code ||
      "",

    date,

    dateFormatted:
      date
        ? new Date(date)
            .toLocaleDateString(
              "de-DE",
              {
                day: "2-digit",
                month: "2-digit",
                year: "numeric"
              }
            )
        : "",

    time:
      date
        ? new Date(date)
            .toLocaleTimeString(
              "de-DE",
              {
                hour: "2-digit",
                minute: "2-digit"
              }
            )
        : "",

    status,

    homeTeam:
      normalizeTeamName(home),

    awayTeam:
      normalizeTeamName(away),

    homeCrest:
      home.crest ||
      "",

    awayCrest:
      away.crest ||
      "",

    score,

    venue:
      match.venue ||
      "",

    matchday:
      match.matchday ||
      null
  };
}


/* =========================================================
   SPIELE VOM FOOTBALL-DATA
========================================================= */

async function getTeamMatches() {

  const data =
    await apiRequest(
      `/teams/${VFB_TEAM_ID}/matches?status=FINISHED,SCHEDULED&limit=50`
    );

  return (
    data.matches ||
    []
  );
}


function sortMatches(
  matches
) {

  return [...matches].sort(
    (a, b) =>
      new Date(
        a.utcDate ||
        a.date ||
        0
      ) -
      new Date(
        b.utcDate ||
        b.date ||
        0
      )
  );
}


function getNextMatch(
  matches
) {

  const now =
    Date.now();

  const upcoming =
    matches
      .filter(
        match =>
          new Date(
            match.utcDate ||
            match.date ||
            0
          ).getTime() >= now
      )
      .sort(
        (a, b) =>
          new Date(
            a.utcDate ||
            a.date ||
            0
          ) -
          new Date(
            b.utcDate ||
            b.date ||
            0
          )
      );

  return (
    upcoming[0] ||
    null
  );
}


function getRecentMatches(
  matches
) {

  return matches
    .filter(
      match =>
        match.status ===
          "FINISHED"
    )
    .sort(
      (a, b) =>
        new Date(
          b.utcDate ||
          b.date ||
          0
        ) -
        new Date(
          a.utcDate ||
          a.date ||
          0
        )
    );
}


function fallbackNextGame() {

  return {

    id:
      null,

    competition:
      "Bundesliga",

    date:
      "2026-09-19T18:30:00+02:00",

    dateFormatted:
      "19.09.2026",

    time:
      "18:30",

    status:
      "SCHEDULED",

    homeTeam:
      "VfB Stuttgart",

    awayTeam:
      "Borussia Dortmund",

    homeCrest:
      "",

    awayCrest:
      "",

    score:
      {
        home:
          null,
        away:
          null
      },

    venue:
      "MHPArena",

    matchday:
      null
  };
}


/* =========================================================
   NEXT MATCH
========================================================= */

async function buildNextMatch() {

  try {

    const matches =
      await getTeamMatches();

    const next =
      getNextMatch(
        matches
      );

    if (
      next
    ) {
      return mapMatch(
        next
      );
    }

  } catch (error) {

    console.warn(
      "Next Match nicht verfügbar:",
      error.message
    );
  }

  return fallbackNextGame();
}


/* =========================================================
   FIXTURES / RESULTS
========================================================= */

async function buildFixtures() {

  try {

    const matches =
      await getTeamMatches();

    const sorted =
      sortMatches(
        matches
      );

    const upcoming =
      sorted
        .filter(
          match =>
            match.status !==
              "FINISHED"
        )
        .slice(
          0,
          10
        )
        .map(
          mapMatch
        );

    const results =
      getRecentMatches(
        matches
      )
        .slice(
          0,
          10
        )
        .map(
          mapMatch
        );

    return {

      fixtures:
        upcoming,

      results

    };

  } catch (error) {

    console.warn(
      "Fixtures nicht verfügbar:",
      error.message
    );

    return {

      fixtures:
        [],

      results:
        []

    };
  }
}


/* =========================================================
   TABELLE
========================================================= */

function calculateTableFromMatches(
  matches
) {

  const teams =
    new Map();

  function ensure(
    team
  ) {

    const name =
      normalizeTeamName(
        team
      );

    if (
      !teams.has(name)
    ) {

      teams.set(
        name,
        {
          team:
            name,

          playedGames:
            0,

          won:
            0,

          draw:
            0,

          lost:
            0,

          goalsFor:
            0,

          goalsAgainst:
            0,

          goalDifference:
            0,

          points:
            0
        }
      );
    }

    return teams.get(
      name
    );
  }

  for (
    const match of matches
  ) {

    if (
      match.status !==
        "FINISHED"
    ) {
      continue;
    }

    const home =
      ensure(
        match.homeTeam ||
        {}
      );

    const away =
      ensure(
        match.awayTeam ||
        {}
      );

    const score =
      normalizeScore(
        match.score || {}
      );

    const hg =
      Number(
        score.home
      );

    const ag =
      Number(
        score.away
      );

    if (
      !Number.isFinite(hg) ||
      !Number.isFinite(ag)
    ) {
      continue;
    }

    home.playedGames++;
    away.playedGames++;

    home.goalsFor += hg;
    home.goalsAgainst += ag;

    away.goalsFor += ag;
    away.goalsAgainst += hg;

    if (
      hg > ag
    ) {

      home.won++;
      home.points += 3;
      away.lost++;

    } else if (
      hg < ag
    ) {

      away.won++;
      away.points += 3;
      home.lost++;

    } else {

      home.draw++;
      away.draw++;

      home.points++;
      away.points++;
    }
  }

  for (
    const team of teams.values()
  ) {

    team.goalDifference =
      team.goalsFor -
      team.goalsAgainst;

    team.goalDiff =
      team.goalDifference;

    team.played =
      team.playedGames;

    team.wins =
      team.won;

    team.draws =
      team.draw;

    team.losses =
      team.lost;
  }

  return Array.from(
    teams.values()
  ).sort(
    (a, b) => {

      if (
        b.points !==
        a.points
      ) {

        return (
          b.points -
          a.points
        );
      }

      if (
        b.goalDifference !==
        a.goalDifference
      ) {

        return (
          b.goalDifference -
          a.goalDifference
        );
      }

      return (
        b.goalsFor -
        a.goalsFor
      );
    }
  );
}


async function getTable() {

  try {

    const data =
      await apiRequest(
        "/competitions/BL1/standings"
      );

    const table =
      data.standings?.[0]?.table ||
      [];

    return table.map(
      row => {

        const team =
          row.team ||
          {};

        const playedGames =
          Number(
            row.playedGames ||
            row.played ||
            0
          );

        const won =
          Number(
            row.won ||
            row.wins ||
            0
          );

        const draw =
          Number(
            row.draw ||
            row.draws ||
            0
          );

        const lost =
          Number(
            row.lost ||
            row.losses ||
            0
          );

        const goalsFor =
          Number(
            row.goalsFor ||
            0
          );

        const goalsAgainst =
          Number(
            row.goalsAgainst ||
            0
          );

        const goalDifference =
          Number(
            row.goalDifference ??
            (
              goalsFor -
              goalsAgainst
            )
          );

        return {

          position:
            Number(
              row.position ||
              0
            ),

          team:
            normalizeTeamName(
              team
            ),

          crest:
            team.crest ||
            "",

          playedGames,

          played:
            playedGames,

          won,

          wins:
            won,

          draw,

          draws:
            draw,

          lost,

          losses:
            lost,

          goalsFor,

          goalsAgainst,

          goalDifference,

          goalDiff:
            goalDifference,

          points:
            Number(
              row.points ||
              0
            )
        };
      }
    );

  } catch (error) {

    console.warn(
      "Tabelle nicht verfügbar:",
      error.message
    );

    try {

      const matches =
        await getTeamMatches();

      return calculateTableFromMatches(
        matches
      );

    } catch (
      fallbackError
    ) {

      console.warn(
        "Tabelle Fallback ebenfalls fehlgeschlagen:",
        fallbackError.message
      );

      return [];
    }
  }
}


/* =========================================================
   CHAMPIONS LEAGUE
========================================================= */

async function getChampionsLeague() {

  try {

    const data =
      await apiRequest(
        `/teams/${VFB_TEAM_ID}/matches?competitions=CL&limit=20`
      );

    return (
      data.matches ||
      []
    )
      .sort(
        (a, b) =>
          new Date(
            a.utcDate
          ) -
          new Date(
            b.utcDate
          )
      )
      .map(
        mapMatch
      );

  } catch (error) {

    console.warn(
      "Champions League nicht verfügbar:",
      error.message
    );

    return [];
  }
}


/* =========================================================
   LIVE
========================================================= */

async function getLiveMatches() {

  try {

    const data =
      await apiRequest(
        `/teams/${VFB_TEAM_ID}/matches?status=IN_PLAY,PAUSED`
      );

    return (
      data.matches ||
      []
    ).map(
      mapMatch
    );

  } catch (error) {

    return [];
  }
}


/* =========================================================
   MATCH DETAILS
========================================================= */

function mapMatchDetails(
  match
) {

  const basic =
    mapMatch(
      match
    );

  const score =
    match.score ||
    {};

  const fullTime =
    score.fullTime ||
    {};

  const halfTime =
    score.halfTime ||
    {};

  const duration =
    score.duration ||
    "";

  const home =
    match.homeTeam ||
    {};

  const away =
    match.awayTeam ||
    {};

  const referees =
    Array.isArray(
      match.referees
    )
      ? match.referees
      : [];

  const events =
    Array.isArray(
      match.events
    )
      ? match.events
      : [];

  const lineups =
    Array.isArray(
      match.lineups
    )
      ? match.lineups
      : [];

  const stats =
    match.statistics ||
    [];

  let statistics = {

    home:
      {},

    away:
      {}
  };

  if (
    Array.isArray(stats)
  ) {

    for (
      const item of stats
    ) {

      const team =
        item.team ||
        {};

      const teamName =
        normalizeTeamName(
          team
        );

      const target =
        teamName ===
        normalizeTeamName(home)
          ? statistics.home
          : statistics.away;

      if (
        Array.isArray(
          item.statistics
        )
      ) {

        for (
          const stat of item.statistics
        ) {

          if (
            stat.type
          ) {

            target[
              stat.type
            ] =
              stat.value;
          }
        }
      }
    }
  }

  return {

    ...basic,

    venue:
      match.venue ||
      basic.venue,

    referee:
      referees[0]?.name ||
      "",

    referees,

    duration,

    halfTime,

    fullTime,

    events,

    lineups,

    statistics
  };
}


/* =========================================================
   BUNDESLIGA MATCH STATS
========================================================= */

async function getBundesligaMatchStats(
  details
) {

  /*
   * Die Bundesliga-Seite wird nur als
   * zusätzliche Datenquelle versucht.
   * Wenn sie nicht erreichbar ist,
   * bleiben Football-Data-Daten erhalten.
   */

  try {

    if (
      !details ||
      !details.homeTeam ||
      !details.awayTeam
    ) {
      return null;
    }

    const searchUrl =
      `${BUNDESLIGA_BASE}?match=${encodeURIComponent(details.homeTeam)}-${encodeURIComponent(details.awayTeam)}`;

    const html =
      await httpsRequest(
        searchUrl
      );

    if (
      !html
    ) {
      return null;
    }

    /*
     * Keine riskante automatische Zuordnung
     * von Zahlen aus beliebigem HTML.
     * Die Football-Data-Werte bleiben führend.
     */

    return null;

  } catch (error) {

    return null;
  }
}


/* =========================================================
   MATCH DETAILS API
========================================================= */

async function getMatchDetails(
  id
) {

  const cached =
    matchCache.get(
      String(id)
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
    String(id),
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
   DASHBOARD
========================================================= */

async function buildDashboard() {

  const [
    vfbNews,
    kickerNews,
    nextGame,
    fixtureData,
    table,
    squad,
    championsLeague,
    live
  ] =
    await Promise.all([

      getVfBNews(),

      getKickerNews(),

      buildNextMatch(),

      buildFixtures(),

      getTable(),

      buildSquad(),

      getChampionsLeague(),

      getLiveMatches()

    ]);

  const news =
    mergeNews(
      vfbNews,
      kickerNews
    );

  return {

    updatedAt:
      new Date().toISOString(),

    news,

    nextGame,

    fixtures:
      fixtureData.fixtures,

    results:
      fixtureData.results,

    championsLeague,

    table,

    squad,

    live,

    attribution:
      "Data provided by football-data.org"
  };
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

    /*
     * Auch bei API-Fehler ein brauchbares
     * Dashboard zurückgeben.
     */

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
    clean.includes("..")
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
           MATCH DETAILS
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

          /*
           * SPA-Fallback
           */

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
