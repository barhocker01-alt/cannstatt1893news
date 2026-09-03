const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;
const TOKEN = process.env.FOOTBALL_DATA_TOKEN;

const VFB_TEAM_ID = 10;

let cache = {
  data: null,
  time: 0
};

const CACHE_TIME = 6 * 60 * 60 * 1000;

function apiRequest(endpoint) {
  return new Promise((resolve, reject) => {
    if (!TOKEN) {
      reject(new Error("FOOTBALL_DATA_TOKEN fehlt"));
      return;
    }

    const req = https.get(
      "https://api.football-data.org/v4" + endpoint,
      {
        headers: {
          "X-Auth-Token": TOKEN
        }
      },
      res => {
        let body = "";

        res.on("data", chunk => {
          body += chunk;
        });

        res.on("end", () => {
          let json;

          try {
            json = JSON.parse(body);
          } catch {
            reject(
              new Error(
                "football-data.org lieferte kein gültiges JSON"
              )
            );
            return;
          }

          if (res.statusCode !== 200) {
            reject(
              new Error(
                `football-data.org HTTP ${res.statusCode}: ${
                  json.message || JSON.stringify(json)
                }`
              )
            );
            return;
          }

          resolve(json);
        });
      }
    );

    req.on("error", reject);

    req.setTimeout(15000, () => {
      req.destroy(new Error("API Timeout"));
    });
  });
}

