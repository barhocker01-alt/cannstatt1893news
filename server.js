"use strict";

const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

/* =========================================================
   KONFIGURATION
========================================================= */

const PORT = Number(process.env.PORT || 3000);
const TOKEN = process.env.FOOTBALL_DATA_TOKEN || "";

const VFB_TEAM_ID = 10;

const VFB_RSS_URL =
  "https://www.vfb.de/templates/generated/1/raw/de.xml";

const KICKER_RSS_URL =
  "https://www.kicker.de/vfb-stuttgart/news";

const FOOTBALL_DATA_BASE =
  "https://api.football-data.org/v4";

const BUNDESLIGA_BASE =
  "https://www.bundesliga.com/de/bundesliga/spieltag";

const CACHE_TIME =
  10 * 60 * 1000;

const MATCH_CACHE_TIME =
  2 * 60 * 1000;


/* =========================================================
   CACHE
========================================================= */

let dashboardCache = {
  data: null,
  time: 0
};

const matchCache = new Map();


/* =========================================================
   HTTP HELFER
========================================================= */

function httpsRequest(url, headers = {}) {
  return new Promise((resolve, reject) => {

    const request = https.get(
      url,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
          "Accept-Language": "de-DE,de;q=0.9,en;q=0.8",
          ...headers
        }
      },
      response => {

        let body = "";

        response.setEncoding("utf8");

        response.on("data", chunk => {
          body += chunk;
        });

        response.on("end", () => {

          const status =
            response.statusCode || 0;

          if (status >= 200 && status < 400) {
            resolve(body);
          } else {
            reject(
              new Error(
                `HTTP ${status} bei ${url}`
              )
            );
          }
        });
      }
    );

    request.on("error", reject);

    request.setTimeout(
      15000,
      () => {
        request.destroy(
          new Error(
            "Request Timeout"
          )
        );
      }
    );
  });
}


async function apiRequest(endpoint) {

  if (!TOKEN) {
    throw new Error(
      "FOOTBALL_DATA_TOKEN fehlt"
    );
  }

  return new Promise((resolve, reject) => {

    const request = https.get(
      `${FOOTBALL_DATA_BASE}${endpoint}`,
      {
        headers: {
          "X-Auth-Token": TOKEN,
          "User-Agent": "Cannstatt1893News/1.0",
          "Accept": "application/json"
        }
      },
      response => {

        let body = "";

        response.setEncoding("utf8");

        response.on(
          "data",
          chunk => {
            body += chunk;
          }
        );

        response.on(
          "end",
          () => {

            const status =
              response.statusCode || 0;

            if (
              status < 200 ||
              status >= 300
            ) {
              reject(
                new Error(
                  `Football-Data HTTP ${status}: ${body.slice(0, 300)}`
                )
              );
              return;
            }

            try {
              resolve(
                JSON.parse(body)
              );
            } catch (error) {
              reject(error);
            }
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
            "Football-Data Timeout"
          )
        );
      }
    );
  });
}


/* =========================================================
   XML / HTML HELFER
========================================================= */

function decodeHtml(text = "") {

  return String(text)
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#x27;/gi, "'")
    .replace(/&#x2F;/gi, "/")
    .replace(/&#(\d+);/g, (_, n) => {
      return String.fromCharCode(
        Number(n)
      );
    });
}


function stripHtml(text = "") {

  return decodeHtml(
    String(text)
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}


function xmlTag(block, tag) {

  const regex =
    new RegExp(
      `<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`,
      "i"
    );

  const match =
    String(block).match(regex);

  return match
    ? decodeHtml(
        stripHtml(match[1])
      )
    : "";
}


function xmlAttr(block, tag, attr) {

  const regex =
    new RegExp(
      `<${tag}[^>]*${attr}=["']([^"']+)["'][^>]*>`,
      "i"
    );

  const match =
    String(block).match(regex);

  return match
    ? decodeHtml(match[1])
    : "";
}


/* =========================================================
   DATUM
========================================================= */

function formatDate(value) {

  if (!value) {
    return "";
  }

  const date =
    new Date(value);

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return "";
  }

  return date.toLocaleDateString(
    "de-DE",
    {
      day: "2-digit",
      month: "2-digit",
      year: "numeric"
    }
  );
}


