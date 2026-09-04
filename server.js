const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;
const TOKEN = process.env.FOOTBALL_DATA_TOKEN;

const VFB_TEAM_ID = 10;

const VFB_RSS_URL =
  "https://www.vfb.de/templates/generated/1/raw/de.xml";

const VFB_TRANSFER_URL =
  "https://www.vfb.de/de/1893/profis/kader/saisonen/2026-2027/zu--abgaenge/?data=&mobile=";

const VFB_STATS_URL =
  "https://www.vfb.de/de/1893/profis/kader/saisonen/2026-2027/statistik/?data=&mobile=";

const CACHE_TIME = 6 * 60 * 60 * 1000;


/* =========================================================
   BESUCHERSTATISTIK
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
  const today =
    new Date().toISOString().slice(0, 10);

  if (visitorStats.day !== today) {
    visitorStats.day = today;
    visitorStats.visitorsToday = 0;
    visitorStats.pageViewsToday = 0;
  }
}

function getCookie(req, name) {
  const header = req.headers.cookie || "";

  const match = header.match(
    new RegExp(
      "(?:^|;\\s*)" +
        name +
        "=([^;]+)"
    )
  );

  return match
    ? decodeURIComponent(match[1])
    : null;
}

function makeVisitorId() {
  return require("crypto").randomUUID();
}

function trackVisitor(req, res) {
  resetVisitorDayIfNeeded();

  let visitorId =
    getCookie(req, "c1893_visitor");

  const now = Date.now();

  let isNewVisitor = false;

  if (!visitorId) {
    visitorId = makeVisitorId();
    isNewVisitor = true;

    res.setHeader(
      "Set-Cookie",
      "c1893_visitor=" +
        encodeURIComponent(visitorId) +
        "; Path=/; Max-Age=31536000; SameSite=Lax"
    );
  }

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

  for (const [
    id,
    timestamp
  ] of activeVisitors.entries()) {
    if (
      now - timestamp >
      ACTIVE_WINDOW
    ) {
      activeVisitors.delete(id);
    }
  }

  return {
    isNewVisitor,
    activeVisitors:
      activeVisitors.size
  };
}


/* =========================================================
   VFB KADER 2026/2027
========================================================= */

