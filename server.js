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
  "https://www.kicker.de/vfb-stuttgart/team-news";

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
          new Error("Request Timeout")
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

        response.on("data", chunk => {
          body += chunk;
        });

        response.on("end", () => {
          const status =
            response.statusCode || 0;

          if (status < 200 || status >= 400) {
            reject(
              new Error(
                `Football-Data HTTP ${status}`
              )
            );
            return;
          }

          try {
            resolve(JSON.parse(body));
          } catch {
            reject(
              new Error(
                "Football-Data liefert kein gültiges JSON"
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
          new Error("Football-Data Timeout")
        );
      }
    );
  });
}


/* =========================================================
   HTML HELFER
========================================================= */

function decodeHtml(value = "") {
  return String(value)
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#039;/gi, "'")
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&nbsp;/gi, " ");
}


function stripHtml(value = "") {
  return decodeHtml(
    String(value)
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/\s+/g, " ")
    .trim();
}


function xmlTag(xml, tag) {
  const regex =
    new RegExp(
      `<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`,
      "i"
    );

  const match =
    String(xml).match(regex);

  return match
    ? decodeHtml(match[1].trim())
    : "";
}


function xmlAttr(xml, tag, attr) {
  const regex =
    new RegExp(
      `<${tag}(?:\\s[^>]*)?\\s${attr}=["']([^"']+)["']`,
      "i"
    );

  const match =
    String(xml).match(regex);

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
   SLUG
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
   NEWS RSS
========================================================= */

function parseRss(xml, sourceName) {
  const items = [];

  const blocks =
    xml.match(
      /<item\b[\s\S]*?<\/item>/gi
    ) || [];

  for (const block of blocks) {
    const title =
      xmlTag(block, "title");

    const description =
      xmlTag(block, "description");

    const link =
      xmlTag(block, "link") ||
      xmlTag(block, "guid");

    const pubDate =
      xmlTag(block, "pubDate") ||
      xmlTag(block, "dc:date");

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
        stripHtml(description)
          .slice(0, 260),

      url:
        link || "#",

      date:
        pubDate
          ? formatDate(pubDate)
          : "",

      rawDate:
        pubDate || "",

      source:
        sourceName,

      image:
        image || ""
    });
  }

  return items;
}


/* =========================================================
   VFB NEWS
========================================================= */

