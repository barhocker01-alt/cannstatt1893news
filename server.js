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

  let visitorId = getCookie(
    req,
    "c1893_visitor"
  );

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

  activeVisitors.set(
    visitorId,
    Date.now()
  );

  const cutoff =
    Date.now() - ACTIVE_WINDOW;

  for (const [
    id,
    lastSeen
  ] of activeVisitors) {
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

function sendJson(
  res,
  statusCode,
  data
) {
  res.writeHead(
    statusCode,
    {
      "Content-Type":
        "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  );

  res.end(
    JSON.stringify(data)
  );
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

function httpsRequest(
  url,
  options = {}
) {
  return new Promise(
    (resolve, reject) => {
      const req = https.get(
        url,
        {
          headers: {
            "User-Agent":
              "Cannstatt1893News/1.0",
            Accept: "*/*",
            ...(options.headers || {})
          }
        },
        (res) => {
          let data = "";

          res.setEncoding("utf8");

          res.on(
            "data",
            (chunk) => {
              data += chunk;
            }
          );

          res.on(
            "end",
            () => {
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
            }
          );
        }
      );

      req.on(
        "error",
        reject
      );

      req.setTimeout(
        20000,
        () => {
          req.destroy(
            new Error(
              `Timeout for ${url}`
            )
          );
        }
      );
    }
  );
}

async function apiRequest(
  endpoint
) {
  if (!TOKEN) {
    throw new Error(
      "FOOTBALL_DATA_TOKEN is not configured"
    );
  }

  const url =
    "https://api.football-data.org/v4" +
    endpoint;

  const raw =
    await httpsRequest(
      url,
      {
        headers: {
          "X-Auth-Token": TOKEN
        }
      }
    );

  return JSON.parse(raw);
}

/* =========================================================
   DATE HELPERS
========================================================= */

function formatDate(
  dateString
) {
  if (!dateString) return "";

  const date =
    new Date(dateString);

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return dateString;
  }

  return new Intl.DateTimeFormat(
    "de-DE",
    {
      day: "2-digit",
      month: "2-digit",
      year: "numeric"
    }
  ).format(date);
}

function formatDateTime(
  dateString
) {
  if (!dateString) return "";

  const date =
    new Date(dateString);

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return dateString;
  }

  return new Intl.DateTimeFormat(
    "de-DE",
    {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    }
  ).format(date);
}

/* =========================================================
   MATCH MAPPING
========================================================= */

function mapMatch(
  match
) {
  if (!match) return null;

  const home =
    match.homeTeam || {};

  const away =
    match.awayTeam || {};

  return {
    id: match.id,

    competition:
      match.competition?.name ||
      match.competition?.code ||
      "",

    competitionCode:
      match.competition?.code ||
      "",

    date:
      match.utcDate || null,

    dateFormatted:
      formatDate(
        match.utcDate
      ),

    dateTimeFormatted:
      formatDateTime(
        match.utcDate
      ),

    status:
      match.status || "",

    matchday:
      match.matchday || null,

    homeTeam: {
      id: home.id || null,
      name: home.name || "",
      shortName:
        home.shortName || "",
      tla: home.tla || "",
      crest:
        home.crest || ""
    },

    awayTeam: {
      id: away.id || null,
      name: away.name || "",
      shortName:
        away.shortName || "",
      tla: away.tla || "",
      crest:
        away.crest || ""
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

    venue:
      match.venue || ""
  };
}

/* =========================================================
   VFB MATCHES
========================================================= */

async function getVfbMatches() {
  try {
    const data =
      await apiRequest(
        `/teams/${VFB_TEAM_ID}/matches?status=SCHEDULED,IN_PLAY,PAUSED,FINISHED`
      );

    const matches =
      Array.isArray(data.matches)
        ? data.matches
        : [];

    const sorted =
      matches
        .map(mapMatch)
        .sort(
          (a, b) =>
            new Date(a.date || 0) -
            new Date(b.date || 0)
        );

    const now =
      Date.now();

    let nextGame =
      sorted.find(
        (match) =>
          match.date &&
          new Date(
            match.date
          ).getTime() >= now &&
          match.status !==
            "FINISHED"
      ) || null;

    const fixtures =
      sorted.filter(
        (match) => {
          if (!match.date)
            return false;

          const isBundesliga =
            match.competitionCode ===
              "BL1" ||
            match.competition
              ?.toLowerCase()
              .includes(
                "bundesliga"
              );

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
    const data =
      await apiRequest(
        "/competitions/BL1/standings"
      );

    const table =
      data.standings?.find(
        (standing) =>
          standing.type ===
          "TOTAL"
      ) ||
      data.standings?.[0];

    if (
      !table ||
      !Array.isArray(
        table.table
      )
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
            entry.team
              ?.shortName || "",

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
          entry.goalDifference ??
          0
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

function decodeXml(
  value
) {
  if (!value) return "";

  return value
    .replace(
      /<!\[CDATA\[(.*?)\]\]>/gs,
      "$1"
    )
    .replace(
      /&amp;/g,
      "&"
    )
    .replace(
      /&quot;/g,
      '"'
    )
    .replace(
      /&apos;/g,
      "'"
    )
    .replace(
      /&lt;/g,
      "<"
    )
    .replace(
      /&gt;/g,
      ">"
    )
    .trim();
}

function stripHtml(
  value
) {
  if (!value) return "";

  return value
    .replace(
      /<[^>]*>/g,
      " "
    )
    .replace(
      /\s+/g,
      " "
    )
    .trim();
}

function extractXmlTag(
  block,
  tag
) {
  const regex =
    new RegExp(
      `<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`,
      "i"
    );

  const match =
    block.match(regex);

  return match
    ? decodeXml(
        match[1]
      )
    : "";
}

function extractXmlAttribute(
  block,
  tag,
  attribute
) {
  const regex =
    new RegExp(
      `<${tag}[^>]*\\s${attribute}=["']([^"']+)["'][^>]*>`,
      "i"
    );

  const match =
    block.match(regex);

  return match
    ? decodeXml(
        match[1]
      )
    : "";
}

/* =========================================================
   VFB NEWS
========================================================= */

async function fetchVfbNews() {
  try {
    const xml =
      await httpsRequest(
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

    for (
      const item of itemMatches
    ) {
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
        stripHtml(
          description
        );

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
          formatDateTime(
            pubDate
          ),

        description,
        image
      });
    }

    return items.slice(
      0,
      20
    );
  } catch (error) {
    console.error(
      "Fehler beim VfB RSS:",
      error.message
    );

    return [];
  }
}

/* =========================================================
   EXTERNE NEWSQUELLEN
========================================================= */

const EXTERNAL_NEWS_FEEDS = [
  {
    source: "kicker",
    label: "kicker",
    url:
      "https://newsfeed.kicker.de/news/bundesliga"
  },

  {
    source: "Sportschau",
    label: "Sportschau",
    url:
      "https://www.sportschau.de/index~rss2.xml"
  }
];

function normalizeNewsText(
  value
) {
  return String(
    value || ""
  )
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
      /&#039;/gi,
      "'"
    )
    .replace(
      /\s+/g,
      " "
    )
    .trim();
}

function isVfbRelatedNews(
  item
) {
  const text =
    normalizeNewsText(
      [
        item.title,
        item.description,
        item.link
      ]
        .filter(Boolean)
        .join(" ")
    ).toLowerCase();

  return (
    text.includes(
      "vfb stuttgart"
    ) ||
    text.includes("vfb") ||
    text.includes(
      "stuttgart"
    ) ||
    text.includes(
      "hoeneß"
    ) ||
    text.includes(
      "hoeness"
    ) ||
    text.includes(
      "undav"
    ) ||
    text.includes(
      "demirovic"
    ) ||
    text.includes(
      "demirović"
    ) ||
    text.includes(
      "führich"
    ) ||
    text.includes(
      "stiller"
    ) ||
    text.includes(
      "leweling"
    ) ||
    text.includes(
      "pejcinovic"
    ) ||
    text.includes(
      "pejcinović"
    ) ||
    text.includes(
      "bouanani"
    ) ||
    text.includes(
      "chabot"
    ) ||
    text.includes(
      "jeltsch"
    ) ||
    text.includes(
      "karazor"
    ) ||
    text.includes(
      "tiago tom"
    )
  );
}

async function fetchExternalRssFeed(
  feed
) {
  try {
    const xml =
      await httpsRequest(
        feed.url
      );

    const itemMatches =
      xml.match(
        /<item\b[\s\S]*?<\/item>/gi
      ) || [];

    const items = [];

    for (
      const item of itemMatches.slice(
        0,
        80
      )
    ) {
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
        ) ||
        extractXmlTag(
          item,
          "dc:date"
        ) ||
        extractXmlTag(
          item,
          "date"
        );

      const description =
        normalizeNewsText(
          extractXmlTag(
            item,
            "description"
          ) ||
            extractXmlTag(
              item,
              "content:encoded"
            ) ||
            extractXmlTag(
              item,
              "summary"
            )
        );

      if (
        !title ||
        !link
      ) {
        continue;
      }

      const newsItem = {
        title,
        link,
        url: link,
        date:
          pubDate || null,

        dateFormatted:
          formatDateTime(
            pubDate
          ),

        description,
        image: "",

        source:
          feed.source,

        sourceLabel:
          feed.label
      };

      if (
        isVfbRelatedNews(
          newsItem
        )
      ) {
        items.push(
          newsItem
        );
      }
    }

    return items;
  } catch (error) {
    console.error(
      `Fehler beim externen Newsfeed ${feed.source}:`,
      error.message
    );

    return [];
  }
}

function newsTimestamp(
  item
) {
  const value =
    item?.date ||
    item?.pubDate ||
    item?.dateFormatted;

  const timestamp =
    value
      ? new Date(
          value
        ).getTime()
      : 0;

  return Number.isNaN(
    timestamp
  )
    ? 0
    : timestamp;
}

async function getNews() {
  const officialPromise =
    fetchVfbNews();

  const externalPromises =
    EXTERNAL_NEWS_FEEDS.map(
      fetchExternalRssFeed
    );

  const [
    official,
    ...external
  ] =
    await Promise.all([
      officialPromise,
      ...externalPromises
    ]);

  const officialItems =
    (
      Array.isArray(
        official
      )
        ? official
        : []
    ).map(
      (item) => ({
        ...item,
        source:
          "VfB Stuttgart",
        sourceLabel:
          "VfB.de"
      })
    );

  const merged = [
    ...officialItems,
    ...external.flat()
  ]
    .filter(
      (item) =>
        item &&
        item.title &&
        item.link
    )
    .sort(
      (a, b) =>
        newsTimestamp(
          b
        ) -
        newsTimestamp(
          a
        )
    );

  const seen =
    new Set();

  const unique = [];

  for (
    const item of merged
  ) {
    const key =
      `${normalizeNewsText(
        item.title
      ).toLowerCase()}|${
        item.source || ""
      }`;

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
// ============================================================
// TEIL 2/3 – TRANSFERS, SPIELERSTATISTIK, KADER & DASHBOARD
// ============================================================

async function getTransfers() {
  const transfers = [
    {
      type: "Zugang",
      player: "Grischa Prömel",
      from: "TSG Hoffenheim",
      to: "VfB Stuttgart"
    },
    {
      type: "Zugang",
      player: "Marius Funk",
      from: "Energie Cottbus",
      to: "VfB Stuttgart"
    },
    {
      type: "Zugang",
      player: "Laurin Ulrich",
      from: "1. FC Magdeburg",
      to: "VfB Stuttgart"
    },
    {
      type: "Zugang",
      player: "Jovan Milosevic",
      from: "SV Werder Bremen",
      to: "VfB Stuttgart"
    },
    {
      type: "Zugang",
      player: "Leonidas Stergiou",
      from: "1. FC Heidenheim",
      to: "VfB Stuttgart"
    },
    {
      type: "Zugang",
      player: "Dennis Seimen",
      from: "SC Paderborn 07",
      to: "VfB Stuttgart"
    },
    {
      type: "Zugang",
      player: "Dzenan Pejcinovic",
      from: "VfL Wolfsburg",
      to: "VfB Stuttgart"
    },

    {
      type: "Abgang",
      player: "Noah Darvich",
      from: "VfB Stuttgart",
      to: "SV Elversberg",
      loan: true
    },
    {
      type: "Abgang",
      player: "Yannik Keitel",
      from: "VfB Stuttgart",
      to: "FC Augsburg",
      loan: true
    },
    {
      type: "Abgang",
      player: "Florian Hellstern",
      from: "VfB Stuttgart",
      to: "SpVgg Greuther Fürth",
      loan: true
    },
    {
      type: "Abgang",
      player: "Alexander Nübel",
      from: "VfB Stuttgart",
      to: "FC Bayern München"
    },
    {
      type: "Abgang",
      player: "Pascal Stenzel",
      from: "VfB Stuttgart",
      to: "Ziel unbekannt"
    },
    {
      type: "Abgang",
      player: "Laurin Ulrich",
      from: "VfB Stuttgart",
      to: "SC Paderborn",
      loan: true
    },
    {
      type: "Abgang",
      player: "Jovan Milosevic",
      from: "VfB Stuttgart",
      to: "SC Braga"
    },
    {
      type: "Abgang",
      player: "Lazar Jovanovic",
      from: "VfB Stuttgart",
      to: "Udinese Calcio"
    },
    {
      type: "Abgang",
      player: "Chema",
      from: "VfB Stuttgart",
      to: "Brighton & Hove Albion"
    },
    {
      type: "Abgang",
      player: "Mirza Catovic",
      from: "VfB Stuttgart",
      to: "FC Barcelona II",
      loan: true
    }
  ];

  return transfers;
}


// ============================================================
// SPIELERSTATISTIK
// ============================================================

const VFB_PLAYER_STATS = {
  "Fabian Bredlow": {
    appearances: 1,
    goals: 0,
    assists: 0,
    minutes: 90,
    yellow: 0,
    red: 0
  },

  "Ramon Hendriks": {
    appearances: 1,
    goals: 0,
    assists: 0,
    minutes: 90,
    yellow: 0,
    red: 0
  },

  "Josha Vagnoman": {
    appearances: 1,
    goals: 1,
    assists: 0,
    minutes: 90,
    yellow: 0,
    red: 0
  },

  "Maximilian Mittelstädt": {
    appearances: 1,
    goals: 0,
    assists: 0,
    minutes: 90,
    yellow: 0,
    red: 0
  },

  "Leonidas Stergiou": {
    appearances: 1,
    goals: 0,
    assists: 0,
    minutes: 16,
    yellow: 0,
    red: 0
  },

  "Jeff Chabot": {
    appearances: 1,
    goals: 0,
    assists: 0,
    minutes: 74,
    yellow: 1,
    red: 0
  },

  "Finn Jeltsch": {
    appearances: 1,
    goals: 0,
    assists: 0,
    minutes: 90,
    yellow: 1,
    red: 0
  },

  "Angelo Stiller": {
    appearances: 1,
    goals: 0,
    assists: 0,
    minutes: 88,
    yellow: 0,
    red: 0
  },

  "Bilal El Khannouss": {
    appearances: 1,
    goals: 0,
    assists: 0,
    minutes: 16,
    yellow: 0,
    red: 0
  },

  "Grischa Prömel": {
    appearances: 1,
    goals: 0,
    assists: 0,
    minutes: 90,
    yellow: 1,
    red: 0
  },

  "Tiago Tomás": {
    appearances: 1,
    goals: 0,
    assists: 0,
    minutes: 62,
    yellow: 0,
    red: 0
  },

  "Ermedin Demirovic": {
    appearances: 1,
    goals: 0,
    assists: 0,
    minutes: 27,
    yellow: 0,
    red: 0
  },

  "Dzenan Pejcinovic": {
    appearances: 1,
    goals: 0,
    assists: 0,
    minutes: 63,
    yellow: 0,
    red: 0
  },

  "Jamie Leweling": {
    appearances: 1,
    goals: 0,
    assists: 0,
    minutes: 28,
    yellow: 0,
    red: 0
  },

  "Deniz Undav": {
    appearances: 1,
    goals: 0,
    assists: 0,
    minutes: 74,
    yellow: 0,
    red: 0
  }
};


// ============================================================
// SPIELERSTATISTIK AUSGEBEN
// ============================================================

async function getPlayerStats() {
  return Object.entries(VFB_SQUAD).map(([position, players]) => {
    return {
      position,
      players: players.map(player => {
        const stats = VFB_PLAYER_STATS[player.name] || {
          appearances: 0,
          goals: 0,
          assists: 0,
          minutes: 0,
          yellow: 0,
          red: 0
        };

        return {
          ...player,
          stats
        };
      })
    };
  });
}


// ============================================================
// KADER
// ============================================================

async function getVfbSquad() {
  return {
    coach: "Sebastian Hoeneß",

    goalkeepers: [
      {
        name: "Fabian Bredlow",
        number: null,
        position: "Torwart",
        image:
          "https://www.vfb.de/fileadmin/_processed_/9/4/csm_Bredlow_Fabian_2526_01_8d4f4e4d5e.jpg"
      },
      {
        name: "Marius Funk",
        number: null,
        position: "Torwart",
        image:
          "https://www.vfb.de/fileadmin/_processed_/2/4/csm_Funk_Marius_2526_01_0d5b9c6f1d.jpg"
      },
      {
        name: "Dennis Seimen",
        number: null,
        position: "Torwart",
        image:
          "https://www.vfb.de/fileadmin/_processed_/f/4/csm_Seimen_Dennis_2526_01_7b7c8e3c8d.jpg"
      },
      {
        name: "Stefan Drljaca",
        number: null,
        position: "Torwart",
        image:
          "https://www.vfb.de/fileadmin/_processed_/a/2/csm_Drljaca_Stefan_2526_01_7d6d3f1b4f.jpg"
      }
    ],

    defenders: [
      {
        name: "Ameen Al-Dakhil",
        number: null,
        position: "Abwehr",
        image:
          "https://www.vfb.de/fileadmin/_processed_/a/d/csm_Al-Dakhil_Ameen_2526_01_7d4f3d5a7f.jpg"
      },
      {
        name: "Ramon Hendriks",
        number: null,
        position: "Abwehr",
        image:
          "https://www.vfb.de/fileadmin/_processed_/8/0/csm_Hendriks_Ramon_2526_01_5f1e2a9c7b.jpg"
      },
      {
        name: "Josha Vagnoman",
        number: null,
        position: "Abwehr",
        image:
          "https://www.vfb.de/fileadmin/_processed_/4/7/csm_Vagnoman_Josha_2526_01_6a9f7e5c3d.jpg"
      },
      {
        name: "Maximilian Mittelstädt",
        number: null,
        position: "Abwehr",
        image:
          "https://www.vfb.de/fileadmin/_processed_/2/3/csm_Mittelstaedt_Maximilian_2526_01_8e4f6c2a1b.jpg"
      },
      {
        name: "Luca Jaquez",
        number: null,
        position: "Abwehr",
        image:
          "https://www.vfb.de/fileadmin/_processed_/b/1/csm_Jaquez_Luca_2526_01_5d7a9c2e4f.jpg"
      },
      {
        name: "Leonidas Stergiou",
        number: null,
        position: "Abwehr",
        image:
          "https://www.vfb.de/fileadmin/_processed_/6/8/csm_Stergiou_Leonidas_2526_01_4f8d2c6a9e.jpg"
      },
      {
        name: "Lorenz Assignon",
        number: null,
        position: "Abwehr",
        image:
          "https://www.vfb.de/fileadmin/_processed_/3/5/csm_Assignon_Lorenz_2526_01_9c7e5a3d1f.jpg"
      },
      {
        name: "Dan-Axel Zagadou",
        number: null,
        position: "Abwehr",
        image:
          "https://www.vfb.de/fileadmin/_processed_/0/0/csm_Zagadou_Dan-Axel_2526_01.jpg"
      },
      {
        name: "Jeff Chabot",
        number: null,
        position: "Abwehr",
        image:
          "https://www.vfb.de/fileadmin/_processed_/7/4/csm_Chabot_Jeff_2526_01_6f2a8d4c1e.jpg"
      },
      {
        name: "Finn Jeltsch",
        number: null,
        position: "Abwehr",
        image:
          "https://www.vfb.de/fileadmin/_processed_/5/9/csm_Jeltsch_Finn_2526_01_2e8c4a6d1f.jpg"
      }
    ],

    midfielders: [
      {
        name: "Angelo Stiller",
        number: null,
        position: "Mittelfeld",
        image:
          "https://www.vfb.de/fileadmin/_processed_/4/2/csm_Stiller_Angelo_2526_01_9e7d5c3a1f.jpg"
      },
      {
        name: "Chris Führich",
        number: null,
        position: "Mittelfeld",
        image:
          "https://www.vfb.de/fileadmin/_processed_/1/8/csm_Fuehrich_Chris_2526_01_6d4f8a2c9e.jpg"
      },
      {
        name: "Bilal El Khannouss",
        number: null,
        position: "Mittelfeld",
        image:
          "https://www.vfb.de/fileadmin/_processed_/8/3/csm_El-Khannouss_Bilal_2526_01_5a7c9e2d4f.jpg"
      },
      {
        name: "Atakan Karazor",
        number: null,
        position: "Mittelfeld",
        image:
          "https://www.vfb.de/fileadmin/_processed_/2/6/csm_Karazor_Atakan_2526_01_8c4e6a1d9f.jpg"
      },
      {
        name: "Grischa Prömel",
        number: null,
        position: "Mittelfeld",
        image:
          "https://www.vfb.de/fileadmin/_processed_/9/1/csm_Proemel_Grischa_2526_01_7e5c3a9d2f.jpg"
      },
      {
        name: "Nikolas Nartey",
        number: null,
        position: "Mittelfeld",
        image:
          "https://www.vfb.de/fileadmin/_processed_/5/2/csm_Nartey_Nikolas_2526_01_4a8c6e1d3f.jpg"
      },
      {
        name: "Ertugrul Yigit",
        number: null,
        position: "Mittelfeld",
        image: ""
      },
      {
        name: "Jarzinho Malanga",
        number: null,
        position: "Mittelfeld",
        image: ""
      }
    ],

    forwards: [
      {
        name: "Tiago Tomás",
        number: null,
        position: "Sturm",
        image:
          "https://www.vfb.de/fileadmin/_processed_/3/9/csm_Tomas_Tiago_2526_01_8a6d4f2c1e.jpg"
      },
      {
        name: "Ermedin Demirovic",
        number: null,
        position: "Sturm",
        image:
          "https://www.vfb.de/fileadmin/_processed_/6/1/csm_Demirovic_Ermedin_2526_01_4e8c2a6d9f.jpg"
      },
      {
        name: "Dzenan Pejcinovic",
        number: null,
        position: "Sturm",
        image:
          "https://www.vfb.de/fileadmin/_processed_/8/5/csm_Pejcinovic_Dzenan_2526_01_7c4e9a2d6f.jpg"
      },
      {
        name: "Jamie Leweling",
        number: null,
        position: "Sturm",
        image:
          "https://www.vfb.de/fileadmin/_processed_/2/9/csm_Leweling_Jamie_2526_01_5d8a3c7e1f.jpg"
      },
      {
        name: "Jeremy Arévalo",
        number: null,
        position: "Sturm",
        image:
          "https://www.vfb.de/fileadmin/_processed_/4/6/csm_Arevalo_Jeremy_2526_01_9e3c7a5d2f.jpg"
      },
      {
        name: "Deniz Undav",
        number: null,
        position: "Sturm",
        image:
          "https://www.vfb.de/fileadmin/_processed_/7/2/csm_Undav_Deniz_2526_01_6c4a8e1d9f.jpg"
      },
      {
        name: "Badredine Bouanani",
        number: null,
        position: "Sturm",
        image:
          "https://www.vfb.de/fileadmin/_processed_/1/5/csm_Bouanani_Badredine_2526_01_8e4c6a2d9f.jpg"
      },
      {
        name: "Justin Diehl",
        number: null,
        position: "Sturm",
        image: ""
      },
      {
        name: "Leo Sauer",
        number: null,
        position: "Sturm",
        image:
          "https://www.vfb.de/fileadmin/_processed_/3/4/csm_Sauer_Leo_2526_01_7a5e9c2d4f.jpg"
      }
    ]
  };
}


// ============================================================
// DASHBOARD AUFBAUEN
// ============================================================

async function buildDashboard() {
  const [
    matchData,
    table,
    news,
    transfers,
    squad,
    playerStats
  ] = await Promise.all([
    getVfbMatches(),
    getBundesligaTable(),
    getNews(),
    getTransfers(),
    getVfbSquad(),
    getPlayerStats()
  ]);

  let championsLeague = [];

  try {
    const clData = await apiRequest(
      "/teams/" +
        VFB_TEAM_ID +
        "/matches?competitions=CL&status=SCHEDULED,IN_PLAY,PAUSED,FINISHED"
    );

    if (clData && Array.isArray(clData.matches)) {
      championsLeague = clData.matches
        .map(mapMatch)
        .sort((a, b) => {
          return (
            new Date(a.rawDate || a.date).getTime() -
            new Date(b.rawDate || b.date).getTime()
          );
        });
    }
  } catch (error) {
    console.error(
      "Champions-League-Daten konnten nicht geladen werden:",
      error.message
    );
  }

  return {
    updatedAt: new Date().toISOString(),

    nextGame: matchData.nextGame,

    fixtures: matchData.fixtures,

    championsLeague,

    table,

    news,

    transfers,

    squad,

    playerStats
  };
}


// ============================================================
// DASHBOARD CACHE
// ============================================================

async function getDashboard() {
  const now = Date.now();

  if (
    dashboardCache.data &&
    dashboardCache.timestamp &&
    now - dashboardCache.timestamp < CACHE_TIME
  ) {
    return dashboardCache.data;
  }

  if (dashboardCache.promise) {
    return dashboardCache.promise;
  }

  dashboardCache.promise = buildDashboard()
    .then(data => {
      dashboardCache.data = data;
      dashboardCache.timestamp = Date.now();
      dashboardCache.promise = null;

      return data;
    })
    .catch(error => {
      dashboardCache.promise = null;
      throw error;
    });

  return dashboardCache.promise;
}


// ============================================================
// JSON RESPONSE
// ============================================================

function sendDashboard(res, data) {
  res.writeHead(200, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-cache"
  });

  res.end(JSON.stringify(data));
}


// ============================================================
// HTML DATEI LADEN
// ============================================================

function getIndexFile() {
  const possibleFiles = [
    path.join(__dirname, "index.html"),
    path.join(__dirname, "public", "index.html")
  ];

  for (const file of possibleFiles) {
    if (fs.existsSync(file)) {
      return file;
    }
  }

  return null;
}


// ============================================================
// MIME TYPES
// ============================================================

function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();

  const mimeTypes = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".txt": "text/plain; charset=utf-8"
  };

  return mimeTypes[ext] || "application/octet-stream";
}


// ============================================================
// STATIC FILE SERVER
// ============================================================

function serveStatic(req, res) {
  let requestPath = decodeURIComponent(req.url.split("?")[0]);

  if (requestPath === "/") {
    requestPath = "/index.html";
  }

  const publicPath = path.join(__dirname, requestPath);

  if (!publicPath.startsWith(__dirname)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  if (!fs.existsSync(publicPath)) {
    res.writeHead(404, {
      "Content-Type": "text/plain; charset=utf-8"
    });

    res.end("Not found");
    return;
  }

  const stat = fs.statSync(publicPath);

  if (!stat.isFile()) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }

  res.writeHead(200, {
    "Content-Type": getMimeType(publicPath),
    "Cache-Control": "no-cache"
  });

  fs.createReadStream(publicPath).pipe(res);
}


// ============================================================
// SERVER
// ============================================================

const server = http.createServer(async (req, res) => {
  try {
    const requestUrl = req.url.split("?")[0];

    // --------------------------------------------------------
    // HEALTH CHECK
    // --------------------------------------------------------

    if (requestUrl === "/health") {
      sendJson(res, 200, {
        status: "ok",
        service: "Cannstatt 1893 News",
        time: new Date().toISOString()
      });

      return;
    }


    // --------------------------------------------------------
    // BESUCHER-STATISTIK
    // --------------------------------------------------------

    if (requestUrl === "/api/stats") {
      if (req.method !== "GET") {
        sendJson(res, 405, {
          error: "Method not allowed"
        });

        return;
      }

      const stats = trackVisitor(req, res);

      sendJson(res, 200, stats);

      return;
    }


    // --------------------------------------------------------
    // DASHBOARD API
    // --------------------------------------------------------

    if (requestUrl === "/api/dashboard") {
      if (req.method !== "GET") {
        sendJson(res, 405, {
          error: "Method not allowed"
        });

        return;
      }

      try {
        const dashboard = await getDashboard();

        sendDashboard(res, dashboard);
      } catch (error) {
        console.error("Dashboard Fehler:", error);

        sendJson(res, 500, {
          error: "Dashboard konnte nicht geladen werden",
          message: error.message
        });
      }

      return;
    }


    // --------------------------------------------------------
    // EINZELNE API-ROUTEN
    // --------------------------------------------------------

    if (requestUrl === "/api/news") {
      try {
        const news = await getNews();

        sendJson(res, 200, {
          news
        });
      } catch (error) {
        console.error("News Fehler:", error);

        sendJson(res, 500, {
          error: "News konnten nicht geladen werden"
        });
      }

      return;
    }


    if (requestUrl === "/api/transfers") {
      try {
        const transfers = await getTransfers();

        sendJson(res, 200, {
          transfers
        });
      } catch (error) {
        console.error("Transfers Fehler:", error);

        sendJson(res, 500, {
          error: "Transfers konnten nicht geladen werden"
        });
      }

      return;
    }


    if (requestUrl === "/api/squad") {
      try {
        const squad = await getVfbSquad();

        sendJson(res, 200, {
          squad
        });
      } catch (error) {
        console.error("Kader Fehler:", error);

        sendJson(res, 500, {
          error: "Kader konnte nicht geladen werden"
        });
      }

      return;
    }


    if (requestUrl === "/api/stats/players") {
      try {
        const playerStats = await getPlayerStats();

        sendJson(res, 200, {
          playerStats
        });
      } catch (error) {
        console.error("Spielerstatistik Fehler:", error);

        sendJson(res, 500, {
          error: "Spielerstatistiken konnten nicht geladen werden"
        });
      }

      return;
    }


    // --------------------------------------------------------
    // STATIC FILES
    // --------------------------------------------------------

    serveStatic(req, res);

  } catch (error) {
    console.error("Server Fehler:", error);

    if (!res.headersSent) {
      sendJson(res, 500, {
        error: "Interner Serverfehler"
      });
    } else {
      res.end();
    }
  }
});


// ============================================================
// SERVER START
// ============================================================

server.listen(PORT, () => {
  console.log("==============================================");
  console.log(" Cannstatt 1893 News");
  console.log(" Server gestartet");
  console.log(" Port:", PORT);
  console.log("==============================================");
});


// ============================================================
// FEHLERBEHANDLUNG
// ============================================================

process.on("uncaughtException", error => {
  console.error("Uncaught Exception:", error);
});

process.on("unhandledRejection", error => {
  console.error("Unhandled Rejection:", error);
});
// ============================================================
// TEIL 3/3 – ZUSATZROUTEN, SHUTDOWN & ENDE
// ============================================================

// ============================================================
// API – SPIELE
// ============================================================

async function sendMatches(res) {
  try {
    const matches = await getVfbMatches();

    sendJson(res, 200, {
      nextGame: matches.nextGame,
      fixtures: matches.fixtures
    });
  } catch (error) {
    console.error("Matches Fehler:", error);

    sendJson(res, 500, {
      error: "Spiele konnten nicht geladen werden",
      message: error.message
    });
  }
}


// ============================================================
// API – TABELLE
// ============================================================

async function sendTable(res) {
  try {
    const table = await getBundesligaTable();

    sendJson(res, 200, {
      table
    });
  } catch (error) {
    console.error("Tabelle Fehler:", error);

    sendJson(res, 500, {
      error: "Tabelle konnte nicht geladen werden",
      message: error.message
    });
  }
}


// ============================================================
// API – CHAMPIONS LEAGUE
// ============================================================

async function sendChampionsLeague(res) {
  try {
    const data = await apiRequest(
      "/teams/" +
        VFB_TEAM_ID +
        "/matches?competitions=CL&status=SCHEDULED,IN_PLAY,PAUSED,FINISHED"
    );

    const matches = Array.isArray(data.matches)
      ? data.matches
          .map(mapMatch)
          .sort((a, b) => {
            return (
              new Date(a.rawDate || a.date).getTime() -
              new Date(b.rawDate || b.date).getTime()
            );
          })
      : [];

    sendJson(res, 200, {
      championsLeague: matches
    });
  } catch (error) {
    console.error("Champions-League Fehler:", error);

    sendJson(res, 500, {
      error: "Champions-League-Spiele konnten nicht geladen werden",
      message: error.message
    });
  }
}


// ============================================================
// CACHE MANUELL LEEREN
// ============================================================

function clearDashboardCache() {
  dashboardCache.data = null;
  dashboardCache.timestamp = 0;
  dashboardCache.promise = null;
}


// ============================================================
// ADMIN / CACHE ROUTE
// ============================================================

function handleCacheRoute(req, res) {
  if (req.method !== "GET") {
    sendJson(res, 405, {
      error: "Method not allowed"
    });

    return true;
  }

  clearDashboardCache();

  sendJson(res, 200, {
    success: true,
    message: "Dashboard-Cache wurde geleert",
    time: new Date().toISOString()
  });

  return true;
}


// ============================================================
// API-ROUTEN ERWEITERN
// ============================================================

const originalCreateServer = server.listeners("request")[0];


// ============================================================
// GRACEFUL SHUTDOWN
// ============================================================

function shutdown(signal) {
  console.log(`${signal} empfangen – Server wird beendet...`);

  server.close(() => {
    console.log("Server wurde sauber beendet.");
    process.exit(0);
  });

  setTimeout(() => {
    console.error("Server konnte nicht rechtzeitig beendet werden.");
    process.exit(1);
  }, 10000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));


// ============================================================
// ENDE
// ============================================================

console.log("Cannstatt 1893 News – Server bereit.");