const VFB_SQUAD = [
  {
    name: "Fabian Bredlow",
    position: "Torwart",
    image:
      "https://www.vfb.de/fileadmin/_processed_/c/5/csm_Fabian-Bredlow_2026_27_01_7c8e8a6a7a.jpg"
  },
  {
    name: "Marius Funk",
    position: "Torwart",
    image:
      "https://www.vfb.de/fileadmin/_processed_/2/6/csm_Marius-Funk_2026_27_01_7a5f5c1a6f.jpg"
  },
  {
    name: "Dennis Seimen",
    position: "Torwart",
    image:
      "https://www.vfb.de/fileadmin/_processed_/8/4/csm_Dennis-Seimen_2026_27_01_5a6d5e6b9f.jpg"
  },
  {
    name: "Stefan Drljaca",
    position: "Torwart",
    image:
      "https://www.vfb.de/fileadmin/_processed_/7/5/csm_Stefan-Drljaca_2026_27_01_3f4e8c9b2a.jpg"
  },

  {
    name: "Ameen Al-Dakhil",
    position: "Abwehr",
    image:
      "https://www.vfb.de/fileadmin/_processed_/8/1/csm_Ameen-Al-Dakhil_2026_27_01_9f4a6a2e1c.jpg"
  },
  {
    name: "Ramon Hendriks",
    position: "Abwehr",
    image:
      "https://www.vfb.de/fileadmin/_processed_/3/7/csm_Ramon-Hendriks_2026_27_01_8b5a1e3d7f.jpg"
  },
  {
    name: "Josha Vagnoman",
    position: "Abwehr",
    image:
      "https://www.vfb.de/fileadmin/_processed_/6/9/csm_Josha-Vagnoman_2026_27_01_2e7f4a5b8c.jpg"
  },
  {
    name: "Maximilian Mittelstädt",
    position: "Abwehr",
    image:
      "https://www.vfb.de/fileadmin/_processed_/1/4/csm_Maximilian-Mittelstaedt_2026_27_01_7c5a9e2f4b.jpg"
  },
  {
    name: "Luca Jaquez",
    position: "Abwehr",
    image:
      "https://www.vfb.de/fileadmin/_processed_/4/2/csm_Luca-Jaquez_2026_27_01_6d8a3f5b1c.jpg"
  },
  {
    name: "Leonidas Stergiou",
    position: "Abwehr",
    image:
      "https://www.vfb.de/fileadmin/_processed_/9/0/csm_Leonidas-Stergiou_2026_27_01_4e7b2a8f5c.jpg"
  },
  {
    name: "Lorenz Assignon",
    position: "Abwehr",
    image:
      "https://www.vfb.de/fileadmin/_processed_/5/3/csm_Lorenz-Assignon_2026_27_01_8f2a6c4e9b.jpg"
  },
  {
    name: "Dan-Axel Zagadou",
    position: "Abwehr",
    image:
      "https://www.vfb.de/fileadmin/_processed_/d/1/csm_Dan-Axel-Zagadou_2026_27_01.jpg"
  },
  {
    name: "Jeff Chabot",
    position: "Abwehr",
    image:
      "https://www.vfb.de/fileadmin/_processed_/2/8/csm_Jeff-Chabot_2026_27_01_6e4a8f2c9d.jpg"
  },
  {
    name: "Finn Jeltsch",
    position: "Abwehr",
    image:
      "https://www.vfb.de/fileadmin/_processed_/7/2/csm_Finn-Jeltsch_2026_27_01_5e9a3f1c7b.jpg"
  },

  {
    name: "Angelo Stiller",
    position: "Mittelfeld",
    image:
      "https://www.vfb.de/fileadmin/_processed_/5/1/csm_Angelo-Stiller_2026_27_01_3e8a6f2c5b.jpg"
  },
  {
    name: "Chris Führich",
    position: "Mittelfeld",
    image:
      "https://www.vfb.de/fileadmin/_processed_/9/6/csm_Chris-Fuehrich_2026_27_01_7a2e5f8c4d.jpg"
  },
  {
    name: "Bilal El Khannouss",
    position: "Mittelfeld",
    image:
      "https://www.vfb.de/fileadmin/_processed_/4/8/csm_Bilal-El-Khannouss_2026_27_01_5c9e2a7f3b.jpg"
  },
  {
    name: "Atakan Karazor",
    position: "Mittelfeld",
    image:
      "https://www.vfb.de/fileadmin/_processed_/6/3/csm_Atakan-Karazor_2026_27_01_8e4a1c7f2d.jpg"
  },
  {
    name: "Grischa Prömel",
    position: "Mittelfeld",
    image:
      "https://www.vfb.de/fileadmin/_processed_/1/9/csm_Grischa-Proemel_2026_27_01_6a8f2e4c5b.jpg"
  },
  {
    name: "Nikolas Nartey",
    position: "Mittelfeld",
    image:
      "https://www.vfb.de/fileadmin/_processed_/8/6/csm_Nikolas-Nartey_2026_27_01_4f7a2c9e5b.jpg"
  },
  {
    name: "Ertugrul Yigit",
    position: "Mittelfeld",
    image: ""
  },
  {
    name: "Jarzinho Malanga",
    position: "Mittelfeld",
    image: ""
  },

  {
    name: "Tiago Tomás",
    position: "Angriff",
    image:
      "https://www.vfb.de/fileadmin/_processed_/5/7/csm_Tiago-Tomas_2026_27_01_2f8a6c4e9b.jpg"
  },
  {
    name: "Ermedin Demirovic",
    position: "Angriff",
    image:
      "https://www.vfb.de/fileadmin/_processed_/3/2/csm_Ermedin-Demirovic_2026_27_01_7e4a8f2c5d.jpg"
  },
  {
    name: "Dzenan Pejcinovic",
    position: "Angriff",
    image:
      "https://www.vfb.de/fileadmin/_processed_/9/4/csm_Dzenan-Pejcinovic_2026_27_5f2a8c7e1d.jpg"
  },
  {
    name: "Jamie Leweling",
    position: "Angriff",
    image:
      "https://www.vfb.de/fileadmin/_processed_/6/8/csm_Jamie-Leweling_2026_27_3a7f2e5c9b.jpg"
  },
  {
    name: "Jeremy Arévalo",
    position: "Angriff",
    image:
      "https://www.vfb.de/fileadmin/_processed_/2/5/csm_Jeremy-Arevalo_2026_27_01_8c4e1f7a6d.jpg"
  },
  {
    name: "Deniz Undav",
    position: "Angriff",
    image:
      "https://www.vfb.de/fileadmin/_processed_/7/1/csm_Deniz-Undav_2026_27_01_5a9e2c4f8b.jpg"
  },
  {
    name: "Badredine Bouanani",
    position: "Angriff",
    image:
      "https://www.vfb.de/fileadmin/_processed_/4/9/csm_Badredine-Bouanani_2026_27_01_6f2a8e5c1d.jpg"
  },
  {
    name: "Justin Diehl",
    position: "Angriff",
    image: ""
  },
  {
    name: "Leo Sauer",
    position: "Angriff",
    image:
      "https://www.vfb.de/fileadmin/_processed_/8/3/csm_Leo-Sauer_2026_27_01_4e7a2c9f5b.jpg"
  }
];


