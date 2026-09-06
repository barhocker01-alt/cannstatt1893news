const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;
const TOKEN = process.env.FOOTBALL_DATA_TOKEN;

const VFB_TEAM_ID = 10;

/*
 * =========================================================
 * RSS FEEDS
 * =========================================================
 */

const VFB_RSS_URL =
  "https://www.vfb.de/templates/generated/1/raw/de.xml";

const KICKER_RSS_URL =
  "https://newsfeed.kicker.de/news/bundesliga";

/*
 * =========================================================
 * CACHE
 * =========================================================
 *
 * Dashboard: 10 Minuten
 * Matchdetails: 2 Minuten
 */

const CACHE_TIME = 10 * 60 * 1000;
const MATCH_DETAIL_CACHE_TIME = 2 * 60 * 1000;

let cache = {
  data: null,
  time: 0
};

const matchDetailCache = new Map();


/*
 * =========================================================
 * HTTP REQUEST
 * =========================================================
 */

function httpsRequest(url, headers = {}) {
  return new Promise((resolve, reject) => {

    const req = https.get(
      url,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (compatible; Cannstatt1893News/1.0)",
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

        res.on("end", async () => {

          /*
           * Erfolgreiche Antwort
           */
          if (
            res.statusCode >= 200 &&
            res.statusCode < 300
          ) {
            resolve(body);
            return;
          }

          /*
           * Redirects verfolgen
           */
          if (
            [301, 302, 303, 307, 308].includes(
              res.statusCode
            ) &&
            res.headers.location
          ) {

            try {

              const nextUrl =
                new URL(
                  res.headers.location,
                  url
                ).toString();

              resolve(
                await httpsRequest(
                  nextUrl,
                  headers
                )
              );

              return;

            } catch (redirectError) {

              reject(redirectError);
              return;

            }

          }

          reject(
            new Error(
              `HTTP ${res.statusCode} bei ${url}`
            )
          );

        });

      }
    );

    req.setTimeout(
      20000,
      () => {

        req.destroy(
          new Error(
            "HTTP Request Timeout"
          )
        );

      }
    );

    req.on(
      "error",
      error => {
        reject(error);
      }
    );

  });
}


/*
 * =========================================================
 * FOOTBALL-DATA.ORG API
 * =========================================================
 */

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

    const req =
      https.get(
        url,
        {
          headers: {
            "X-Auth-Token":
              TOKEN,

            "User-Agent":
              "Cannstatt1893News/1.0"
          }
        },
        res => {

          let body = "";

          res.setEncoding("utf8");

          res.on(
            "data",
            chunk => {
              body += chunk;
            }
          );

          res.on(
            "end",
            () => {

              let json;

              try {

                json =
                  JSON.parse(body);

              } catch (error) {

                reject(
                  new Error(
                    "football-data.org lieferte kein gültiges JSON"
                  )
                );

                return;

              }

              if (
                res.statusCode !== 200
              ) {

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

            }
          );

        }
      );

    req.setTimeout(
      20000,
      () => {

        req.destroy(
          new Error(
            "Football-Data API Timeout"
          )
        );

      }
    );

    req.on(
      "error",
      error => {
        reject(error);
      }
    );

  });

}


/*
 * =========================================================
 * DATUM FORMATIEREN
 * =========================================================
 */

function formatDate(dateString) {

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

  return date.toLocaleString(
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


/*
 * =========================================================
 * SPIEL UMWANDELN
 * =========================================================
 */

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
      match.homeTeam?.name ||
      "",

    away:
      match.awayTeam?.name ||
      "",

    homeLogo:
      match.homeTeam?.crest ||
      "",

    awayLogo:
      match.awayTeam?.crest ||
      "",

    competition:
      match.competition?.name ||
      "",

    league:
      match.competition?.name ||
      "",

    status:
      match.status ||
      "",

    statusLong:
      match.status ||
      "",

    homeGoals:
      match.score?.fullTime?.home ??
      null,

    awayGoals:
      match.score?.fullTime?.away ??
      null,

    venue:
      match.venue ||
      "",

    matchday:
      match.matchday ||
      null

  };

}


