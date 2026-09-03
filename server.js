const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;
const TOKEN = process.env.FOOTBALL_DATA_TOKEN;

const VFB_TEAM_ID = 10;

const RSS_URL =
  "https://www.vfb.de/templates/generated/1/raw/de.xml";

const CACHE_TIME = 6 * 60 * 60 * 1000;

let cache = {
  data: null,
  time: 0
};

/* =========================
   HTTP HELPER
========================= */

function request(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith("https") ? https : http;

    const req = protocol.get(
      url,
      {
        headers: {
          "User-Agent": "Canstatt1893News/1.0",
          ...headers
        }
      },
      (res) => {
        let data = "";

        res.on("data", chunk => {
          data += chunk;
        });

        res.on("end", () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(data);
          } else {
            reject(
              new Error(
                `HTTP ${res.statusCode} bei ${url}`
              )
            );
          }
        });
      }
    );

    req.on("error", reject);
  });
}

/* =========================
   FOOTBALL-DATA.ORG
========================= */

async function apiRequest(endpoint) {
  if (!TOKEN) {
    throw new Error(
      "FOOTBALL_DATA_TOKEN fehlt in den Render Environment Variables."
    );
  }

  const url =
    "https://api.football-data.org/v4" + endpoint;

  const data = await request(url, {
    "X-Auth-Token": TOKEN
  });

  return JSON.parse(data);
}

/* =========================
   VFB SPIELE
========================= */

async function getVfbMatches() {
  const data = await apiRequest(
    `/teams/${VFB_TEAM_ID}/matches?competitions=BL1,CL&dateFrom=2026-07-01&dateTo=2027-06-30&limit=100`
  );

  return data.matches || [];
}

/* =========================
   BUNDESLIGA TABELLE
========================= */

async function getBundesligaTable() {
  const data = await apiRequest(
    "/competitions/BL1/standings"
  );

  if (
    data.standings &&
    data.standings.length > 0
  ) {
    const total =
      data.standings.find(
        standing => standing.type === "TOTAL"
      ) || data.standings[0];

    return total.table || [];
  }

  return [];
}

/* =========================
   HTML ENTITIES
========================= */

function decodeHTML(text = "") {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, "/");
}

/* =========================
   XML PARSER
========================= */

function getXMLValue(block, tag) {
  const regex = new RegExp(
    `<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`,
    "i"
  );

  const match = block.match(regex);

  if (!match) {
    return "";
  }

  return decodeHTML(
    match[1]
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, "$1")
      .trim()
  );
}

/* =========================
   VFB RSS NEWS
========================= */

async function fetchVfbNews() {
  try {
    const xml = await request(RSS_URL);

    const items = [];
    const matches = xml.match(
      /<item[\s\S]*?<\/item>/gi
    ) || [];

    const blockedTitles = [
      "News-Archiv",
      "VfB Magazine",
      "VfB Tippspiel",
      "VfB Radio",
      "Praktikum",
      "Aushilfen und Werkstudenten",
      "Mitgliedschaft",
      "Listenansicht",
      "Statistik",
      "Zu-/Abgänge"
    ];

    for (const item of matches) {
      const title = getXMLValue(item, "title");
      const link = getXMLValue(item, "link");
      const description =
        getXMLValue(item, "description");

      const pubDate =
        getXMLValue(item, "pubDate") ||
        getXMLValue(item, "date");

      if (!title || !link) {
        continue;
      }

      if (
        blockedTitles.some(
          blocked =>
            title.toLowerCase() ===
            blocked.toLowerCase()
        )
      ) {
        continue;
      }

      items.push({
        title,
        link,
        description,
        pubDate
      });
    }

    console.log(
      "VfB-News gefunden:",
      items.length
    );

    return items.slice(0, 10);

  } catch (error) {
    console.error(
      "Fehler beim VfB RSS Feed:",
      error.message
    );

    return [];
  }
}

/* =========================
   DASHBOARD
========================= */