function formatDate(dateString) {
  if (!dateString) return "";

  return new Date(dateString).toLocaleString("de-DE", {
    timeZone: "Europe/Berlin",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function mapMatch(match) {
  return {
    id: match.id,

    date: formatDate(match.utcDate),
    rawDate: match.utcDate,

    home: match.homeTeam?.name || "",
    away: match.awayTeam?.name || "",

    homeLogo: match.homeTeam?.crest || "",
    awayLogo: match.awayTeam?.crest || "",

    competition:
      match.competition?.name || "",

    league:
      match.competition?.name || "",

    status: match.status || "",

    statusLong: match.status || "",

    homeGoals:
      match.score?.fullTime?.home ?? null,

    awayGoals:
      match.score?.fullTime?.away ?? null,

    venue: match.venue || "",

    matchday: match.matchday || null
  };
}

async function getVfbMatches() {
  const data = await apiRequest(
    `/teams/${VFB_TEAM_ID}/matches?competitions=BL1,CL&dateFrom=2026-07-01&dateTo=2027-06-30&limit=100`
  );

  return (data.matches || [])
    .map(mapMatch)
    .sort(
      (a, b) =>
        new Date(a.rawDate) -
        new Date(b.rawDate)
    );
}

async function getBundesligaTable() {
  const data = await apiRequest(
    "/competitions/BL1/standings"
  );

  const standings = data.standings || [];

  const total = standings.find(
    item => item.type === "TOTAL"
  );

  if (!total) return [];

  return (total.table || []).map(item => ({
    rank: item.position,

    team:
      item.team?.name || "",

    logo:
      item.team?.crest || "",

    played:
      item.playedGames ?? 0,

    wins:
      item.won ?? 0,

    draws:
      item.draw ?? 0,

    losses:
      item.lost ?? 0,

    goalsFor:
      item.goalsFor ?? 0,

    goalsAgainst:
      item.goalsAgainst ?? 0,

    goalDiff:
      item.goalDifference ?? 0,

    points:
      item.points ?? 0,

    form:
      item.form || ""
  }));
}

async function getNews() {
  try {
    const result = await fetchVfbNews();

    return result;
  } catch (error) {
    console.error(
      "NEWS ERROR:",
      error.message
    );

    return [];
  }
}

function fetchVfbNews() {
  return new Promise((resolve, reject) => {
    https.get(
      "https://www.vfb.de/de/1893/aktuell/neues/",
      res => {
        let html = "";

        res.on("data", chunk => {
          html += chunk;
        });

        res.on("end", () => {
          const links = [];

          const regex =
            /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;

          let match;

          while (
            (match = regex.exec(html)) !== null
          ) {
            let url = match[1];

            let title = match[2]
              .replace(/<[^>]*>/g, " ")
              .replace(/\s+/g, " ")
              .trim();

            if (!title || title.length < 8) {
              continue;
            }

            if (url.startsWith("/")) {
              url = "https://www.vfb.de" + url;
            }

            if (
              url.includes("vfb.de") &&
              !links.some(
                item => item.url === url
              )
            ) {
              links.push({
                title,
                url
              });
            }
          }

          resolve(links.slice(0, 10));
        });
      }
    ).on("error", reject);
  });
}

async function buildDashboard() {
  console.log("Lade VfB-Spiele...");

  const matches = await getVfbMatches();

  console.log(
    "VfB-Spiele gefunden:",
    matches.length
  );

  console.log("Lade Bundesliga-Tabelle...");

  const table =
    await getBundesligaTable();

  console.log(
    "Tabellenplätze:",
    table.length
  );

  const news = await getNews();

  const bundesliga = matches.filter(
    match =>
      match.competition === "Bundesliga"
  );

  const championsLeague = matches.filter(
    match =>
      match.competition ===
        "UEFA Champions League" ||
      match.competition ===
        "Champions League"
  );

  const now = new Date();

  const nextGame =
    matches.find(match => {
      const date = new Date(match.rawDate);

      return (
        date >= now &&
        (
          match.status === "SCHEDULED" ||
          match.status === "TIMED"
        )
      );
    }) || null;

  return {
    updatedAt:
      new Date().toISOString(),

    news,

    nextGame,

    fixtures: bundesliga,

    championsLeague,

    table,

    live: [],

    attribution:
      "Data provided by football-data.org"
  };
}

async function getDashboard() {
  if (
    cache.data &&
    Date.now() - cache.time <
      CACHE_TIME
  ) {
    return cache.data;
  }

  try {
    const data =
      await buildDashboard();

    cache = {
      data,
      time: Date.now()
    };

    return data;
  } catch (error) {
    console.error(
      "API ERROR:",
      error.message
    );

    return {
      updatedAt:
        new Date().toISOString(),

      news: [],

      nextGame: null,

      fixtures: [],

      championsLeague: [],

      table: [],

      live: [],

      error: error.message,

      attribution:
        "Data provided by football-data.org"
    };
  }
}

function sendJSON(res, data) {
  res.writeHead(200, {
    "Content-Type":
      "application/json; charset=utf-8",

    "Cache-Control":
      "no-store"
  });

  res.end(
    JSON.stringify(data)
  );
}

function serveFile(res, filename) {
  const filePath =
    path.join(__dirname, filename);

  if (!fs.existsSync(filePath)) {
    res.writeHead(404);
    res.end("Nicht gefunden");
    return;
  }

  const ext =
    path.extname(filePath);

  const types = {
    ".html":
      "text/html; charset=utf-8",

    ".css":
      "text/css; charset=utf-8",

    ".js":
      "application/javascript; charset=utf-8"
  };

  res.writeHead(200, {
    "Content-Type":
      types[ext] ||
      "application/octet-stream"
  });

  fs.createReadStream(filePath)
    .pipe(res);
}

const server =
  http.createServer(
    async (req, res) => {
      try {
        if (
          req.url ===
          "/api/dashboard"
        ) {
          const data =
            await getDashboard();

          sendJSON(res, data);
          return;
        }

        if (
          req.url === "/health"
        ) {
          sendJSON(res, {
            status: "ok",
            apiConfigured:
              !!TOKEN
          });

          return;
        }

        if (
          req.url === "/" ||
          req.url === "/index.html"
        ) {
          serveFile(
            res,
            "index.html"
          );

          return;
        }

        res.writeHead(404);
        res.end("Nicht gefunden");
      } catch (error) {
        console.error(
          "SERVER ERROR:",
          error
        );

        res.writeHead(500, {
          "Content-Type":
            "application/json"
        });

        res.end(
          JSON.stringify({
            error:
              error.message
          })
        );
      }
    }
  );

server.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log(
      `Server läuft auf Port ${PORT}`
    );

    console.log(
      "Football-Data Token vorhanden:",
      !!TOKEN
    );
  }
);
