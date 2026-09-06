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
 * KICKER RSS
 */
const KICKER_RSS_URL =
  "https://www.kicker.de/news/fussball/bundesliga/startseite.rss";

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
            : "",

        source:
          "VFB NEWS"

      });

    }

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

    return items.slice(0, 10);

  } catch (error) {

    console.error(
      "VfB RSS FEED FEHLER:",
      error.message
    );

    return [];

  }

}


/* =========================================================
   KICKER NEWS
========================================================= */

async function fetchKickerNews() {

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
      "pejcinovic",
      "leweling",
      "el khannouss",
      "prömel",
      "promel",
      "jeltsch",
      "chabot",
      "sauer"
    ];

    const out = [];

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
        normalizeVfbUrl(
          getXmlValue(
            item,
            "link"
          )
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
        `${title} ${description}`.toLowerCase();

      if (
        !title ||
        !link ||
        !keywords.some(
          k => haystack.includes(k)
        )
      ) {
        continue;
      }

      if (
        out.some(
          x => x.url === link
        )
      ) {
        continue;
      }

      out.push({

        title,

        url:
          link,

        link:
          link,

        description,

        pubDate,

        date:
          pubDate
            ? formatDate(pubDate)
            : "",

        source:
          "KICKER"

      });

    }

    out.sort(
      (a, b) =>
        new Date(
          b.pubDate || 0
        ) -
        new Date(
          a.pubDate || 0
        )
    );

    return out.slice(
      0,
      8
    );

  } catch (error) {

    console.error(
      "KICKER RSS FEHLER:",
      error.message
    );

    return [];

  }

}


/* =========================================================
   NEWS ZUSAMMENFÜHREN
========================================================= */

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

    merged.sort(
      (a, b) =>
        new Date(
          b.pubDate || 0
        ) -
        new Date(
          a.pubDate || 0
        )
    );

    return merged.slice(
      0,
      12
    );

  } catch (error) {

    console.error(
      "NEWS ERROR:",
      error.message
    );

    return [];

  }

}


/* =========================================================
   VFB KADER + SAISONSTATISTIKEN
========================================================= */

const VFB_SQUAD_FALLBACK = [

  ["Tor","Fabian Bredlow"],
  ["Tor","Marius Funk"],
  ["Tor","Dennis Seimen"],
  ["Tor","Stefan Drljaca"],

  ["Abwehr","Ameen Al-Dakhil"],
  ["Abwehr","Ramon Hendriks"],
  ["Abwehr","Josha Vagnoman"],
  ["Abwehr","Maximilian Mittelstädt"],
  ["Abwehr","Luca Jaquez"],
  ["Abwehr","Leonidas Stergiou"],
  ["Abwehr","Lorenz Assignon"],
  ["Abwehr","Dan-Axel Zagadou"],
  ["Abwehr","Jeff Chabot"],
  ["Abwehr","Finn Jeltsch"],

  ["Mittelfeld","Angelo Stiller"],
  ["Mittelfeld","Chris Führich"],
  ["Mittelfeld","Bilal El Khannouss"],
  ["Mittelfeld","Atakan Karazor"],
  ["Mittelfeld","Grischa Prömel"],
  ["Mittelfeld","Nikolas Nartey"],
  ["Mittelfeld","Ertugrul Yigit"],
  ["Mittelfeld","Jarzinho Malanga"],

  ["Sturm","Tiago Tomás"],
  ["Sturm","Ermedin Demirovic"],
  ["Sturm","Dzenan Pejcinovic"],
  ["Sturm","Jamie Leweling"],
  ["Sturm","Jeremy Arevalo"],
  ["Sturm","Deniz Undav"],
  ["Sturm","Justin Diehl"],
  ["Sturm","Leo Sauer"]

];