/*
 * =========================================================
 * VFB SPIELE
 * =========================================================
 */

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


/*
 * =========================================================
 * BUNDESLIGA TABELLE
 * =========================================================
 */

async function getBundesligaTable() {

  console.log(
    "Lade Bundesliga-Tabelle..."
  );

  const data =
    await apiRequest(
      "/competitions/BL1/standings"
    );

  const standings =
    data.standings ||
    [];

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
      .map(
        item => ({

          position:
            item.position,

          team:
            item.team?.name ||
            "",

          logo:
            item.team?.crest ||
            "",

          played:
            item.playedGames ??
            0,

          wins:
            item.won ??
            0,

          draws:
            item.draw ??
            0,

          losses:
            item.lost ??
            0,

          goalsFor:
            item.goalsFor ??
            0,

          goalsAgainst:
            item.goalsAgainst ??
            0,

          goalDiff:
            item.goalDifference ??
            0,

          points:
            item.points ??
            0,

          form:
            item.form ||
            ""

        })
      );

  console.log(
    "Tabellenplätze:",
    table.length
  );

  return table;

}


/*
 * =========================================================
 * HTML ENTITIES DEKODIEREN
 * =========================================================
 */

function decodeHTML(
  text = ""
) {

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


/*
 * =========================================================
 * XML TAG AUSLESEN
 * =========================================================
 */

function getXmlValue(
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

  if (!match) {
    return "";
  }

  return decodeHTML(
    match[1]
  );

}


/*
 * =========================================================
 * TEXT BEREINIGEN
 * =========================================================
 */

function cleanText(
  text = ""
) {

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


/*
 * =========================================================
 * URL NORMALISIEREN
 * =========================================================
 */

function normalizeVfbUrl(
  url = ""
) {

  url =
    decodeHTML(
      url.trim()
    );

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
    return (
      "https://www.vfb.de" +
      url
    );
  }

  return url;

}


/*
 * =========================================================
 * RSS ITEMS PARSEN
 * =========================================================
 */

function parseRssItems(
  xml = ""
) {

  const items = [];

  const rssItems =
    xml.match(
      /<item\b[\s\S]*?<\/item>/gi
    ) || [];

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

    let guid =
      getXmlValue(
        item,
        "guid"
      );

    const description =
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

    if (!pubDate) {

      pubDate =
        getXmlValue(
          item,
          "dc:date"
        );

    }

    if (!pubDate) {

      pubDate =
        getXmlValue(
          item,
          "date"
        );

    }

    /*
     * RSS Links können als CDATA
     * oder normal vorliegen.
     */
    link =
      decodeHTML(
        link
      ).trim();

    guid =
      decodeHTML(
        guid
      ).trim();

    /*
     * Bild suchen
     */
    let image = "";

    const mediaContent =
      item.match(
        /<media:content[^>]+url=["']([^"']+)["'][^>]*>/i
      );

    const mediaThumbnail =
      item.match(
        /<media:thumbnail[^>]+url=["']([^"']+)["'][^>]*>/i
      );

    const enclosure =
      item.match(
        /<enclosure[^>]+url=["']([^"']+)["'][^>]*>/i
      );

    if (
      mediaContent
    ) {

      image =
        mediaContent[1];

    } else if (
      mediaThumbnail
    ) {

      image =
        mediaThumbnail[1];

    } else if (
      enclosure
    ) {

      image =
        enclosure[1];

    }

    if (image) {

      image =
        decodeHTML(
          image
        ).trim();

    }

    if (
      !title &&
      !link
    ) {
      continue;
    }

    items.push({
      title,
      link,
      guid,
      description,
      pubDate,
      image
    });

  }

  return items;

}


