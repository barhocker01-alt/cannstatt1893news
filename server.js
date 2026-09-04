const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;
const TOKEN = process.env.FOOTBALL_DATA_TOKEN;

const VFB_TEAM_ID = 10;

const VFB_RSS_URL = "https://www.vfb.de/templates/generated/1/raw/de.xml";

const VFB_STATS_URL =
  "https://www.vfb.de/de/1893/profis/kader/saisonen/2026-2027/statistik/?data=&mobile=";

const CACHE_TIME = 6 * 60 * 60 * 1000;

let dashboardCache = null;
let dashboardCacheTime = 0;

/* =========================================================
   BESUCHER-TICKER
   Anonymes Besucher-Cookie, keine IP-Speicherung.
   Hinweis: Auf Render Free sind diese Werte nicht dauerhaft.
========================================================= */

let visitorStats = {
  day: new Date().toISOString().slice(0, 10),
  visitorsToday: 0,
  pageViewsToday: 0,
  totalVisitors: 0,
  totalPageViews: 0
};

const activeVisitors = new Map();
const ACTIVE_WINDOW = 2 * 60 * 1000;

function resetVisitorDayIfNeeded() {
  const today = new Date().toISOString().slice(0, 10);

  if (visitorStats.day !== today) {
    visitorStats.day = today;
    visitorStats.visitorsToday = 0;
    visitorStats.pageViewsToday = 0;
  }
}

function getCookie(req, name) {
  const header = req.headers.cookie || "";

  const match = header.match(
    new RegExp("(?:^|;\\s*)" + name + "=([^;]+)")
  );

  return match ? decodeURIComponent(match[1]) : null;
}

function makeVisitorId() {
  return require("crypto").randomUUID();
}

function trackVisitor(req, res) {
  resetVisitorDayIfNeeded();

  let visitorId = getCookie(req, "c1893_visitor");
  let isNewVisitor = false;

  if (!visitorId) {
    visitorId = makeVisitorId();
    isNewVisitor = true;

    res.setHeader(
      "Set-Cookie",
      `c1893_visitor=${encodeURIComponent(
        visitorId
      )}; Max-Age=31536000; Path=/; SameSite=Lax`
    );
  }

  visitorStats.pageViewsToday += 1;
  visitorStats.totalPageViews += 1;

  if (isNewVisitor) {
    visitorStats.visitorsToday += 1;
    visitorStats.totalVisitors += 1;
  }

  activeVisitors.set(visitorId, Date.now());

  const cutoff = Date.now() - ACTIVE_WINDOW;

  for (const [id, lastSeen] of activeVisitors) {
    if (lastSeen < cutoff) {
      activeVisitors.delete(id);
    }
  }

  return {
    visitorsOnline: activeVisitors.size,
    visitorsToday: visitorStats.visitorsToday,
    pageViewsToday: visitorStats.pageViewsToday,
    totalVisitors: visitorStats.totalVisitors,
    totalPageViews: visitorStats.totalPageViews
  };
}

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });

  res.end(JSON.stringify(data));
}

/* =========================================================
   OFFICIAL VFB SQUAD
========================================================= */