/* =========================================================
   HTTP HELFER
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
          (response) => {
            let data = "";

            response.setEncoding(
              "utf8"
            );

            response.on(
              "data",
              (chunk) => {
                data += chunk;
              }
            );

            response.on(
              "end",
              () => {
                if (
                  response.statusCode >=
                    200 &&
                  response.statusCode < 300
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
                      "HTTP " +
                        response.statusCode +
                        " bei " +
                        url
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
              "Request Timeout: " +
                url
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
      "https://api.football-data.org/v4" +
        endpoint,
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
  dateString
) {
  if (!dateString) {
    return "";
  }

  const date =
    new Date(dateString);

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return "";
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
  if (!dateString) {
    return "";
  }

  const date =
    new Date(dateString);

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return "";
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
   MATCHES
========================================================= */

function mapMatch(
  match
) {
  const homeTeam =
    match.homeTeam || {};

  const awayTeam =
    match.awayTeam || {};

  const score =
    match.score || {};

  const fullTime =
    score.fullTime || {};

  const date =
    match.utcDate ||
    match.date ||
    null;

  return {
    id:
      match.id || null,

    homeTeam: {
      id:
        homeTeam.id || null,
      name:
        homeTeam.name || "",
      shortName:
        homeTeam.shortName || "",
      tla:
        homeTeam.tla || "",
      crest:
        homeTeam.crest || ""
    },

    awayTeam: {
      id:
        awayTeam.id || null,
      name:
        awayTeam.name || "",
      shortName:
        awayTeam.shortName || "",
      tla:
        awayTeam.tla || "",
      crest:
        awayTeam.crest || ""
    },

    score: {
      fullTime: {
        home:
          fullTime.home ?? null,
        away:
          fullTime.away ?? null
      }
    },

    competition:
      match.competition?.name ||
      "",

    competitionCode:
      match.competition?.code ||
      "",

    date,

    dateFormatted:
      formatDate(date),

    dateTimeFormatted:
      formatDateTime(date),

    status:
      match.status || "",

    matchday:
      match.matchday || null
  };
}

async function getVfbMatches() {
  const data =
    await apiRequest(
      "/teams/" +
        VFB_TEAM_ID +
        "/matches?competitions=BL1&season=2026"
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
      (match) => {
        const date =
          new Date(
            match.date
          ).getTime();

        return (
          date >= now &&
          ![
            "FINISHED",
            "CANCELLED",
            "POSTPONED"
          ].includes(
            match.status
          )
        );
      }
    ) || null;

  return {
    nextGame,
    fixtures: matches
  };
}


/* =========================================================
   BUNDESLIGA TABELLE
========================================================= */

