const http = require("http");
const https = require("https");

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_FOOTBALL_KEY;

const VFB_TEAM_ID = 160;
const BUNDESLIGA_ID = 78;
const CHAMPIONS_LEAGUE_ID = 2;
const SEASON = 2026;

const VFB_NEWS_URL = "https://www.vfb.de/de/1893/aktuell/neues/";

let staticCache = {
  data: null,
  time: 0
};

let liveCache = {
  data: [],
  time: 0
};

const STATIC_CACHE_TIME = 6 * 60 * 60 * 1000;
const LIVE_CACHE_TIME = 20 * 60 * 1000;

function request(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, options, res => {
      let body = "";

      res.on("data", chunk => {
        body += chunk;
      });

      res.on("end", () => {
        resolve({
          status: res.statusCode,
          body
        });
      });
    });

    req.on("error", reject);
    req.setTimeout(15000, () => {
      req.destroy(new Error("Request timeout"));
    });
  });
}

async function apiFootball(endpoint) {
  if (!API_KEY) {
    throw new Error("API_FOOTBALL_KEY fehlt in Render");
  }

  const result = await request(
    "https://v3.football.api-sports.io" + endpoint,
    {
      headers: {
        "x-apisports-key": API_KEY
      }
    }
  );

  let json;

  try {
    json = JSON.parse(result.body);
  } catch {
    throw new Error("API-Football lieferte kein gültiges JSON");
  }

  if (result.status !== 200) {
    throw new Error(
      `API-Football HTTP ${result.status}: ${JSON.stringify(json.errors || json)}`
    );
  }

  if (json.errors && Object.keys(json.errors).length > 0) {
    throw new Error(
      `API-Football Fehler: ${JSON.stringify(json.errors)}`
    );
  }

  return json.response || [];
}