/*
 * =========================================================
 * VFB NEWS
 * =========================================================
 */

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

    const parsed =
      parseRssItems(
        xml
      );

    console.log(
      "VfB RSS Items gefunden:",
      parsed.length
    );

    const blockedTitles = [
      "tickets",
      "ticket",
      "shop",
      "fanshop",
      "newsletter",
      "mitglied werden",
      "mitgliedschaft",
      "datenschutz",
      "impressum",
      "kontakt"
    ];

    const news =
      parsed
        .filter(
          item => {

            const title =
              item.title
                .toLowerCase();

            return !blockedTitles.some(
              blocked =>
                title.includes(
                  blocked
                )
            );

          }
        )
        .map(
          item => ({

            title:
              item.title,

            link:
              normalizeVfbUrl(
                item.link ||
                item.guid
              ),

            description:
              item.description,

            date:
              item.pubDate,

            rawDate:
              item.pubDate,

            image:
              item.image,

            source:
              "VfB Stuttgart"

          })
        )
        .filter(
          item =>
            item.title &&
            item.link
        )
        .sort(
          (a, b) =>
            new Date(
              b.rawDate
            ) -
            new Date(
              a.rawDate
            )
        )
        .slice(
          0,
          10
        );

    return news;

  } catch (error) {

    console.error(
      "VfB RSS Fehler:",
      error.message
    );

    return [];

  }

}


/*
 * =========================================================
 * KICKER NEWS
 * =========================================================
 */

async function fetchKickerNews() {

  console.log(
    "Lade Kicker RSS Feed..."
  );

  try {

    const xml =
      await httpsRequest(
        KICKER_RSS_URL
      );

    console.log(
      "Kicker RSS Feed geladen."
    );

    console.log(
      "Kicker RSS Zeichen:",
      xml.length
    );

    const parsed =
      parseRssItems(
        xml
      );

    console.log(
      "Kicker RSS Items gefunden:",
      parsed.length
    );

    const keywords = [
      "vfb stuttgart",
      "vfb",
      "stuttgart",
      "hoeneß",
      "hoeness",
      "demirovic",
      "undav",
      "stiller",
      "führich",
      "fuehrich",
      "el khannouss",
      "karazor",
      "mittelstädt",
      "mittelstaedt",
      "jeltsch",
      "vagnoman"
    ];

    const news =
      parsed
        .filter(
          item => {

            const haystack =
              (
                item.title +
                " " +
                item.description
              )
                .toLowerCase();

            return keywords.some(
              keyword =>
                haystack.includes(
                  keyword
                )
            );

          }
        )
        .map(
          item => ({

            title:
              item.title,

            link:
              item.link ||
              item.guid ||
              "",

            description:
              item.description,

            date:
              item.pubDate,

            rawDate:
              item.pubDate,

            image:
              item.image,

            source:
              "Kicker"

          })
        )
        .filter(
          item =>
            item.title &&
            item.link
        )
        .sort(
          (a, b) =>
            new Date(
              b.rawDate
            ) -
            new Date(
              a.rawDate
            )
        )
        .slice(
          0,
          10
        );

    return news;

  } catch (error) {

    console.error(
      "Kicker RSS Fehler:",
      error.message
    );

    return [];

  }

}


/*
 * =========================================================
 * NEWS ZUSAMMENFÜHREN
 * =========================================================
 */

async function getNews() {

  const [
    vfbNews,
    kickerNews
  ] =
    await Promise.all([
      fetchVfbNews(),
      fetchKickerNews()
    ]);

  const combined =
    [
      ...vfbNews,
      ...kickerNews
    ];

  const seen =
    new Set();

  const result =
    combined
      .filter(
        item => {

          const key =
            (
              item.link ||
              item.title
            )
              .toLowerCase()
              .trim();

          if (
            !key ||
            seen.has(key)
          ) {
            return false;
          }

          seen.add(key);

          return true;

        }
      )
      .sort(
        (a, b) =>
          new Date(
            b.rawDate
          ) -
          new Date(
            a.rawDate
          )
      )
      .slice(
        0,
        16
      );

  return result;

}


