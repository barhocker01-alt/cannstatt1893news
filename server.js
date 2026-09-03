const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;
const TOKEN = process.env.FOOTBALL_DATA_TOKEN;

const VFB_TEAM_ID = 10;

/*
 * Dashboard-Cache
 * 15 Minuten, damit neue News relativ schnell erscheinen.
 */
let cache = {
  data: null,
  time: 0
};

const CACHE_TIME = 15 * 60 * 1000;


/* =========================================================
   FOOTBALL-DATA.ORG API
========================================================= */

function apiRequest(endpoint) {
  return new Promise((resolve, reject) => {

    if (!TOKEN) {
      reject(
        new Error("FOOTBALL_DATA_TOKEN fehlt")
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
        new Error("football-data.org Timeout")
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

  const date = new Date(dateString);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toLocaleString(
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

    id:
      match.id,

    date:
      formatDate(match.utcDate),

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


/* =========================================================
   BUNDESLIGA TABELLE
========================================================= */

async function getBundesligaTable() {

  const data = await apiRequest(
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
   XML TEXT BEREINIGEN
========================================================= */

function cleanXmlText(value) {

  if (!value) {
    return "";
  }

  return String(value)

    .replace(
      /<!\[CDATA\[([\s\S]*?)\]\]>/gi,
      "$1"
    )

    .replace(
      /<[^>]*>/g,
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
      /&apos;/gi,
      "'"
    )

    .replace(
      /&#39;/gi,
      "'"
    )

    .replace(
      /&lt;/gi,
      "<"
    )

    .replace(
      /&gt;/gi,
      ">"
    )

    .replace(
      /&nbsp;/gi,
      " "
    )

    .replace(
      /&#(\d+);/g,
      (match, dec) =>
        String.fromCharCode(
          Number(dec)
        )
    )

    .replace(
      /&#x([0-9a-f]+);/gi,
      (match, hex) =>
        String.fromCharCode(
          parseInt(hex, 16)
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

function getXmlTag(
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

  return cleanXmlText(
    match[1]
  );

}


/* =========================================================
   OFFIZIELLE VFB NEWS
========================================================= */

/*
 * Offizieller RSS-Feed des VfB Stuttgart.
 *
 * Quelle:
 * https://www.vfb.de/templates/generated/1/raw/de.xml
 */

function fetchVfbRSS() {

  return new Promise(
    (resolve, reject) => {

      const rssUrl =
        "https://www.vfb.de/templates/generated/1/raw/de.xml";

      console.log(
        "Lade offizielle VfB-News..."
      );

      const request =
        https.get(
          rssUrl,
          {
            headers: {
              "User-Agent":
                "Canstatt1893News/1.0",
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
                  res.statusCode !== 200
                ) {

                  reject(
                    new Error(
                      `VfB RSS HTTP ${res.statusCode}`
                    )
                  );

                  return;

                }

                if (
                  !xml ||
                  !xml.includes("<")
                ) {

                  reject(
                    new Error(
                      "VfB RSS Feed ist leer"
                    )
                  );

                  return;

                }

                resolve(xml);

              }
            );

          }
        );

      request.on(
        "error",
        reject
      );

      request.setTimeout(
        15000,
        () => {

          request.destroy(
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
   NEWS AUS RSS ERSTELLEN
========================================================= */

async function getNews() {

  try {

    const xml =
      await fetchVfbRSS();

    const items = [];

    const itemRegex =
      /<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi;

    let match;

    while (
      (match =
        itemRegex.exec(xml)) !== null
    ) {

      const item =
        match[1];

      const title =
        getXmlTag(
          item,
          "title"
        );

      const link =
        getXmlTag(
          item,
          "link"
        );

      const pubDate =
        getXmlTag(
          item,
          "pubDate"
        );

      const description =
        getXmlTag(
          item,
          "description"
        );

      const category =
        getXmlTag(
          item,
          "category"
        );


      if (
        !title ||
        !link
      ) {
        continue;
      }


      /*
       * Nur echte VfB-Artikel.
       */
      if (
        !link.includes(
          "vfb.de"
        )
      ) {
        continue;
      }


      /*
       * Keine doppelten Meldungen.
       */
      if (
        items.some(
          news =>
            news.url === link
        )
      ) {
        continue;
      }


      let date = "";

      if (pubDate) {

        const parsed =
          new Date(pubDate);

        if (
          !Number.isNaN(
            parsed.getTime()
          )
        ) {

          date =
            parsed.toLocaleString(
              "de-DE",
              {
                timeZone:
                  "Europe/Berlin",
                day:
                  "2-digit",
                month:
                  "2-digit",
                year:
                  "numeric",
                hour:
                  "2-digit",
                minute:
                  "2-digit"
              }
            );

        }

      }


      items.push({

        title:

          title,

        url:

          link,

        date:

          date,

        summary:

          description,

        category:

          category ||
          "VfB aktuell"

      });


      /*
       * Maximal 10 News.
       */
      if (
        items.length >= 10
      ) {
        break;
      }

    }


    console.log(
      "VfB-News gefunden:",
      items.length
    );


    return items;

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
    "Lade echte VfB-News..."
  );

  const news =
    await getNews();


  /* =======================================================
     BUNDESLIGA
  ======================================================= */

  const bundesliga =
    matches.filter(
      match =>
        match.competition ===
        "Bundesliga"
    );


  /* =======================================================
     CHAMPIONS LEAGUE
  ======================================================= */

  const championsLeague =
    matches.filter(
      match =>
        match.competition ===
          "UEFA Champions League" ||

        match.competition ===
          "Champions League"
    );


  /* =======================================================
     NÄCHSTES SPIEL
  ======================================================= */

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


  /* =======================================================
     DASHBOARD
  ======================================================= */

  return {

    updatedAt:
      new Date().toISOString(),

    news:

      news,

    nextGame:

      nextGame,

    fixtures:

      bundesliga,

    championsLeague:

      championsLeague,

    table:

      table,

    live:

      [],

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
    Date.now() -
      cache.time <
      CACHE_TIME
  ) {

    return cache.data;

  }


  try {

    const data =
      await buildDashboard();


    cache = {

      data:

        data,

      time:

        Date.now()

    };


    return data;

  } catch (error) {

    console.error(
      "DASHBOARD ERROR:",
      error.message
    );


    return {

      updatedAt:
        new Date().toISOString(),

      news:
        [],

      nextGame:
        null,

      fixtures:
        [],

      championsLeague:
        [],

      table:
        [],

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
    JSON.stringify(
      data
    )
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
    !fs.existsSync(
      filePath
    )
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
      "image/x-icon",

    ".webp":
      "image/webp"

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
    async (req, res) => {

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


        /* =================================================
           DASHBOARD API
        ================================================= */

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


        /* =================================================
           HEALTH CHECK
        ================================================= */

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


        /* =================================================
           HOMEPAGE
        ================================================= */

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


        /* =================================================
           FALLBACK
        ================================================= */

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


        /* =================================================
           404
        ================================================= */

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
          JSON.stringify(
            {
              error:
                error.message
            }
          )
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

  }
);
