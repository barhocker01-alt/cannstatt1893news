const http = require("http");
const https = require("https");

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_FOOTBALL_KEY;

const VFB_TEAM_ID = 160;
const BUNDESLIGA_ID = 78;
const CHAMPIONS_LEAGUE_ID = 2;
const SEASON = 2026;

let cache = {
  data: null,
  time: 0
};

function apiFootball(path) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      {
        hostname: "v3.football.api-sports.io",
        path,
        headers: {
          "x-apisports-key": API_KEY
        }
      },
      response => {
        let body = "";

        response.on("data", chunk => {
          body += chunk;
        });

        response.on("end", () => {
          try {
            const json = JSON.parse(body);

            if (response.statusCode >= 400) {
              reject(new Error("API Fehler " + response.statusCode));
              return;
            }

            resolve(json);
          } catch (error) {
            reject(error);
          }
        });
      }
    );

    req.on("error", reject);
    req.setTimeout(15000, () => {
      req.destroy();
      reject(new Error("API Timeout"));
    });
  });
}

function formatDate(dateString) {
  if (!dateString) return "";

  const date = new Date(dateString);

  return new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

async function getFixtures(league) {
  const result = await apiFootball(
    `/fixtures?team=${VFB_TEAM_ID}&league=${league}&season=${SEASON}`
  );

  return (result.response || []).map(match => ({
    id: match.fixture.id,
    date: match.fixture.date,
    formattedDate: formatDate(match.fixture.date),
    status: match.fixture.status.short,
    statusLong: match.fixture.status.long,
    home: match.teams.home.name,
    away: match.teams.away.name,
    homeLogo: match.teams.home.logo,
    awayLogo: match.teams.away.logo,
    homeGoals: match.goals.home,
    awayGoals: match.goals.away,
    league: match.league.name
  }));
}

async function getTable() {
  const result = await apiFootball(
    `/standings?league=${BUNDESLIGA_ID}&season=${SEASON}&team=${VFB_TEAM_ID}`
  );

  const standings =
    result.response?.[0]?.league?.standings?.[0] || [];

  return standings.map(row => ({
    position: row.rank,
    team: row.team.name,
    logo: row.team.logo,
    points: row.points,
    played: row.all.played,
    wins: row.all.win,
    draws: row.all.draw,
    losses: row.all.lose,
    goalsFor: row.all.goals.for,
    goalsAgainst: row.all.goals.against,
    goalDiff: row.goalsDiff
  }));
}

async function getLiveMatches() {
  const result = await apiFootball("/fixtures?live=all");

  return (result.response || [])
    .filter(match =>
      match.teams.home.id === VFB_TEAM_ID ||
      match.teams.away.id === VFB_TEAM_ID
    )
    .map(match => ({
      id: match.fixture.id,
      elapsed: match.fixture.status.elapsed,
      status: match.fixture.status.short,
      home: match.teams.home.name,
      away: match.teams.away.name,
      homeGoals: match.goals.home,
      awayGoals: match.goals.away
    }));
}

async function getNews() {
  return new Promise(resolve => {
    const req = https.get(
      "https://www.vfb.de/de/1893/aktuell/neues/",
      {
        headers: {
          "User-Agent": "Canstatt1893News/2.0"
        }
      },
      response => {
        let html = "";

        response.on("data", chunk => {
          html += chunk;
        });

        response.on("end", () => {
          const news = [];
          const regex =
            /href="([^"]+)"[^>]*>([\s\S]{0,500}?)<\/a>/gi;

          let match;

          while (
            (match = regex.exec(html)) !== null &&
            news.length < 10
          ) {
            let title = match[2]
              .replace(/<[^>]+>/g, " ")
              .replace(/\s+/g, " ")
              .trim();

            if (
              title.length > 20 &&
              !title.includes("Cookie") &&
              !title.includes("Datenschutz")
            ) {
              let url = match[1];

              if (url.startsWith("/")) {
                url = "https://www.vfb.de" + url;
              }

              if (url.startsWith("http")) {
                news.push({
                  title,
                  url
                });
              }
            }
          }

          resolve(news);
        });
      }
    );

    req.on("error", () => resolve([]));
  });
}

async function buildDashboard() {
  if (!API_KEY) {
    throw new Error("API_FOOTBALL_KEY fehlt");
  }

  const [
    bundesligaFixtures,
    championsLeagueFixtures,
    table,
    live,
    news
  ] = await Promise.all([
    getFixtures(BUNDESLIGA_ID),
    getFixtures(CHAMPIONS_LEAGUE_ID),
    getTable(),
    getLiveMatches(),
    getNews()
  ]);

  const now = Date.now();

  const upcoming = [
    ...bundesligaFixtures,
    ...championsLeagueFixtures
  ]
    .filter(match => new Date(match.date).getTime() > now)
    .sort(
      (a, b) =>
        new Date(a.date).getTime() -
        new Date(b.date).getTime()
    );

  return {
    updatedAt: new Date().toISOString(),

    news,

    nextGame: upcoming[0] || null,

    fixtures: bundesligaFixtures
      .sort(
        (a, b) =>
          new Date(a.date).getTime() -
          new Date(b.date).getTime()
      )
      .slice(0, 20),

    championsLeague: championsLeagueFixtures
      .sort(
        (a, b) =>
          new Date(a.date).getTime() -
          new Date(b.date).getTime()
      ),

    table,

    live
  };
}

async function getDashboard() {
  const fiveMinutes = 5 * 60 * 1000;

  if (
    cache.data &&
    Date.now() - cache.time < fiveMinutes
  ) {
    return cache.data;
  }

  const data = await buildDashboard();

  cache.data = data;
  cache.time = Date.now();

  return data;
}

const server = http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");

  if (req.url === "/api/dashboard") {
    try {
      const data = await getDashboard();

      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8"
      });

      res.end(JSON.stringify(data));
    } catch (error) {
      console.error(error);

      res.writeHead(500, {
        "Content-Type": "application/json; charset=utf-8"
      });

      res.end(
        JSON.stringify({
          error: "Daten konnten nicht geladen werden"
        })
      );
    }

    return;
  }

  if (req.url === "/health") {
    res.writeHead(200, {
      "Content-Type": "text/plain"
    });

    res.end("Canstatt 1893 News läuft");
    return;
  }

  if (req.url === "/" || req.url === "/index.html") {
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8"
    });

    const fs = require("fs");
    res.end(
      fs.readFileSync(__dirname + "/index.html")
    );

    return;
  }

  res.writeHead(404);
  res.end("Nicht gefunden");
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(
    `Canstatt 1893 News läuft auf Port ${PORT}`
  );
});
