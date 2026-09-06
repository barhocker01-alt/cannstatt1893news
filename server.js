const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;
const TOKEN = process.env.FOOTBALL_DATA_TOKEN;

const VFB_TEAM_ID = 10;

const VFB_RSS_URL =
  "https://www.vfb.de/templates/generated/1/raw/de.xml";

const KICKER_RSS_URL =
  "https://newsfeed.kicker.de/news/bundesliga";

const BUNDESLIGA_BASE_URL =
  "https://www.bundesliga.com/de/bundesliga/spieltag";

const KICKER_TEAM_NEWS_URL =
  "https://www.kicker.de/vfb-stuttgart/team-news";

const VFB_OFFICIAL_SQUAD_URL =
  "https://www.vfb.de/de/1893/profis/kader/saisonen/2026-2027/kader/";

const VFB_OFFICIAL_STATS_URL =
  "https://www.vfb.de/de/1893/profis/kader/saisonen/2026-2027/statistik/?data=&mobile=";

const BUNDESLIGA_MATCH_STATS_BASE =
  "https://www.bundesliga.com/de/bundesliga/spieltag/2026-2027";

const CACHE_TIME = 10 * 60 * 1000;
const MATCH_DETAIL_CACHE_TIME = 2 * 60 * 1000;

let cache = {
  data: null,
  time: 0
};

const matchDetailCache = new Map();

function httpsRequest(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (compatible; Cannstatt1893News/1.0)",
          "Accept":
            "application/rss+xml, application/xml, text/html, application/xhtml+xml, text/xml, */*",
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
          if (
            res.statusCode >= 200 &&
            res.statusCode < 300
          ) {
            resolve(body);
            return;
          }

          if (
            [301, 302, 303, 307, 308].includes(res.statusCode) &&
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
            } catch (error) {
              reject(error);
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
      reject
    );
  });
}

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
      reject
    );
  });
}

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
    return (
      "https:" +
      url
    );
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

async function fetchVfbNews() {
  console.log(
    "Lade offiziellen VfB RSS Feed..."
  );

  try {
    const xml =
      await httpsRequest(
        VFB_RSS_URL
      );

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

      link =
        normalizeVfbUrl(
          link
        );

      if (!link) {
        link =
          normalizeVfbUrl(
            getXmlValue(
              item,
              "guid"
            )
          );
      }

      if (
        !title ||
        title.length < 5 ||
        !link
      ) {
        continue;
      }

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

      if (
        items.some(
          existing =>
            existing.url ===
            link
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
            : "",

        source:
          "VFB"
      });
    }

    items.sort(
      (a, b) =>
        new Date(
          b.pubDate || 0
        ) -
        new Date(
          a.pubDate || 0
        )
    );

    return items.slice(
      0,
      10
    );

  } catch (error) {
    console.error(
      "VfB RSS FEED FEHLER:",
      error.message
    );

    return [];
  }
}

async function fetchKickerNews() {
  const out = [];

  try {
    const html =
      await httpsRequest(
        KICKER_TEAM_NEWS_URL,
        {
          "Accept":
            "text/html,application/xhtml+xml"
        }
      );

    const anchorRegex =
      /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;

    let match;

    while (
      (match =
        anchorRegex.exec(html))
    ) {
      const href =
        decodeHTML(
          match[1] || ""
        ).trim();

      const title =
        cleanText(
          match[2] || ""
        );

      if (
        !title ||
        title.length < 12
      ) {
        continue;
      }

      if (
        !/(kicker\.de\/.*(?:artikel|video|analyse|spielbericht|news)|\/(?:artikel|video|analyse|spielbericht)\b)/i.test(
          href
        )
      ) {
        continue;
      }

      const link =
        href.startsWith(
          "http"
        )
          ? href
          : new URL(
              href,
              "https://www.kicker.de"
            ).toString();

      if (
        !link.includes(
          "kicker.de"
        )
      ) {
        continue;
      }

      if (
        /^(mehr|weiter|alle|login|registrieren|shop|tickets)$/i.test(
          title
        )
      ) {
        continue;
      }

      if (
        out.some(
          item =>
            item.url ===
            link
        )
      ) {
        continue;
      }

      out.push({
        title:
          title,

        url:
          link,

        link:
          link,

        description:
          "",

        pubDate:
          "",

        date:
          "",

        source:
          "KICKER"
      });

      if (
        out.length >= 10
      ) {
        break;
      }
    }

  } catch (error) {
    console.error(
      "KICKER TEAM-NEWS FEHLER:",
      error.message
    );
  }

  try {
    const xml =
      await httpsRequest(
        KICKER_RSS_URL
      );

    const rssItems =
      xml.match(
        /<item\b[\s\S]*?<\/item>/gi
      ) || [];

    const keywords = [
      "vfb",
      "stuttgart",
      "hoeneß",
      "hoeness",
      "undav",
      "führich",
      "fuehrich",
      "karazor",
      "demirovic",
      "demirović",
      "pejcinovic",
      "pejčinović",
      "leweling",
      "el khannouss",
      "prömel",
      "promel",
      "jeltsch",
      "chabot",
      "sauer",
      "vagnoman",
      "mittelstädt",
      "mittelstaedt",
      "hendriks"
    ];

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

      const description =
        cleanText(
          getXmlValue(
            item,
            "description"
          )
        );

      let link =
        decodeHTML(
          getXmlValue(
            item,
            "link"
          )
        ).trim();

      if (!link) {
        link =
          decodeHTML(
            getXmlValue(
              item,
              "guid"
            )
          ).trim();
      }

      const pubDate =
        getXmlValue(
          item,
          "pubDate"
        ) ||
        getXmlValue(
          item,
          "dc:date"
        ) ||
        getXmlValue(
          item,
          "date"
        );

      const haystack =
        (
          title +
          " " +
          description
        ).toLowerCase();

      if (
        !title ||
        !link ||
        !keywords.some(
          keyword =>
            haystack.includes(
              keyword
            )
        )
      ) {
        continue;
      }

      if (
        out.some(
          item =>
            item.url ===
            link
        )
      ) {
        continue;
      }

      out.push({
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
            : "",

        source:
          "KICKER"
      });
    }

  } catch (error) {
    console.error(
      "KICKER RSS FEHLER:",
      error.message
    );
  }

  return out.slice(
    0,
    10
  );
}