const VFB_SQUAD = [
  // TOR
  {
    id: "bredlow",
    name: "Fabian Bredlow",
    number: 33,
    position: "Torwart",
    group: "TOR",
    image:
      "https://www.vfb.de/?proxy=sportdb%2Fspieler%2F06165-1_bredlow.png"
  },

  {
    id: "funk",
    name: "Marius Funk",
    number: 23,
    position: "Torwart",
    group: "TOR",
    image:
      "https://www.vfb.de/?proxy=sportdb%2Fspieler%2F6dd79-33_funk.png"
  },

  {
    id: "seimen",
    name: "Dennis Seimen",
    number: 1,
    position: "Torwart",
    group: "TOR",
    image:
      "https://www.vfb.de/?proxy=sportdb%2Fspieler%2Fa1564-41_seimen.png"
  },

  {
    id: "drljaca",
    name: "Stefan Drljaca",
    number: 42,
    position: "Torwart",
    group: "TOR",
    image:
      "https://www.vfb.de/?proxy=sportdb%2Fspieler%2F26729-46_drljaca.png"
  },

  // ABWEHR
  {
    id: "al-dakhil",
    name: "Ameen Al-Dakhil",
    number: 2,
    position: "Abwehr",
    group: "ABWEHR",
    image:
      "https://www.vfb.de/?proxy=sportdb%2Fspieler%2Fb6d82-2_al-dakhil.png"
  },

  {
    id: "hendriks",
    name: "Ramon Hendriks",
    number: 3,
    position: "Abwehr",
    group: "ABWEHR",
    image:
      "https://www.vfb.de/?proxy=sportdb%2Fspieler%2F37072-3_hendriks.png"
  },

  {
    id: "vagnoman",
    name: "Josha Vagnoman",
    number: 4,
    position: "Abwehr",
    group: "ABWEHR",
    image:
      "https://www.vfb.de/?proxy=sportdb%2Fspieler%2F20236-4_vagnoman.png"
  },

  {
    id: "mittelstaedt",
    name: "Maximilian Mittelstädt",
    number: 7,
    position: "Abwehr",
    group: "ABWEHR",
    image:
      "https://www.vfb.de/?proxy=sportdb%2Fspieler%2F0efee-7_mittelsta--dt.png"
  },

  {
    id: "jaquez",
    name: "Luca Jaquez",
    number: 14,
    position: "Abwehr",
    group: "ABWEHR",
    image:
      "https://www.vfb.de/?proxy=sportdb%2Fspieler%2F244f9-14_jaquez.png"
  },

  {
    id: "stergiou",
    name: "Leonidas Stergiou",
    number: 20,
    position: "Abwehr",
    group: "ABWEHR",
    image:
      "https://www.vfb.de/?proxy=sportdb%2Fspieler%2F029f7-20_stergiou.png"
  },

  {
    id: "assignon",
    name: "Lorenz Assignon",
    number: 22,
    position: "Abwehr",
    group: "ABWEHR",
    image:
      "https://www.vfb.de/?proxy=sportdb%2Fspieler%2F38f68-22_assignon.png"
  },

  {
    id: "zagadou",
    name: "Dan-Axel Zagadou",
    number: 23,
    position: "Abwehr",
    group: "ABWEHR",
    image:
      "https://www.vfb.de/?proxy=img%2Fdummy.png"
  },

  {
    id: "chabot",
    name: "Jeff Chabot",
    number: 24,
    position: "Abwehr",
    group: "ABWEHR",
    image:
      "https://www.vfb.de/?proxy=sportdb%2Fspieler%2Fa284d-24_chabot.png"
  },

  {
    id: "jeltsch",
    name: "Finn Jeltsch",
    number: 29,
    position: "Abwehr",
    group: "ABWEHR",
    image:
      "https://www.vfb.de/?proxy=sportdb%2Fspieler%2Ff076a-29_jeltsch.png"
  },

  // MITTELFELD
  {
    id: "stiller",
    name: "Angelo Stiller",
    number: 6,
    position: "Mittelfeld",
    group: "MITTELFELD",
    image:
      "https://www.vfb.de/?proxy=sportdb%2Fspieler%2Fa2f7b-6_stiller.png"
  },

  {
    id: "fuehrich",
    name: "Chris Führich",
    number: 10,
    position: "Mittelfeld",
    group: "MITTELFELD",
    image:
      "https://www.vfb.de/?proxy=sportdb%2Fspieler%2F95b40-10_fu--hrich.png"
  },

  {
    id: "el-khannouss",
    name: "Bilal El Khannouss",
    number: 11,
    position: "Mittelfeld",
    group: "MITTELFELD",
    image:
      "https://www.vfb.de/?proxy=sportdb%2Fspieler%2F1d484-11_el_khannouss.png"
  },

  {
    id: "karazor",
    name: "Atakan Karazor",
    number: 16,
    position: "Mittelfeld",
    group: "MITTELFELD",
    image:
      "https://www.vfb.de/?proxy=sportdb%2Fspieler%2F4b88f-16_karazor.png"
  },

  {
    id: "proemel",
    name: "Grischa Prömel",
    number: 21,
    position: "Mittelfeld",
    group: "MITTELFELD",
    image:
      "https://www.vfb.de/?proxy=sportdb%2Fspieler%2F9a7b9-21_pro--mel.png"
  },

  {
    id: "nartey",
    name: "Nikolas Nartey",
    number: 28,
    position: "Mittelfeld",
    group: "MITTELFELD",
    image:
      "https://www.vfb.de/?proxy=sportdb%2Fspieler%2F76cc5-28_nartey.png"
  },

  {
    id: "yigit",
    name: "Ertugrul Yigit",
    number: 35,
    position: "Mittelfeld",
    group: "MITTELFELD",
    image:
      "https://www.vfb.de/?proxy=img%2Fdummy.png"
  },

  {
    id: "malanga",
    name: "Jarzinho Malanga",
    number: 38,
    position: "Mittelfeld",
    group: "MITTELFELD",
    image:
      "https://www.vfb.de/?proxy=img%2Fdummy.png"
  },

  // STURM
  {
    id: "tomas",
    name: "Tiago Tomás",
    number: 8,
    position: "Sturm",
    group: "STURM",
    image:
      "https://www.vfb.de/?proxy=sportdb%2Fspieler%2F49f37-8_tomas.png"
  },

  {
    id: "demirovic",
    name: "Ermedin Demirovic",
    number: 9,
    position: "Sturm",
    group: "STURM",
    image:
      "https://www.vfb.de/?proxy=sportdb%2Fspieler%2F0ba85-9_demirovic.png"
  },

  {
    id: "pejcinovic",
    name: "Dzenan Pejcinovic",
    number: 17,
    position: "Sturm",
    group: "STURM",
    image:
      "https://www.vfb.de/?proxy=sportdb%2Fspieler%2F4c4de-17_pejcinovic.png"
  },

  {
    id: "leweling",
    name: "Jamie Leweling",
    number: 18,
    position: "Sturm",
    group: "STURM",
    image:
      "https://www.vfb.de/?proxy=sportdb%2Fspieler%2Fe4223-18_leweling.png"
  },

  {
    id: "arevalo",
    name: "Jeremy Arévalo",
    number: 25,
    position: "Sturm",
    group: "STURM",
    image:
      "https://www.vfb.de/?proxy=sportdb%2Fspieler%2Fc04c5-25_arevalo.png"
  },

  {
    id: "undav",
    name: "Deniz Undav",
    number: 26,
    position: "Sturm",
    group: "STURM",
    image:
      "https://www.vfb.de/?proxy=sportdb%2Fspieler%2Fa56ab-22_undav.png"
  },

  {
    id: "bouanani",
    name: "Badredine Bouanani",
    number: 27,
    position: "Sturm",
    group: "STURM",
    image:
      "https://www.vfb.de/?proxy=sportdb%2Fspieler%2F13b72-27_bouanani.png"
  },

  {
    id: "diehl",
    name: "Justin Diehl",
    number: 29,
    position: "Sturm",
    group: "STURM",
    image:
      "https://www.vfb.de/?proxy=img%2Fdummy.png"
  },

  {
    id: "sauer",
    name: "Leo Sauer",
    number: 44,
    position: "Sturm",
    group: "STURM",
    image:
      "https://www.vfb.de/?proxy=sportdb%2Fspieler%2Fa1dfb-44_sauer.png"
  }
];

