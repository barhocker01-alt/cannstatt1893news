const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = process.env.PORT || 3000;
const TOKEN = process.env.FOOTBALL_DATA_TOKEN;
const VFB_TEAM_ID = 10;
const API_BASE = "https://api.football-data.org/v4";
const VFB_RSS_URL = "https://www.vfb.de/templates/generated/1/raw/de.xml";
const VFB_SQUAD_URL = "https://www.vfb.de/de/1893/profis/kader/saisonen/2026-2027/kader/?data=&mobile=";
const VFB_STATS_URL = "https://www.vfb.de/de/1893/profis/kader/saisonen/2026-2027/statistik/?data=&mobile=";
const CACHE_TIME = 6 * 60 * 60 * 1000;

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
  const day = new Date().toISOString().slice(0, 10);

  if (visitorStats.day !== day) {
    visitorStats.day = day;
    visitorStats.visitorsToday = 0;
    visitorStats.pageViewsToday = 0;
  }
}

function getCookie(req, name) {
  const header = req.headers.cookie || "";

  const match = header.match(
    new RegExp("(?:^|;\\s*)" + name + "=([^;]+)")
  );

  return match
    ? decodeURIComponent(match[1])
    : null;
}

function trackVisitor(req, res) {
  resetVisitorDayIfNeeded();

  let visitorId = getCookie(
    req,
    "c1893_visitor"
  );

  if (!visitorId) {
    visitorId = crypto.randomUUID();

    res.setHeader(
      "Set-Cookie",
      `c1893_visitor=${encodeURIComponent(
        visitorId
      )}; Path=/; Max-Age=31536000; SameSite=Lax`
    );
  }

  const now = Date.now();
  const lastSeen =
    activeVisitors.get(visitorId);

  if (
    !lastSeen ||
    now - lastSeen > ACTIVE_WINDOW
  ) {
    visitorStats.visitorsToday++;
    visitorStats.totalVisitors++;
  }

  visitorStats.pageViewsToday++;
  visitorStats.totalPageViews++;

  activeVisitors.set(
    visitorId,
    now
  );

  for (
    const [id, timestamp]
    of activeVisitors
  ) {
    if (
      now - timestamp >
      ACTIVE_WINDOW
    ) {
      activeVisitors.delete(id);
    }
  }

  return activeVisitors.size;
}


/* =========================================================
   VFB KADER 2026/2027
========================================================= */

const VFB_SQUAD = [
  ["Fabian Bredlow", "Torwart"],
  ["Marius Funk", "Torwart"],
  ["Dennis Seimen", "Torwart"],
  ["Stefan Drljaca", "Torwart"],

  ["Ameen Al-Dakhil", "Abwehr"],
  ["Ramon Hendriks", "Abwehr"],
  ["Josha Vagnoman", "Abwehr"],
  ["Maximilian Mittelstädt", "Abwehr"],
  ["Luca Jaquez", "Abwehr"],
  ["Leonidas Stergiou", "Abwehr"],
  ["Lorenz Assignon", "Abwehr"],
  ["Dan-Axel Zagadou", "Abwehr"],
  ["Jeff Chabot", "Abwehr"],
  ["Finn Jeltsch", "Abwehr"],

  ["Angelo Stiller", "Mittelfeld"],
  ["Chris Führich", "Mittelfeld"],
  ["Bilal El Khannouss", "Mittelfeld"],
  ["Atakan Karazor", "Mittelfeld"],
  ["Grischa Prömel", "Mittelfeld"],
  ["Nikolas Nartey", "Mittelfeld"],
  ["Ertugrul Yigit", "Mittelfeld"],
  ["Jarzinho Malanga", "Mittelfeld"],

  ["Tiago Tomás", "Angriff"],
  ["Ermedin Demirovic", "Angriff"],
  ["Dzenan Pejcinovic", "Angriff"],
  ["Jamie Leweling", "Angriff"],
  ["Jeremy Arévalo", "Angriff"],
  ["Deniz Undav", "Angriff"],
  ["Badredine Bouanani", "Angriff"],
  ["Justin Diehl", "Angriff"],
  ["Leo Sauer", "Angriff"]
].map(
  ([name, position]) => ({
    name,
    position,
    image: ""
  })
);