async function getNews() {
  try {
    const [
      vfbNews,
      kickerNews
    ] =
      await Promise.all([
        fetchVfbNews(),
        fetchKickerNews()
      ]);

    const merged =
      [
        ...vfbNews,
        ...kickerNews
      ];

    const seen =
      new Set();

    const result =
      merged
        .filter(item => {
          const key =
            String(
              item.url ||
              item.link ||
              item.title ||
              ""
            )
              .trim()
              .toLowerCase();

          if (
            !key ||
            seen.has(key)
          ) {
            return false;
          }

          seen.add(key);

          return true;
        })
        .sort(
          (a, b) =>
            new Date(
              b.pubDate || 0
            ) -
            new Date(
              a.pubDate || 0
            )
        );

    const kicker =
      result
        .filter(
          item =>
            item.source ===
            "KICKER"
        )
        .slice(
          0,
          6
        );

    const vfb =
      result.filter(
        item =>
          item.source !==
          "KICKER"
      );

    return [
      ...kicker,
      ...vfb
    ].slice(
      0,
      16
    );

  } catch (error) {
    console.error(
      "NEWS ERROR:",
      error.message
    );

    return [];
  }
}

const PLAYER_PHOTO_CACHE =
  new Map();

const PLAYER_PHOTO_CACHE_TIME =
  24 * 60 * 60 * 1000;

function slugifyPlayerName(
  name = ""
) {
  return String(name)
    .normalize("NFD")
    .replace(
      /[\u0300-\u036f]/g,
      ""
    )
    .replace(
      /ß/g,
      "ss"
    )
    .replace(
      /đ/g,
      "d"
    )
    .replace(
      /Đ/g,
      "D"
    )
    .replace(
      /[^a-zA-Z0-9]+/g,
      "-"
    )
    .replace(
      /^-+|-+$/g,
      ""
    )
    .toLowerCase();
}