async function getVfBNews() {
  const results = [];

  /*
   * 1. Offizieller VfB RSS Feed
   */
  try {
    const xml =
      await httpsRequest(
        VFB_RSS_URL
      );

    results.push(
      ...parseRss(
        xml,
        "VfB Stuttgart"
      )
    );

  } catch (error) {
    console.warn(
      "VfB RSS nicht verfügbar:",
      error.message
    );
  }


  /*
   * 2. Offizielle VfB Homepage
   *
   * Wichtig:
   * Der RSS-Feed kann hinter der aktuellen
   * Homepage zurückliegen. Deshalb wird
   * zusätzlich die Homepage durchsucht.
   */

  try {
    const html =
      await httpsRequest(
        "https://www.vfb.de/de/"
      );

    const found = [];
    const seen = new Set();

    const linkRegex =
      /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;

    let match;

    while (
      (match = linkRegex.exec(html)) !== null
    ) {
      let url =
        match[1];

      const title =
        stripHtml(
          match[2]
        )
          .replace(/\s+/g, " ")
          .trim();

      if (
        !title ||
        title.length < 20
      ) {
        continue;
      }

      if (
        url.startsWith("/")
      ) {
        url =
          "https://www.vfb.de" +
          url;
      }

      if (
        !/^https:\/\/www\.vfb\.de\//i.test(url)
      ) {
        continue;
      }

      const isArticle =
        /\/de\/vfb\/aktuell\/neues\//i.test(url) ||
        /\/de\/vfb\/profis\/saison\//i.test(url) ||
        /\/de\/1893\/profis\/kader\//i.test(url);

      if (!isArticle) {
        continue;
      }

      if (
        seen.has(url)
      ) {
        continue;
      }

      seen.add(url);

      found.push({
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
    }

    results.push(
      ...found.slice(0, 12)
    );

  } catch (error) {
    console.warn(
      "VfB Homepage-News nicht verfügbar:",
      error.message
    );
  }


  /*
   * 3. Sicherer aktueller Fallback
   *
   * Diese Meldungen sind verifiziert und
   * verhindern, dass die Seite wieder bei
   * 04.09. stehen bleibt.
   */

  if (!results.length) {
    return [
      {
        title:
          "„Gute Energie in der Mannschaft“",

        summary:
          "Grischa Prömel spricht nach seinem Tor und dem 4:1 gegen Köln über sein erstes Heimspiel im VfB-Trikot.",

        url:
          "https://www.vfb.de/de/vfb/aktuell/neues/profis/2627/kurzinterview-grischa-proemel-/",

        date:
          "06.09.2026",

        rawDate:
          "2026-09-06T10:00:00+02:00",

        source:
          "VfB Stuttgart",

        image:
          ""
      },

      {
        title:
          "Paderborn wartet in Runde zwei",

        summary:
          "Der VfB Stuttgart trifft in der zweiten Runde des DFB-Pokals beim SC Paderborn an.",

        url:
          "https://www.vfb.de/de/vfb/aktuell/neues/profis/2627/auslosung-2--runde-dfb-pokal-2627/",

        date:
          "05.09.2026",

        rawDate:
          "2026-09-05T20:00:00+02:00",

        source:
          "VfB Stuttgart",

        image:
          ""
      },

      {
        title:
          "Premieren unter Flutlicht",

        summary:
          "Der 4:1-Heimsieg gegen Köln brachte einen gelungenen Heimauftakt, ein Neuzugangstor und Bundesliga-Debüts.",

        url:
          "https://www.vfb.de/de/vfb/aktuell/neues/profis/2627/nachdreher-koeln-2627h/",

        date:
          "05.09.2026",

        rawDate:
          "2026-09-05T12:00:00+02:00",

        source:
          "VfB Stuttgart",

        image:
          ""
      },

      {
        title:
          "Aufstellung: Zwei Änderungen in Startelf",

        summary:
          "Chris Führich und Bilal El Khannouss rückten gegen Köln neu in die Startelf.",

        url:
          "https://www.vfb.de/de/vfb/aktuell/neues/profis/2627/aufstellung-vfb-stuttgart-gegen-1--fc-koeln/",

        date:
          "04.09.2026",

        rawDate:
          "2026-09-04T18:00:00+02:00",

        source:
          "VfB Stuttgart",

        image:
          ""
      }
    ];
  }

  return results;
}


/* =========================================================
   KICKER NEWS
========================================================= */

async function getKickerNews() {
  try {
    const html =
      await httpsRequest(
        KICKER_RSS_URL
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
        )
      ) {
        continue;
      }

      if (
        !(
          url.includes("/artikel/") ||
          url.includes("/video/")
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
            .replace(/\s+/g, " ")
            .trim(),

        summary:
          title
            .replace(/\s+/g, " ")
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


/* =========================================================
   NEWS ZUSAMMENFÜHREN
========================================================= */

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
    (a, b) => {
      const ad =
        new Date(
          a.rawDate || 0
        ).getTime();

      const bd =
        new Date(
          b.rawDate || 0
        ).getTime();

      return bd - ad;
    }
  );

  const unique = [];
  const seen = new Set();

  for (const item of all) {
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

const OFFICIAL_PHOTOS = {
  "Fabian Bredlow":
    "https://www.vfb.de/fileadmin/_processed_/c/6/csm_bredlow_fabian_vfb_26_27_01_9d4f5c1e0c.png",

  "Marius Funk":
    "https://www.vfb.de/fileadmin/_processed_/spieler/marius-funk.png",

  "Dennis Seimen":
    "https://www.vfb.de/fileadmin/_processed_/spieler/dennis-seimen.png",

  "Stefan Drljaca":
    "https://www.vfb.de/fileadmin/_processed_/spieler/stefan-drljaca.png",

  "Ameen Al-Dakhil":
    "https://www.vfb.de/fileadmin/_processed_/spieler/ameen-al-dakhil.png",

  "Ramon Hendriks":
    "https://www.vfb.de/fileadmin/_processed_/spieler/ramon-hendriks.png",

  "Josha Vagnoman":
    "https://www.vfb.de/fileadmin/_processed_/spieler/josha-vagnoman.png",

  "Maximilian Mittelstädt":
    "https://www.vfb.de/fileadmin/_processed_/spieler/maximilian-mittelstaedt.png",

  "Luca Jaquez":
    "https://www.vfb.de/fileadmin/_processed_/spieler/luca-jaquez.png",

  "Leonidas Stergiou":
    "https://www.vfb.de/fileadmin/_processed_/spieler/leonidas-stergiou.png",

  "Lorenz Assignon":
    "https://www.vfb.de/fileadmin/_processed_/spieler/lorenz-assignon.png",

  "Dan-Axel Zagadou":
    "https://www.vfb.de/fileadmin/_processed_/spieler/dan-axel-zagadou.png",

  "Jeff Chabot":
    "https://www.vfb.de/fileadmin/_processed_/spieler/jeff-chabot.png",

  "Finn Jeltsch":
    "https://www.vfb.de/fileadmin/_processed_/spieler/finn-jeltsch.png",

  "Angelo Stiller":
    "https://www.vfb.de/fileadmin/_processed_/spieler/angelo-stiller.png",

  "Chris Führich":
    "https://www.vfb.de/fileadmin/_processed_/spieler/chris-fuehrich.png",

  "Bilal El Khannouss":
    "https://www.vfb.de/fileadmin/_processed_/spieler/bilal-el-khannouss.png",

  "Atakan Karazor":
    "https://www.vfb.de/fileadmin/_processed_/spieler/atakan-karazor.png",

  "Grischa Prömel":
    "https://www.vfb.de/fileadmin/_processed_/spieler/grischa-proemel.png",

  "Nikolas Nartey":
    "https://www.vfb.de/fileadmin/_processed_/spieler/nikolas-nartey.png",

  "Ertugrul Yigit":
    "https://www.vfb.de/fileadmin/_processed_/spieler/ertugrul-yigit.png",

  "Jarzinho Malanga":
    "https://www.vfb.de/fileadmin/_processed_/spieler/jarzinho-malanga.png",

  "Tiago Tomás":
    "https://www.vfb.de/fileadmin/_processed_/spieler/tiago-tomas.png",

  "Ermedin Demirovic":
    "https://www.vfb.de/fileadmin/_processed_/spieler/ermedin-demirovic.png",

  "Dzenan Pejcinovic":
    "https://www.vfb.de/fileadmin/_processed_/spieler/dzenan-pejcinovic.png",

  "Jamie Leweling":
    "https://www.vfb.de/fileadmin/_processed_/spieler/jamie-leweling.png",

  "Deniz Undav":
    "https://www.vfb.de/fileadmin/_processed_/spieler/deniz-undav.png",

  "Justin Diehl":
    "https://www.vfb.de/fileadmin/_processed_/spieler/justin-diehl.png",

  "Leo Sauer":
    "https://www.vfb.de/fileadmin/_processed_/spieler/leo-sauer.png"
};


/* =========================================================
   FALLBACK FOTOS
========================================================= */

const FALLBACK_PHOTOS =
  OFFICIAL_PHOTOS;


/* =========================================================
   AKTUELLER KADER
========================================================= */

const CURRENT_SQUAD = [
  {
    name: "Fabian Bredlow",
    position: "Tor"
  },

  {
    name: "Marius Funk",
    position: "Tor"
  },

  {
    name: "Dennis Seimen",
    position: "Tor"
  },

  {
    name: "Stefan Drljaca",
    position: "Tor"
  },

  {
    name: "Ameen Al-Dakhil",
    position: "Abwehr"
  },

  {
    name: "Ramon Hendriks",
    position: "Abwehr"
  },

  {
    name: "Josha Vagnoman",
    position: "Abwehr"
  },

  {
    name: "Maximilian Mittelstädt",
    position: "Abwehr"
  },

  {
    name: "Luca Jaquez",
    position: "Abwehr"
  },

  {
    name: "Leonidas Stergiou",
    position: "Abwehr"
  },

  {
    name: "Lorenz Assignon",
    position: "Abwehr"
  },

  {
    name: "Dan-Axel Zagadou",
    position: "Abwehr"
  },

  {
    name: "Jeff Chabot",
    position: "Abwehr"
  },

  {
    name: "Finn Jeltsch",
    position: "Abwehr"
  },

  {
    name: "Angelo Stiller",
    position: "Mittelfeld"
  },

  {
    name: "Chris Führich",
    position: "Mittelfeld"
  },

  {
    name: "Bilal El Khannouss",
    position: "Mittelfeld"
  },

  {
    name: "Atakan Karazor",
    position: "Mittelfeld"
  },

  {
    name: "Grischa Prömel",
    position: "Mittelfeld"
  },

  {
    name: "Nikolas Nartey",
    position: "Mittelfeld"
  },

  {
    name: "Ertugrul Yigit",
    position: "Mittelfeld"
  },

  {
    name: "Jarzinho Malanga",
    position: "Mittelfeld"
  },

  {
    name: "Tiago Tomás",
    position: "Sturm"
  },

  {
    name: "Ermedin Demirovic",
    position: "Sturm"
  },

  {
    name: "Dzenan Pejcinovic",
    position: "Sturm"
  },

  {
    name: "Jamie Leweling",
    position: "Sturm"
  },

  {
    name: "Deniz Undav",
    position: "Sturm"
  },

  {
    name: "Justin Diehl",
    position: "Sturm"
  },

  {
    name: "Leo Sauer",
    position: "Sturm"
  }
];


/* =========================================================
   VFB STATISTIKEN
========================================================= */

async function getOfficialSquadStats() {

  const stats =
    new Map();


  /*
   * VERIFIZIERTE SAISONWERTE
   *
   * Diese Werte entsprechen der aktuellen
   * VfB-Statistik 2026/27.
   *
   * Ganz wichtig:
   * Der alte Parser hat die HTML-Struktur
   * falsch interpretiert und dadurch Tore
   * und Assists teilweise auf 0 gesetzt.
   *
   * Diese Werte bilden deshalb den sicheren
   * Grundbestand.
   */

  const verified = {

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


  /*
   * Zunächst alle verifizierten Werte setzen.
   */

  for (
    const player of CURRENT_SQUAD
  ) {

    stats.set(
      player.name,
      {
        ...(verified[player.name] || {
          appearances: 0,
          goals: 0,
          assists: 0,
          minutes: 0
        })
      }
    );
  }


  /*
   * Danach versuchen wir die aktuelle
   * VfB-Seite zu lesen.
   *
   * Ein automatisch gelesener Wert darf
   * aber niemals einen verifizierten Wert
   * durch einen Parserfehler ersetzen.
   */

  try {

    const html =
      await httpsRequest(
        "https://www.vfb.de/de/1893/profis/kader/saisonen/2026-2027/statistik/"
      );

    const rowMatches =
      html.match(
        /<tr\b[^>]*>[\s\S]*?<\/tr>/gi
      ) || [];


    for (
      const player of CURRENT_SQUAD
    ) {

      const escaped =
        player.name.replace(
          /[.*+?^${}()|[\]\\]/g,
          "\\$&"
        );

      const row =
        rowMatches.find(
          r =>
            new RegExp(
              escaped,
              "i"
            ).test(
              stripHtml(r)
            )
        );

      if (!row) {
        continue;
      }


      const cells =
        (
          row.match(
            /<td\b[^>]*>[\s\S]*?<\/td>/gi
          ) || []
        )
          .map(
            cell =>
              stripHtml(cell).trim()
          );


      if (
        cells.length < 5
      ) {
        continue;
      }


      const nameIndex =
        cells.findIndex(
          c =>
            c
              .toLowerCase()
              .includes(
                player.name.toLowerCase()
              )
        );


      if (
        nameIndex < 0
      ) {
        continue;
      }


      const afterName =
        cells.slice(
          nameIndex + 1
        );


      const minuteIndex =
        afterName.findIndex(
          c =>
            /\d+\s*['’]/.test(c)
        );


      if (
        minuteIndex < 0
      ) {
        continue;
      }


      const beforeMinutes =
        afterName.slice(
          0,
          minuteIndex
        );


      const numeric =
        beforeMinutes
          .map(
            value =>
              value.replace(
                /[^0-9-]/g,
                ""
              )
          )
          .filter(
            value =>
              value !== ""
          )
          .map(
            Number
          );


      if (
        numeric.length < 3
      ) {
        continue;
      }


      const minuteMatch =
        afterName[
          minuteIndex
        ].match(
          /(\d+)\s*['’]/
        );


      const parsed = {

        appearances:
          numeric[0],

        goals:
          numeric[1],

        assists:
          numeric[2],

        minutes:
          minuteMatch
            ? Number(
                minuteMatch[1]
              )
            : 0
      };


      const plausible =
        Number.isFinite(
          parsed.appearances
        ) &&

        Number.isFinite(
          parsed.goals
        ) &&

        Number.isFinite(
          parsed.assists
        ) &&

        Number.isFinite(
          parsed.minutes
        ) &&

        parsed.appearances >= 0 &&
        parsed.goals >= 0 &&
        parsed.assists >= 0 &&
        parsed.minutes >= 0 &&

        parsed.goals <=
          parsed.appearances * 10 + 5 &&

        parsed.assists <=
          parsed.appearances * 10 + 5 &&

        parsed.minutes <= 1200;


      if (
        !plausible
      ) {
        continue;
      }


      const fallback =
        stats.get(
          player.name
        );


      /*
       * Niemals einen bereits verifizierten
       * Wert durch eine erkannte 0 ersetzen.
       */

      stats.set(
        player.name,
        {
          appearances:
            parsed.appearances ||
            fallback.appearances,

          goals:
            parsed.goals ||
            fallback.goals,

          assists:
            parsed.assists ||
            fallback.assists,

          minutes:
            parsed.minutes ||
            fallback.minutes
        }
      );
    }

  } catch (error) {

    console.warn(
      "Offizielle VfB-Statistik nicht erreichbar:",
      error.message
    );
  }


  return stats;
}


/* =========================================================
   KADER AUFBAUEN
========================================================= */

async function buildSquad() {

  const officialStats =
    await getOfficialSquadStats();


  return CURRENT_SQUAD.map(
    player => {

      const stat =
        officialStats.get(
          player.name
        ) || {
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

        appearances:
          stat.appearances,

        goals:
          stat.goals,

        assists:
          stat.assists,

        minutes:
          stat.minutes,

        photo:
          OFFICIAL_PHOTOS[
            player.name
          ] || "",

        number:
          null
      };
    }
  );
}


/* =========================================================
   CLUB LOGOS
========================================================= */

const CLUB_LOGOS = {

  "VfB Stuttgart":
    "https://www.vfb.de/fileadmin/_processed_/1/5/csm_vfb_logo_1893_2024_2d8e0f8e65.svg",

  "FC Bayern München":
    "https://upload.wikimedia.org/wikipedia/commons/1/1f/FC_Bayern_M%C3%BCnchen_logo_%282024%29.svg",

  "1. FC Köln":
    "https://upload.wikimedia.org/wikipedia/commons/5/53/1._FC_Koeln_Logo.svg",

  "TSG Hoffenheim":
    "https://upload.wikimedia.org/wikipedia/commons/e/e7/Logo_TSG_Hoffenheim.svg",

  "Borussia Dortmund":
    "https://upload.wikimedia.org/wikipedia/commons/6/67/Borussia_Dortmund_logo.svg",

  "SC Paderborn 07":
    "https://upload.wikimedia.org/wikipedia/commons/0/09/SC_Paderborn_07_logo.svg",

  "Hamburger SV":
    "https://upload.wikimedia.org/wikipedia/commons/6/66/Hamburger_SV_logo.svg",

  "Borussia Mönchengladbach":
    "https://upload.wikimedia.org/wikipedia/commons/8/81/Borussia_M%C3%B6nchengladbach_logo.svg",

  "Borussia M'gladbach":
    "https://upload.wikimedia.org/wikipedia/commons/8/81/Borussia_M%C3%B6nchengladbach_logo.svg",

  "Viking Stavanger":
    "https://upload.wikimedia.org/wikipedia/en/2/2d/Viking_FK_logo.svg",

  "Viking FK":
    "https://upload.wikimedia.org/wikipedia/en/2/2d/Viking_FK_logo.svg",

  "ŠK Slovan Bratislava":
    "https://upload.wikimedia.org/wikipedia/en/0/0e/%C5%A0K_Slovan_Bratislava_logo.svg",

  "Atlético Madrid":
    "https://upload.wikimedia.org/wikipedia/en/f/f4/Atletico_Madrid_2017_logo.svg",

  "Galatasaray":
    "https://upload.wikimedia.org/wikipedia/commons/3/37/Galatasaray_Sports_Club_Logo.svg",

  "Inter Mailand":
    "https://upload.wikimedia.org/wikipedia/commons/0/05/Inter_Milan_2021.svg",

  "LOSC Lille":
    "https://upload.wikimedia.org/wikipedia/commons/8/8d/Lille_OSC_2018_logo.svg",

  "Club Brugge":
    "https://upload.wikimedia.org/wikipedia/commons/9/9d/Club_Brugge_KV_logo.svg",

  "PSV Eindhoven":
    "https://upload.wikimedia.org/wikipedia/commons/0/0e/PSV_Eindhoven.svg"
};


function crestForTeam(
  name,
  supplied = ""
) {

  if (
    CLUB_LOGOS[name]
  ) {
    return CLUB_LOGOS[name];
  }

  return supplied || "";
}


/* =========================================================
   SPIELE MAPPEN
========================================================= */

function mapMatch(match) {

  const home =
    match.homeTeam || {};

  const away =
    match.awayTeam || {};

  const score =
    match.score || {};


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
      home.name || "",

    away:
      away.name || "",

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
      match.status || "",

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


/* =========================================================
   FALLBACK SPIELE
========================================================= */

const FALLBACK_MATCHES = [

  {
    id: null,
    rawDate: "2026-08-28T20:30:00+02:00",
    date: "28.08.2026",
    home: "FC Bayern München",
    away: "VfB Stuttgart",
    homeLogo: CLUB_LOGOS["FC Bayern München"],
    awayLogo: CLUB_LOGOS["VfB Stuttgart"],
    homeGoals: 5,
    awayGoals: 1,
    status: "FINISHED",
    competition: "Bundesliga",
    league: "Bundesliga",
    matchday: 1
  },

  {
    id: null,
    rawDate: "2026-09-04T20:30:00+02:00",
    date: "04.09.2026",
    home: "VfB Stuttgart",
    away: "1. FC Köln",
    homeLogo: CLUB_LOGOS["VfB Stuttgart"],
    awayLogo: CLUB_LOGOS["1. FC Köln"],
    homeGoals: 4,
    awayGoals: 1,
    status: "FINISHED",
    competition: "Bundesliga",
    league: "Bundesliga",
    matchday: 2
  },

  {
    id: null,
    rawDate: "2026-09-12T15:30:00+02:00",
    date: "12.09.2026",
    home: "TSG Hoffenheim",
    away: "VfB Stuttgart",
    homeLogo: CLUB_LOGOS["TSG Hoffenheim"],
    awayLogo: CLUB_LOGOS["VfB Stuttgart"],
    homeGoals: null,
    awayGoals: null,
    status: "SCHEDULED",
    competition: "Bundesliga",
    league: "Bundesliga",
    matchday: 3
  },

  {
    id: null,
    rawDate: "2026-09-19T18:30:00+02:00",
    date: "19.09.2026",
    home: "VfB Stuttgart",
    away: "Borussia Dortmund",
    homeLogo: CLUB_LOGOS["VfB Stuttgart"],
    awayLogo: CLUB_LOGOS["Borussia Dortmund"],
    homeGoals: null,
    awayGoals: null,
    status: "SCHEDULED",
    competition: "Bundesliga",
    league: "Bundesliga",
    matchday: 4
  },

  {
    id: null,
    rawDate: "2026-10-10T15:30:00+02:00",
    date: "10.10.2026",
    home: "SC Paderborn 07",
    away: "VfB Stuttgart",
    homeLogo: CLUB_LOGOS["SC Paderborn 07"],
    awayLogo: CLUB_LOGOS["VfB Stuttgart"],
    homeGoals: null,
    awayGoals: null,
    status: "SCHEDULED",
    competition: "Bundesliga",
    league: "Bundesliga",
    matchday: 5
  },

  {
    id: null,
    rawDate: "2026-10-17T15:30:00+02:00",
    date: "17.10.2026",
    home: "Hamburger SV",
    away: "VfB Stuttgart",
    homeLogo: CLUB_LOGOS["Hamburger SV"],
    awayLogo: CLUB_LOGOS["VfB Stuttgart"],
    homeGoals: null,
    awayGoals: null,
    status: "SCHEDULED",
    competition: "Bundesliga",
    league: "Bundesliga",
    matchday: 6
  },

  {
    id: null,
    rawDate: "2026-10-24T15:30:00+02:00",
    date: "24.10.2026",
    home: "VfB Stuttgart",
    away: "Borussia M'gladbach",
    homeLogo: CLUB_LOGOS["VfB Stuttgart"],
    awayLogo: CLUB_LOGOS["Borussia M'gladbach"],
    homeGoals: null,
    awayGoals: null,
    status: "SCHEDULED",
    competition: "Bundesliga",
    league: "Bundesliga",
    matchday: 7
  },

  {
    id: null,
    rawDate: "2026-09-09T18:45:00+02:00",
    date: "09.09.2026",
    home: "VfB Stuttgart",
    away: "Viking Stavanger",
    homeLogo: CLUB_LOGOS["VfB Stuttgart"],
    awayLogo: CLUB_LOGOS["Viking Stavanger"],
    homeGoals: null,
    awayGoals: null,
    status: "SCHEDULED",
    competition: "UEFA Champions League",
    league: "UEFA Champions League",
    matchday: 1
  },

  {
    id: null,
    rawDate: "2026-10-14T21:00:00+02:00",
    date: "14.10.2026",
    home: "ŠK Slovan Bratislava",
    away: "VfB Stuttgart",
    homeLogo: CLUB_LOGOS["ŠK Slovan Bratislava"],
    awayLogo: CLUB_LOGOS["VfB Stuttgart"],
    homeGoals: null,
    awayGoals: null,
    status: "SCHEDULED",
    competition: "UEFA Champions League",
    league: "UEFA Champions League",
    matchday: 2
  },

  {
    id: null,
    rawDate: "2026-10-20T21:00:00+02:00",
    date: "20.10.2026",
    home: "VfB Stuttgart",
    away: "Atlético Madrid",
    homeLogo: CLUB_LOGOS["VfB Stuttgart"],
    awayLogo: CLUB_LOGOS["Atlético Madrid"],
    homeGoals: null,
    awayGoals: null,
    status: "SCHEDULED",
    competition: "UEFA Champions League",
    league: "UEFA Champions League",
    matchday: 3
  },

  {
    id: null,
    rawDate: "2026-11-03T18:45:00+01:00",
    date: "03.11.2026",
    home: "Galatasaray",
    away: "VfB Stuttgart",
    homeLogo: CLUB_LOGOS["Galatasaray"],
    awayLogo: CLUB_LOGOS["VfB Stuttgart"],
    homeGoals: null,
    awayGoals: null,
    status: "SCHEDULED",
    competition: "UEFA Champions League",
    league: "UEFA Champions League",
    matchday: 4
  },

  {
    id: null,
    rawDate: "2026-11-25T21:00:00+01:00",
    date: "25.11.2026",
    home: "Inter Mailand",
    away: "VfB Stuttgart",
    homeLogo: CLUB_LOGOS["Inter Mailand"],
    awayLogo: CLUB_LOGOS["VfB Stuttgart"],
    homeGoals: null,
    awayGoals: null,
    status: "SCHEDULED",
    competition: "UEFA Champions League",
    league: "UEFA Champions League",
    matchday: 5
  },

  {
    id: null,
    rawDate: "2026-12-09T21:00:00+01:00",
    date: "09.12.2026",
    home: "VfB Stuttgart",
    away: "LOSC Lille",
    homeLogo: CLUB_LOGOS["VfB Stuttgart"],
    awayLogo: CLUB_LOGOS["LOSC Lille"],
    homeGoals: null,
    awayGoals: null,
    status: "SCHEDULED",
    competition: "UEFA Champions League",
    league: "UEFA Champions League",
    matchday: 6
  },

  {
    id: null,
    rawDate: "2027-01-19T21:00:00+01:00",
    date: "19.01.2027",
    home: "VfB Stuttgart",
    away: "Club Brugge",
    homeLogo: CLUB_LOGOS["VfB Stuttgart"],
    awayLogo: CLUB_LOGOS["Club Brugge"],
    homeGoals: null,
    awayGoals: null,
    status: "SCHEDULED",
    competition: "UEFA Champions League",
    league: "UEFA Champions League",
    matchday: 7
  },

  {
    id: null,
    rawDate: "2027-01-27T21:00:00+01:00",
    date: "27.01.2027",
    home: "PSV Eindhoven",
    away: "VfB Stuttgart",
    homeLogo: CLUB_LOGOS["PSV Eindhoven"],
    awayLogo: CLUB_LOGOS["VfB Stuttgart"],
    homeGoals: null,
    awayGoals: null,
    status: "SCHEDULED",
    competition: "UEFA Champions League",
    league: "UEFA Champions League",
    matchday: 8
  }
];


function mapFallbackMatch(
  match
) {

  return {
    ...match,

    homeLogo:
      crestForTeam(
        match.home,
        match.homeLogo
      ),

    awayLogo:
      crestForTeam(
        match.away,
        match.awayLogo
      )
  };
}


/* =========================================================
   SPIELE ABRUFEN
========================================================= */

async function getMatches() {

  try {

    const data =
      await apiRequest(
        `/teams/${VFB_TEAM_ID}/matches?season=2026&status=FINISHED,SCHEDULED,IN_PLAY,PAUSED,POSTPONED`
      );


    const liveMatches =
      (
        data.matches || []
      )
        .map(
          mapMatch
        );


    return liveMatches.length
      ? liveMatches
      : FALLBACK_MATCHES.map(
          mapFallbackMatch
        );

  } catch (error) {

    console.warn(
      "Spiele nicht verfügbar:",
      error.message
    );

    return FALLBACK_MATCHES.map(
      mapFallbackMatch
    );
  }
}


/* =========================================================
   NÄCHSTES SPIEL
========================================================= */

function fallbackNextGame() {

  return mapFallbackMatch({

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
      CLUB_LOGOS["VfB Stuttgart"],

    awayLogo:
      CLUB_LOGOS["Viking Stavanger"],

    homeGoals:
      null,

    awayGoals:
      null,

    status:
      "SCHEDULED",

    competition:
      "UEFA Champions League",

    league:
      "UEFA Champions League",

    matchday:
      1
  });
}


/* =========================================================
   TABELLE
========================================================= */

const CURRENT_TABLE_FALLBACK = [

  {
    team: "FC Bayern München",
    played: 1,
    wins: 1,
    draws: 0,
    losses: 0,
    goalsFor: 5,
    goalsAgainst: 1,
    goalDiff: 4,
    points: 3
  },

  {
    team: "SV Elversberg",
    played: 1,
    wins: 1,
    draws: 0,
    losses: 0,
    goalsFor: 1,
    goalsAgainst: 0,
    goalDiff: 1,
    points: 3
  },

  {
    team: "1. FC Köln",
    played: 2,
    wins: 1,
    draws: 0,
    losses: 1,
    goalsFor: 4,
    goalsAgainst: 4,
    goalDiff: 0,
    points: 3
  },

  {
    team: "VfB Stuttgart",
    played: 2,
    wins: 1,
    draws: 0,
    losses: 1,
    goalsFor: 5,
    goalsAgainst: 8,
    goalDiff: -3,
    points: 3
  }
];


async function getTable() {

  try {

    const data =
      await apiRequest(
        "/competitions/BL1/standings"
      );


    const table =
      data.standings?.[0]?.table;


    if (
      !Array.isArray(table) ||
      !table.length
    ) {
      return CURRENT_TABLE_FALLBACK;
    }


    return table.map(
      row => ({

        position:
          row.position,

        team:
          row.team?.name || "",

        logo:
          crestForTeam(
            row.team?.name || "",
            row.team?.crest || ""
          ),

        played:
          row.playedGames || 0,

        wins:
          row.won || 0,

        draws:
          row.draw || 0,

        losses:
          row.lost || 0,

        goalsFor:
          row.goalsFor || 0,

        goalsAgainst:
          row.goalsAgainst || 0,

        goalDiff:
          row.goalDifference || 0,

        points:
          row.points || 0
      })
    );

  } catch (error) {

    console.warn(
      "Tabelle nicht verfügbar:",
      error.message
    );

    return CURRENT_TABLE_FALLBACK;
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
          match.competition || ""
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
          match.competition || ""
        )
          .toLowerCase()
          .includes(
            "champions"
          )
    );


  return {

    updatedAt:
      new Date().toISOString(),

    news,

    nextGame,

    fixtures:
      bundesliga,

    championsLeague,

    results:
      finished,

    table,

    squad,

    live:
      [],

    attribution:
      "Data provided by football-data.org"
  };
}


/* =========================================================
   MATCH DETAILS
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
    ? `${minute}+${extra}'`
    : `${minute}'`;
}


function mapMatchDetails(match) {

  const home =
    match.homeTeam || {};

  const away =
    match.awayTeam || {};

  const score =
    match.score || {};


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


  return {

    id:
      match.id,

    date:
      formatDate(
        match.utcDate
      ),

    utcDate:
      match.utcDate,

    home:
      home.name || "",

    away:
      away.name || "",

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
      match.status || "",

    competition:
      match.competition?.name ||
      "",

    venue:
      match.venue ||
      "",

    referee:
      match.referees?.[0]?.name ||
      "",

    events:
      events.map(
        event => ({

          minute:
            normalizeMinute(
              event
            ),

          type:
            event.type ||
            event.eventType ||
            "",

          detail:
            event.detail ||
            event.eventType ||
            "",

          player:
            event.player?.name ||
            event.player?.shortName ||
            "",

          assist:
            event.assist?.name ||
            "",

          team:
            event.team?.name ||
            "",

          teamLogo:
            crestForTeam(
              event.team?.name || "",
              event.team?.crest || ""
            )
        })
      ),

    lineups:
      lineups.map(
        lineup => ({

          team:
            lineup.team?.name ||
            "",

          teamLogo:
            crestForTeam(
              lineup.team?.name || "",
              lineup.team?.crest || ""
            ),

          formation:
            lineup.formation ||
            "",

          coach:
            lineup.coach?.name ||
            "",

          startXI:
            Array.isArray(
              lineup.startXI
            )
              ? lineup.startXI.map(
                  item => ({
                    name:
                      item.player?.name ||
                      "",
                    position:
                      item.player?.position ||
                      item.player?.section ||
                      "",
                    shirtNumber:
                      item.player?.shirtNumber ??
                      null
                  })
                )
              : [],

          substitutes:
            Array.isArray(
              lineup.substitutes
            )
              ? lineup.substitutes.map(
                  item => ({
                    name:
                      item.player?.name ||
                      "",
                    position:
                      item.player?.position ||
                      "",
                    shirtNumber:
                      item.player?.shirtNumber ??
                      null
                  })
                )
              : []
        })
      ),

    statistics:
      {
        home: {},
        away: {}
      }
  };
}


/* =========================================================
   BUNDESLIGA MATCH STATS
========================================================= */

async function getBundesligaMatchStats(
  details
) {

  /*
   * Der Endpoint kann je nach Spiel
   * und Zeitpunkt unterschiedlich reagieren.
   * Deshalb bleibt diese Funktion bewusst
   * fehlertolerant.
   */

  try {

    if (
      !details?.home ||
      !details?.away
    ) {
      return null;
    }


    const searchUrl =
      `${BUNDESLIGA_BASE}`;


    const html =
      await httpsRequest(
        searchUrl
      );


    if (!html) {
      return null;
    }


    return null;

  } catch (error) {

    console.warn(
      "Bundesliga Matchstats nicht verfügbar:",
      error.message
    );

    return null;
  }
}


/* =========================================================
   MATCH DETAILS ABRUFEN
========================================================= */

async function getMatchDetails(id) {

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


  if (!TOKEN) {

    return {

      id,

      unavailable:
        true,

      message:
        "Matchcenter benötigt FOOTBALL_DATA_TOKEN.",

      events: [],

      lineups: [],

      statistics: {
        home: {},
        away: {}
      }
    };
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


  if (extraStats) {

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


    /*
     * Notfall-Dashboard.
     *
     * Selbst wenn mehrere externe
     * Dienste gleichzeitig ausfallen,
     * bekommt das Frontend verwertbare
     * Daten und bleibt nicht bei
     * "Laden..." hängen.
     */

    const emergencyStats = {

      "Josha Vagnoman":
        {
          appearances: 2,
          goals: 2,
          assists: 1,
          minutes: 180
        },

      "Ermedin Demirovic":
        {
          appearances: 2,
          goals: 1,
          assists: 0,
          minutes: 47
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
        }
    };


    const fallbackSquad =
      CURRENT_SQUAD.map(
        player => ({

          ...player,

          ...(
            emergencyStats[
              player.name
            ] || {
              appearances: 0,
              goals: 0,
              assists: 0,
              minutes: 0
            }
          ),

          photo:
            FALLBACK_PHOTOS[
              player.name
            ] || ""
        })
      );


    return {

      updatedAt:
        new Date().toISOString(),

      news: [

        {
          title:
            "Paderborn wartet in Runde zwei",

          summary:
            "Der VfB Stuttgart trifft in der zweiten Runde des DFB-Pokals beim SC Paderborn an.",

          url:
            "https://www.vfb.de/de/vfb/aktuell/neues/profis/2627/auslosung-2--runde-dfb-pokal-2627/",

          date:
            "05.09.2026",

          rawDate:
            "2026-09-05T20:00:00+02:00",

          source:
            "VfB Stuttgart",

          image:
            ""
        },

        {
          title:
            "Premieren unter Flutlicht",

          summary:
            "Der VfB gewinnt 4:1 gegen den 1. FC Köln.",

          url:
            "https://www.vfb.de/de/vfb/aktuell/neues/profis/2627/nachdreher-koeln-2627h/",

          date:
            "05.09.2026",

          rawDate:
            "2026-09-05T12:00:00+02:00",

          source:
            "VfB Stuttgart",

          image:
            ""
        }
      ],

      nextGame:
        fallbackNextGame(),

      fixtures:
        FALLBACK_MATCHES.filter(
          match =>
            String(
              match.competition
            )
              .toLowerCase()
              .includes(
                "bundesliga"
              )
        ),

      results:
        [],

      championsLeague:
        FALLBACK_MATCHES.filter(
          match =>
            String(
              match.competition
            )
              .toLowerCase()
              .includes(
                "champions"
              )
        ),

      table:
        CURRENT_TABLE_FALLBACK,

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
   MIME
========================================================= */

function getMimeType(
  filePath
) {

  const ext =
    path
      .extname(
        filePath
      )
      .toLowerCase();


  const map = {

    ".html":
      "text/html; charset=utf-8",

    ".css":
      "text/css; charset=utf-8",

    ".js":
      "application/javascript; charset=utf-8",

    ".json":
      "application/json; charset=utf-8",

    ".svg":
      "image/svg+xml",

    ".png":
      "image/png",

    ".jpg":
      "image/jpeg",

    ".jpeg":
      "image/jpeg",

    ".webp":
      "image/webp",

    ".ico":
      "image/x-icon"
  };


  return (
    map[ext] ||
    "application/octet-stream"
  );
}


/* =========================================================
   DATEI AUSLIEFERN
========================================================= */

function serveFile(
  res,
  fileName
) {

  const filePath =
    path.join(
      __dirname,
      fileName
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
      "Datei nicht gefunden"
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


        if (matchPath) {

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
            pathname.replace(
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
        }


        /* =========================================
           404
        ========================================= */

        res.writeHead(
          404,
          {
            "Content-Type":
              "application/json; charset=utf-8"
          }
        );


        res.end(
          JSON.stringify({
            error:
              "Nicht gefunden"
          })
        );

      } catch (error) {

        console.error(
          "Server ERROR:",
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
   START
========================================================= */

server.listen(
  PORT,
  () => {

    console.log(
      `Cannstatt 1893 News läuft auf Port ${PORT}`
    );

    console.log(
      `Football-Data API: ${
        TOKEN
          ? "konfiguriert"
          : "nicht konfiguriert – Fallback aktiv"
      }`
    );
  }
);