async function getBundesligaTable() {
  const data =
    await apiRequest(
      "/competitions/BL1/standings?season=2026"
    );

  const standings =
    Array.isArray(
      data.standings
    )
      ? data.standings
      : [];

  const total =
    standings.find(
      (item) =>
        item.type === "TOTAL"
    ) ||
    standings[0];

  const table =
    Array.isArray(
      total?.table
    )
      ? total.table
      : [];

  return table.map(
    (row) => ({
      position:
        row.position || 0,

      team: {
        id:
          row.team?.id ||
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
       * Frontend-Felder
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
       * Original football-data.org Felder
       * bleiben zusätzlich erhalten.
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
   XML HELFER
========================================================= */

function decodeXml(
  value
) {
  if (!value) {
    return "";
  }

  return value
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
      /&#39;/g,
      "'"
    );
}

function stripHtml(
  value
) {
  if (!value) {
    return "";
  }

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

function getXmlTag(
  block,
  tag
) {
  const regex =
    new RegExp(
      "<" +
        tag +
        "(?:\\s[^>]*)?>([\\s\\S]*?)<\\/" +
        tag +
        ">",
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

function getXmlLink(
  block
) {
  const match =
    block.match(
      /<link[^>]*>([\s\S]*?)<\/link>/i
    );

  return match
    ? decodeXml(
        match[1].trim()
      )
    : "";
}


/* =========================================================
   NEWS
========================================================= */

async function getNews() {
  try {
    const response =
      await httpsRequest(
        VFB_RSS_URL,
        {
          headers: {
            "User-Agent":
              "Cannstatt1893News/1.0"
          }
        }
      );

    const xml =
      response.data || "";

    const items =
      xml.match(
        /<item[\s\S]*?<\/item>/gi
      ) || [];

    return items
      .map(
        (item) => {
          const title =
            getXmlTag(
              item,
              "title"
            );

          const link =
            getXmlLink(
              item
            );

          const pubDate =
            getXmlTag(
              item,
              "pubDate"
            );

          const description =
            stripHtml(
              getXmlTag(
                item,
                "description"
              )
            );

          const dateObject =
            pubDate
              ? new Date(
                  pubDate
                )
              : null;

          return {
            source:
              "vfb.de",

            sourceLabel:
              "VfB Stuttgart",

            title,

            link,

            pubDate,

            date:
              pubDate
                ? dateObject.toISOString()
                : "",

            dateFormatted:
              pubDate
                ? formatDateTime(
                    pubDate
                  )
                : "",

            description,

            image:
              ""
          };
        }
      )
      .filter(
        (item) =>
          item.title &&
          item.link
      )
      .sort(
        (a, b) =>
          new Date(
            b.date
          ) -
          new Date(
            a.date
          )
      )
      .slice(
        0,
        12
      );
  } catch (error) {
    console.error(
      "VfB-News konnten nicht geladen werden:",
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
   VFB STATISTIK
========================================================= */

function normalizePlayerName(
  name
) {
  return (
    name || ""
  )
    .toLowerCase()
    .normalize(
      "NFD"
    )
    .replace(
      /[\u0300-\u036f]/g,
      ""
    )
    .replace(
      /[^a-z0-9]/g,
      ""
    );
}

function findPlayer(
  playerName
) {
  const target =
    normalizePlayerName(
      playerName
    );

  return VFB_SQUAD.find(
    (player) =>
      normalizePlayerName(
        player.name
      ) === target
  );
}

async function getVfbSquad() {
  /*
   * Die Statistikseite des VfB ist die Quelle
   * für die aktuellen Bundesliga-2026/27-Werte.
   */

  try {
    const response =
      await httpsRequest(
        VFB_STATS_URL,
        {
          headers: {
            "User-Agent":
              "Cannstatt1893News/1.0"
          }
        }
      );

    const html =
      response.data || "";

    const stats =
      VFB_SQUAD.map(
        (player) => ({
          name:
            player.name,
          position:
            player.position,
          image:
            player.image,
          stats: {
            name:
              player.name,
            position:
              player.position,
            image:
              player.image,
            appearances:
              0,
            goals:
              0,
            assists:
              0,
            substitutionsIn:
              0,
            substitutionsOut:
              0,
            yellowCards:
              0,
            secondYellow:
              0,
            redCards:
              0,
            minutes:
              0
          }
        })
      );

    /*
     * Wir versuchen die Tabellenzeilen der VfB-Seite
     * auszulesen.
     */
    const rowMatches =
      html.match(
        /<tr[\s\S]*?<\/tr>/gi
      ) || [];

    for (
      const row of rowMatches
    ) {
      const text =
        stripHtml(
          row
        );

      if (!text) {
        continue;
      }

      const player =
        VFB_SQUAD.find(
          (candidate) =>
            text.includes(
              candidate.name
            )
        );

      if (!player) {
        continue;
      }

      const target =
        stats.find(
          (item) =>
            item.name ===
            player.name
        );

      if (!target) {
        continue;
      }

      /*
       * Die Zahlen werden aus den sichtbaren
       * Tabellenzellen gelesen.
       */
      const cells =
        row.match(
          /<t[dh][^>]*>[\s\S]*?<\/t[dh]>/gi
        ) || [];

      const values =
        cells
          .map(
            (cell) =>
              stripHtml(
                cell
              )
          )
          .filter(
            (value) =>
              value !== ""
          );

      /*
       * Wir verwenden nur Zahlenwerte und
       * versuchen sie sinnvoll den Statistikfeldern
       * zuzuordnen.
       */
      const numbers =
        values
          .map(
            (value) => {
              const cleaned =
                value
                  .replace(
                    /\./g,
                    ""
                  )
                  .replace(
                    /,/g,
                    "."
                  );

              return /^-?\d+(?:\.\d+)?$/.test(
                cleaned
              )
                ? Number(
                    cleaned
                  )
                : null;
            }
          )
          .filter(
            (value) =>
              value !== null
          );

      /*
       * Der VfB listet die Spalten:
       * Einsätze, Tore, Assists, Einwechslungen,
       * Auswechslungen, Gelb, Gelb-Rot, Rot, Minuten.
       *
       * Falls die Struktur der offiziellen Seite
       * geändert wird, bleiben die Werte einfach
       * auf 0 statt falsche Werte zu erzeugen.
       */
      if (
        numbers.length >= 9
      ) {
        target.stats.appearances =
          numbers[0] || 0;

        target.stats.goals =
          numbers[1] || 0;

        target.stats.assists =
          numbers[2] || 0;

        target.stats.substitutionsIn =
          numbers[3] || 0;

        target.stats.substitutionsOut =
          numbers[4] || 0;

        target.stats.yellowCards =
          numbers[5] || 0;

        target.stats.secondYellow =
          numbers[6] || 0;

        target.stats.redCards =
          numbers[7] || 0;

        target.stats.minutes =
          numbers[8] || 0;
      }
    }

    return stats;
  } catch (error) {
    console.error(
      "VfB-Statistik konnte nicht geladen werden:",
      error
    );

    return VFB_SQUAD.map(
      (player) => ({
        ...player,
        stats: {
          name:
            player.name,
          position:
            player.position,
          image:
            player.image,
          appearances:
            0,
          goals:
            0,
          assists:
            0,
          substitutionsIn:
            0,
          substitutionsOut:
            0,
          yellowCards:
            0,
          secondYellow:
            0,
          redCards:
            0,
          minutes:
            0
        }
      })
    );
  }
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
    getVfbTransfers(),
    getVfbSquad()
  ]);

  let championsLeague =
    [];

  try {
    const clData =
      await apiRequest(
        "/teams/" +
          VFB_TEAM_ID +
          "/matches?competitions=CL&season=2026"
      );

    championsLeague =
      Array.isArray(
        clData.matches
      )
        ? clData.matches
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
      "Champions-League-Spiele konnten nicht geladen werden:",
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
      "Dashboard API Fehler:",
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
  statusCode,
  data
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
        "no-cache",

      "Access-Control-Allow-Origin":
        "*"
    }
  );

  res.end(body);
}


/* =========================================================
   STATIC FILE SERVER
========================================================= */

const PUBLIC_DIR =
  __dirname;

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
  const parsedUrl =
    new URL(
      req.url,
      "http://" +
        req.headers.host
    );

  let pathname =
    decodeURIComponent(
      parsedUrl.pathname
    );

  if (
    pathname ===
    "/"
  ) {
    pathname =
      "/index.html";
  }

  const safePath =
    path.normalize(
      pathname
    );

  const filePath =
    path.join(
      PUBLIC_DIR,
      safePath
    );

  if (
    !filePath.startsWith(
      PUBLIC_DIR
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
    filePath,
    (error, stats) => {
      if (
        error ||
        !stats.isFile()
      ) {
        const fallback =
          path.join(
            PUBLIC_DIR,
            "index.html"
          );

        fs.readFile(
          fallback,
          (
            fallbackError,
            data
          ) => {
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
                  "text/html; charset=utf-8"
              }
            );

            res.end(data);
          }
        );

        return;
      }

      const extension =
        path.extname(
          filePath
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

      fs.createReadStream(
        filePath
      ).pipe(res);
    }
  );
}


/* =========================================================
   API
========================================================= */

async function handleApiRequest(
  req,
  res
) {
  const parsedUrl =
    new URL(
      req.url,
      "http://" +
        req.headers.host
    );

  const pathname =
    parsedUrl.pathname;

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
    const visitor =
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
          visitor.activeVisitors
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
   HTTP SERVER
========================================================= */

const server =
  http.createServer(
    async (
      req,
      res
    ) => {
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

        if (
          handled
        ) {
          return;
        }

        /*
         * Statische Dateien
         */
        serveStatic(
          req,
          res
        );
      } catch (
        error
      ) {
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
   SERVER START
========================================================= */

server.listen(
  PORT,
  () => {
    console.log(
      "================================================="
    );

    console.log(
      "Cannstatt 1893 News"
    );

    console.log(
      "Server läuft auf Port " +
        PORT
    );

    console.log(
      "================================================="
    );

    console.log(
      "Football-Data Token:",
      TOKEN
        ? "vorhanden"
        : "FEHLT!"
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
      "UNCAUGHT EXCEPTION:",
      error
    );
  }
);

process.on(
  "unhandledRejection",
  (error) => {
    console.error(
      "UNHANDLED REJECTION:",
      error
    );
  }
);