/* =========================================================
   HTTP HELPERS
========================================================= */

function httpsRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: {
          "User-Agent": "Cannstatt1893News/1.0",
          Accept: "*/*",
          ...(options.headers || {})
        }
      },
      (res) => {
        let data = "";

        res.setEncoding("utf8");

        res.on("data", (chunk) => {
          data += chunk;
        });

        res.on("end", () => {
          if (
            res.statusCode >= 200 &&
            res.statusCode < 300
          ) {
            resolve(data);
          } else {
            reject(
              new Error(
                `HTTP ${res.statusCode} for ${url}`
              )
            );
          }
        });
      }
    );

    req.on("error", reject);

    req.setTimeout(20000, () => {
      req.destroy(
        new Error(`Timeout for ${url}`)
      );
    });
  });
}

async function apiRequest(endpoint) {
  if (!TOKEN) {
    throw new Error(
      "FOOTBALL_DATA_TOKEN is not configured"
    );
  }

  const url =
    "https://api.football-data.org/v4" +
    endpoint;

  const raw = await httpsRequest(url, {
    headers: {
      "X-Auth-Token": TOKEN
    }
  });

  return JSON.parse(raw);
}

/* =========================================================
   DATE HELPERS
========================================================= */

function formatDate(dateString) {
  if (!dateString) return "";

  const date = new Date(dateString);

  if (Number.isNaN(date.getTime())) {
    return dateString;
  }

  return new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  }).format(date);
}