async function getVfbSquad() {

  try {

    const team =
      await apiRequest(
        `/teams/${VFB_TEAM_ID}`
      );

    const squad =
      Array.isArray(team.squad)
        ? team.squad
        : [];

    const base =
      squad.length
        ? squad
        : VFB_SQUAD_FALLBACK.map(
            ([position,name]) =>
              ({
                name,
                position
              })
          );

    return base.map(
      p => ({

        id:
          p.id ?? null,

        name:
          p.name || "",

        position:
          p.position || "",

        number:
          p.shirtNumber ?? null,

        photo:
          p.photo ||
          p.image ||
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

  } catch (e) {

    return VFB_SQUAD_FALLBACK.map(
      ([position,name]) =>
        ({

          name,

          position,

          number:
            null,

          photo:
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

  }

}


/* =========================================================
   KADERSTATISTIKEN
========================================================= */

async function getVfbSquadStats(
  matches,
  squad
) {

  const byId =
    new Map(
      squad
        .filter(
          p => p.id != null
        )
        .map(
          p => [
            String(p.id),
            p
          ]
        )
    );

  const byName =
    new Map(
      squad.map(
        p => [
          String(
            p.name
          ).toLowerCase(),
          p
        ]
      )
    );

  const finished =
    matches.filter(
      m =>
        [
          "FINISHED",
          "AWARDED"
        ].includes(
          String(
            m.status || ""
          ).toUpperCase()
        ) &&
        m.id
    );

  await Promise.all(
    finished.map(
      async m => {

        try {

          const d =
            await getMatchDetails(
              m.id
            );

          for (
            const side of [
              d.lineups?.home,
              d.lineups?.away
            ]
          ) {

            for (
              const p of [
                ...(side?.lineup || []),
                ...(side?.bench || [])
              ]
            ) {

              const player =
                (
                  p.id != null &&
                  byId.get(
                    String(p.id)
                  )
                ) ||
                byName.get(
                  String(
                    p.name || ""
                  ).toLowerCase()
                );

              if (
                player &&
                (side.lineup || []).some(
                  x =>
                    String(
                      x.id ?? x.name
                    ) ===
                    String(
                      p.id ?? p.name
                    )
                )
              ) {

                player.appearances += 1;

              }

            }

          }

          for (
            const g of
            d.goals || []
          ) {

            let p =
              g.scorerId != null
                ? byId.get(
                    String(
                      g.scorerId
                    )
                  )
                : byName.get(
                    String(
                      g.scorer || ""
                    ).toLowerCase()
                  );

            if (p) {
              p.goals += 1;
            }

            p =
              g.assistId != null
                ? byId.get(
                    String(
                      g.assistId
                    )
                  )
                : byName.get(
                    String(
                      g.assist || ""
                    ).toLowerCase()
                  );

            if (p) {
              p.assists += 1;
            }

          }

          for (
            const sub of
            d.substitutions || []
          ) {

            const pIn =
              sub.playerInId != null
                ? byId.get(
                    String(
                      sub.playerInId
                    )
                  )
                : byName.get(
                    String(
                      sub.playerIn || ""
                    ).toLowerCase()
                  );

            if (pIn) {
              pIn.appearances += 1;
            }

          }

        } catch (e) {

          console.warn(
            "Kaderstatistik Spiel",
            m.id,
            e.message
          );

        }

      }
    )
  );

  return squad;

}


/* =========================================================
   MATCHCENTER
========================================================= */

const MATCH_DETAIL_CACHE_TIME =
  2 * 60 * 1000;

const matchDetailCache =
  new Map();


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


function mapMatchDetails(
  match
) {

  const home =
    match?.homeTeam || {};

  const away =
    match?.awayTeam || {};

  const goals =
    (match?.goals || [])
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
    (match?.bookings || [])
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
    (match?.substitutions || [])
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

  function mapLineup(team) {

    return {

      formation:
        team?.formation ||
        null,

      coach:
        team?.coach?.name ||
        null,

      lineup:
        (team?.lineup || [])
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
        (team?.bench || [])
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
        mapLineup(home),

      away:
        mapLineup(away)

    },

    statistics:
      stats,

    referees:
      match?.referees ||
      []

  };

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

    news,

    nextGame,

    fixtures:
      bundesliga,

    championsLeague,

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


/* =========================================================
   MATCHCENTER / SPIELDETAILS
========================================================= */

const MATCH_DETAIL_CACHE_TIME =
  2 * 60 * 1000;

const matchDetailCache =
  new Map();


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


function mapMatchDetails(
  match
) {

  const home =
    match?.homeTeam || {};

  const away =
    match?.awayTeam || {};


  /* =========================
     TORE
  ========================= */

  const goals =
    (match?.goals || [])
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


  /* =========================
     KARTEN
  ========================= */

  const bookings =
    (match?.bookings || [])
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


  /* =========================
     WECHSEL
  ========================= */

  const substitutions =
    (match?.substitutions || [])
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


  /* =========================
     AUFSTELLUNG
  ========================= */

  function mapLineup(team) {

    return {

      formation:
        team?.formation ||
        null,

      coach:
        team?.coach?.name ||
        null,

      lineup:
        (team?.lineup || [])
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
        (team?.bench || [])
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


  /* =========================
     STATISTIKEN
  ========================= */

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
        mapLineup(home),

      away:
        mapLineup(away)

    },


    statistics:
      stats,

    referees:
      match?.referees ||
      []

  };

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
           MATCHCENTER API
        ========================================= */

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

              kickerConfigured:
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


          /* =====================================
             FALLBACK AUF INDEX.HTML
          ===================================== */

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
      "Kicker RSS Feed:",
      KICKER_RSS_URL
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