async function getKickerPlayerPhoto(
  name
) {
  const key =
    String(
      name || ""
    ).trim();

  if (!key) {
    return "";
  }

  const cached =
    PLAYER_PHOTO_CACHE.get(
      key
    );

  if (
    cached &&
    Date.now() -
      cached.time <
      PLAYER_PHOTO_CACHE_TIME
  ) {
    return cached.url || "";
  }

  const candidates = [
    `https://www.kicker.de/${slugifyPlayerName(key)}/spieler`,
    `https://www.kicker.de/${slugifyPlayerName(key)}/spieler-news`
  ];

  for (
    const url of candidates
  ) {
    try {
      const html =
        await httpsRequest(
          url,
          {
            "Accept":
              "text/html,application/xhtml+xml"
          }
        );

      const matches = [
        html.match(
          /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["'][^>]*>/i
        ),
        html.match(
          /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["'][^>]*>/i
        )
      ];

      const photo =
        matches.find(
          Boolean
        )?.[1] ||
        "";

      if (photo) {
        const result =
          decodeHTML(
            photo
          );

        PLAYER_PHOTO_CACHE.set(
          key,
          {
            time:
              Date.now(),
            url:
              result
          }
        );

        return result;
      }

    } catch (error) {
    }
  }

  PLAYER_PHOTO_CACHE.set(
    key,
    {
      time:
        Date.now(),
      url:
        ""
    }
  );

  return "";
}

const VFB_SQUAD_FALLBACK = [
  ["Tor","Fabian Bredlow",1],
  ["Tor","Marius Funk",33],
  ["Tor","Dennis Seimen",41],
  ["Tor","Stefan Drljaca",46],

  ["Abwehr","Ameen Al-Dakhil",2],
  ["Abwehr","Ramon Hendriks",3],
  ["Abwehr","Josha Vagnoman",4],
  ["Abwehr","Maximilian Mittelstädt",7],
  ["Abwehr","Luca Jaquez",14],
  ["Abwehr","Leonidas Stergiou",20],
  ["Abwehr","Lorenz Assignon",22],
  ["Abwehr","Dan-Axel Zagadou",23],
  ["Abwehr","Jeff Chabot",24],
  ["Abwehr","Finn Jeltsch",29],

  ["Mittelfeld","Angelo Stiller",6],
  ["Mittelfeld","Chris Führich",10],
  ["Mittelfeld","Bilal El Khannouss",11],
  ["Mittelfeld","Atakan Karazor",16],
  ["Mittelfeld","Grischa Prömel",21],
  ["Mittelfeld","Nikolas Nartey",28],
  ["Mittelfeld","Ertugrul Yigit",39],
  ["Mittelfeld","Jarzinho Malanga",43],

  ["Sturm","Tiago Tomás",8],
  ["Sturm","Ermedin Demirovic",9],
  ["Sturm","Dzenan Pejcinovic",17],
  ["Sturm","Jamie Leweling",18],
  ["Sturm","Jeremy Arévalo",25],
  ["Sturm","Deniz Undav",26],
  ["Sturm","Justin Diehl",31],
  ["Sturm","Leo Sauer",44]
];

const VFB_OFFICIAL_PHOTOS = {
  "Fabian Bredlow":
    "https://www.vfb.de/?proxy=sportdb%2Fspieler%2F06165-1_bredlow.png",

  "Marius Funk":
    "https://www.vfb.de/?proxy=sportdb%2Fspieler%2F6dd79-33_funk.png",

  "Dennis Seimen":
    "https://www.vfb.de/?proxy=sportdb%2Fspieler%2Fa1564-41_seimen.png",

  "Stefan Drljaca":
    "https://www.vfb.de/?proxy=sportdb%2Fspieler%2F26729-46_drljaca.png",

  "Ameen Al-Dakhil":
    "https://www.vfb.de/?proxy=sportdb%2Fspieler%2Fb6d82-2_al-dakhil.png",

  "Ramon Hendriks":
    "https://www.vfb.de/?proxy=sportdb%2Fspieler%2F37072-3_hendriks.png",

  "Josha Vagnoman":
    "https://www.vfb.de/?proxy=sportdb%2Fspieler%2F20236-4_vagnoman.png",

  "Maximilian Mittelstädt":
    "https://www.vfb.de/?proxy=sportdb%2Fspieler%2F0efee-7_mittelsta--dt.png",

  "Luca Jaquez":
    "https://www.vfb.de/?proxy=sportdb%2Fspieler%2F244f9-14_jaquez.png",

  "Leonidas Stergiou":
    "https://www.vfb.de/?proxy=sportdb%2Fspieler%2F029f7-20_stergiou.png",

  "Lorenz Assignon":
    "https://www.vfb.de/?proxy=sportdb%2Fspieler%2F38f68-22_assignon.png",

  "Dan-Axel Zagadou":
    "https://www.vfb.de/?proxy=sportdb%2Fspieler%2F??_zagadou.png",

  "Jeff Chabot":
    "https://www.vfb.de/?proxy=sportdb%2Fspieler%2Fa284d-24_chabot.png",

  "Finn Jeltsch":
    "https://www.vfb.de/?proxy=sportdb%2Fspieler%2Ff076a-29_jeltsch.png",

  "Angelo Stiller":
    "https://www.vfb.de/?proxy=sportdb%2Fspieler%2Fa2f7b-6_stiller.png",

  "Chris Führich":
    "https://www.vfb.de/?proxy=sportdb%2Fspieler%2F95b40-10_fu--hrich.png",

  "Bilal El Khannouss":
    "https://www.vfb.de/?proxy=sportdb%2Fspieler%2F1d484-11_el_khannouss.png",

  "Atakan Karazor":
    "https://www.vfb.de/?proxy=sportdb%2Fspieler%2F4b88f-16_karazor.png",

  "Grischa Prömel":
    "https://www.vfb.de/?proxy=sportdb%2Fspieler%2F9a7b9-21_pro--mel.png",

  "Nikolas Nartey":
    "https://www.vfb.de/?proxy=sportdb%2Fspieler%2F76cc5-28_nartey.png",

  "Ertugrul Yigit":
    "https://www.vfb.de/?proxy=sportdb%2Fspieler%2Fabfd0-yigit.png",

  "Jarzinho Malanga":
    "https://www.vfb.de/?proxy=sportdb%2Fspieler%2F55d47-malanga.png",

  "Tiago Tomás":
    "https://www.vfb.de/?proxy=sportdb%2Fspieler%2F49f37-8_tomas.png",

  "Ermedin Demirovic":
    "https://www.vfb.de/?proxy=sportdb%2Fspieler%2F0ba85-9_demirovic.png",

  "Dzenan Pejcinovic":
    "https://www.vfb.de/?proxy=sportdb%2Fspieler%2F4c4de-17_pejcinovic.png",

  "Jamie Leweling":
    "https://www.vfb.de/?proxy=sportdb%2Fspieler%2Fe4223-18_leweling.png",

  "Deniz Undav":
    "https://www.vfb.de/?proxy=sportdb%2Fspieler%2Fa56ab-22_undav.png",

  "Leo Sauer":
    "https://www.vfb.de/?proxy=sportdb%2Fspieler%2Fa1dfb-44_sauer.png"
};

const VFB_OFFICIAL_STATS_FALLBACK = {
  "Fabian Bredlow":
    { appearances: 2, minutes: 180, goals: 0, assists: 0 },

  "Marius Funk":
    { appearances: 0, minutes: 0, goals: 0, assists: 0 },

  "Dennis Seimen":
    { appearances: 0, minutes: 0, goals: 0, assists: 0 },

  "Stefan Drljaca":
    { appearances: 0, minutes: 0, goals: 0, assists: 0 },

  "Ameen Al-Dakhil":
    { appearances: 0, minutes: 0, goals: 0, assists: 0 },

  "Ramon Hendriks":
    { appearances: 2, minutes: 102, goals: 0, assists: 0 },

  "Josha Vagnoman":
    { appearances: 2, minutes: 180, goals: 1, assists: 1 },

  "Maximilian Mittelstädt":
    { appearances: 2, minutes: 168, goals: 1, assists: 1 },

  "Luca Jaquez":
    { appearances: 0, minutes: 0, goals: 0, assists: 0 },

  "Leonidas Stergiou":
    { appearances: 1, minutes: 16, goals: 0, assists: 0 },

  "Lorenz Assignon":
    { appearances: 0, minutes: 0, goals: 0, assists: 0 },

  "Dan-Axel Zagadou":
    { appearances: 0, minutes: 0, goals: 0, assists: 0 },

  "Jeff Chabot":
    { appearances: 2, minutes: 164, goals: 0, assists: 0 },

  "Finn Jeltsch":
    { appearances: 2, minutes: 180, goals: 0, assists: 1 },

  "Angelo Stiller":
    { appearances: 2, minutes: 177, goals: 0, assists: 0 },

  "Chris Führich":
    { appearances: 1, minutes: 70, goals: 0, assists: 0 },

  "Bilal El Khannouss":
    { appearances: 2, minutes: 94, goals: 1, assists: 1 },

  "Atakan Karazor":
    { appearances: 0, minutes: 0, goals: 0, assists: 0 },

  "Grischa Prömel":
    { appearances: 2, minutes: 180, goals: 1, assists: 1 },

  "Nikolas Nartey":
    { appearances: 0, minutes: 0, goals: 0, assists: 0 },

  "Ertugrul Yigit":
    { appearances: 0, minutes: 0, goals: 0, assists: 0 },

  "Jarzinho Malanga":
    { appearances: 0, minutes: 0, goals: 0, assists: 0 },

  "Tiago Tomás":
    { appearances: 1, minutes: 62, goals: 0, assists: 0 },

  "Ermedin Demirovic":
    { appearances: 2, minutes: 47, goals: 2, assists: 0 },

  "Dzenan Pejcinovic":
    { appearances: 2, minutes: 153, goals: 1, assists: 0 },

  "Jamie Leweling":
    { appearances: 2, minutes: 48, goals: 2, assists: 0 },

  "Deniz Undav":
    { appearances: 2, minutes: 144, goals: 2, assists: 0 },

  "Justin Diehl":
    { appearances: 0, minutes: 0, goals: 0, assists: 0 },

  "Leo Sauer":
    { appearances: 1, minutes: 12, goals: 1, assists: 0 }
};

function stripHtmlToText(
  html = ""
) {
  return decodeHTML(
    String(html)
  )
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

async function getVfbSquad() {
  const base =
    VFB_SQUAD_FALLBACK.map(
      (
        [
          position,
          name,
          number
        ]
      ) => ({
        id:
          null,

        name:
          name,

        position:
          position,

        number:
          number,

        shirtNumber:
          number,

        photo:
          VFB_OFFICIAL_PHOTOS[
            name
          ] ||
          "",

        appearances:
          0,

        minutes:
          0,

        goals:
          0,

        assists:
          0
      })
    );

  return await Promise.all(
    base.map(
      async player => ({
        ...player,

        photo:
          player.photo ||
          await getKickerPlayerPhoto(
            player.name
          )
      })
    )
  );
}

async function fetchOfficialVfbStats() {
  try {
    const html =
      await httpsRequest(
        VFB_OFFICIAL_STATS_URL,
        {
          "Accept":
            "text/html,application/xhtml+xml"
        }
      );

    const text =
      stripHtmlToText(
        html
      );

    const headingIndex =
      text.indexOf(
        "Bundesliga 2026/2027"
      );

    const tableText =
      headingIndex >= 0
        ? text.slice(
            headingIndex
          )
        : text;

    const names =
      VFB_SQUAD_FALLBACK.map(
        x => x[1]
      );

    const parsed = {};

    for (
      let i = 0;
      i < names.length;
      i++
    ) {
      const name =
        names[i];

      const start =
        tableText.indexOf(
          name
        );

      if (
        start < 0
      ) {
        continue;
      }

      let end =
        tableText.length;

      for (
        let j = 0;
        j < names.length;
        j++
      ) {
        if (
          j === i
        ) {
          continue;
        }

        const next =
          tableText.indexOf(
            names[j],
            start +
              name.length
          );

        if (
          next >= 0 &&
          next < end
        ) {
          end =
            next;
        }
      }

      const segment =
        tableText.slice(
          start +
            name.length,
          end
        );

      const tokens =
        segment.match(
          /(?:\d+(?:[.,]\d+)?|[-])/g
        ) ||
        [];

      const minutesMatch =
        segment.match(
          /(\d+)\s*[’']/
        );

      const appearances =
        tokens.length
          ? (
              tokens[0] === "-"
                ? 0
                : Number(
                    tokens[0]
                  )
            )
          : 0;

      const minutes =
        minutesMatch
          ? Number(
              minutesMatch[1]
            )
          : 0;

      const known =
        VFB_OFFICIAL_STATS_FALLBACK[
          name
        ] ||
        {
          appearances:
            0,
          minutes:
            0,
          goals:
            0,
          assists:
            0
        };

      parsed[name] = {
        appearances:
          Number.isFinite(
            appearances
          )
            ? appearances
            : known.appearances,

        minutes:
          Number.isFinite(
            minutes
          )
            ? minutes
            : known.minutes,

        goals:
          known.goals,

        assists:
          known.assists
      };
    }

    if (
      Object.keys(
        parsed
      ).length < 10
    ) {
      throw new Error(
        "Offizielle VfB-Statistik konnte nicht vollständig gelesen werden"
      );
    }

    return parsed;

  } catch (error) {
    console.warn(
      "Offizielle VfB-Statistik nicht lesbar:",
      error.message
    );

    return null;
  }
}

async function getVfbSquadStats(
  matches,
  squad
) {
  const official =
    await fetchOfficialVfbStats();

  return squad.map(
    player => {
      const stat =
        official?.[
          player.name
        ] ||
        VFB_OFFICIAL_STATS_FALLBACK[
          player.name
        ] ||
        {};

      return {
        ...player,

        appearances:
          Number(
            stat.appearances ||
            0
          ),

        minutes:
          Number(
            stat.minutes ||
            0
          ),

        goals:
          Number(
            stat.goals ||
            0
          ),

        assists:
          Number(
            stat.assists ||
            0
          ),

        statsSource:
          "VfB Stuttgart"
      };
    }
  );
}

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
    news,
    squad
  ] =
    await Promise.all([
      getVfbMatches(),
      getBundesligaTable(),
      getNews(),
      getVfbSquad()
    ]);

  const squadStats =
    await getVfbSquadStats(
      matches,
      squad
    );

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

  let nextGame =
    matches.find(
      match => {
        const date =
          new Date(
            match.rawDate
          );

        return (
          date >= now &&
          ![
            "FINISHED",
            "AWARDED",
            "CANCELLED",
            "POSTPONED"
          ].includes(
            String(
              match.status ||
              ""
            ).toUpperCase()
          )
        );
      }
    ) ||
    null;

  const officialUpcoming = [
    {
      id:
        null,

      rawDate:
        "2026-09-09T18:45:00+02:00",

      date:
        formatDate(
          "2026-09-09T18:45:00+02:00"
        ),

      home:
        "VfB Stuttgart",

      away:
        "Viking Stavanger",

      homeLogo:
        "",

      awayLogo:
        "",

      competition:
        "UEFA Champions League",

      league:
        "UEFA Champions League",

      status:
        "SCHEDULED",

      homeGoals:
        null,

      awayGoals:
        null,

      venue:
        "MHP Arena Stuttgart"
    },

    {
      id:
        null,

      rawDate:
        "2026-09-12T15:30:00+02:00",

      date:
        formatDate(
          "2026-09-12T15:30:00+02:00"
        ),

      home:
        "TSG Hoffenheim",

      away:
        "VfB Stuttgart",

      homeLogo:
        "",

      awayLogo:
        "",

      competition:
        "Bundesliga",

      league:
        "Bundesliga",

      status:
        "SCHEDULED",

      homeGoals:
        null,

      awayGoals:
        null,

      venue:
        "SNP Arena"
    }
  ].filter(
    game =>
      new Date(
        game.rawDate
      ) >= now
  );

  if (
    officialUpcoming.length
  ) {
    const officialNext =
      officialUpcoming[0];

    if (
      !nextGame ||
      new Date(
        officialNext.rawDate
      ) <
        new Date(
          nextGame.rawDate
        )
    ) {
      nextGame =
        officialNext;
    }
  }

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

    squad:
      squadStats,

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

      squad:
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

function normalizeMatchEventMinute(
  event
) {
  const minute =
    event?.minute ??
    event?.time?.elapsed ??
    null;

  const injury =
    event?.injuryTime ??
    event?.time?.extra ??
    null;

  if (
    minute === null ||
    minute === undefined
  ) {
    return "";
  }

  return injury
    ? `${minute}+${injury}.`
    : `${minute}.`;
}

function slugifyTeamName(
  name = ""
) {
  const map = {
    "VfB Stuttgart":
      "vfb-stuttgart",

    "1. FC Köln":
      "1-fc-koeln",

    "FC Bayern München":
      "fc-bayern-muenchen",

    "Borussia Dortmund":
      "borussia-dortmund",

    "TSG Hoffenheim":
      "tsg-hoffenheim",

    "SC Paderborn 07":
      "sc-paderborn-07",

    "Hamburger SV":
      "hamburger-sv",

    "Borussia Mönchengladbach":
      "borussia-moenchengladbach",

    "Werder Bremen":
      "werder-bremen",

    "SC Freiburg":
      "sc-freiburg",

    "1. FSV Mainz 05":
      "1-fsv-mainz-05",

    "FC Augsburg":
      "fc-augsburg",

    "RB Leipzig":
      "rb-leipzig",

    "1. FC Union Berlin":
      "1-fc-union-berlin",

    "Eintracht Frankfurt":
      "eintracht-frankfurt",

    "Bayer 04 Leverkusen":
      "bayer-04-leverkusen",

    "VfL Wolfsburg":
      "vfl-wolfsburg",

    "1. FC Heidenheim 1846":
      "1-fc-heidenheim-1846"
  };

  if (
    map[name]
  ) {
    return map[name];
  }

  return String(name)
    .normalize("NFD")
    .replace(
      /[\u0300-\u036f]/g,
      ""
    )
    .replace(
      /ß/g,
      "ss"
    )
    .replace(
      /[^a-zA-Z0-9]+/g,
      "-"
    )
    .replace(
      /^-+|-+$/g,
      ""
    )
    .toLowerCase();
}

function extractNumberPair(
  text,
  label
) {
  const escaped =
    label.replace(
      /[.*+?^${}()|[\]\\]/g,
      "\\$&"
    );

  const match =
    text.match(
      new RegExp(
        escaped +
        "[^0-9]{0,100}" +
        "(\\d+(?:[.,]\\d+)?)" +
        "(?:%|)" +
        "[^0-9]{0,100}" +
        "(\\d+(?:[.,]\\d+)?)" +
        "(?:%|)",
        "i"
      )
    );

  return match
    ? [
        Number(
          String(
            match[1]
          ).replace(
            ",",
            "."
          )
        ),
        Number(
          String(
            match[2]
          ).replace(
            ",",
            "."
          )
        )
      ]
    : null;
}

async function fetchBundesligaMatchStatistics(
  match
) {
  if (
    !match ||
    match.matchday == null
  ) {
    return {};
  }

  if (
    !String(
      match.competition ||
      ""
    )
      .toLowerCase()
      .includes(
        "bundesliga"
      )
  ) {
    return {};
  }

  const base =
    `${BUNDESLIGA_BASE_URL}/2026-2027/${match.matchday}/${slugifyTeamName(match.home)}-vs-${slugifyTeamName(match.away)}`;

  for (
    const url of [
      `${base}/stats`,
      `${base}/liveticker`
    ]
  ) {
    try {
      const html =
        await httpsRequest(
          url,
          {
            "Accept":
              "text/html,application/xhtml+xml"
          }
        );

      const text =
        stripHtmlToText(
          html
        );

      const stats = {
        home:
          {},
        away:
          {}
      };

      const labels = [
        [
          "possession",
          "Ballbesitz"
        ],
        [
          "shots",
          "Schüsse"
        ],
        [
          "shotsOnGoal",
          "Schüsse aufs Tor"
        ],
        [
          "shotsOffGoal",
          "Schüsse daneben"
        ],
        [
          "cornerKicks",
          "Ecken"
        ],
        [
          "fouls",
          "Fouls"
        ],
        [
          "offsides",
          "Abseits"
        ],
        [
          "yellowCards",
          "Gelbe Karten"
        ],
        [
          "passes",
          "Pässe"
        ],
        [
          "passAccuracy",
          "Passquote"
        ]
      ];

      for (
        const [
          key,
          label
        ] of labels
      ) {
        const pair =
          extractNumberPair(
            text,
            label
          );

        if (pair) {
          stats.home[key] =
            pair[0];

          stats.away[key] =
            pair[1];
        }
      }

      if (
        Object.keys(
          stats.home
        ).length
      ) {
        return stats;
      }

    } catch (error) {
      console.warn(
        "Bundesliga Matchstats:",
        error.message
      );
    }
  }

  return {};
}

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
    ).map(
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
          "REGULAR",

        teamId:
          goal.team?.id ??
          null,

        team:
          goal.team?.name ||
          "",

        scorerId:
          goal.scorer?.id ??
          null,

        scorer:
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
    ).map(
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
    ).map(
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
        ).map(
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
        ).map(
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

    goals:
      goals,

    bookings:
      bookings,

    substitutions:
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

function slugifyBundesligaTeam(
  name = ""
) {
  const map = {
    "VfB Stuttgart":
      "vfb-stuttgart",

    "FC Bayern München":
      "fc-bayern-muenchen",

    "Bayern München":
      "fc-bayern-muenchen",

    "1. FC Köln":
      "1-fc-koeln",

    "TSG Hoffenheim":
      "tsg-hoffenheim",

    "Borussia Dortmund":
      "borussia-dortmund",

    "SC Paderborn 07":
      "sc-paderborn-07",

    "Hamburger SV":
      "hamburger-sv",

    "Borussia Mönchengladbach":
      "borussia-moenchengladbach",

    "Bayer 04 Leverkusen":
      "bayer-04-leverkusen",

    "SV Werder Bremen":
      "sv-werder-bremen",

    "FC Schalke 04":
      "fc-schalke-04",

    "Eintracht Frankfurt":
      "eintracht-frankfurt",

    "SV 07 Elversberg":
      "sv-07-elversberg",

    "SC Freiburg":
      "sc-freiburg",

    "FC Augsburg":
      "fc-augsburg",

    "RB Leipzig":
      "rb-leipzig",

    "1. FSV Mainz 05":
      "1-fsv-mainz-05",

    "1. FC Union Berlin":
      "1-fc-union-berlin"
  };

  if (
    map[name]
  ) {
    return map[name];
  }

  return slugifyPlayerName(
    name
  );
}

async function fetchBundesligaMatchStats(
  details
) {
  try {
    if (
      !details ||
      String(
        details.competitionCode ||
        ""
      ).toUpperCase() !==
        "BL1"
    ) {
      return null;
    }

    const matchday =
      Number(
        details.matchday
      );

    if (
      !Number.isFinite(
        matchday
      ) ||
      matchday < 1
    ) {
      return null;
    }

    const homeSlug =
      slugifyBundesligaTeam(
        details.homeTeam?.name ||
        ""
      );

    const awaySlug =
      slugifyBundesligaTeam(
        details.awayTeam?.name ||
        ""
      );

    const url =
      `${BUNDESLIGA_MATCH_STATS_BASE}/${matchday}/${homeSlug}-vs-${awaySlug}/stats`;

    const html =
      await httpsRequest(
        url,
        {
          "Accept":
            "text/html,application/xhtml+xml"
        }
      );

    const text =
      stripHtmlToText(
        html
      );

    if (
      !text ||
      !text.includes(
        "Ballbesitz"
      )
    ) {
      return null;
    }

    const stats = {
      home:
        {},

      away:
        {},

      source:
        "Bundesliga.com / DFL"
    };

    const pair =
      label => {
        const re =
          new RegExp(
            label +
              "\\s+(\\d+(?:[.,]\\d+)?)\\s+(\\d+(?:[.,]\\d+)?)",
            "i"
          );

        const match =
          text.match(re);

        return match
          ? [
              Number(
                match[1].replace(
                  ",",
                  "."
                )
              ),

              Number(
                match[2].replace(
                  ",",
                  "."
                )
              )
            ]
          : null;
      };

    const possession =
      pair(
        "Ballbesitz \\(%\\)"
      );

    if (possession) {
      stats.home.possession =
        possession[0];

      stats.away.possession =
        possession[1];
    }

    const corners =
      pair(
        "Ecken"
      );

    if (corners) {
      stats.home.cornerKicks =
        corners[0];

      stats.away.cornerKicks =
        corners[1];
    }

    const offsides =
      pair(
        "Abseits"
      );

    if (offsides) {
      stats.home.offsides =
        offsides[0];

      stats.away.offsides =
        offsides[1];
    }

    const fouls =
      pair(
        "begangene Fouls"
      );

    if (fouls) {
      stats.home.fouls =
        fouls[0];

      stats.away.fouls =
        fouls[1];
    }

    const duels =
      pair(
        "gewonnene Zweikämpfe"
      );

    if (duels) {
      stats.home.wonDuels =
        duels[0];

      stats.away.wonDuels =
        duels[1];
    }

    const shots =
      text.match(
        /(\d+)\s+neben das Tor\s+(\d+)\s+auf das Tor\s+(\d+)\s+neben das Tor\s+(\d+)\s+auf das Tor/i
      );

    if (shots) {
      stats.home.shotsOffGoal =
        Number(
          shots[1]
        );

      stats.home.shotsOnGoal =
        Number(
          shots[2]
        );

      stats.away.shotsOffGoal =
        Number(
          shots[3]
        );

      stats.away.shotsOnGoal =
        Number(
          shots[4]
        );

      stats.home.shots =
        stats.home.shotsOffGoal +
        stats.home.shotsOnGoal;

      stats.away.shots =
        stats.away.shotsOffGoal +
        stats.away.shotsOnGoal;
    }

    const passes =
      text.match(
        /Pässe\s+(\d+)\s+(\d+)\s+(\d+(?:[.,]\d+)?)\s*%Passquote\s+(\d+(?:[.,]\d+)?)\s*%/i
      );

    if (passes) {
      stats.home.passes =
        Number(
          passes[1]
        );

      stats.away.passes =
        Number(
          passes[2]
        );

      stats.home.passAccuracy =
        Number(
          passes[3].replace(
            ",",
            "."
          )
        );

      stats.away.passAccuracy =
        Number(
          passes[4].replace(
            ",",
            "."
          )
        );
    }

    const xg =
      text.match(
        /xGoals\s+(\d+(?:[.,]\d+)?)\s+(\d+(?:[.,]\d+)?)/i
      );

    if (xg) {
      stats.home.xGoals =
        Number(
          xg[1].replace(
            ",",
            "."
          )
        );

      stats.away.xGoals =
        Number(
          xg[2].replace(
            ",",
            "."
          )
        );
    }

    return stats;

  } catch (error) {
    console.warn(
      "Bundesliga-Matchstatistik nicht verfügbar:",
      error.message
    );

    return null;
  }
}

async function getMatchDetails(
  matchId
) {
  const id =
    String(
      matchId ||
      ""
    ).trim();

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

  const externalStats =
    await fetchBundesligaMatchStats(
      details
    );

  if (
    externalStats
  ) {
    details.statistics = {
      ...details.statistics,

      home: {
        ...(
          details.statistics?.home ||
          {}
        ),

        ...(
          externalStats.home ||
          {}
        )
      },

      away: {
        ...(
          details.statistics?.away ||
          {}
        ),

        ...(
          externalStats.away ||
          {}
        )
      },

      source:
        externalStats.source
    };
  }

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
        "no-store",

      "Access-Control-Allow-Origin":
        "*"
    }
  );

  res.end(
    JSON.stringify(
      data
    )
  );
}

function serveFile(
  res,
  filename
) {
  const filePath =
    path.join(
      __dirname,
      filename
    );

  if (
    !fs.existsSync(
      filePath
    )
  ) {
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
        "application/octet-stream",

      "Cache-Control":
        "no-cache"
    }
  );

  fs.createReadStream(
    filePath
  ).pipe(
    res
  );
}

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

        const matchPath =
          pathname.match(
            /^\/api\/match\/(\d+)$/
          );

        if (
          matchPath
        ) {
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

        if (
          pathname ===
            "/" ||
          pathname ===
            "/index.html"
        ) {
          serveFile(
            res,
            "index.html"
          );

          return;
        }

        if (
          !pathname.startsWith(
            "/api/"
          )
        ) {
          const safePath =
            pathname.replace(
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

          serveFile(
            res,
            "index.html"
          );

          return;
        }

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

        if (
          !res.headersSent
        ) {
          res.writeHead(
            500,
            {
              "Content-Type":
                "application/json; charset=utf-8"
            }
          );

          res.end(
            JSON.stringify({
              success:
                false,

              error:
                error.message
            })
          );
        } else {
          res.end();
        }
      }
    }
  );

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
      "Kicker RSS Feed:",
      KICKER_RSS_URL
    );

    console.log(
      "VfB Kader:",
      VFB_OFFICIAL_SQUAD_URL
    );

    console.log(
      "VfB Statistik:",
      VFB_OFFICIAL_STATS_URL
    );

    console.log(
      "Dashboard Cache:",
      "10 Minuten"
    );

    console.log(
      "Match Cache:",
      "2 Minuten"
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

process.on(
  "uncaughtException",
  error => {
    console.error(
      "UNCAUGHT EXCEPTION:",
      error
    );
  }
);

process.on(
  "unhandledRejection",
  error => {
    console.error(
      "UNHANDLED REJECTION:",
      error
    );
  }
);
