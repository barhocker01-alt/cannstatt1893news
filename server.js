const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;

const VFB_NEWS_URL =
  "https://www.vfb.de/de/1893/aktuell/neues/";

function request(url) {

  return new Promise((resolve, reject) => {

    https.get(
      url,
      {
        headers: {
          "User-Agent":
            "Canstatt1893News/1.0"
        }
      },
      response => {

        let data = "";

        response.setEncoding("utf8");

        response.on("data", chunk => {
          data += chunk;
        });

        response.on("end", () => {

          if (
            response.statusCode >= 200 &&
            response.statusCode < 400
          ) {
            resolve(data);
          } else {
            reject(
              new Error(
                "HTTP " +
                response.statusCode
              )
            );
          }

        });

      }
    ).on("error", reject);

  });

}


/*
 Entfernt HTML-Tags und bereinigt Text
*/

function cleanText(text) {

  return String(text || "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/\s+/g, " ")
    .trim();

}


/*
 Versucht News aus der offiziellen
 VfB-Newsseite zu erkennen.
*/

function extractNews(html) {

  const results = [];
  const seen = new Set();

  const regex =
    /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;

  let match;

  while (
    (match = regex.exec(html)) &&
    results.length < 10
  ) {

    let url = match[1];

    let title =
      cleanText(match[2]);

    if (
      title.length < 25 ||
      title.length > 180
    ) {
      continue;
    }

    if (
      /cookie|datenschutz|impressum|login|menu|mehr laden/i
        .test(title)
    ) {
      continue;
    }

    if (
      url.startsWith("/")
    ) {
      url =
        "https://www.vfb.de" +
        url;
    }

    if (
      !url.includes("vfb.de")
    ) {
      continue;
    }

    if (
      seen.has(title)
    ) {
      continue;
    }

    seen.add(title);

    results.push({

      title,

      category:
        "VfB aktuell",

      date:
        new Date()
          .toLocaleDateString("de-DE"),

      summary:
        "Aktuelle Meldung des VfB Stuttgart.",

      url

    });

  }

  return results;

}


/*
 Fallback-Daten.
 Falls die Newsquelle kurzzeitig nicht
 erreichbar ist, bleibt die Homepage
 trotzdem funktionsfähig.
*/

function fallbackData() {

  return {

    updatedAt:
      new Date().toISOString(),

    news: [

      {
        title:
          "VfB Stuttgart – aktuelle News",

        category:
          "VfB aktuell",

        date:
          "Aktuell",

        summary:
          "Neue Meldungen findest du auf der offiziellen VfB-Webseite.",

        url:
          "https://www.vfb.de/"
      },

      {
        title:
          "Champions League 2026/27",

        category:
          "Champions League",

        date:
          "Saison 2026/27",

        summary:
          "Der VfB Stuttgart spielt in der Königsklasse.",

        url:
          "https://www.vfb.de/"
      }

    ],


    nextGame: {

      home:
        "VfB Stuttgart",

      away:
        "1. FC Köln",

      date:
        "04.09.2026 · 20:30 Uhr · MHPArena"

    },


    fixtures: [

      {
        date:
          "04.09.2026 · 20:30",

        home:
          "VfB Stuttgart",

        away:
          "1. FC Köln",

        competition:
          "Bundesliga",

        status:
          "HEIM"
      },

      {
        date:
          "09.09.2026 · 18:45",

        home:
          "VfB Stuttgart",

        away:
          "Viking Stavanger",

        competition:
          "Champions League",

        status:
          "HEIM"
      },

      {
        date:
          "12.09.2026 · 15:30",

        home:
          "TSG Hoffenheim",

        away:
          "VfB Stuttgart",

        competition:
          "Bundesliga",

        status:
          "AUSW."
      },

      {
        date:
          "19.09.2026 · 18:30",

        home:
          "VfB Stuttgart",

        away:
          "Borussia Dortmund",

        competition:
          "Bundesliga",

        status:
          "HEIM"
      }

    ],


    table: [

      {
        position:
          1,

        team:
          "FC Bayern München",

        points:
          3
      },

      {
        position:
          18,

        team:
          "VfB Stuttgart",

        points:
          0
      }

    ]

  };

}


/*
 Dashboard erzeugen
*/

async function createDashboard() {

  const data =
    fallbackData();

  try {

    const html =
      await request(
        VFB_NEWS_URL
      );

    const news =
      extractNews(html);

    if (
      news.length >= 1
    ) {

      data.news =
        news;

    }

  } catch (error) {

    console.log(
      "Newsquelle momentan nicht erreichbar."
    );

  }

  data.updatedAt =
    new Date().toISOString();

  return data;

}


/*
 HTTP Server
*/

const server =
  http.createServer(
    async (req, res) => {

      /*
       API
      */

      if (
        req.url ===
        "/api/dashboard"
      ) {

        try {

          const data =
            await createDashboard();

          res.writeHead(
            200,
            {
              "Content-Type":
                "application/json; charset=utf-8",

              "Cache-Control":
                "public, max-age=300"
            }
          );

          res.end(
            JSON.stringify(data)
          );

        } catch (error) {

          res.writeHead(
            500,
            {
              "Content-Type":
                "application/json"
            }
          );

          res.end(
            JSON.stringify({
              error:
                "Daten konnten nicht geladen werden."
            })
          );

        }

        return;

      }


      /*
       Homepage
      */

      let file =
        req.url === "/"
          ? "index.html"
          : req.url.substring(1);


      /*
       Sicherheitsprüfung
      */

      file =
        path.normalize(file);

      if (
        file.includes("..")
      ) {

        res.writeHead(403);

        res.end(
          "Forbidden"
        );

        return;

      }


      const filePath =
        path.join(
          __dirname,
          file
        );


      fs.readFile(
        filePath,
        (error, content) => {

          if (error) {

            res.writeHead(404);

            res.end(
              "404 – Seite nicht gefunden"
            );

            return;

          }


          let contentType =
            "text/plain";

          if (
            file.endsWith(".html")
          ) {

            contentType =
              "text/html; charset=utf-8";

          }

          if (
            file.endsWith(".css")
          ) {

            contentType =
              "text/css";

          }

          if (
            file.endsWith(".js")
          ) {

            contentType =
              "application/javascript";

          }


          res.writeHead(
            200,
            {
              "Content-Type":
                contentType
            }
          );

          res.end(
            content
          );

        }
      );

    }
  );


server.listen(
  PORT,
  () => {

    console.log(
      "Canstatt 1893 News läuft auf Port " +
      PORT
    );

  }
);