/* =========================================================
   SLUGS
========================================================= */

function slugify(name = "") {

  return String(name)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ß/g, "ss")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}


/* =========================================================
   NEWS
========================================================= */

function parseRss(xml, sourceName) {

  const items = [];

  const blocks =
    xml.match(
      /<item\b[\s\S]*?<\/item>/gi
    ) || [];

  for (const block of blocks) {

    const title =
      xmlTag(block, "title");

    const description =
      xmlTag(block, "description");

    const link =
      xmlTag(block, "link") ||
      xmlTag(block, "guid");

    const pubDate =
      xmlTag(block, "pubDate") ||
      xmlTag(block, "dc:date");

    const image =
      xmlAttr(
        block,
        "media:content",
        "url"
      ) ||
      xmlAttr(
        block,
        "media:thumbnail",
        "url"
      ) ||
      xmlAttr(
        block,
        "enclosure",
        "url"
      );

    if (!title) {
      continue;
    }

    items.push({
      title,
      summary:
        stripHtml(description).slice(
          0,
          260
        ),
      url: link || "#",
      date:
        pubDate
          ? formatDate(pubDate)
          : "",
      rawDate:
        pubDate || "",
      source:
        sourceName,
      image:
        image || ""
    });
  }

  return items;
}


async function getVfBNews() {

  try {

    const xml =
      await httpsRequest(
        VFB_RSS_URL
      );

    return parseRss(
      xml,
      "VfB Stuttgart"
    );

  } catch (error) {

    console.warn(
      "VfB News nicht verfügbar:",
      error.message
    );

    return [];
  }
}