async function buildDashboard() {
  if (
    cache.data &&
    Date.now() - cache.time < CACHE_TIME
  ) {
    return cache.data;
  }

  const [
    matches,
    table,
    news
  ] = await Promise.all([
    getVfbMatches(),
    getBundesligaTable(),
    fetchVfbNews()
  ]);

  const bundesliga = matches.filter(
    match =>
      match.competition &&
      match.competition.code === "BL1"
  );

  const championsLeague = matches.filter(
    match =>
      match.competition &&
      match.competition.code === "CL"
  );

  const now = new Date();

  const upcoming = matches
    .filter(match => {
      if (!match.utcDate) {
        return false;
      }

      return (
        new Date(match.utcDate) >= now
      );
    })
    .sort(
      (a, b) =>
        new Date(a.utcDate) -
        new Date(b.utcDate)
    );

  const nextGame =
    upcoming.length > 0
      ? upcoming[0]
      : null;

  const result = {
    nextGame,
    fixtures: bundesliga,
    championsLeague,
    table,
    news,
    attribution:
      "Data provided by football-data.org"
  };

  cache = {
    data: result,
    time: Date.now()
  };

  return result;
}

/* =========================
   FILE SERVER
========================= */

function serveFile(res, fileName) {
  const filePath =
    path.join(__dirname, fileName);

  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404, {
        "Content-Type": "text/plain; charset=utf-8"
      });

      res.end("Datei nicht gefunden.");
      return;
    }

    let contentType =
      "text/plain; charset=utf-8";

    if (fileName.endsWith(".html")) {
      contentType =
        "text/html; charset=utf-8";
    }

    if (fileName.endsWith(".css")) {
      contentType =
        "text/css; charset=utf-8";
    }

    if (fileName.endsWith(".js")) {
      contentType =
        "application/javascript; charset=utf-8";
    }

    res.writeHead(200, {
      "Content-Type": contentType
    });

    res.end(data);
  });
}

/* =========================
   SERVER
========================= */

const server = http.createServer(
  async (req, res) => {

    const requestUrl = new URL(
      req.url,
      `http://${req.headers.host}`
    );

    const pathname =
      requestUrl.pathname;

    /* API */

    if (pathname === "/api/dashboard") {
      try {
        const dashboard =
          await buildDashboard();

        res.writeHead(200, {
          "Content-Type":
            "application/json; charset=utf-8",
          "Cache-Control":
            "public, max-age=300"
        });

        res.end(
          JSON.stringify(dashboard)
        );

      } catch (error) {
        console.error(
          "Dashboard-Fehler:",
          error
        );

        res.writeHead(500, {
          "Content-Type":
            "application/json; charset=utf-8"
        });

        res.end(
          JSON.stringify({
            error:
              "Dashboard konnte nicht geladen werden.",
            message:
              error.message
          })
        );
      }

      return;
    }

    /* HEALTH */

    if (pathname === "/health") {
      res.writeHead(200, {
        "Content-Type":
          "application/json; charset=utf-8"
      });

      res.end(
        JSON.stringify({
          status: "ok"
        })
      );

      return;
    }

    /* WEBSITE */

    if (
      pathname === "/" ||
      pathname === "/index.html"
    ) {
      serveFile(res, "index.html");
      return;
    }

    /* Andere Dateien */

    const safePath =
      pathname.replace(/^\/+/, "");

    if (
      safePath &&
      !safePath.includes("..")
    ) {
      const fullPath =
        path.join(
          __dirname,
          safePath
        );

      fs.stat(
        fullPath,
        (error, stats) => {
          if (
            !error &&
            stats.isFile()
          ) {
            serveFile(
              res,
              safePath
            );
          } else {
            serveFile(
              res,
              "index.html"
            );
          }
        }
      );

      return;
    }

    serveFile(res, "index.html");
  }
);

server.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log(
      `Canstatt 1893 News läuft auf Port ${PORT}`
    );
  }
);
