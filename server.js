const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;
const TOKEN = process.env.FOOTBALL_DATA_TOKEN;

const VFB_TEAM_ID = 10;

/*
 * OFFIZIELLER VFB RSS FEED
 */
const VFB_RSS_URL =
  "https://www.vfb.de/templates/generated/1/raw/de.xml";

/*
 * CACHE
 */
const CACHE_TIME = 6 * 60 * 60 * 1000;

let cache = {
  data: null,
  time: 0
};


/* =========================================================
   HTTP REQUEST
========================================================= */

function httpsRequest(url, headers = {}) {
  return new Promise((resolve, reject) => {

    const req = https.get(
      url,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (compatible; Canstatt1893News/1.0)",
          "Accept":
            "application/rss+xml, application/xml, text/xml, */*",
          ...headers
        }
      },
      res => {

        let body = "";

        res.setEncoding("utf8");

        res.on("data", chunk => {
          body += chunk;
        });

        res.on("end", () => {

          if (
            res.statusCode >= 200 &&
            res.statusCode < 300
          ) {
            resolve(body);
            return;
          }

          reject(
            new Error(
              `HTTP ${res.statusCode} bei ${url}`
            )
          );

        });

      }
    );

    req.setTimeout(20000, () => {
      req.destroy(
        new Error("HTTP Request Timeout")
      );
    });

    req.on("error", error => {
      reject(error);
    });

  });
}


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

    const url =
      "https://api.football-data.org/v4" +
      endpoint;

    const req = https.get(
      url,
      {
        headers: {
          "X-Auth-Token": TOKEN,
          "User-Agent":
            "Canstatt1893News/1.0"
        }
      },
      res => {

        let body = "";

        res.setEncoding("utf8");

        res.on("data", chunk => {
          body += chunk;
        });

        res.on("end", () => {

          let json;

          try {
            json = JSON.parse(body);
          } catch (error) {
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

    req.setTimeout(20000, () => {
      req.destroy(
        new Error(
          "Football-Data API Timeout"
        )
      );
    });

    req.on("error", error => {
      reject(error);
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
      match.score?.fullTime?.home ??
      null,

    awayGoals:
      match.score?.fullTime?.away ??
      null,

    venue:
      match.venue || "",

    matchday:
      match.matchday || null

  };

}


/* =========================================================
   VFB SPIELE
========================================================= */

async function getVfbMatches() {

  console.log(
    "Lade VfB-Spiele..."
  );

  const data =
    await apiRequest(
      `/teams/${VFB_TEAM_ID}/matches?competitions=BL1,CL&dateFrom=2026-07-01&dateTo=2027-06-30&limit=100`
    );

  const matches =
    (data.matches || [])
      .map(mapMatch)
      .sort(
        (a, b) =>
          new Date(a.rawDate) -
          new Date(b.rawDate)
      );

  console.log(
    "VfB-Spiele gefunden:",
    matches.length
  );

  return matches;

}


/* =========================================================
   BUNDESLIGA TABELLE
========================================================= */

async function getBundesligaTable() {

  console.log(
    "Lade Bundesliga-Tabelle..."
  );

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

  const table =
    (total.table || [])
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

  console.log(
    "Tabellenplätze:",
    table.length
  );

  return table;

}


/* =========================================================
   HTML ENTITIES DEKODIEREN
========================================================= */

function decodeHTML(text = "") {

  return text
    .replace(
      /<!\[CDATA\[([\s\S]*?)\]\]>/gi,
      "$1"
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
      /&#39;/gi,
      "'"
    )
    .replace(
      /&apos;/gi,
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
      /&#x27;/gi,
      "'"
    )
    .replace(
      /&#x2F;/gi,
      "/"
    )
    .trim();

}


/* =========================================================
   XML TAG AUSLESEN
========================================================= */

function getXmlValue(block, tag) {

  const regex =
    new RegExp(
      `<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`,
      "i"
    );

  const match =
    block.match(regex);

  if (!match) {
    return "";
  }

  return decodeHTML(
    match[1]
  );

}


/* =========================================================
   TEXT BEREINIGEN
========================================================= */

function cleanText(text = "") {

  return decodeHTML(text)
    .replace(
      /<script[\s\S]*?<\/script>/gi,
      " "
    )
    .replace(
      /<style[\s\S]*?<\/style>/gi,
      " "
    )
    .replace(
      /<[^>]+>/g,
      " "
    )
    .replace(
      /\s+/g,
      " "
    )
    .trim();

}


/* =========================================================
   URL NORMALISIEREN
========================================================= */

function normalizeVfbUrl(url = "") {

  url = decodeHTML(url.trim());

  if (!url) {
    return "";
  }

  if (
    url.startsWith("//")
  ) {
    return "https:" + url;
  }

  if (
    url.startsWith("/")
  ) {
    return "https://www.vfb.de" + url;
  }

  return url;

}


/* =========================================================
   RSS NEWS
========================================================= */

async function fetchVfbNews() {

  console.log(
    "Lade offiziellen VfB RSS Feed..."
  );

  try {

    const xml =
      await httpsRequest(
        VFB_RSS_URL
      );

    console.log(
      "VfB RSS Feed geladen."
    );

    console.log(
      "RSS Zeichen:",
      xml.length
    );

    const items = [];

    /*
     * Normale RSS <item>-Blöcke
     */
    const rssItems =
      xml.match(
        /<item\b[\s\S]*?<\/item>/gi
      ) || [];

    console.log(
      "RSS Items gefunden:",
      rssItems.length
    );

    for (
      const item of rssItems
    ) {

      const title =
        cleanText(
          getXmlValue(
            item,
            "title"
          )
        );

      let link =
        getXmlValue(
          item,
          "link"
        );

      let description =
        cleanText(
          getXmlValue(
            item,
            "description"
          )
        );

      let pubDate =
        getXmlValue(
          item,
          "pubDate"
        );

      /*
       * Manche Feeds benutzen dc:date
       */
      if (!pubDate) {

        pubDate =
          getXmlValue(
            item,
            "dc:date"
          );

      }

      /*
       * Manche Feeds benutzen date
       */
      if (!pubDate) {

        pubDate =
          getXmlValue(
            item,
            "date"
          );

      }

      /*
       * Link sauber machen
       */
      link =
        normalizeVfbUrl(
          link
        );

      /*
       * Falls kein normaler <link>
       * vorhanden ist, versuchen wir
       * guid
       */
      if (!link) {

        link =
          normalizeVfbUrl(
            getXmlValue(
              item,
              "guid"
            )
          );

      }

      /*
       * Nur echte VfB-News
       */
      if (
        !title ||
        title.length < 5 ||
        !link
      ) {
        continue;
      }

      /*
       * Navigations-/Service-Seiten
       * nicht als News anzeigen
       */
      const blocked = [
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

      const isBlocked =
        blocked.some(
          blockedTitle =>
            title.toLowerCase() ===
            blockedTitle.toLowerCase()
        );

      if (isBlocked) {
        continue;
      }

      /*
       * Duplikate verhindern
       */
      if (
        items.some(
          existing =>
            existing.url === link
        )
      ) {
        continue;
      }

      items.push({

        title:
          title,

        url:
          link,

        link:
          link,

        description:
          description,

        pubDate:
          pubDate,

        date:
          pubDate
            ? formatDate(pubDate)
            : ""

      });

    }

    /*
     * Nach Datum sortieren,
     * neueste zuerst.
     */
    items.sort(
      (a, b) => {

        const dateA =
          a.pubDate
            ? new Date(a.pubDate).getTime()
            : 0;

        const dateB =
          b.pubDate
            ? new Date(b.pubDate).getTime()
            : 0;

        return dateB - dateA;

      }
    );

    const result =
      items.slice(0, 10);

    console.log(
      "VfB-News gefunden:",
      result.length
    );

    if (result.length > 0) {

      console.log(
        "Erste VfB-News:",
        result[0].title
      );

    }

    return result;

  } catch (error) {

    console.error(
      "VfB RSS FEED FEHLER:",
      error.message
    );

    return [];

  }

}


/* =========================================================
   NEWS
========================================================= */

async function getNews() {

  try {

    return await fetchVfbNews();

  } catch (error) {

    console.error(
      "NEWS ERROR:",
      error.message
    );

    return [];

  }

}


/* =========================================================
   DASHBOARD
========================================================= */

async function buildDashboard() {

  console.log(
    "======================================"
  );

  console.log(
    "Baue Canstatt 1893 News Dashboard..."
  );

  console.log(
    "======================================"
  );

  const [
    matches,
    table,
    news
  ] =
    await Promise.all([
      getVfbMatches(),
      getBundesligaTable(),
      getNews()
    ]);

  /*
   * Bundesliga
   */
  const bundesliga =
    matches.filter(
      match =>
        match.competition ===
        "Bundesliga"
    );

  /*
   * Champions League
   */
  const championsLeague =
    matches.filter(
      match =>
        match.competition ===
          "UEFA Champions League" ||
        match.competition ===
          "Champions League"
    );

  /*
   * Nächstes Spiel
   */
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

  const dashboard = {

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

  console.log(
    "Dashboard fertig."
  );

  console.log(
    "News:",
    news.length
  );

  console.log(
    "Bundesliga-Spiele:",
    bundesliga.length
  );

  console.log(
    "Champions-League-Spiele:",
    championsLeague.length
  );

  return dashboard;

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

    console.log(
      "Dashboard aus Cache geladen."
    );

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
      "API ERROR:",
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
   JSON SENDEN
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


        /* =========================================
           DASHBOARD API
        ========================================= */

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


        /* =========================================
           HEALTH CHECK
        ========================================= */

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

              rssConfigured:
                !!VFB_RSS_URL,

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


        /* =========================================
           HOMEPAGE
        ========================================= */

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


        /* =========================================
           CSS / JS / BILDER ETC.
        ========================================= */

        if (
          !pathname.startsWith(
            "/api/"
          )
        ) {

          const safePath =
            pathname
              .replace(
                /^\/+/,
                ""
              );

          if (
            safePath &&
            !safePath.includes(
              ".."
            )
          ) {

            const fullPath =
              path.join(
                __dirname,
                safePath
              );

            if (
              fs.existsSync(
                fullPath
              )
            ) {

              const stats =
                fs.statSync(
                  fullPath
                );

              if (
                stats.isFile()
              ) {

                serveFile(
                  res,
                  safePath
                );

                return;

              }

            }

          }

          /*
           * Fallback auf index.html
           */
          serveFile(
            res,
            "index.html"
          );

          return;

        }


        /* =========================================
           404
        ========================================= */

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
      "======================================"
    );

    console.log(
      `Canstatt 1893 News läuft auf Port ${PORT}`
    );

    console.log(
      "Football-Data Token vorhanden:",
      !!TOKEN
    );

    console.log(
      "VfB RSS Feed:",
      VFB_RSS_URL
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
      "======================================"
    );

  }
);