async function getKickerNews() {

  try {

    const html =
      await httpsRequest(
        "https://www.kicker.de/vfb-stuttgart/news"
      );

    const results = [];

    const links =
      html.match(
        /<a[^>]+href=["']([^"']*\/vfb-stuttgart\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi
      ) || [];

    const seen =
      new Set();

    for (const item of links) {

      const match =
        item.match(
          /href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i
        );

      if (!match) {
        continue;
      }

      let url =
        match[1];

      const title =
        stripHtml(match[2]);

      if (!title) {
        continue;
      }

      if (
        !url.startsWith("http")
      ) {
        url =
          "https://www.kicker.de" +
          (
            url.startsWith("/")
              ? url
              : "/" + url
          );
      }

      if (
        seen.has(url) ||
        title.length < 15
      ) {
        continue;
      }

      seen.add(url);

      results.push({
        title,
        summary:
          title.slice(
            0,
            260
          ),
        url,
        date: "",
        rawDate: "",
        source: "Kicker",
        image: ""
      });

      if (
        results.length >= 12
      ) {
        break;
      }
    }

    return results;

  } catch (error) {

    console.warn(
      "Kicker News nicht verfügbar:",
      error.message
    );

    return [];
  }
}


async function getNews() {

  const [
    vfb,
    kicker
  ] =
    await Promise.all([
      getVfBNews(),
      getKickerNews()
    ]);

  const all = [
    ...vfb,
    ...kicker
  ];

  all.sort(
    (a, b) =>
      new Date(
        b.rawDate || 0
      ) -
      new Date(
        a.rawDate || 0
      )
  );

  const unique = [];

  const seen =
    new Set();

  for (const item of all) {

    const key =
      `${item.title}|${item.url}`;

    if (
      seen.has(key)
    ) {
      continue;
    }

    seen.add(key);

    unique.push(item);
  }

  return unique.slice(
    0,
    20
  );
}


/* =========================================================
   OFFIZIELLE VFB SPIELERBILDER
========================================================= */

const OFFICIAL_PHOTOS = {

  "Fabian Bredlow":
    "https://www.vfb.de/fileadmin/_processed_/c/6/csm_bredlow_fabian_vfb_26_27_01_9d4f5c1e0c.png",

  "Marius Funk":
    "https://www.vfb.de/fileadmin/_processed_/spieler/marius-funk.png",

  "Dennis Seimen":
    "https://www.vfb.de/fileadmin/_processed_/spieler/dennis-seimen.png",

  "Stefan Drljaca":
    "https://www.vfb.de/fileadmin/_processed_/spieler/stefan-drljaca.png",

  "Ameen Al-Dakhil":
    "https://www.vfb.de/fileadmin/_processed_/spieler/ameen-al-dakhil.png",

  "Ramon Hendriks":
    "https://www.vfb.de/fileadmin/_processed_/spieler/ramon-hendriks.png",

  "Josha Vagnoman":
    "https://www.vfb.de/fileadmin/_processed_/spieler/josha-vagnoman.png",

  "Maximilian Mittelstädt":
    "https://www.vfb.de/fileadmin/_processed_/spieler/maximilian-mittelstaedt.png",

  "Luca Jaquez":
    "https://www.vfb.de/fileadmin/_processed_/spieler/luca-jaquez.png",

  "Leonidas Stergiou":
    "https://www.vfb.de/fileadmin/_processed_/spieler/leonidas-stergiou.png",

  "Lorenz Assignon":
    "https://www.vfb.de/fileadmin/_processed_/spieler/lorenz-assignon.png",

  "Dan-Axel Zagadou":
    "https://www.vfb.de/fileadmin/_processed_/spieler/dan-axel-zagadou.png",

  "Jeff Chabot":
    "https://www.vfb.de/fileadmin/_processed_/spieler/jeff-chabot.png",

  "Finn Jeltsch":
    "https://www.vfb.de/fileadmin/_processed_/spieler/finn-jeltsch.png",

  "Angelo Stiller":
    "https://www.vfb.de/fileadmin/_processed_/spieler/angelo-stiller.png",

  "Chris Führich":
    "https://www.vfb.de/fileadmin/_processed_/spieler/chris-fuehrich.png",

  "Bilal El Khannouss":
    "https://www.vfb.de/fileadmin/_processed_/spieler/bilal-el-khannouss.png",

  "Atakan Karazor":
    "https://www.vfb.de/fileadmin/_processed_/spieler/atakan-karazor.png",

  "Grischa Prömel":
    "https://www.vfb.de/fileadmin/_processed_/spieler/grischa-proemel.png",

  "Nikolas Nartey":
    "https://www.vfb.de/fileadmin/_processed_/spieler/nikolas-nartey.png",

  "Ertugrul Yigit":
    "https://www.vfb.de/fileadmin/_processed_/spieler/ertugrul-yigit.png",

  "Jarzinho Malanga":
    "https://www.vfb.de/fileadmin/_processed_/spieler/jarzinho-malanga.png",

  "Tiago Tomás":
    "https://www.vfb.de/fileadmin/_processed_/spieler/tiago-tomas.png",

  "Ermedin Demirovic":
    "https://www.vfb.de/fileadmin/_processed_/spieler/ermedin-demirovic.png",

  "Dzenan Pejcinovic":
    "https://www.vfb.de/fileadmin/_processed_/spieler/dzenan-pejcinovic.png",

  "Jamie Leweling":
    "https://www.vfb.de/fileadmin/_processed_/spieler/jamie-leweling.png",

  "Deniz Undav":
    "https://www.vfb.de/fileadmin/_processed_/spieler/deniz-undav.png",

  "Justin Diehl":
    "https://www.vfb.de/fileadmin/_processed_/spieler/justin-diehl.png",

  "Leo Sauer":
    "https://www.vfb.de/fileadmin/_processed_/spieler/leo-sauer.png"
};


/* =========================================================
   AKTUELLER KADER
========================================================= */

const CURRENT_SQUAD = [

  {
    name: "Fabian Bredlow",
    position: "Tor"
  },
  {
    name: "Marius Funk",
    position: "Tor"
  },
  {
    name: "Dennis Seimen",
    position: "Tor"
  },
  {
    name: "Stefan Drljaca",
    position: "Tor"
  },

  {
    name: "Ameen Al-Dakhil",
    position: "Abwehr"
  },
  {
    name: "Ramon Hendriks",
    position: "Abwehr"
  },
  {
    name: "Josha Vagnoman",
    position: "Abwehr"
  },
  {
    name: "Maximilian Mittelstädt",
    position: "Abwehr"
  },
  {
    name: "Luca Jaquez",
    position: "Abwehr"
  },
  {
    name: "Leonidas Stergiou",
    position: "Abwehr"
  },
  {
    name: "Lorenz Assignon",
    position: "Abwehr"
  },
  {
    name: "Dan-Axel Zagadou",
    position: "Abwehr"
  },
  {
    name: "Jeff Chabot",
    position: "Abwehr"
  },
  {
    name: "Finn Jeltsch",
    position: "Abwehr"
  },

  {
    name: "Angelo Stiller",
    position: "Mittelfeld"
  },
  {
    name: "Chris Führich",
    position: "Mittelfeld"
  },
  {
    name: "Bilal El Khannouss",
    position: "Mittelfeld"
  },
  {
    name: "Atakan Karazor",
    position: "Mittelfeld"
  },
  {
    name: "Grischa Prömel",
    position: "Mittelfeld"
  },
  {
    name: "Nikolas Nartey",
    position: "Mittelfeld"
  },
  {
    name: "Ertugrul Yigit",
    position: "Mittelfeld"
  },
  {
    name: "Jarzinho Malanga",
    position: "Mittelfeld"
  },

  {
    name: "Tiago Tomás",
    position: "Sturm"
  },
  {
    name: "Ermedin Demirovic",
    position: "Sturm"
  },
  {
    name: "Dzenan Pejcinovic",
    position: "Sturm"
  },
  {
    name: "Jamie Leweling",
    position: "Sturm"
  },
  {
    name: "Deniz Undav",
    position: "Sturm"
  },
  {
    name: "Justin Diehl",
    position: "Sturm"
  },
  {
    name: "Leo Sauer",
    position: "Sturm"
  }
];


/* =========================================================
   VFB STATISTIKEN
========================================================= */

async function getOfficialSquadStats() {

  let stats =
    new Map();

  try {

    const url =
      "https://www.vfb.de/de/1893/profis/kader/saisonen/2026-2027/statistik/";

    const html =
      await httpsRequest(url);

    const text =
      stripHtml(html);

    for (
      const player of CURRENT_SQUAD
    ) {

      const escaped =
        player.name
          .replace(
            /[.*+?^${}()|[\]\\]/g,
            "\\$&"
          );

      const regex =
        new RegExp(
          escaped +
          "([\\s\\S]{0,500})",
          "i"
        );

      const match =
        text.match(regex);

      if (!match) {
        continue;
      }

      const section =
        match[1];

      const numbers =
        section.match(
          /\d+/g
        ) || [];

      const appearances =
        Number(
          numbers[0] || 0
        );

      const goals =
        Number(
          numbers[1] || 0
        );

      const assists =
        Number(
          numbers[2] || 0
        );

      const minuteMatch =
        section.match(
          /(\d+)\s*['’]/
        );

      const minutes =
        minuteMatch
          ? Number(
              minuteMatch[1]
            )
          : 0;

      stats.set(
        player.name,
        {
          appearances,
          goals,
          assists,
          minutes
        }
      );
    }

  } catch (error) {

    console.warn(
      "Offizielle VfB-Statistik nicht erreichbar:",
      error.message
    );
  }

  return stats;
}


/* =========================================================
   KADER AUFBAUEN
========================================================= */

async function buildSquad() {

  const officialStats =
    await getOfficialSquadStats();

  return CURRENT_SQUAD.map(
    player => {

      const stat =
        officialStats.get(
          player.name
        ) || {
          appearances: 0,
          goals: 0,
          assists: 0,
          minutes: 0
        };

      return {

        name:
          player.name,

        position:
          player.position,

        appearances:
          stat.appearances,

        goals:
          stat.goals,

        assists:
          stat.assists,

        minutes:
          stat.minutes,

        photo:
          OFFICIAL_PHOTOS[
            player.name
          ] || "",

        number:
          null
      };
    }
  );
}


/* =========================================================
   SPIELE
========================================================= */

function mapMatch(match) {

  const home =
    match.homeTeam || {};

  const away =
    match.awayTeam || {};

  const score =
    match.score || {};

  return {

    id:
      match.id,

    utcDate:
      match.utcDate,

    rawDate:
      match.utcDate,

    date:
      formatDate(
        match.utcDate
      ),

    home:
      home.name || "",

    away:
      away.name || "",

    homeLogo:
      home.crest || "",

    awayLogo:
      away.crest || "",

    homeGoals:
      score.fullTime?.home ??
      score.halfTime?.home ??
      null,

    awayGoals:
      score.fullTime?.away ??
      score.halfTime?.away ??
      null,

    status:
      match.status || "",

    competition:
      match.competition?.name ||
      "",

    league:
      match.competition?.name ||
      "",

    competitionCode:
      match.competition?.code ||
      "",

    matchday:
      match.matchday ??
      null,

    venue:
      match.venue ||
      ""
  };
}


async function getMatches() {

  try {

    const data =
      await apiRequest(
        `/teams/${VFB_TEAM_ID}/matches?season=2026&status=FINISHED,SCHEDULED,IN_PLAY,PAUSED,POSTPONED`
      );

    return (
      data.matches || []
    ).map(
      mapMatch
    );

  } catch (error) {

    console.warn(
      "Spiele nicht verfügbar:",
      error.message
    );

    return [];
  }
}


/* =========================================================
   NÄCHSTES SPIEL FALLBACK
========================================================= */

function fallbackNextGame() {

  return {

    id:
      null,

    rawDate:
      "2026-09-09T18:45:00+02:00",

    date:
      "09.09.2026",

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
      "Champions League",

    status:
      "SCHEDULED",

    homeGoals:
      null,

    awayGoals:
      null,

    venue:
      "MHPArena"
  };
}


/* =========================================================
   TABELLE
========================================================= */

async function getTable() {

  try {

    const data =
      await apiRequest(
        "/competitions/BL1/standings?season=2026"
      );

    const standings =
      data.standings?.[0]?.table ||
      [];

    return standings.map(
      row => {

        const team =
          row.team || {};

        return {

          position:
            row.position,

          team:
            team.name || "",

          shortName:
            team.shortName ||
            team.name ||
            "",

          crest:
            team.crest ||
            "",

          playedGames:
            row.playedGames || 0,

          won:
            row.won || 0,

          draw:
            row.draw || 0,

          lost:
            row.lost || 0,

          goalsFor:
            row.goalsFor || 0,

          goalsAgainst:
            row.goalsAgainst || 0,

          goalDifference:
            row.goalDifference || 0,

          points:
            row.points || 0
        };
      }
    );

  } catch (error) {

    console.warn(
      "Tabelle nicht verfügbar:",
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
    "Dashboard wird aufgebaut..."
  );

  const [
    news,
    matches,
    table,
    squad
  ] =
    await Promise.all([
      getNews(),
      getMatches(),
      getTable(),
      buildSquad()
    ]);

  const now =
    Date.now();

  const upcoming =
    matches
      .filter(
        match =>
          match.rawDate &&
          new Date(
            match.rawDate
          ).getTime() >= now
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

  const finished =
    matches
      .filter(
        match =>
          match.status ===
          "FINISHED"
      )
      .sort(
        (a, b) =>
          new Date(
            b.rawDate
          ) -
          new Date(
            a.rawDate
          )
      );

  let nextGame =
    upcoming[0] ||
    fallbackNextGame();

  if (
    !nextGame ||
    !nextGame.home
  ) {
    nextGame =
      fallbackNextGame();
  }

  const bundesliga =
    matches.filter(
      match =>
        String(
          match.competition || ""
        )
          .toLowerCase()
          .includes(
            "bundesliga"
          )
    );

  const championsLeague =
    matches.filter(
      match =>
        String(
          match.competition || ""
        )
          .toLowerCase()
          .includes(
            "champions"
          )
    );

  /*
   * WICHTIG:
   * dashboard.squad bleibt ein ARRAY.
   * Das Frontend wurde so angepasst,
   * dass es sowohl Array als auch
   * gruppiertes Objekt versteht.
   */

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

    results:
      finished,

    table:
      table,

    squad:
      squad,

    live:
      [],

    attribution:
      "Data provided by football-data.org"
  };
}


/* =========================================================
   MATCHDETAILS
========================================================= */

function normalizeMinute(event) {

  const minute =
    event?.minute ??
    event?.time?.elapsed ??
    null;

  const extra =
    event?.injuryTime ??
    event?.time?.extra ??
    null;

  if (
    minute === null ||
    minute === undefined
  ) {
    return "";
  }

  return extra
    ? `${minute}+${extra}.`
    : `${minute}.`;
}


function mapLineup(team) {

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


function mapMatchDetails(match) {

  const home =
    match.homeTeam ||
    {};

  const away =
    match.awayTeam ||
    {};

  const goals =
    (
      match.goals ||
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
          normalizeMinute(
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
      match.bookings ||
      []
    ).map(
      booking => ({

        minute:
          booking.minute ??
          null,

        injuryTime:
          booking.injuryTime ??
          null,

        minuteLabel:
          normalizeMinute(
            booking
          ),

        teamId:
          booking.team?.id ??
          null,

        team:
          booking.team?.name ||
          "",

        playerId:
          booking.player?.id ??
          null,

        player:
          booking.player?.name ||
          "",

        card:
          booking.card ||
          ""
      })
    );

  const substitutions =
    (
      match.substitutions ||
      []
    ).map(
      substitution => ({

        minute:
          substitution.minute ??
          null,

        injuryTime:
          substitution.injuryTime ??
          null,

        minuteLabel:
          normalizeMinute(
            substitution
          ),

        teamId:
          substitution.team?.id ??
          null,

        team:
          substitution.team?.name ||
          "",

        playerInId:
          substitution.playerIn?.id ??
          null,

        playerIn:
          substitution.playerIn?.name ||
          "",

        playerOutId:
          substitution.playerOut?.id ??
          null,

        playerOut:
          substitution.playerOut?.name ||
          ""
      })
    );

  return {

    id:
      match.id ??
      null,

    utcDate:
      match.utcDate ||
      null,

    date:
      formatDate(
        match.utcDate
      ),

    status:
      match.status ||
      "",

    minute:
      match.minute ??
      null,

    injuryTime:
      match.injuryTime ??
      null,

    venue:
      match.venue ||
      "",

    attendance:
      match.attendance ??
      null,

    matchday:
      match.matchday ??
      null,

    stage:
      match.stage ||
      null,

    competition:
      match.competition?.name ||
      "",

    competitionCode:
      match.competition?.code ||
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
      match.score ||
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

    statistics: {

      home:
        home.statistics ||
        {},

      away:
        away.statistics ||
        {}
    },

    referees:
      match.referees ||
      []
  };
}


/* =========================================================
   BUNDESLIGA MATCHSTATISTIK
========================================================= */

function extractPair(
  text,
  regex
) {

  const match =
    text.match(
      regex
    );

  if (!match) {
    return null;
  }

  return [
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
  ];
}


async function getBundesligaMatchStats(
  details
) {

  try {

    if (
      !details ||
      details.competitionCode !==
        "BL1"
    ) {
      return null;
    }

    if (
      !details.matchday ||
      !details.homeTeam?.name ||
      !details.awayTeam?.name
    ) {
      return null;
    }

    const homeSlug =
      slugify(
        details.homeTeam.name
      );

    const awaySlug =
      slugify(
        details.awayTeam.name
      );

    const url =
      `${BUNDESLIGA_BASE}/2026-2027/${details.matchday}/${homeSlug}-vs-${awaySlug}/stats`;

    const html =
      await httpsRequest(
        url
      );

    const text =
      stripHtml(html);

    if (!text) {
      return null;
    }

    const result = {

      home: {},

      away: {},

      source:
        "Bundesliga.com / DFL"
    };

    let pair;


    pair =
      extractPair(
        text,
        /Ballbesitz\s*\(%\)\s*(\d+(?:[.,]\d+)?)\s*(\d+(?:[.,]\d+)?)/i
      );

    if (pair) {

      result.home.possession =
        pair[0];

      result.away.possession =
        pair[1];
    }


    pair =
      extractPair(
        text,
        /Ecken\s*(\d+)\s*(\d+)/i
      );

    if (pair) {

      result.home.cornerKicks =
        pair[0];

      result.away.cornerKicks =
        pair[1];
    }


    pair =
      extractPair(
        text,
        /Abseits\s*(\d+)\s*(\d+)/i
      );

    if (pair) {

      result.home.offsides =
        pair[0];

      result.away.offsides =
        pair[1];
    }


    pair =
      extractPair(
        text,
        /begangene Fouls\s*(\d+)\s*(\d+)/i
      );

    if (pair) {

      result.home.fouls =
        pair[0];

      result.away.fouls =
        pair[1];
    }


    pair =
      extractPair(
        text,
        /gewonnene Zweikämpfe\s*(\d+)\s*(\d+)/i
      );

    if (pair) {

      result.home.wonDuels =
        pair[0];

      result.away.wonDuels =
        pair[1];
    }


    const shots =
      text.match(
        /(\d+)\s+neben das Tor\s+(\d+)\s+auf das Tor\s+(\d+)\s+neben das Tor\s+(\d+)\s+auf das Tor/i
      );

    if (shots) {

      result.home.shotsOffGoal =
        Number(
          shots[1]
        );

      result.home.shotsOnGoal =
        Number(
          shots[2]
        );

      result.away.shotsOffGoal =
        Number(
          shots[3]
        );

      result.away.shotsOnGoal =
        Number(
          shots[4]
        );

      result.home.shots =
        result.home.shotsOffGoal +
        result.home.shotsOnGoal;

      result.away.shots =
        result.away.shotsOffGoal +
        result.away.shotsOnGoal;
    }


    const passes =
      text.match(
        /Pässe\s+(\d+)\s+(\d+)\s+(\d+(?:[.,]\d+)?)\s*%\s*Passquote\s+(\d+(?:[.,]\d+)?)\s*%/i
      );

    if (passes) {

      result.home.passes =
        Number(
          passes[1]
        );

      result.away.passes =
        Number(
          passes[2]
        );

      result.home.passAccuracy =
        Number(
          String(
            passes[3]
          ).replace(
            ",",
            "."
          )
        );

      result.away.passAccuracy =
        Number(
          String(
            passes[4]
          ).replace(
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

      result.home.xGoals =
        Number(
          String(
            xg[1]
          ).replace(
            ",",
            "."
          )
        );

      result.away.xGoals =
        Number(
          String(
            xg[2]
          ).replace(
            ",",
            "."
          )
        );
    }


    return result;

  } catch (error) {

    console.warn(
      "Bundesliga Matchstatistik nicht verfügbar:",
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
      matchId || ""
    ).trim();

  if (
    !/^\d+$/.test(id)
  ) {
    throw new Error(
      "Ungültige Spiel-ID"
    );
  }

  const cached =
    matchCache.get(
      id
    );

  if (
    cached &&
    Date.now() -
      cached.time <
      MATCH_CACHE_TIME
  ) {

    return cached.data;
  }

  const match =
    await apiRequest(
      `/matches/${id}`
    );

  const details =
    mapMatchDetails(
      match
    );

  const extraStats =
    await getBundesligaMatchStats(
      details
    );

  if (extraStats) {

    details.statistics = {

      ...details.statistics,

      home: {

        ...details.statistics.home,

        ...extraStats.home
      },

      away: {

        ...details.statistics.away,

        ...extraStats.away
      },

      source:
        extraStats.source
    };
  }

  matchCache.set(
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


/* =========================================================
   DASHBOARD CACHE
========================================================= */

async function getDashboard() {

  if (
    dashboardCache.data &&
    Date.now() -
      dashboardCache.time <
      CACHE_TIME
  ) {

    return dashboardCache.data;
  }

  try {

    const data =
      await buildDashboard();

    dashboardCache = {

      data,

      time:
        Date.now()
    };

    return data;

  } catch (error) {

    console.error(
      "Dashboard ERROR:",
      error
    );

    /*
     * WICHTIG:
     * Auch bei API-Fehler wird ein
     * brauchbares Dashboard zurückgegeben.
     * Dadurch bleibt die Seite nicht
     * dauerhaft auf "Laden".
     */

    const fallbackSquad =
      CURRENT_SQUAD.map(
        player => ({

          ...player,

          appearances:
            0,

          goals:
            0,

          assists:
            0,

          minutes:
            0,

          photo:
            OFFICIAL_PHOTOS[
              player.name
            ] || ""
        })
      );

    return {

      updatedAt:
        new Date().toISOString(),

      news:
        [],

      nextGame:
        fallbackNextGame(),

      fixtures:
        [],

      results:
        [],

      championsLeague:
        [],

      table:
        [],

      squad:
        fallbackSquad,

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
   JSON
========================================================= */

function sendJSON(
  res,
  data,
  statusCode = 200
) {

  const body =
    JSON.stringify(
      data
    );

  res.writeHead(
    statusCode,
    {
      "Content-Type":
        "application/json; charset=utf-8",

      "Cache-Control":
        "no-store",

      "Access-Control-Allow-Origin":
        "*",

      "Access-Control-Allow-Methods":
        "GET, OPTIONS",

      "Access-Control-Allow-Headers":
        "Content-Type"
    }
  );

  res.end(
    body
  );
}


/* =========================================================
   DATEIEN
========================================================= */

function getMimeType(
  filePath
) {

  const ext =
    path.extname(
      filePath
    ).toLowerCase();

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
      "image/x-icon",

    ".txt":
      "text/plain; charset=utf-8"
  };

  return (
    types[ext] ||
    "application/octet-stream"
  );
}


function serveFile(
  res,
  requestedPath
) {

  const clean =
    requestedPath
      .replace(
        /^\/+/,
        ""
      );

  if (
    clean.includes("..")
  ) {

    res.writeHead(
      403
    );

    res.end(
      "Forbidden"
    );

    return;
  }

  const filePath =
    path.join(
      __dirname,
      clean
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

  const stat =
    fs.statSync(
      filePath
    );

  if (
    !stat.isFile()
  ) {

    res.writeHead(
      404
    );

    res.end(
      "Nicht gefunden"
    );

    return;
  }

  res.writeHead(
    200,
    {
      "Content-Type":
        getMimeType(
          filePath
        ),

      "Cache-Control":
        "public, max-age=300"
    }
  );

  fs.createReadStream(
    filePath
  ).pipe(
    res
  );
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

        if (
          req.method ===
          "OPTIONS"
        ) {

          res.writeHead(
            204,
            {
              "Access-Control-Allow-Origin":
                "*",

              "Access-Control-Allow-Methods":
                "GET, OPTIONS",

              "Access-Control-Allow-Headers":
                "Content-Type"
            }
          );

          res.end();

          return;
        }

        const requestUrl =
          new URL(
            req.url,
            `http://${req.headers.host || "localhost"}`
          );

        const pathname =
          requestUrl.pathname;


        /* =========================================
           HEALTH
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
                Boolean(
                  TOKEN
                ),

              rssConfigured:
                Boolean(
                  VFB_RSS_URL
                ),

              indexExists:
                fs.existsSync(
                  path.join(
                    __dirname,
                    "index.html"
                  )
                ),

              serverTime:
                new Date().toISOString()
            }
          );

          return;
        }


        /* =========================================
           DASHBOARD
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
           MATCHDETAILS
        ========================================= */

        const matchPath =
          pathname.match(
            /^\/api\/match\/(\d+)$/
          );

        if (matchPath) {

          const details =
            await getMatchDetails(
              matchPath[1]
            );

          sendJSON(
            res,
            {
              success:
                true,

              match:
                details,

              attribution:
                "Data provided by football-data.org"
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
           STATISCHE DATEIEN
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

            const filePath =
              path.join(
                __dirname,
                safePath
              );

            if (
              fs.existsSync(
                filePath
              ) &&
              fs.statSync(
                filePath
              ).isFile()
            ) {

              serveFile(
                res,
                safePath
              );

              return;
            }
          }

          /*
           * SPA-Fallback
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

        sendJSON(
          res,
          {
            error:
              "Nicht gefunden"
          },
          404
        );

      } catch (error) {

        console.error(
          "SERVER ERROR:",
          error
        );

        sendJSON(
          res,
          {
            error:
              error.message ||
              "Interner Serverfehler"
          },
          500
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
      "========================================"
    );

    console.log(
      "  CANNSTATT 1893 NEWS"
    );

    console.log(
      "========================================"
    );

    console.log(
      `Port: ${PORT}`
    );

    console.log(
      "Football-Data Token:",
      TOKEN
        ? "vorhanden"
        : "FEHLT"
    );

    console.log(
      "VfB RSS:",
      VFB_RSS_URL
    );

    console.log(
      "Index:",
      fs.existsSync(
        path.join(
          __dirname,
          "index.html"
        )
      )
        ? "vorhanden"
        : "FEHLT"
    );

    console.log(
      "========================================"
    );
  }
);