function formatDateTime(dateString) {
  if (!dateString) return "";

  const date = new Date(dateString);

  if (Number.isNaN(date.getTime())) {
    return dateString;
  }

  return new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

/* =========================================================
   MATCH MAPPING
========================================================= */

function mapMatch(match) {
  if (!match) return null;

  const home = match.homeTeam || {};
  const away = match.awayTeam || {};

  return {
    id: match.id,

    competition:
      match.competition?.name ||
      match.competition?.code ||
      "",

    competitionCode:
      match.competition?.code || "",

    date: match.utcDate || null,

    dateFormatted:
      formatDate(match.utcDate),

    dateTimeFormatted:
      formatDateTime(match.utcDate),

    status: match.status || "",

    matchday:
      match.matchday || null,

    homeTeam: {
      id: home.id || null,
      name: home.name || "",
      shortName:
        home.shortName || "",
      tla: home.tla || "",
      crest: home.crest || ""
    },

    awayTeam: {
      id: away.id || null,
      name: away.name || "",
      shortName:
        away.shortName || "",
      tla: away.tla || "",
      crest: away.crest || ""
    },

    score: {
      fullTime: {
        home:
          match.score?.fullTime?.home ??
          null,

        away:
          match.score?.fullTime?.away ??
          null
      },

      halfTime: {
        home:
          match.score?.halfTime?.home ??
          null,

        away:
          match.score?.halfTime?.away ??
          null
      }
    },

    venue: match.venue || ""
  };
}

/* =========================================================
   VFB MATCHES
========================================================= */

async function getVfbMatches() {
  try {
    const data = await apiRequest(
      `/teams/${VFB_TEAM_ID}/matches?status=SCHEDULED,IN_PLAY,PAUSED,FINISHED`
    );

    const matches = Array.isArray(
      data.matches
    )
      ? data.matches
      : [];

    const sorted = matches
      .map(mapMatch)
      .sort(
        (a, b) =>
          new Date(a.date || 0) -
          new Date(b.date || 0)
      );

    const now = Date.now();

    let nextGame =
      sorted.find(
        (match) =>
          match.date &&
          new Date(match.date).getTime() >=
            now &&
          match.status !== "FINISHED"
      ) || null;

    const fixtures = sorted.filter(
      (match) => {
        if (!match.date) return false;

        const isBundesliga =
          match.competitionCode === "BL1" ||
          match.competition
            ?.toLowerCase()
            .includes("bundesliga");

        return isBundesliga;
      }
    );

    return {
      nextGame,
      fixtures
    };
  } catch (error) {
    console.error(
      "Fehler bei VfB Spielen:",
      error.message
    );

    return {
      nextGame: null,
      fixtures: []
    };
  }
}

/* =========================================================
   BUNDESLIGA TABLE
========================================================= */

async function getBundesligaTable() {
  try {
    const data = await apiRequest(
      "/competitions/BL1/standings"
    );

    const table =
      data.standings?.find(
        (standing) =>
          standing.type === "TOTAL"
      ) ||
      data.standings?.[0];

    if (
      !table ||
      !Array.isArray(table.table)
    ) {
      return [];
    }

    return table.table.map(
      (entry) => ({
        position:
          entry.position,

        team: {
          id:
            entry.team?.id ||
            null,

          name:
            entry.team?.name ||
            "",

          shortName:
            entry.team?.shortName ||
            "",

          tla:
            entry.team?.tla ||
            "",

          crest:
            entry.team?.crest ||
            ""
        },

        playedGames:
          entry.playedGames ?? 0,

        won:
          entry.won ?? 0,

        draw:
          entry.draw ?? 0,

        lost:
          entry.lost ?? 0,

        points:
          entry.points ?? 0,

        goalsFor:
          entry.goalsFor ?? 0,

        goalsAgainst:
          entry.goalsAgainst ?? 0,

        goalDifference:
          entry.goalDifference ?? 0
      })
    );
  } catch (error) {
    console.error(
      "Fehler bei Bundesliga-Tabelle:",
      error.message
    );

    return [];
  }
}

/* =========================================================
   RSS HELPERS
========================================================= */

function decodeXml(value) {
  if (!value) return "";

  return value
    .replace(
      /<!\[CDATA\[(.*?)\]\]>/gs,
      "$1"
    )
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

function stripHtml(value) {
  if (!value) return "";

  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractXmlTag(block, tag) {
  const regex = new RegExp(
    `<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`,
    "i"
  );

  const match = block.match(regex);

  return match
    ? decodeXml(match[1])
    : "";
}

function extractXmlAttribute(
  block,
  tag,
  attribute
) {
  const regex = new RegExp(
    `<${tag}[^>]*\\s${attribute}=["']([^"']+)["'][^>]*>`,
    "i"
  );

  const match = block.match(regex);

  return match
    ? decodeXml(match[1])
    : "";
}

/* =========================================================
   VFB NEWS
========================================================= */

async function fetchVfbNews() {
  try {
    const xml = await httpsRequest(
      VFB_RSS_URL
    );

    const items = [];

    const itemMatches =
      xml.match(
        /<item\b[\s\S]*?<\/item>/gi
      );

    if (!itemMatches) {
      return [];
    }

    for (const item of itemMatches) {
      const title =
        extractXmlTag(
          item,
          "title"
        );

      const link =
        extractXmlTag(
          item,
          "link"
        );

      const pubDate =
        extractXmlTag(
          item,
          "pubDate"
        );

      let description =
        extractXmlTag(
          item,
          "description"
        );

      if (!description) {
        description =
          extractXmlTag(
            item,
            "content:encoded"
          );
      }

      description =
        stripHtml(description);

      let image =
        extractXmlAttribute(
          item,
          "media:content",
          "url"
        );

      if (!image) {
        image =
          extractXmlAttribute(
            item,
            "media:thumbnail",
            "url"
          );
      }

      if (!image) {
        image =
          extractXmlAttribute(
            item,
            "enclosure",
            "url"
          );
      }

      if (
        !image &&
        description
      ) {
        const imageMatch =
          description.match(
            /https?:\/\/[^\s"'<>]+\.(?:jpg|jpeg|png|webp)/i
          );

        if (imageMatch) {
          image =
            imageMatch[0];
        }
      }

      if (!title) {
        continue;
      }

      items.push({
        title,
        link,
        url: link,
        date:
          pubDate || null,
        dateFormatted:
          formatDateTime(pubDate),
        description,
        image
      });
    }

    return items.slice(0, 20);
  } catch (error) {
    console.error(
      "Fehler beim VfB RSS:",
      error.message
    );

    return [];
  }
}

async function getNews() {
  return await fetchVfbNews();
}

/* =========================================================
   TRANSFERS 2026/27
========================================================= */

async function getVfbTransfers() {
  return {
    season: "2026/27",

    arrivals: [
      {
        name: "Grischa Prömel",
        from: "TSG Hoffenheim",
        type: "Transfer"
      },

      {
        name: "Marius Funk",
        from: "Energie Cottbus",
        type: "Transfer"
      },

      {
        name: "Laurin Ulrich",
        from: "1. FC Magdeburg",
        type: "Ende der Leihe"
      },

      {
        name: "Jovan Milosevic",
        from: "SV Werder Bremen",
        type: "Ende der Leihe"
      },

      {
        name: "Leonidas Stergiou",
        from: "1. FC Heidenheim",
        type: "Ende der Leihe"
      },

      {
        name: "Dennis Seimen",
        from: "SC Paderborn 07",
        type: "Ende der Leihe"
      },

      {
        name: "Dzenan Pejcinovic",
        from: "VfL Wolfsburg",
        type: "Transfer"
      }
    ],

    departures: [
      {
        name: "Noah Darvich",
        to: "SV Elversberg",
        type: "Leihe"
      },

      {
        name: "Yannik Keitel",
        to: "FC Augsburg",
        type: "Leihe"
      },

      {
        name: "Florian Hellstern",
        to: "SpVgg Greuther Fürth",
        type: "Leihe"
      },

      {
        name: "Alexander Nübel",
        to: "FC Bayern München",
        type: "Ende der Leihe"
      },

      {
        name: "Pascal Stenzel",
        to: "Ziel unbekannt",
        type: "Abgang"
      },

      {
        name: "Laurin Ulrich",
        to: "SC Paderborn",
        type: "Leihe"
      },

      {
        name: "Jovan Milosevic",
        to: "SC Braga",
        type: "Transfer"
      },

      {
        name: "Lazar Jovanovic",
        to: "Udinese Calcio",
        type: "Transfer"
      },

      {
        name: "Chema",
        to: "Brighton & Hove Albion",
        type: "Transfer"
      },

      {
        name: "Mirza Catovic",
        to: "FC Barcelona II",
        type: "Leihe"
      }
    ]
  };
}
/* =========================================================
   PLAYER STATS
========================================================= */

function parseStatNumber(value) {
  if (
    value === undefined ||
    value === null
  ) {
    return 0;
  }

  const text = String(value)
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (
    !text ||
    text === "-" ||
    text === "–" ||
    text === "—"
  ) {
    return 0;
  }

  const match =
    text.match(/\d+/);

  return match
    ? Number(match[0])
    : 0;
}

/* =========================================================
   PARSE OFFICIAL VFB STATISTICS PAGE
========================================================= */

function parseVfbStatsHtml(html) {
  const statsByName = {};

  if (!html) {
    return statsByName;
  }

  const rowMatches =
    html.match(
      /<tr\b[^>]*>[\s\S]*?<\/tr>/gi
    ) || [];

  for (const row of rowMatches) {
    const cells =
      row.match(
        /<(?:td|th)\b[^>]*>[\s\S]*?<\/(?:td|th)>/gi
      ) || [];

    if (cells.length < 2) {
      continue;
    }

    const cleanCells = cells.map(
      (cell) =>
        cell
          .replace(
            /<[^>]*>/g,
            " "
          )
          .replace(
            /&nbsp;/gi,
            " "
          )
          .replace(
            /&amp;/gi,
            "&"
          )
          .replace(
            /&quot;/gi,
            '"'
          )
          .replace(
            /\s+/g,
            " "
          )
          .trim()
    );

    const name =
      cleanCells[0];

    if (!name) {
      continue;
    }

    const lower =
      name.toLowerCase();

    if (
      lower === "spieler" ||
      lower === "name" ||
      lower.includes("spieler")
    ) {
      continue;
    }

    /*
      Official VfB statistics page:

      Spieler
      Spiele
      Tore
      Assists
      Einwechslung
      Auswechslung
      Gelbe Karte
      Gelbrote Karte
      Rote Karte
      Spielminuten
    */

    if (cleanCells.length >= 10) {
      statsByName[name] = {
        appearances:
          parseStatNumber(
            cleanCells[1]
          ),

        goals:
          parseStatNumber(
            cleanCells[2]
          ),

        assists:
          parseStatNumber(
            cleanCells[3]
          ),

        substitutionsIn:
          parseStatNumber(
            cleanCells[4]
          ),

        substitutionsOut:
          parseStatNumber(
            cleanCells[5]
          ),

        yellowCards:
          parseStatNumber(
            cleanCells[6]
          ),

        secondYellow:
          parseStatNumber(
            cleanCells[7]
          ),

        redCards:
          parseStatNumber(
            cleanCells[8]
          ),

        minutes:
          parseStatNumber(
            cleanCells[9]
          )
      };
    }
  }

  return statsByName;
}

/* =========================================================
   GET VFB SQUAD + OFFICIAL STATS
========================================================= */

async function getVfbSquad() {
  const baseSquad =
    VFB_SQUAD.map((player) => ({
      ...player,

      stats: {
        appearances: 0,
        goals: 0,
        assists: 0,
        substitutionsIn: 0,
        substitutionsOut: 0,
        yellowCards: 0,
        secondYellow: 0,
        redCards: 0,
        minutes: 0
      }
    }));

  try {
    const html =
      await httpsRequest(
        VFB_STATS_URL
      );

    const stats =
      parseVfbStatsHtml(html);

    const normalizedStats =
      {};

    for (
      const [name, value]
      of Object.entries(stats)
    ) {
      normalizedStats[
        name
          .toLowerCase()
          .replace(
            /ä/g,
            "a"
          )
          .replace(
            /ö/g,
            "o"
          )
          .replace(
            /ü/g,
            "u"
          )
          .replace(
            /ß/g,
            "ss"
          )
          .replace(
            /[^a-z0-9]/g,
            ""
          )
      ] = value;
    }

    return baseSquad.map(
      (player) => {
        const key =
          player.name
            .toLowerCase()
            .replace(
              /ä/g,
              "a"
            )
            .replace(
              /ö/g,
              "o"
            )
            .replace(
              /ü/g,
              "u"
            )
            .replace(
              /ß/g,
              "ss"
            )
            .replace(
              /[^a-z0-9]/g,
              ""
            );

        return {
          ...player,
          stats:
            normalizedStats[key] ||
            player.stats
        };
      }
    );
  } catch (error) {
    console.error(
      "Fehler bei VfB Kader/Statistik:",
      error.message
    );

    return baseSquad;
  }
}

/* =========================================================
   DASHBOARD
========================================================= */

async function buildDashboard() {
  console.log(
    "Dashboard wird aktualisiert..."
  );

  const [
    matches,
    table,
    news,
    transfers,
    squad
  ] = await Promise.all([
    getVfbMatches(),
    getBundesligaTable(),
    getNews(),
    getVfbTransfers(),
    getVfbSquad()
  ]);

  const dashboard = {
    success: true,

    generatedAt:
      new Date().toISOString(),

    attribution:
      "Data provided by football-data.org",

    nextGame:
      matches.nextGame,

    fixtures:
      matches.fixtures,

    championsLeague:
      [],

    table,

    news,

    transfers,

    squad
  };

  /*
   * Champions League:
   * VfB Champions-League-Spiele werden separat
   * aus den API-Daten gefiltert.
   */

  try {
    const clData =
      await apiRequest(
        `/teams/${VFB_TEAM_ID}/matches?competitions=CL`
      );

    dashboard.championsLeague =
      Array.isArray(
        clData.matches
      )
        ? clData.matches
            .map(mapMatch)
            .sort(
              (a, b) =>
                new Date(a.date || 0) -
                new Date(b.date || 0)
            )
            .slice(0, 8)
        : [];
  } catch (error) {
    console.error(
      "Fehler bei Champions League:",
      error.message
    );

    dashboard.championsLeague =
      [];
  }

  return dashboard;
  

  

  /* =========================================================
   CACHE
========================================================= */

let dashboardCache = null;
let dashboardCacheTime = 0;

async function getDashboard() {
  const now = Date.now();

  if (
    dashboardCache &&
    now - dashboardCacheTime < CACHE_TIME
  ) {
    return dashboardCache;
  }

  const dashboard =
    await buildDashboard();

  dashboardCache =
    dashboard;

  dashboardCacheTime =
    now;

  return dashboard;
}

/* =========================================================
   STATIC FILE SERVER
========================================================= */

function getContentType(filePath) {
  const ext =
    path.extname(filePath)
      .toLowerCase();

  const types = {
    ".html":
      "text/html; charset=utf-8",

    ".js":
      "application/javascript; charset=utf-8",

    ".css":
      "text/css; charset=utf-8",

    ".json":
      "application/json; charset=utf-8",

    ".png":
      "image/png",

    ".jpg":
      "image/jpeg",

    ".jpeg":
      "image/jpeg",

    ".gif":
      "image/gif",

    ".svg":
      "image/svg+xml",

    ".webp":
      "image/webp",

    ".ico":
      "image/x-icon",

    ".txt":
      "text/plain; charset=utf-8",

    ".woff":
      "font/woff",

    ".woff2":
      "font/woff2"
  };

  return (
    types[ext] ||
    "application/octet-stream"
  );
}

function sendFile(
  res,
  filePath
) {
  fs.readFile(
    filePath,
    (error, data) => {
      if (error) {
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
            getContentType(
              filePath
            ),

          "Cache-Control":
            "public, max-age=300"
        }
      );

      res.end(data);
    }
  );
}

/* =========================================================
   REQUEST URL HELPERS
========================================================= */

function getRequestPath(req) {
  try {
    return new URL(
      req.url,
      `http://${req.headers.host || "localhost"}`
    ).pathname;
  } catch {
    return "/";
  }
}

function safePathname(pathname) {
  try {
    return decodeURIComponent(
      pathname
    );
  } catch {
    return pathname;
  }
}

/* =========================================================
   STATIC ROUTING
========================================================= */

function serveStatic(req, res) {
  let pathname =
    safePathname(
      getRequestPath(req)
    );

  if (
    pathname === "/" ||
    pathname === ""
  ) {
    pathname =
      "/index.html";
  }

  /*
   * Verhindert Path Traversal.
   */
  const normalized =
    path.normalize(
      pathname
    );

  if (
    normalized.includes("..")
  ) {
    res.writeHead(
      403,
      {
        "Content-Type":
          "text/plain; charset=utf-8"
      }
    );

    res.end(
      "Forbidden"
    );

    return;
  }

  const filePath =
    path.join(
      __dirname,
      normalized
    );

  /*
   * Nur Dateien innerhalb
   * des Server-Verzeichnisses
   * ausliefern.
   */
  const root =
    path.resolve(
      __dirname
    );

  const resolved =
    path.resolve(
      filePath
    );

  if (
    !resolved.startsWith(
      root
    )
  ) {
    res.writeHead(
      403,
      {
        "Content-Type":
          "text/plain; charset=utf-8"
      }
    );

    res.end(
      "Forbidden"
    );

    return;
  }

  fs.stat(
    resolved,
    (error, stats) => {
      if (
        error ||
        !stats.isFile()
      ) {
        /*
         * SPA-Fallback:
         * Wenn keine Datei gefunden
         * wurde, versuchen wir
         * index.html.
         */
        const indexFile =
          path.join(
            __dirname,
            "index.html"
          );

        fs.stat(
          indexFile,
          (indexError, indexStats) => {
            if (
              indexError ||
              !indexStats.isFile()
            ) {
              res.writeHead(
                404,
                {
                  "Content-Type":
                    "text/plain; charset=utf-8"
                }
              );

              res.end(
                "Seite nicht gefunden"
              );

              return;
            }

            sendFile(
              res,
              indexFile
            );
          }
        );

        return;
      }

      sendFile(
        res,
        resolved
      );
    }
  );
}

/* =========================================================
   API ROUTES
========================================================= */

async function handleApiRequest(
  req,
  res
) {
  const pathname =
    getRequestPath(req);

  /*
   * Besucherstatistik
   */
  if (
    pathname ===
    "/api/stats"
  ) {
    trackVisitor(
      req,
      res
    );

    sendJson(
      res,
      200,
      {
        success: true,

        day:
          visitorStats.day,

        visitorsToday:
          visitorStats.visitorsToday,

        pageViewsToday:
          visitorStats.pageViewsToday,

        totalVisitors:
          visitorStats.totalVisitors,

        totalPageViews:
          visitorStats.totalPageViews
      }
    );

    return true;
  }

  /*
   * Dashboard
   */
  if (
    pathname ===
    "/api/dashboard"
  ) {
    try {
      const dashboard =
        await getDashboard();

      sendJson(
        res,
        200,
        dashboard
      );
    } catch (error) {
      console.error(
        "Dashboard API Fehler:",
        error
      );

      sendJson(
        res,
        500,
        {
          success: false,
          error:
            "Dashboard konnte nicht geladen werden."
        }
      );
    }

    return true;
  }

  /*
   * Health Check
   */
  if (
    pathname ===
    "/health"
  ) {
    sendJson(
      res,
      200,
      {
        success: true,
        status: "ok",
        service:
          "Cannstatt 1893 News",
        timestamp:
          new Date().toISOString()
      }
    );

    return true;
  }

  return false;
}

/* =========================================================
   HTTP SERVER
========================================================= */

const server =
  http.createServer(
    async (req, res) => {
      try {
        /*
         * CORS / API Header
         */
        res.setHeader(
          "Access-Control-Allow-Origin",
          "*"
        );

        res.setHeader(
          "Access-Control-Allow-Methods",
          "GET, OPTIONS"
        );

        res.setHeader(
          "Access-Control-Allow-Headers",
          "Content-Type"
        );

        /*
         * OPTIONS
         */
        if (
          req.method ===
          "OPTIONS"
        ) {
          res.writeHead(
            204
          );

          res.end();

          return;
        }

        /*
         * Nur GET wird benötigt.
         */
        if (
          req.method !==
          "GET"
        ) {
          res.writeHead(
            405,
            {
              "Content-Type":
                "text/plain; charset=utf-8",
              "Allow":
                "GET, OPTIONS"
            }
          );

          res.end(
            "Method Not Allowed"
          );

          return;
        }

        /*
         * API
         */
        const handled =
          await handleApiRequest(
            req,
            res
          );

        if (handled) {
          return;
        }

        /*
         * Statische Dateien
         */
        serveStatic(
          req,
          res
        );
      } catch (error) {
        console.error(
          "Serverfehler:",
          error
        );

        if (
          !res.headersSent
        ) {
          res.writeHead(
            500,
            {
              "Content-Type":
                "text/plain; charset=utf-8"
            }
          );
        }

        res.end(
          "Interner Serverfehler"
        );
      }
    }
  );
  /* =========================================================
   CACHE
========================================================= */

async function getDashboard() {
  const now =
    Date.now();

  if (
    dashboardCache &&
    now - dashboardCacheTime <
      CACHE_TIME
  ) {
    return dashboardCache;
  }

  try {
    const dashboard =
      await buildDashboard();

    dashboardCache =
      dashboard;

    dashboardCacheTime =
      now;

    return dashboard;
  } catch (error) {
    console.error(
      "Dashboard-Fehler:",
      error
    );

    if (dashboardCache) {
      return dashboardCache;
    }

    return {
      success: false,
      generatedAt:
        new Date().toISOString(),
      attribution:
        "Data provided by football-data.org",
      nextGame: null,
      fixtures: [],
      championsLeague: [],
      table: [],
      news: [],
      transfers: {
        season: "2026/27",
        arrivals: [],
        departures: []
      },
      squad:
        VFB_SQUAD.map(
          (player) => ({
            ...player,
            stats: {
              appearances: 0,
              goals: 0,
              assists: 0,
              substitutionsIn: 0,
              substitutionsOut: 0,
              yellowCards: 0,
              secondYellow: 0,
              redCards: 0,
              minutes: 0
            }
          })
        ),
      error:
        error.message
    };
  }
}

/* =========================================================
   STATIC FILE SERVER
========================================================= */

const publicDirectory =
  __dirname;

function getContentType(
  filePath
) {
  const ext =
    path
      .extname(filePath)
      .toLowerCase();

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

function serveStatic(
  req,
  res
) {
  let requestedPath =
    req.url.split("?")[0];

  if (
    requestedPath === "/" ||
    requestedPath === ""
  ) {
    requestedPath =
      "/index.html";
  }

  let filePath =
    path.join(
      publicDirectory,
      requestedPath
    );

  /*
   * Sicherheit:
   * Keine Dateien außerhalb des Projektordners ausliefern.
   */

  const resolvedRoot =
    path.resolve(
      publicDirectory
    );

  const resolvedPath =
    path.resolve(filePath);

  if (
    !resolvedPath.startsWith(
      resolvedRoot
    )
  ) {
    res.writeHead(403, {
      "Content-Type":
        "text/plain; charset=utf-8"
    });

    res.end(
      "Forbidden"
    );

    return;
  }

  fs.stat(
    filePath,
    (error, stats) => {
      if (
        !error &&
        stats.isFile()
      ) {
        const contentType =
          getContentType(
            filePath
          );

        res.writeHead(
          200,
          {
            "Content-Type":
              contentType,

            "Cache-Control":
              "public, max-age=300"
          }
        );

        fs.createReadStream(
          filePath
        ).pipe(res);

        return;
      }

      /*
       * SPA/Fallback:
       * Wenn keine Datei gefunden wurde,
       * index.html ausliefern.
       */

      const fallback =
        path.join(
          publicDirectory,
          "index.html"
        );

      fs.readFile(
        fallback,
        (fallbackError, data) => {
          if (
            fallbackError
          ) {
            res.writeHead(
              404,
              {
                "Content-Type":
                  "text/plain; charset=utf-8"
              }
            );

            res.end(
              "404 - Seite nicht gefunden"
            );

            return;
          }

          res.writeHead(
            200,
            {
              "Content-Type":
                "text/html; charset=utf-8",

              "Cache-Control":
                "no-cache"
            }
          );

          res.end(data);
        }
      );
    }
  );
}

/* =========================================================
   SERVER
========================================================= */

const server =
  http.createServer(
    async (req, res) => {
      /*
       * CORS
       */

      res.setHeader(
        "Access-Control-Allow-Origin",
        "*"
      );

      res.setHeader(
        "Access-Control-Allow-Methods",
        "GET, OPTIONS"
      );

      res.setHeader(
        "Access-Control-Allow-Headers",
        "Content-Type"
      );

      /*
       * OPTIONS
       */

      if (
        req.method ===
        "OPTIONS"
      ) {
        res.writeHead(
          204
        );

        res.end();

        return;
      }

      /*
       * API: Besucher-Ticker
       */

      if (
        req.url.startsWith(
          "/api/stats"
        )
      ) {
        if (req.method !== "GET") {
          sendJson(res, 405, { error: "Method not allowed" });
          return;
        }

        const stats = trackVisitor(req, res);
        sendJson(res, 200, stats);
        return;
      }

      /*
       * API: Dashboard
       */

      if (
        req.url.startsWith(
          "/api/dashboard"
        )
      ) {
        if (
          req.method !==
          "GET"
        ) {
          res.writeHead(
            405,
            {
              "Content-Type":
                "application/json; charset=utf-8"
            }
          );

          res.end(
            JSON.stringify({
              error:
                "Method not allowed"
            })
          );

          return;
        }

        try {
          const data =
            await getDashboard();

          res.writeHead(
            200,
            {
              "Content-Type":
                "application/json; charset=utf-8",

              "Cache-Control":
                "no-cache"
            }
          );

          res.end(
            JSON.stringify(data)
          );
        } catch (error) {
          console.error(
            "API dashboard error:",
            error
          );

          res.writeHead(
            500,
            {
              "Content-Type":
                "application/json; charset=utf-8"
            }
          );

          res.end(
            JSON.stringify({
              success: false,
              error:
                error.message
            })
          );
        }

        return;
      }

      /*
       * Health Check
       */

      if (
        req.url.startsWith(
          "/health"
        )
      ) {
        res.writeHead(
          200,
          {
            "Content-Type":
              "application/json; charset=utf-8"
          }
        );

        res.end(
          JSON.stringify({
            status: "ok",
            service:
              "Cannstatt 1893 News",
            timestamp:
              new Date().toISOString()
          })
        );

        return;
      }

      /*
       * Favicon / robots
       * einfach normal statisch behandeln
       */

      serveStatic(
        req,
        res
      );
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
      `Football-data Token vorhanden: ${
        TOKEN ? "JA" : "NEIN"
      }`
    );
  }
);

/* =========================================================
   ERROR HANDLING
========================================================= */

process.on(
  "uncaughtException",
  (error) => {
    console.error(
      "Uncaught Exception:",
      error
    );
  }
);

process.on(
  "unhandledRejection",
  (error) => {
    console.error(
      "Unhandled Rejection:",
      error
    );
  }
);
  
