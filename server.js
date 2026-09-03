const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;
const TOKEN = process.env.FOOTBALL_DATA_TOKEN;

const VFB_TEAM_ID = 10;

const VFB_RSS_URL =
  "https://www.vfb.de/templates/generated/1/raw/de.xml";

let cache = {
  data: null,
  time: 0
};

const CACHE_TIME =
  6 * 60 * 60 * 1000;


/* =========================================================
   FOOTBALL-DATA.ORG API
========================================================= */

function apiRequest(endpoint) {

  return new Promise((resolve, reject) => {

    if (!TOKEN) {
      reject(
        new Error(
          "FOOTBALL_DATA_TOKEN fehlt"
        )
      );

      return;
    }

    const req = https.get(
      "https://api.football-data.org/v4" + endpoint,
      {
        headers: {
          "X-Auth-Token": TOKEN,
          "User-Agent": "Canstatt1893News/1.0"
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
                  json.message ||
                  JSON.stringify(json)
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

      req.destroy(
        new Error("API Timeout")
      );

    });

  });

}


/* =========================================================
   DATUM FORMATIEREN
========================================================= */

function formatDate(dateString) {

  if (!dateString) {
    return "";
  }

  return new Date(
    dateString
  ).toLocaleString(
    "de-DE",
    {
      timeZone: "Europe/Berlin",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    }
  );

}


/* =========================================================
   SPIEL UMWANDELN
========================================================= */

function mapMatch(match) {

  return {

    id: match.id,

    date:
      formatDate(
        match.utcDate
      ),

    rawDate:
      match.utcDate,

    home:
      match.homeTeam?.name || "",

    away:
      match.awayTeam?.name || "",

    homeLogo:
      match.homeTeam?.crest || "",

    awayLogo:
      match.awayTeam?.crest || "",

    competition:
      match.competition?.name || "",

    league:
      match.competition?.name || "",

    status:
      match.status || "",

    statusLong:
      match.status || "",

    homeGoals:
      match.score?.fullTime?.home ?? null,

    awayGoals:
      match.score?.fullTime?.away ?? null,

    venue:
      match.venue || "",

    matchday:
      match.matchday || null

  };

}


/* =========================================================
   VFB SPIELE LADEN
========================================================= */

async function getVfbMatches() {

  const data =
    await apiRequest(
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


/* =========================================================
   BUNDESLIGA TABELLE
========================================================= */

async function getBundesligaTable() {

  const data =
    await apiRequest(
      "/competitions/BL1/standings"
    );

  const standings =
    data.standings || [];

  const total =
    standings.find(
      item =>
        item.type === "TOTAL"
    );

  if (!total) {
    return [];
  }

  return (total.table || [])
    .map(item => ({

      position:
        item.position,

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


/* =========================================================
   HTML ENTITY DEKODIEREN
========================================================= */

function decodeHTML(text) {

  if (!text) {
    return "";
  }

  return String(text)

    .replace(
      /<!\[CDATA\[([\s\S]*?)\]\]>/g,
      "$1"
    )

    .replace(
      /<[^>]*>/g,
      " "
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
      /&#39;/g,
      "'"
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

    .replace(
      /&#(\d+);/g,
      (_, code) =>
        String.fromCharCode(
          Number(code)
        )
    )

    .replace(
      /&#x([0-9a-f]+);/gi,
      (_, code) =>
        String.fromCharCode(
          parseInt(code, 16)
        )
    )

    .replace(
      /\s+/g,
      " "
    )

    .trim();

}


/* =========================================================
   XML TAG AUSLESEN
========================================================= */

function getXMLValue(
  xml,
  tag
) {

  const regex =
    new RegExp(
      `<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`,
      "i"
    );

  const match =
    xml.match(regex);

  if (!match) {
    return "";
  }

  return decodeHTML(
    match[1]
  );

}


/* =========================================================
   OFFIZIELLE VFB NEWS
========================================================= */

function fetchVfbNews() {

  return new Promise(
    (resolve, reject) => {

      const req =
        https.get(
          VFB_RSS_URL,
          {
            headers: {
              "User-Agent":
                "Mozilla/5.0 Canstatt1893News/1.0",
              "Accept":
                "application/rss+xml, application/xml, text/xml, */*"
            }
          },
          res => {

            let xml = "";

            res.on(
              "data",
              chunk => {
                xml += chunk;
              }
            );

            res.on(
              "end",
              () => {

                if (
                  res.statusCode < 200 ||
                  res.statusCode >= 300
                ) {

                  reject(
                    new Error(
                      `VfB RSS HTTP ${res.statusCode}`
                    )
                  );

                  return;
                }


                /*
                 * RSS besteht normalerweise aus
                 * mehreren <item>-Elementen.
                 */

                const itemRegex =
                  /<item\b[^>]*>([\s\S]*?)<\/item>/gi;

                const items = [];

                let match;


                while (
                  (match =
                    itemRegex.exec(xml)) !== null
                ) {

                  const item =
                    match[1];

                  const title =
                    getXMLValue(
                      item,
                      "title"
                    );

                  const link =
                    getXMLValue(
                      item,
                      "link"
                    );

                  const pubDate =
                    getXMLValue(
                      item,
                      "pubDate"
                    );

                  let description =
                    getXMLValue(
                      item,
                      "description"
                    );

                  const category =
                    getXMLValue(
                      item,
                      "category"
                    );


                  /*
                   * Nur echte Meldungen übernehmen.
                   */

                  if (
                    !title ||
                    title.length < 5 ||
                    !link
                  ) {
                    continue;
                  }


                  /*
                   * Navigation / Archiv-Einträge
                   * werden zusätzlich herausgefiltert.
                   */

                  const lowerTitle =
                    title.toLowerCase();

                  const blocked = [
                    "news-archiv",
                    "vfb magazine",
                    "vfb radio",
                    "vfb tippspiel",
                    "listenansicht",
                    "statistik",
                    "zu-/abgänge",
                    "mitgliedschaft",
                    "praktikum",
                    "aushilfen und werkstudenten"
                  ];


                  if (
                    blocked.some(
                      word =>
                        lowerTitle.includes(word)
                    )
                  ) {
                    continue;
                  }


                  /*
                   * Beschreibung kürzen.
                   */

                  if (
                    description.length > 300
                  ) {

                    description =
                      description.substring(
                        0,
                        297
                      ) + "...";

                  }


                  items.push({

                    category:
                      category ||
                      "VfB aktuell",

                    title,

                    date:
                      pubDate
                        ? formatDate(pubDate)
                        : "",

                    summary:
                      description,

                    url:
                      link

                  });

                }


                /*
                 * Falls der Feed keine
                 * <item>-Elemente liefert,
                 * nicht mit falschen Daten arbeiten.
                 */

                resolve(
                  items.slice(0, 10)
                );

              }
            );

          }
        );


      req.on(
        "error",
        reject
      );


      req.setTimeout(
        15000,
        () => {

          req.destroy(
            new Error(
              "VfB RSS Timeout"
            )
          );

        }
      );

    }
  );

}


/* =========================================================
   NEWS LADEN
========================================================= */

async function getNews() {

  try {

    const news =
      await fetchVfbNews();

    console.log(
      "VfB-News gefunden:",
      news.length
    );

    return news;

  } catch (error) {

    console.error(
      "NEWS ERROR:",
      error.message
    );

    return [];

  }

}


/* =========================================================
   DASHBOARD AUFBAUEN
========================================================= */

async function buildDashboard() {

  console.log(
    "Lade VfB-Spiele..."
  );

  const matches =
    await getVfbMatches();

  console.log(
    "VfB-Spiele gefunden:",
    matches.length
  );


  console.log(
    "Lade Bundesliga-Tabelle..."
  );

  const table =
    await getBundesligaTable();

  console.log(
    "Tabellenplätze:",
    table.length
  );


  console.log(
    "Lade offizielle VfB-News..."
  );

  const news =
    await getNews();


  const bundesliga =
    matches.filter(
      match =>
        match.competition ===
        "Bundesliga"
    );


  const championsLeague =
    matches.filter(
      match =>
        match.competition ===
          "UEFA Champions League" ||
        match.competition ===
          "Champions League"
    );


  const now =
    new Date();


  const nextGame =
    matches.find(
      match => {

        const date =
          new Date(
            match.rawDate
          );

        return (
          date >= now &&
          (
            match.status ===
              "SCHEDULED" ||
            match.status ===
              "TIMED"
          )
        );

      }
    ) || null;


  return {

    updatedAt:
      new Date().toISOString(),

    news,

    nextGame,

    fixtures:
      bundesliga,

    championsLeague,

    table,

    live: [],

    attribution:
      "Data provided by football-data.org"

  };

}


/* =========================================================
   DASHBOARD CACHE
========================================================= */

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

      time:
        Date.now()

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

      error:
        error.message,

      attribution:
        "Data provided by football-data.org"

    };

  }

}


/* =========================================================
   JSON ANTWORT
========================================================= */

function sendJSON(
  res,
  data
) {

  res.writeHead(
    200,
    {
      "Content-Type":
        "application/json; charset=utf-8",

      "Cache-Control":
        "no-store"
    }
  );


  res.end(
    JSON.stringify(data)
  );

}


/* =========================================================
   DATEI AUSLIEFERN
========================================================= */

function serveFile(
  res,
  filename
) {

  const filePath =
    path.join(
      __dirname,
      filename
    );


  console.log(
    "Datei angefordert:",
    filePath
  );


  if (
    !fs.existsSync(filePath)
  ) {

    console.error(
      "DATEI NICHT GEFUNDEN:",
      filePath
    );


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


  const ext =
    path.extname(
      filePath
    );


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

    ".svg":
      "image/svg+xml",

    ".ico":
      "image/x-icon"

  };


  res.writeHead(
    200,
    {
      "Content-Type":
        types[ext] ||
        "application/octet-stream"
    }
  );


  fs.createReadStream(
    filePath
  ).pipe(res);

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

        const pathname =
          new URL(
            req.url,
            `http://${req.headers.host}`
          ).pathname;


        console.log(
          "REQUEST:",
          pathname
        );


        /* =========================
           API
        ========================= */

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


        /* =========================
           HEALTH CHECK
        ========================= */

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
                !!TOKEN,

              cwd:
                process.cwd(),

              dirname:
                __dirname,

              indexExists:
                fs.existsSync(
                  path.join(
                    __dirname,
                    "index.html"
                  )
                )

            }
          );


          return;

        }


        /* =========================
           HOMEPAGE
        ========================= */

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


        /* =========================
           FALLBACK
        ========================= */

        if (
          !pathname.startsWith(
            "/api/"
          )
        ) {

          serveFile(
            res,
            "index.html"
          );


          return;

        }


        /* =========================
           404
        ========================= */

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


      } catch (error) {

        console.error(
          "SERVER ERROR:",
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
            error:
              error.message
          })
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
      `Server läuft auf Port ${PORT}`
    );

    console.log(
      "Football-Data Token vorhanden:",
      !!TOKEN
    );

    console.log(
      "Server-Verzeichnis:",
      __dirname
    );

    console.log(
      "index.html vorhanden:",
      fs.existsSync(
        path.join(
          __dirname,
          "index.html"
        )
      )
    );

    console.log(
      "VfB RSS Feed:",
      VFB_RSS_URL
    );

  }
);