/* =========================================================
   HTTP
========================================================= */

function httpsRequest(
  url,
  options = {}
) {
  return new Promise(
    (resolve, reject) => {
      const request =
        https.get(
          url,
          {
            headers:
              options.headers || {}
          },
          response => {
            let data = "";

            response.setEncoding(
              "utf8"
            );

            response.on(
              "data",
              chunk => {
                data += chunk;
              }
            );

            response.on(
              "end",
              () => {
                if (
                  response.statusCode >=
                    200 &&
                  response.statusCode <
                    300
                ) {
                  resolve({
                    statusCode:
                      response.statusCode,
                    headers:
                      response.headers,
                    data
                  });
                } else {
                  reject(
                    new Error(
                      `HTTP ${response.statusCode} bei ${url}`
                    )
                  );
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
        20000,
        () => {
          request.destroy(
            new Error(
              `Timeout: ${url}`
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
      "FOOTBALL_DATA_TOKEN fehlt."
    );
  }

  const response =
    await httpsRequest(
      API_BASE + endpoint,
      {
        headers: {
          "X-Auth-Token":
            TOKEN,
          "User-Agent":
            "Cannstatt1893News/1.0"
        }
      }
    );

  return JSON.parse(
    response.data
  );
}


/* =========================================================
   DATUM
========================================================= */

function formatDate(
  value
) {
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
    return value;
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

function formatDateTime(
  value
) {
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
    return value;
  }

  return date.toLocaleString(
    "de-DE",
    {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    }
  );
}


/* =========================================================
   SPIELE
========================================================= */

function mapMatch(
  match
) {
  return {
    id:
      match.id,

    competition:
      match.competition?.name ||
      "",

    competitionCode:
      match.competition?.code ||
      "",

    date:
      match.utcDate ||
      "",

    dateFormatted:
      formatDate(
        match.utcDate
      ),

    dateTimeFormatted:
      formatDateTime(
        match.utcDate
      ),

    status:
      match.status ||
      "",

    matchday:
      match.matchday ||
      null,

    homeTeam: {
      id:
        match.homeTeam?.id ||
        null,

      name:
        match.homeTeam?.name ||
        "",

      shortName:
        match.homeTeam?.shortName ||
        "",

      tla:
        match.homeTeam?.tla ||
        "",

      crest:
        match.homeTeam?.crest ||
        ""
    },

    awayTeam: {
      id:
        match.awayTeam?.id ||
        null,

      name:
        match.awayTeam?.name ||
        "",

      shortName:
        match.awayTeam?.shortName ||
        "",

      tla:
        match.awayTeam?.tla ||
        "",

      crest:
        match.awayTeam?.crest ||
        ""
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
      match.venue ||
      ""
  };
}

async function getVfbMatches() {
  const data =
    await apiRequest(
      `/teams/${VFB_TEAM_ID}/matches?status=SCHEDULED,IN_PLAY,PAUSED,FINISHED`
    );

  const matches =
    Array.isArray(
      data.matches
    )
      ? data.matches
          .map(mapMatch)
          .sort(
            (a, b) =>
              new Date(a.date) -
              new Date(b.date)
          )
      : [];

  const now =
    Date.now();

  const nextGame =
    matches.find(
      match =>
        new Date(
          match.date
        ).getTime() >= now &&
        match.status !==
          "FINISHED"
    ) || null;

  const fixtures =
    matches.filter(
      match =>
        match.competitionCode ===
        "BL1"
    );

  return {
    nextGame,
    fixtures
  };
}


/* =========================================================
   BUNDESLIGA TABELLE
========================================================= */

async function getBundesligaTable() {
  const data =
    await apiRequest(
      "/competitions/BL1/standings"
    );

  const standings =
    Array.isArray(
      data.standings
    )
      ? data.standings
      : [];

  const total =
    standings.find(
      item =>
        item.type ===
        "TOTAL"
    ) ||
    standings[0];

  const table =
    Array.isArray(
      total?.table
    )
      ? total.table
      : [];

  return table.map(
    row => ({
      position:
        row.position ??
        0,

      team: {
        id:
          row.team?.id ??
          null,

        name:
          row.team?.name ||
          "",

        shortName:
          row.team?.shortName ||
          "",

        tla:
          row.team?.tla ||
          "",

        crest:
          row.team?.crest ||
          ""
      },

      /*
       * Diese Namen passen direkt
       * zur vorhandenen index.html.
       */

      played:
        row.playedGames ??
        0,

      wins:
        row.won ??
        0,

      draws:
        row.draw ??
        0,

      losses:
        row.lost ??
        0,

      points:
        row.points ??
        0,

      goalsFor:
        row.goalsFor ??
        0,

      goalsAgainst:
        row.goalsAgainst ??
        0,

      goalDiff:
        row.goalDifference ??
        0,

      /*
       * Originalfelder ebenfalls vorhanden.
       */

      playedGames:
        row.playedGames ??
        0,

      won:
        row.won ??
        0,

      draw:
        row.draw ??
        0,

      lost:
        row.lost ??
        0,

      goalDifference:
        row.goalDifference ??
        0
    })
  );
}


/* =========================================================
   XML
========================================================= */

function decodeXml(
  value
) {
  return String(
    value || ""
  )
    .replace(
      /<!\[CDATA\[([\s\S]*?)\]\]>/g,
      "$1"
    )
    .replace(
      /&amp;/g,
      "&"
    )
    .replace(
      /&lt;/g,
      "<"
    )
    .replace(
      /&gt;/g,
      ">"
    )
    .replace(
      /&quot;/g,
      '"'
    )
    .replace(
      /&#39;|&#x27;/g,
      "'"
    );
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
        match[1].trim()
      )
    : "";
}

function stripHtml(
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
      /\s+/g,
      " "
    )
    .trim();
}


/* =========================================================
   VFB NEWS
========================================================= */

async function getNews() {
  try {
    const response =
      await httpsRequest(
        VFB_RSS_URL,
        {
          headers: {
            "User-Agent":
              "Mozilla/5.0 Cannstatt1893News/1.0"
          }
        }
      );

    const xml =
      response.data ||
      "";

    const items =
      xml.match(
        /<item\b[\s\S]*?<\/item>/gi
      ) || [];

    return items
      .map(
        item => {
          const pubDate =
            extractXmlTag(
              item,
              "pubDate"
            );

          return {
            source:
              "VfB Stuttgart",

            sourceLabel:
              "VfB Stuttgart",

            title:
              extractXmlTag(
                item,
                "title"
              ),

            link:
              extractXmlTag(
                item,
                "link"
              ),

            pubDate,

            date:
              formatDateTime(
                pubDate
              ),

            dateFormatted:
              formatDateTime(
                pubDate
              ),

            description:
              stripHtml(
                extractXmlTag(
                  item,
                  "description"
                )
              ),

            image:
              ""
          };
        }
      )
      .filter(
        item =>
          item.title &&
          item.link
      )
      .sort(
        (a, b) =>
          new Date(
            b.pubDate
          ) -
          new Date(
            a.pubDate
          )
      )
      .slice(
        0,
        20
      );
  } catch (error) {
    console.error(
      "VfB-News Fehler:",
      error
    );

    return [];
  }
}


/* =========================================================
   TRANSFERS
========================================================= */

function getVfbTransfers() {
  return {
    season:
      "2026/2027",

    arrivals: [
      {
        name:
          "Grischa Prömel",
        from:
          "TSG Hoffenheim",
        type:
          "Transfer"
      },

      {
        name:
          "Marius Funk",
        from:
          "Energie Cottbus",
        type:
          "Transfer"
      },

      {
        name:
          "Laurin Ulrich",
        from:
          "1. FC Magdeburg",
        type:
          "Ende der Leihe"
      },

      {
        name:
          "Jovan Milosevic",
        from:
          "SV Werder Bremen",
        type:
          "Ende der Leihe"
      },

      {
        name:
          "Leonidas Stergiou",
        from:
          "1. FC Heidenheim",
        type:
          "Ende der Leihe"
      },

      {
        name:
          "Dennis Seimen",
        from:
          "SC Paderborn 07",
        type:
          "Ende der Leihe"
      },

      {
        name:
          "Dzenan Pejcinovic",
        from:
          "VfL Wolfsburg",
        type:
          "Transfer"
      }
    ],

    departures: [
      {
        name:
          "Noah Darvich",
        to:
          "SV Elversberg",
        type:
          "Leihe"
      },

      {
        name:
          "Yannik Keitel",
        to:
          "FC Augsburg",
        type:
          "Leihe"
      },

      {
        name:
          "Florian Hellstern",
        to:
          "SpVgg Greuther Fürth",
        type:
          "Leihe"
      },

      {
        name:
          "Alexander Nübel",
        to:
          "FC Bayern München",
        type:
          "Ende der Leihe"
      },

      {
        name:
          "Pascal Stenzel",
        to:
          "Ziel unbekannt",
        type:
          "Abgang"
      },

      {
        name:
          "Laurin Ulrich",
        to:
          "SC Paderborn",
        type:
          "Leihe"
      },

      {
        name:
          "Jovan Milosevic",
        to:
          "SC Braga",
        type:
          "Transfer"
      },

      {
        name:
          "Lazar Jovanovic",
        to:
          "Udinese Calcio",
        type:
          "Transfer"
      },

      {
        name:
          "Chema",
        to:
          "Brighton & Hove Albion",
        type:
          "Transfer"
      },

      {
        name:
          "Mirza Catovic",
        to:
          "FC Barcelona II",
        type:
          "Leihe"
      }
    ]
  };
}


/* =========================================================
   STATISTIK
========================================================= */

function parseStatNumber(
  value
) {
  const match =
    String(
      value ??
        ""
    )
      .replace(
        /<[^>]*>/g,
        " "
      )
      .match(
        /-?\d+/
      );

  return match
    ? Number(
        match[0]
      )
    : 0;
}

function parseVfbStatsHtml(
  html
) {
  const result = {};

  const rows =
    html.match(
      /<tr[\s\S]*?<\/tr>/gi
    ) || [];

  for (
    const row of rows
  ) {
    const text =
      stripHtml(
        row
      );

    const player =
      VFB_SQUAD.find(
        p =>
          text
            .toLowerCase()
            .includes(
              p.name.toLowerCase()
            )
      );

    if (!player) {
      continue;
    }

    const cells =
      row.match(
        /<td[\s\S]*?<\/td>/gi
      ) ||
      row.match(
        /<t[dh][\s\S]*?<\/t[dh]>/gi
      ) ||
      [];

    const numbers =
      cells.map(
        cell =>
          parseStatNumber(
            cell
          )
      );

    result[
      player.name
    ] = {
      appearances:
        numbers[0] ||
        0,

      goals:
        numbers[1] ||
        0,

      assists:
        numbers[2] ||
        0,

      substitutionsIn:
        numbers[3] ||
        0,

      substitutionsOut:
        numbers[4] ||
        0,

      yellowCards:
        numbers[5] ||
        0,

      secondYellow:
        numbers[6] ||
        0,

      redCards:
        numbers[7] ||
        0,

      minutes:
        numbers[8] ||
        0
    };
  }

  return result;
}


/*
 * Aktueller Stand der Bundesliga
 * 2026/2027 als sichere Fallback-Werte.
 */

const CURRENT_VFB_STATS = {
  "Fabian Bredlow":
    [1,0,0,0,0,0,0,0,90],

  "Ramon Hendriks":
    [1,0,0,0,0,0,0,0,90],

  "Josha Vagnoman":
    [1,1,0,0,0,0,0,0,90],

  "Maximilian Mittelstädt":
    [1,0,0,0,0,0,0,0,90],

  "Leonidas Stergiou":
    [1,0,0,1,0,0,0,0,16],

  "Jeff Chabot":
    [1,0,0,0,1,1,0,0,74],

  "Finn Jeltsch":
    [1,0,0,0,0,1,0,0,90],

  "Angelo Stiller":
    [1,0,0,0,1,0,0,0,88],

  "Bilal El Khannouss":
    [1,0,0,1,0,0,0,0,16],

  "Grischa Prömel":
    [1,0,0,0,0,1,0,0,90],

  "Tiago Tomás":
    [1,0,0,0,1,0,0,0,62],

  "Ermedin Demirovic":
    [1,0,0,1,0,0,0,0,27],

  "Dzenan Pejcinovic":
    [1,0,0,0,1,0,0,0,63],

  "Jamie Leweling":
    [1,0,0,1,0,0,0,0,28],

  "Deniz Undav":
    [1,0,0,0,1,0,0,0,74]
};

function fallbackStats(
  name
) {
  const values =
    CURRENT_VFB_STATS[
      name
    ] ||
    [0,0,0,0,0,0,0,0,0];

  return {
    appearances:
      values[0],

    goals:
      values[1],

    assists:
      values[2],

    substitutionsIn:
      values[3],

    substitutionsOut:
      values[4],

    yellowCards:
      values[5],

    secondYellow:
      values[6],

    redCards:
      values[7],

    minutes:
      values[8]
  };
}


/* =========================================================
   OFFIZIELLE SPIELERBILDER
========================================================= */

function absoluteVfbUrl(
  url
) {
  if (
    url.startsWith("//")
  ) {
    return "https:" +
      url;
  }

  if (
    url.startsWith("/")
  ) {
    return "https://www.vfb.de" +
      url;
  }

  return url;
}

function extractOfficialImage(
  html,
  playerName
) {
  const escapedName =
    playerName.replace(
      /[.*+?^${}()|[\]\\]/g,
      "\\$&"
    );

  const patterns = [
    new RegExp(
      `<img[^>]+(?:alt|title)=["'][^"']*${escapedName}[^"']*["'][^>]+(?:src|data-src)=["']([^"']+)["']`,
      "i"
    ),

    new RegExp(
      `<img[^>]+(?:src|data-src)=["']([^"']+)["'][^>]+(?:alt|title)=["'][^"']*${escapedName}[^"']*["']`,
      "i"
    )
  ];

  for (
    const pattern
    of patterns
  ) {
    const match =
      html.match(
        pattern
      );

    if (
      match &&
      match[1]
    ) {
      return absoluteVfbUrl(
        decodeXml(
          match[1]
        )
      );
    }
  }

  /*
   * Zusätzlicher Fallback:
   * Suche im Bereich um den Spielernamen.
   */

  const index =
    html
      .toLowerCase()
      .indexOf(
        playerName.toLowerCase()
      );

  if (
    index >= 0
  ) {
    const area =
      html.slice(
        Math.max(
          0,
          index - 6000
        ),
        Math.min(
          html.length,
          index + 6000
        )
      );

    const match =
      area.match(
        /(?:src|data-src)=["']([^"']+\.(?:jpg|jpeg|png|webp)(?:\?[^"']*)?)["']/i
      );

    if (
      match &&
      match[1]
    ) {
      return absoluteVfbUrl(
        decodeXml(
          match[1]
        )
      );
    }
  }

  return "";
}

async function loadOfficialPlayerImages() {
  try {
    const response =
      await httpsRequest(
        VFB_SQUAD_URL,
        {
          headers: {
            "User-Agent":
              "Mozilla/5.0 Cannstatt1893News/1.0"
          }
        }
      );

    const images = {};

    for (
      const player
      of VFB_SQUAD
    ) {
      const image =
        extractOfficialImage(
          response.data ||
            "",
          player.name
        );

      if (image) {
        images[
          player.name
        ] = image;
      }
    }

    return images;
  } catch (error) {
    console.error(
      "VfB-Bilder Fehler:",
      error
    );

    return {};
  }
}


/* =========================================================
   KADER
========================================================= */

async function getVfbSquad() {
  const [
    statsResponse,
    officialImages
  ] = await Promise.all([
    httpsRequest(
      VFB_STATS_URL,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 Cannstatt1893News/1.0"
        }
      }
    ),

    loadOfficialPlayerImages()
  ]);

  const parsed =
    parseVfbStatsHtml(
      statsResponse.data ||
        ""
    );

  return VFB_SQUAD.map(
    player => {
      const image =
        officialImages[
          player.name
        ] ||
        "";

      const parsedStats =
        parsed[
          player.name
        ];

      const parsedHasValues =
        parsedStats &&
        Object.values(
          parsedStats
        ).some(
          value =>
            value > 0
        );

      const stats =
        parsedHasValues
          ? parsedStats
          : fallbackStats(
              player.name
            );

      return {
        name:
          player.name,

        position:
          player.position,

        image,

        stats: {
          name:
            player.name,

          position:
            player.position,

          image,

          ...stats
        }
      };
    }
  );
}


/* =========================================================
   DASHBOARD
========================================================= */

async function buildDashboard() {
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
    Promise.resolve(
      getVfbTransfers()
    ),
    getVfbSquad()
  ]);

  let championsLeague =
    [];

  try {
    const data =
      await apiRequest(
        `/teams/${VFB_TEAM_ID}/matches?competitions=CL`
      );

    championsLeague =
      Array.isArray(
        data.matches
      )
        ? data.matches
            .map(mapMatch)
            .sort(
              (a, b) =>
                new Date(a.date) -
                new Date(b.date)
            )
            .slice(
              0,
              8
            )
        : [];
  } catch (error) {
    console.error(
      "Champions-League Fehler:",
      error
    );
  }

  return {
    success:
      true,

    generatedAt:
      new Date().toISOString(),

    attribution: {
      footballData:
        "football-data.org",

      vfb:
        "VfB Stuttgart"
    },

    nextGame:
      matches.nextGame,

    fixtures:
      matches.fixtures,

    championsLeague,

    table,

    news,

    transfers,

    squad
  };
}


/* =========================================================
   CACHE
========================================================= */

let dashboardCache =
  null;

let dashboardCacheTime =
  0;

async function getDashboard() {
  const now =
    Date.now();

  if (
    dashboardCache &&
    now -
      dashboardCacheTime <
      CACHE_TIME
  ) {
    return dashboardCache;
  }

  try {
    const data =
      await buildDashboard();

    dashboardCache =
      data;

    dashboardCacheTime =
      now;

    return data;
  } catch (error) {
    console.error(
      "Dashboard Fehler:",
      error
    );

    if (
      dashboardCache
    ) {
      return dashboardCache;
    }

    throw error;
  }
}


/* =========================================================
   JSON
========================================================= */

function sendJson(
  res,
  status,
  data
) {
  res.writeHead(
    status,
    {
      "Content-Type":
        "application/json; charset=utf-8",

      "Cache-Control":
        "no-cache",

      "Access-Control-Allow-Origin":
        "*"
    }
  );

  res.end(
    JSON.stringify(
      data
    )
  );
}


/* =========================================================
   STATIC FILES
========================================================= */

const PUBLIC_DIR =
  path.resolve(
    __dirname
  );

const MIME_TYPES = {
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

  ".gif":
    "image/gif",

  ".svg":
    "image/svg+xml",

  ".webp":
    "image/webp",

  ".ico":
    "image/x-icon",

  ".woff":
    "font/woff",

  ".woff2":
    "font/woff2",

  ".ttf":
    "font/ttf"
};

function serveStatic(
  req,
  res
) {
  const url =
    new URL(
      req.url,
      "http://" +
        (
          req.headers.host ||
          "localhost"
        )
    );

  let pathname =
    decodeURIComponent(
      url.pathname
    );

  if (
    pathname ===
    "/"
  ) {
    pathname =
      "/index.html";
  }

  const file =
    path.resolve(
      PUBLIC_DIR,
      "." +
        pathname
    );

  if (
    file !==
      PUBLIC_DIR &&
    !file.startsWith(
      PUBLIC_DIR +
        path.sep
    )
  ) {
    res.writeHead(
      403
    );

    return res.end(
      "Forbidden"
    );
  }

  fs.stat(
    file,
    (
      error,
      stats
    ) => {
      const target =
        !error &&
        stats.isFile()
          ? file
          : path.join(
              PUBLIC_DIR,
              "index.html"
            );

      fs.readFile(
        target,
        (
          readError,
          data
        ) => {
          if (
            readError
          ) {
            res.writeHead(
              404,
              {
                "Content-Type":
                  "text/plain; charset=utf-8"
              }
            );

            return res.end(
              "404 - Seite nicht gefunden"
            );
          }

          const extension =
            path.extname(
              target
            ).toLowerCase();

          res.writeHead(
            200,
            {
              "Content-Type":
                MIME_TYPES[
                  extension
                ] ||
                "application/octet-stream"
            }
          );

          res.end(
            data
          );
        }
      );
    }
  );
}


/* =========================================================
   API
========================================================= */

async function handleApi(
  req,
  res
) {
  const pathname =
    new URL(
      req.url,
      "http://" +
        (
          req.headers.host ||
          "localhost"
        )
    ).pathname;

  if (
    pathname ===
    "/api/dashboard"
  ) {
    const data =
      await getDashboard();

    sendJson(
      res,
      200,
      data
    );

    return true;
  }

  if (
    pathname ===
    "/api/stats"
  ) {
    const active =
      trackVisitor(
        req,
        res
      );

    sendJson(
      res,
      200,
      {
        success:
          true,

        day:
          visitorStats.day,

        visitorsToday:
          visitorStats.visitorsToday,

        pageViewsToday:
          visitorStats.pageViewsToday,

        totalVisitors:
          visitorStats.totalVisitors,

        totalPageViews:
          visitorStats.totalPageViews,

        activeVisitors:
          active
      }
    );

    return true;
  }

  if (
    pathname ===
    "/health"
  ) {
    sendJson(
      res,
      200,
      {
        success:
          true,

        status:
          "ok",

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
   SERVER
========================================================= */

const server =
  http.createServer(
    async (
      req,
      res
    ) => {
      try {
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

        if (
          req.method ===
          "OPTIONS"
        ) {
          res.writeHead(
            204
          );

          return res.end();
        }

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

          return res.end(
            "Method Not Allowed"
          );
        }

        const handled =
          await handleApi(
            req,
            res
          );

        if (
          handled
        ) {
          return;
        }

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
   START
========================================================= */

server.listen(
  PORT,
  () => {
    console.log(
      "========================================"
    );

    console.log(
      "Cannstatt 1893 News"
    );

    console.log(
      `Server läuft auf Port ${PORT}`
    );

    console.log(
      `Football-Data Token: ${
        TOKEN
          ? "vorhanden"
          : "FEHLT"
      }`
    );

    console.log(
      "========================================"
    );
  }
);


/* =========================================================
   ERROR HANDLING
========================================================= */

process.on(
  "uncaughtException",
  error =>
    console.error(
      "UNCAUGHT EXCEPTION:",
      error
    )
);

process.on(
  "unhandledRejection",
  error =>
    console.error(
      "UNHANDLED REJECTION:",
      error
    )
);