/*
 * =========================================================
 * VFB KADER
 * =========================================================
 *
 * Fallback-Daten.
 *
 * Die API kann bei einzelnen Spielern
 * unvollständige Daten liefern.
 */

const VFB_SQUAD = [

  /*
   * Tor
   */
  {
    id: 1,
    name: "Fabian Bredlow",
    position: "Torwart",
    shirtNumber: 33,
    photo:
      "https://img.a.transfermarkt.technology/portrait/big/251571-1669118264.jpg"
  },

  {
    id: 2,
    name: "Dennis Seimen",
    position: "Torwart",
    shirtNumber: 41,
    photo:
      "https://img.a.transfermarkt.technology/portrait/big/680237-1709398305.jpg"
  },

  /*
   * Abwehr
   */
  {
    id: 10,
    name: "Dan-Axel Zagadou",
    position: "Abwehr",
    shirtNumber: 23,
    photo:
      "https://img.a.transfermarkt.technology/portrait/big/282323-1699970308.jpg"
  },

  {
    id: 11,
    name: "Jeff Chabot",
    position: "Abwehr",
    shirtNumber: 24,
    photo:
      "https://img.a.transfermarkt.technology/portrait/big/260727-1708951952.jpg"
  },

  {
    id: 12,
    name: "Anrie Chase",
    position: "Abwehr",
    shirtNumber: 45,
    photo:
      "https://img.a.transfermarkt.technology/portrait/big/683840-1727791686.jpg"
  },

  {
    id: 13,
    name: "Finn Jeltsch",
    position: "Abwehr",
    shirtNumber: 29,
    photo:
      "https://img.a.transfermarkt.technology/portrait/big/689879-1710776386.jpg"
  },

  {
    id: 14,
    name: "Leonidas Stergiou",
    position: "Abwehr",
    shirtNumber: 20,
    photo:
      "https://img.a.transfermarkt.technology/portrait/big/473503-1690999990.jpg"
  },

  {
    id: 15,
    name: "Maximilian Mittelstädt",
    position: "Abwehr",
    shirtNumber: 7,
    photo:
      "https://img.a.transfermarkt.technology/portrait/big/332216-1710160830.jpg"
  },

  {
    id: 16,
    name: "Josha Vagnoman",
    position: "Abwehr",
    shirtNumber: 4,
    photo:
      "https://img.a.transfermarkt.technology/portrait/big/399564-1668783007.jpg"
  },

  /*
   * Mittelfeld
   */
  {
    id: 20,
    name: "Angelo Stiller",
    position: "Mittelfeld",
    shirtNumber: 6,
    photo:
      "https://img.a.transfermarkt.technology/portrait/big/340078-1662541725.jpg"
  },

  {
    id: 21,
    name: "Atakan Karazor",
    position: "Mittelfeld",
    shirtNumber: 16,
    photo:
      "https://img.a.transfermarkt.technology/portrait/big/343245-1671196511.jpg"
  },

  {
    id: 22,
    name: "Enzo Millot",
    position: "Mittelfeld",
    shirtNumber: 8,
    photo:
      "https://img.a.transfermarkt.technology/portrait/big/593775-1708947031.jpg"
  },

  {
    id: 23,
    name: "El Bilal Touré",
    position: "Mittelfeld",
    shirtNumber: 10,
    photo:
      "https://img.a.transfermarkt.technology/portrait/big/523350-1699991737.jpg"
  },

  {
    id: 24,
    name: "Yannick Keitel",
    position: "Mittelfeld",
    shirtNumber: 5,
    photo:
      "https://img.a.transfermarkt.technology/portrait/big/477129-1705480115.jpg"
  },

  {
    id: 25,
    name: "Jamie Leweling",
    position: "Mittelfeld",
    shirtNumber: 18,
    photo:
      "https://img.a.transfermarkt.technology/portrait/big/473855-1688982144.jpg"
  },

  {
    id: 26,
    name: "Abdulrahman Al-Muhtaseb",
    position: "Mittelfeld",
    shirtNumber: 31,
    photo:
      ""
  },

  {
    id: 27,
    name: "Bilal El Khannouss",
    position: "Mittelfeld",
    shirtNumber: 11,
    photo:
      "https://img.a.transfermarkt.technology/portrait/big/639641-1709396861.jpg"
  },

  /*
   * Angriff
   */
  {
    id: 30,
    name: "Deniz Undav",
    position: "Angriff",
    shirtNumber: 26,
    photo:
      "https://img.a.transfermarkt.technology/portrait/big/339889-1704202461.jpg"
  },

  {
    id: 31,
    name: "Ermedin Demirović",
    position: "Angriff",
    shirtNumber: 9,
    photo:
      "https://img.a.transfermarkt.technology/portrait/big/324817-1709458478.jpg"
  },

  {
    id: 32,
    name: "Nick Woltemade",
    position: "Angriff",
    shirtNumber: 27,
    photo:
      "https://img.a.transfermarkt.technology/portrait/big/466489-1708951685.jpg"
  },

  {
    id: 33,
    name: "Justin Diehl",
    position: "Angriff",
    shirtNumber: 14,
    photo:
      "https://img.a.transfermarkt.technology/portrait/big/569049-1709396864.jpg"
  },

  {
    id: 34,
    name: "Marius Bülter",
    position: "Angriff",
    shirtNumber: 19,
    photo:
      "https://img.a.transfermarkt.technology/portrait/big/230872-1688982118.jpg"
  },

  {
    id: 35,
    name: "Tiago Tomás",
    position: "Angriff",
    shirtNumber: 29,
    photo:
      "https://img.a.transfermarkt.technology/portrait/big/504346-1688982147.jpg"
  }

];