function formatDate(dateString) {
  if (!dateString) return "";

  const date = new Date(dateString);

  return date.toLocaleString("de-DE", {
    timeZone: "Europe/Berlin",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function mapFixture(item) {
  return {
    id: item.fixture?.id,
    date: formatDate(item.fixture?.date),
    rawDate: item.fixture?.date,

    home: item.teams?.home?.name || "",
    away: item.teams?.away?.name || "",

    homeLogo: item.teams?.home?.logo || "",
    awayLogo: item.teams?.away?.logo || "",

    competition: item.league?.name || "",
    league: item.league?.name || "",

    status: item.fixture?.status?.short || "",
    statusLong: item.fixture?.status?.long || "",

    homeGoals: item.goals?.home,
    awayGoals: item.goals?.away,

    venue: item.fixture?.venue?.name || "",
    city: item.fixture?.venue?.city || ""
  };
}

async function getFixtures(leagueId) {
  const response = await apiFootball(
    `/fixtures?team=${VFB_TEAM_ID}&league=${leagueId}&season=${SEASON}`
  );

  return response
    .map(mapFixture)
    .sort((a, b) => {
      return new Date(a.rawDate) - new Date(b.rawDate);
    });
}

async function getTable() {
  const response = await apiFootball(
    `/standings?league=${BUNDESLIGA_ID}&season=${SEASON}`
  );

  if (!response.length) {
    return [];
  }

  const groups = response[0].league?.standings || [];

  if (!groups.length) {
    return [];
  }

  return groups[0].map(item => ({
    rank: item.rank,
    team: item.team?.name || "",
    logo: item.team?.logo || "",
    played: item.all?.played ?? 0,
    wins: item.all?.win ?? 0,
    draws: item.all?.draw ?? 0,
    losses: item.all?.lose ?? 0,
    goalsFor: item.all?.goals?.for ?? 0,
    goalsAgainst: item.all?.goals?.against ?? 0,
    goalDiff: item.goalsDiff ?? 0,
    points: item.points ?? 0,
    form: item.form || ""
  }));
}

async function getLiveMatches() {
  const response = await apiFootball(
    `/fixtures?team=${VFB_TEAM_ID}&live=all`
  );

  return response.map(mapFixture);
}

async function getNews() {
  try {
    const result = await request(VFB_NEWS_URL);

    const html = result.body;

    const links = [];
    const regex =
      /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;

    let match;

    while ((match = regex.exec(html)) !== null) {
      let url = match[1];
      let title = match[2]
        .replace(/<[^>]*>/g, " ")
        .replace(/\s+/g, " ")
        .trim();

      if (!title || title.length < 8) continue;

      if (url.startsWith("/")) {
        url = "https://www.vfb.de" + url;
      }

      if (
        url.includes("vfb.de") &&
        !links.some(x => x.url === url)
      ) {
        links.push({
          title,
          url
        });
      }
    }

    return links.slice(0, 10);
  } catch (error) {
    console.error("NEWS ERROR:", error.message);
    return [];
  }
}

async function buildStaticDashboard() {
  console.log("Lade Bundesliga-Spiele...");

  const bundesliga = await getFixtures(BUNDESLIGA_ID);

  console.log(
    "Bundesliga-Spiele:",
    bundesliga.length
  );

  console.log("Lade Champions-League-Spiele...");

  const championsLeague =
    await getFixtures(CHAMPIONS_LEAGUE_ID);

  console.log(
    "Champions-League-Spiele:",
    championsLeague.length
  );

  console.log("Lade Tabelle...");

  const table = await getTable();

  console.log(
    "Tabellenplätze:",
    table.length
  );

  const news = await getNews();

  const now = new Date();

  const allFixtures = [
    ...bundesliga,
    ...championsLeague
  ].sort((a, b) => {
    return new Date(a.rawDate) - new Date(b.rawDate);
  });

  const nextGame =
    allFixtures.find(game => {
      return (
        game.rawDate &&
        new Date(game.rawDate) >= now &&
        !["FT", "AET", "PEN"].includes(game.status)
      );
    }) || null;

  return {
    updatedAt: new Date().toISOString(),
    news,
    nextGame,
    fixtures: bundesliga,
    championsLeague,
    table
  };
}

async function getStaticDashboard() {
  if (
    staticCache.data &&
    Date.now() - staticCache.time < STATIC_CACHE_TIME
  ) {
    return staticCache.data;
  }

  try {
    const data = await buildStaticDashboard();

    staticCache = {
      data,
      time: Date.now()
    };

    return data;
  } catch (error) {
    console.error(
      "STATIC API ERROR:",
      error.message
    );

    if (staticCache.data) {
      return staticCache.data;
    }

    return {
      updatedAt: new Date().toISOString(),
      news: await getNews(),
      nextGame: null,
      fixtures: [],
      championsLeague: [],
      table: [],
      error: error.message
    };
  }
}

async function getLiveCached() {
  if (
    Date.now() - liveCache.time < LIVE_CACHE_TIME
  ) {
    return liveCache.data;
  }

  try {
    const data = await getLiveMatches();

    liveCache = {
      data,
      time: Date.now()
    };

    return data;
  } catch (error) {
    console.error(
      "LIVE API ERROR:",
      error.message
    );

    return liveCache.data;
  }
}

async function buildDashboard() {
  const staticData = await getStaticDashboard();
  const live = await getLiveCached();

  return {
    ...staticData,
    live
  };
}

function sendJSON(res, data) {
  res.writeHead(200, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });

  res.end(JSON.stringify(data));
}

async function serveFile(res, file) {
  const fs = require("fs");
  const path = require("path");

  const filePath = path.join(__dirname, file);

  if (!fs.existsSync(filePath)) {
    res.writeHead(404);
    res.end("Nicht gefunden");
    return;
  }

  const ext = path.extname(filePath);

  const types = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8"
  };

  res.writeHead(200, {
    "Content-Type":
      types[ext] || "application/octet-stream"
  });

  fs.createReadStream(filePath).pipe(res);
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.url === "/api/dashboard") {
      const data = await buildDashboard();
      sendJSON(res, data);
      return;
    }

    if (req.url === "/health") {
      sendJSON(res, {
        status: "ok",
        apiConfigured: !!API_KEY
      });
      return;
    }

    if (
      req.url === "/" ||
      req.url === "/index.html"
    ) {
      await serveFile(res, "index.html");
      return;
    }

    res.writeHead(404, {
      "Content-Type": "text/plain; charset=utf-8"
    });

    res.end("Nicht gefunden");
  } catch (error) {
    console.error("SERVER ERROR:", error);

    res.writeHead(500, {
      "Content-Type": "application/json; charset=utf-8"
    });

    res.end(
      JSON.stringify({
        error: error.message
      })
    );
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(
    `Server läuft auf Port ${PORT}`
  );

  console.log(
    "API-Football Key vorhanden:",
    !!API_KEY
  );
});