/*
 * =========================================================
 * KADER-STATISTIK
 * =========================================================
 *
 * Die Statistik wird aus den verfügbaren
 * Football-Data-Spieldetails abgeleitet.
 */

async function getVfbSquadStats(
  matches
) {

  const players =
    new Map();

  for (
    const player of VFB_SQUAD
  ) {

    players.set(
      player.name.toLowerCase(),
      {
        ...player,
        appearances: 0,
        goals: 0,
        assists: 0
      }
    );

  }

  /*
   * Nur die letzten abgeschlossenen
   * Spiele betrachten.
   */
  const finished =
    matches
      .filter(
        match =>
          [
            "FINISHED",
            "AWARDED"
          ].includes(
            match.status
          )
      )
      .sort(
        (a, b) =>
          new Date(
            b.rawDate
          ) -
          new Date(
            a.rawDate
          )
      )
      .slice(
        0,
        10
      );

  /*
   * Spieldetails nacheinander laden,
   * damit die API nicht unnötig belastet wird.
   */
  for (
    const match of finished
  ) {

    try {

      const details =
        await getMatchDetails(
          match.id
        );

      const lineups =
        details.lineups ||
        {};

      const lineupPlayers = [
        ...(lineups.home?.lineup || []),
        ...(lineups.home?.bench || []),
        ...(lineups.away?.lineup || []),
        ...(lineups.away?.bench || [])
      ];

      const appeared =
        new Set(
          (
            lineupPlayers || []
          )
            .map(
              player =>
                (
                  player.name ||
                  ""
                )
                  .toLowerCase()
            )
            .filter(Boolean)
        );

      for (
        const player of players.values()
      ) {

        const key =
          player.name.toLowerCase();

        if (
          appeared.has(key)
        ) {

          player.appearances += 1;

        }

      }

      /*
       * Tore und Assists
       */
      for (
        const goal of
        details.goals || []
      ) {

        const scorer =
          (
            goal.scorer ||
            ""
          )
            .toLowerCase();

        const assist =
          (
            goal.assist ||
            ""
          )
            .toLowerCase();

        for (
          const player of
          players.values()
        ) {

          const key =
            player.name.toLowerCase();

          if (
            scorer === key
          ) {

            player.goals += 1;

          }

          if (
            assist === key
          ) {

            player.assists += 1;

          }

        }

      }

    } catch (error) {

      console.error(
        `Kaderstatistik für Spiel ${match.id} konnte nicht geladen werden:`,
        error.message
      );

    }

  }

  return [
    ...players.values()
  ];

}


/*
 * =========================================================
 * KADER AUFTEILEN
 * =========================================================
 */

function groupSquad(
  players
) {

  const goalkeepers = [];
  const defenders = [];
  const midfielders = [];
  const attackers = [];

  for (
    const player of players
  ) {

    const position =
      (
        player.position ||
        ""
      ).toLowerCase();

    if (
      position.includes("tor")
    ) {

      goalkeepers.push(
        player
      );

    } else if (
      position.includes("abwehr")
    ) {

      defenders.push(
        player
      );

    } else if (
      position.includes("mittel")
    ) {

      midfielders.push(
        player
      );

    } else {

      attackers.push(
        player
      );

    }

  }

  return {
    goalkeepers,
    defenders,
    midfielders,
    attackers
  };

}


/*
 * =========================================================
 * MATCH EVENT MINUTE
 * =========================================================
 */

function normalizeMatchEventMinute(
  event
) {

  if (!event) {
    return "";
  }

  const minute =
    event.minute ??
    null;

  const injuryTime =
    event.injuryTime ??
    null;

  if (
    minute === null ||
    minute === undefined
  ) {
    return "";
  }

  if (
    injuryTime !== null &&
    injuryTime !== undefined &&
    Number(injuryTime) > 0
  ) {

    return `${minute}+${injuryTime}'`;

  }

  return `${minute}'`;

}


/*
 * =========================================================
 * MATCH DETAILS
 * =========================================================
 */

function mapMatchDetails(
  match
) {

  const home =
    match?.homeTeam ||
    {};

  const away =
    match?.awayTeam ||
    {};

  const goals =
    (
      match?.goals ||
      []
    )
      .map(
        goal => ({

          minute:
            goal.minute ??
            null,

          injuryTime:
            goal.injuryTime ??
            null,

          minuteLabel:
            normalizeMatchEventMinute(
              goal
            ),

          type:
            goal.type ||
            "",

          teamId:
            goal.team?.id ??
            null,

          team:
            goal.team?.name ||
            "",

          playerId:
            goal.scorer?.id ??
            null,

          player:
            goal.scorer?.name ||
            "",

          assistId:
            goal.assist?.id ??
            null,

          assist:
            goal.assist?.name ||
            "",

          scoreHome:
            goal.score?.home ??
            null,

          scoreAway:
            goal.score?.away ??
            null

        })
      );

  const bookings =
    (
      match?.bookings ||
      []
    )
      .map(
        card => ({

          minute:
            card.minute ??
            null,

          injuryTime:
            card.injuryTime ??
            null,

          minuteLabel:
            normalizeMatchEventMinute(
              card
            ),

          teamId:
            card.team?.id ??
            null,

          team:
            card.team?.name ||
            "",

          playerId:
            card.player?.id ??
            null,

          player:
            card.player?.name ||
            "",

          card:
            card.card ||
            ""

        })
      );

  const substitutions =
    (
      match?.substitutions ||
      []
    )
      .map(
        sub => ({

          minute:
            sub.minute ??
            null,

          injuryTime:
            sub.injuryTime ??
            null,

          minuteLabel:
            normalizeMatchEventMinute(
              sub
            ),

          teamId:
            sub.team?.id ??
            null,

          team:
            sub.team?.name ||
            "",

          playerInId:
            sub.playerIn?.id ??
            null,

          playerIn:
            sub.playerIn?.name ||
            "",

          playerOutId:
            sub.playerOut?.id ??
            null,

          playerOut:
            sub.playerOut?.name ||
            ""

        })
      );


  function mapLineup(
    team
  ) {

    return {

      formation:
        team?.formation ||
        null,

      coach:
        team?.coach?.name ||
        null,

      lineup:
        (
          team?.lineup ||
          []
        )
          .map(
            player => ({

              id:
                player.id ??
                null,

              name:
                player.name ||
                "",

              position:
                player.position ||
                "",

              shirtNumber:
                player.shirtNumber ??
                null

            })
          ),

      bench:
        (
          team?.bench ||
          []
        )
          .map(
            player => ({

              id:
                player.id ??
                null,

              name:
                player.name ||
                "",

              position:
                player.position ||
                "",

              shirtNumber:
                player.shirtNumber ??
                null

            })
          ),

      statistics:
        team?.statistics ||
        {}

    };

  }


  const stats = {

    home:
      home.statistics ||
      {},

    away:
      away.statistics ||
      {}

  };


  return {

    id:
      match?.id ??
      null,

    utcDate:
      match?.utcDate ||
      null,

    date:
      formatDate(
        match?.utcDate
      ),

    status:
      match?.status ||
      "",

    minute:
      match?.minute ??
      null,

    injuryTime:
      match?.injuryTime ??
      null,

    venue:
      match?.venue ||
      "",

    attendance:
      match?.attendance ??
      null,

    matchday:
      match?.matchday ??
      null,

    stage:
      match?.stage ||
      null,

    competition:
      match?.competition?.name ||
      "",

    competitionCode:
      match?.competition?.code ||
      "",

    homeTeam: {

      id:
        home.id ??
        null,

      name:
        home.name ||
        "",

      shortName:
        home.shortName ||
        home.name ||
        "",

      crest:
        home.crest ||
        "",

      formation:
        home.formation ||
        null

    },

    awayTeam: {

      id:
        away.id ??
        null,

      name:
        away.name ||
        "",

      shortName:
        away.shortName ||
        away.name ||
        "",

      crest:
        away.crest ||
        "",

      formation:
        away.formation ||
        null

    },

    score:
      match?.score ||
      {},

    goals,

    bookings,

    substitutions,

    lineups: {

      home:
        mapLineup(
          home
        ),

      away:
        mapLineup(
          away
        )

    },

    statistics:
      stats,

    referees:
      match?.referees ||
      []

  };

}


/*
 * =========================================================
 * MATCH DETAILS LADEN
 * =========================================================
 */

async function getMatchDetails(
  matchId
) {

  const id =
    String(
      matchId ||
      ""
    ).trim();

  /*
   * WICHTIG:
   * Keine fehlerhafte Regex mit doppelten Backslashes.
   */
  if (
    !/^\d+$/.test(id)
  ) {

    throw new Error(
      "Ungültige Spiel-ID"
    );

  }

  const cached =
    matchDetailCache.get(
      id
    );

  if (
    cached &&
    Date.now() -
      cached.time <
      MATCH_DETAIL_CACHE_TIME
  ) {

    return cached.data;

  }

  const data =
    await apiRequest(
      `/matches/${id}`
    );

  const details =
    mapMatchDetails(
      data
    );

  matchDetailCache.set(
    id,
    {
      time:
        Date.now(),

      data:
        details
    }
  );

  return details;

}


/*
 * =========================================================
 * DASHBOARD
 * =========================================================
 */

async function getDashboard() {

  /*
   * Cache prüfen
   */
  if (
    cache.data &&
    Date.now() -
      cache.time <
      CACHE_TIME
  ) {

    console.log(
      "Dashboard aus Cache."
    );

    return cache.data;

  }

  console.log(
    "Lade Dashboard neu..."
  );

  /*
   * API-Aufrufe parallel
   */
  const results =
    await Promise.allSettled([

      getNews(),

      getVfbMatches(),

      getBundesligaTable()

    ]);

  const news =
    results[0].status === "fulfilled"
      ? results[0].value
      : [];

  const matches =
    results[1].status === "fulfilled"
      ? results[1].value
      : [];

  const table =
    results[2].status === "fulfilled"
      ? results[2].value
      : [];

  /*
   * Fehler protokollieren
   */
  results.forEach(
    (result, index) => {

      if (
        result.status ===
        "rejected"
      ) {

        console.error(
          `Dashboard Bereich ${index} Fehler:`,
          result.reason?.message ||
          result.reason
        );

      }

    }
  );


  /*
   * Spiele nach Wettbewerb trennen
   */
  const bundesliga =
    matches.filter(
      match =>
        (
          match.competition ||
          ""
        )
          .toLowerCase()
          .includes(
            "bundesliga"
          )
    );

  const championsLeague =
    matches.filter(
      match =>
        (
          match.competition ||
          ""
        )
          .toLowerCase()
          .includes(
            "champions"
          )
    );


  /*
   * Nächstes Spiel
   */
  const now =
    Date.now();

  const upcoming =
    matches
      .filter(
        match => {

          const timestamp =
            new Date(
              match.rawDate
            ).getTime();

          return (
            Number.isFinite(
              timestamp
            ) &&
            timestamp >= now &&
            ![
              "FINISHED",
              "AWARDED",
              "CANCELLED",
              "POSTPONED"
            ].includes(
              match.status
            )
          );

        }
      )
      .sort(
        (a, b) =>
          new Date(
            a.rawDate
          ) -
          new Date(
            b.rawDate
          )
      );


  const nextMatch =
    upcoming[0] ||
    null;


  /*
   * Kaderstatistik
   */
  let squadPlayers = [];

  try {

    squadPlayers =
      await getVfbSquadStats(
        matches
      );

  } catch (error) {

    console.error(
      "Kaderstatistik Fehler:",
      error.message
    );

    squadPlayers =
      VFB_SQUAD.map(
        player => ({
          ...player,
          appearances: 0,
          goals: 0,
          assists: 0
        })
      );

  }


  const squad =
    groupSquad(
      squadPlayers
    );


  /*
   * Dashboard zusammenbauen
   */
  const dashboard = {

    success:
      true,

    updatedAt:
      new Date().toISOString(),

    news,

    fixtures:
      bundesliga,

    championsLeague,

    allMatches:
      matches,

    nextMatch,

    table,

    squad,

    attribution:
      "Football data provided by football-data.org"

  };


  /*
   * Cache speichern
   */
  cache = {

    data:
      dashboard,

    time:
      Date.now()

  };


  return dashboard;

}


/*
 * =========================================================
 * JSON SENDEN
 * =========================================================
 */

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


/*
 * =========================================================
 * DATEI AUSLIEFERN
 * =========================================================
 */

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

    ".webp":
      "image/webp",

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
  ).pipe(
    res
  );

}


/*
 * =========================================================
 * SERVER
 * =========================================================
 */

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


        /*
         * =========================================
         * MATCHCENTER API
         * =========================================
         */

        const matchPath =
          pathname.match(
            /^\/api\/match\/(\d+)$/
          );


        if (matchPath) {

          const data =
            await getMatchDetails(
              matchPath[1]
            );


          sendJSON(
            res,
            {

              success:
                true,

              match:
                data,

              attribution:
                "Data provided by football-data.org"

            }
          );

          return;

        }


        /*
         * =========================================
         * DASHBOARD API
         * =========================================
         */

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


        /*
         * =========================================
         * HEALTH CHECK
         * =========================================
         */

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

              kickerRssConfigured:
                !!KICKER_RSS_URL,

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


        /*
         * =========================================
         * HOMEPAGE
         * =========================================
         */

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


        /*
         * =========================================
         * CSS / JS / BILDER ETC.
         * =========================================
         */

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


        /*
         * =========================================
         * 404
         * =========================================
         */

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
              success:
                false,

              error:
                error.message
            }
          )
        );

      }

    }
  );


/*
 * =========================================================
 * SERVER START
 * =========================================================
 */

server.listen(
  PORT,
  "0.0.0.0",
  () => {

    console.log(
      "======================================"
    );

    console.log(
      `Cannstatt 1893 News läuft auf Port ${PORT}`
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
      "Kicker RSS Feed:",
      KICKER_RSS_URL
    );

    console.log(
      "Dashboard Cache:",
      "10 Minuten"
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
