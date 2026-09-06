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
 * OFFIZIELLER KICKER RSS FEED
 */
const KICKER_RSS_URL =
  "https://newsfeed.kicker.de/news/bundesliga";

/*
 * CACHE
 *
 * Das Dashboard wird maximal 10 Minuten
 * aus dem Cache geliefert.
 */
const CACHE_TIME =
  10 * 60 * 1000;

const MATCH_DETAIL_CACHE_TIME =
  2 * 60 * 1000;

let cache = {
  data: null,
  time: 0
};

const matchDetailCache =
  new Map();

/*
 * =========================================
 * HTTPS REQUEST
 * =========================================
 */

function httpsRequest(url, options = {}) {

  return new Promise((resolve, reject) => {

    const request =
      https.get(
        url,
        {
          timeout: 15000,
          headers: {
            "User-Agent":
              "Cannstatt1893News/1.0",
            ...(options.headers || {})
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

              if (
                response.statusCode >= 200 &&
                response.statusCode < 300
              ) {

                resolve(body);

              } else {

                reject(
                  new Error(
                    `HTTP ${response.statusCode} bei ${url}`
                  )
                );

              }

            }
          );

        }
      );

    request.on(
      "error",
      reject
    );

    request.on(
      "timeout",
      () => {
        request.destroy(
          new Error(
            `Timeout bei ${url}`
          )
        );
      }
    );

  });

}


/*
 * =========================================
 * FOOTBALL DATA API
 * =========================================
 */

async function apiRequest(endpoint) {

  if (!TOKEN) {

    throw new Error(
      "FOOTBALL_DATA_TOKEN fehlt."
    );

  }

  const url =
    `https://api.football-data.org/v4${endpoint}`;

  const body =
    await httpsRequest(
      url,
      {
        headers: {
          "X-Auth-Token":
            TOKEN
        }
      }
    );

  try {

    return JSON.parse(body);

  } catch (error) {

    throw new Error(
      "Ungültige JSON-Antwort von football-data.org."
    );

  }

}


/*
 * =========================================
 * HTML ENTITY / TEXT
 * =========================================
 */

function decodeHTML(text = "") {

  return String(text)

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


function normalizeUrl(
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


function formatDate(
  value
) {

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

  return date.toLocaleString(
    "de-DE",
    {
      timeZone:
        "Europe/Berlin",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    }
  );

}


/*
 * =========================================
 * RSS ITEM PARSER
 * =========================================
 */

function parseRssItems(
  xml
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

    if (!link) {

      link =
        getXmlValue(
          item,
          "guid"
        );

    }

    link =
      normalizeUrl(link);

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

    /*
     * Bild aus media:content,
     * enclosure oder media:thumbnail
     */
    let image = "";

    const mediaContent =
      item.match(
        /<media:content[^>]+url=["']([^"']+)["']/i
      );

    const mediaThumbnail =
      item.match(
        /<media:thumbnail[^>]+url=["']([^"']+)["']/i
      );

    const enclosure =
      item.match(
        /<enclosure[^>]+url=["']([^"']+)["']/i
      );

    if (mediaContent) {
      image =
        normalizeUrl(
          mediaContent[1]
        );
    } else if (
      mediaThumbnail
    ) {
      image =
        normalizeUrl(
          mediaThumbnail[1]
        );
    } else if (
      enclosure
    ) {
      image =
        normalizeUrl(
          enclosure[1]
        );
    }

    if (
      !title ||
      title.length < 5 ||
      !link
    ) {
      continue;
    }

    items.push({

      title,

      url: link,

      link,

      description,

      pubDate,

      date:
        pubDate
          ? formatDate(
              pubDate
            )
          : "",

      image

    });

  }

  return items;

}


/*
 * =========================================
 * VFB NEWS
 * =========================================
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

    const items =
      parseRssItems(xml);

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

    const result =
      items

        .filter(item => {

          return !blocked.some(
            blockedTitle =>
              item.title
                .toLowerCase() ===
              blockedTitle
                .toLowerCase()
          );

        })

        .sort(
          (a, b) => {

            const dateA =
              a.pubDate
                ? new Date(
                    a.pubDate
                  ).getTime()
                : 0;

            const dateB =
              b.pubDate
                ? new Date(
                    b.pubDate
                  ).getTime()
                : 0;

            return dateB - dateA;

          }
        )

        .slice(0, 10)

        .map(item => ({

          ...item,

          source:
            "VfB Stuttgart"

        }));

    console.log(
      "VfB-News gefunden:",
      result.length
    );

    return result;

  } catch (error) {

    console.error(
      "VFB RSS FEHLER:",
      error.message
    );

    return [];

  }

}


/*
 * =========================================
 * KICKER NEWS
 * =========================================
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

    const items =
      parseRssItems(xml);

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
      "fuhrich",
      "el khannouss",
      "karazor",
      "mittelstädt",
      "mittelstaedt",
      "jelltsch",
      "jeltsch",
      "vagnoman"

    ];

    const result =
      items

        .filter(item => {

          const text =
            (
              item.title +
              " " +
              item.description
            )
              .toLowerCase();

          return keywords.some(
            keyword =>
              text.includes(
                keyword
              )
          );

        })

        .sort(
          (a, b) => {

            const dateA =
              a.pubDate
                ? new Date(
                    a.pubDate
                  ).getTime()
                : 0;

            const dateB =
              b.pubDate
                ? new Date(
                    b.pubDate
                  ).getTime()
                : 0;

            return dateB - dateA;

          }
        )

        .slice(0, 10)

        .map(item => ({

          ...item,

          source:
            "Kicker"

        }));

    console.log(
      "Kicker-VfB-News gefunden:",
      result.length
    );

    return result;

  } catch (error) {

    console.error(
      "KICKER RSS FEHLER:",
      error.message
    );

    return [];

  }

}


/*
 * =========================================
 * NEWS ZUSAMMENFÜHREN
 * =========================================
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

  const combined = [
    ...vfbNews,
    ...kickerNews
  ];

  const unique = [];

  for (
    const item of combined
  ) {

    if (
      !item.url
    ) {
      continue;
    }

    const exists =
      unique.some(
        existing =>
          existing.url ===
          item.url
      );

    if (!exists) {

      unique.push(item);

    }

  }

  unique.sort(
    (a, b) => {

      const dateA =
        a.pubDate
          ? new Date(
              a.pubDate
            ).getTime()
          : 0;

      const dateB =
        b.pubDate
          ? new Date(
              b.pubDate
            ).getTime()
          : 0;

      return dateB - dateA;

    }
  );

  return unique.slice(
    0,
    16
  );

}


/*
 * =========================================
 * MATCH MAPPING
 * =========================================
 */

function mapMatch(
  match
) {

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
 * =========================================
 * VFB SPIELE
 * =========================================
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

      .map(
        mapMatch
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

  console.log(
    "VfB-Spiele gefunden:",
    matches.length
  );

  return matches;

}


/*
 * =========================================
 * BUNDESLIGA TABELLE
 * =========================================
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
        item.type ===
        "TOTAL"
    );

  if (!total) {
    return [];
  }

  return (
    total.table || []
  ).map(
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

}


/*
 * =========================================
 * SPIELDETAILS
 * =========================================
 */

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
          match?.homeTeam
        ),

      away:
        mapLineup(
          match?.awayTeam
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
      (
        match?.referees ||
        []
      ).map(
        referee => ({

          id:
            referee.id ??
            null,

          name:
            referee.name ||
            "",

          nationality:
            referee.nationality ||
            ""

        })
      )

  };

}
/*
 * =========================================
 * KADER
 * =========================================
 *
 * football-data.org liefert den Profikader,
 * aber keine zuverlässigen Spielerfotos.
 *
 * Deshalb verwenden wir feste Kicker/VfB-
 * Bildquellen als Fallback.
 */

const VFB_SQUAD = [

  {
    id: 1,
    name: "Fabian Bredlow",
    position: "Torwart",
    number: 1,
    photo:
      "https://www.vfb.de/fileadmin/_processed_/c/1/csm_Bredlow_Fabian_01_2026_27_01_8e4f6b0f5a.jpg"
  },

  {
    id: 33,
    name: "Marius Funk",
    position: "Torwart",
    number: 33,
    photo: ""
  },

  {
    id: 41,
    name: "Dennis Seimen",
    position: "Torwart",
    number: 41,
    photo:
      "https://img.a.transfermarkt.technology/portrait/big/627756-1697046337.jpg"
  },

  {
    id: 46,
    name: "Stefan Drljaca",
    position: "Torwart",
    number: 46,
    photo: ""
  },

  {
    id: 2,
    name: "Ameen Al-Dakhil",
    position: "Abwehr",
    number: 2,
    photo:
      "https://img.a.transfermarkt.technology/portrait/big/553677-1718714480.jpg"
  },

  {
    id: 3,
    name: "Ramon Hendriks",
    position: "Abwehr",
    number: 3,
    photo:
      "https://img.a.transfermarkt.technology/portrait/big/633191-1697046326.jpg"
  },

  {
    id: 4,
    name: "Josha Vagnoman",
    position: "Abwehr",
    number: 4,
    photo:
      "https://img.a.transfermarkt.technology/portrait/big/557565-1697046314.jpg"
  },

  {
    id: 7,
    name: "Maximilian Mittelstädt",
    position: "Abwehr",
    number: 7,
    photo:
      "https://img.a.transfermarkt.technology/portrait/big/296779-1718714420.jpg"
  },

  {
    id: 14,
    name: "Luca Jaquez",
    position: "Abwehr",
    number: 14,
    photo:
      "https://img.a.transfermarkt.technology/portrait/big/1088233-1707219201.jpg"
  },

  {
    id: 20,
    name: "Leonidas Stergiou",
    position: "Abwehr",
    number: 20,
    photo:
      "https://img.a.transfermarkt.technology/portrait/big/659488-1697046373.jpg"
  },

  {
    id: 22,
    name: "Lorenz Assignon",
    position: "Abwehr",
    number: 22,
    photo:
      "https://img.a.transfermarkt.technology/portrait/big/661719-1697046388.jpg"
  },

  {
    id: 23,
    name: "Dan-Axel Zagadou",
    position: "Abwehr",
    number: 23,
    photo:
      "https://img.a.transfermarkt.technology/portrait/big/344598-1697046404.jpg"
  },

  {
    id: 24,
    name: "Jeff Chabot",
    position: "Abwehr",
    number: 24,
    photo:
      "https://img.a.transfermarkt.technology/portrait/big/287767-1697046418.jpg"
  },

  {
    id: 29,
    name: "Finn Jeltsch",
    position: "Abwehr",
    number: 29,
    photo:
      "https://img.a.transfermarkt.technology/portrait/big/1015711-1718714547.jpg"
  },

  {
    id: 6,
    name: "Angelo Stiller",
    position: "Mittelfeld",
    number: 6,
    photo:
      "https://img.a.transfermarkt.technology/portrait/big/437560-1697046445.jpg"
  },

  {
    id: 10,
    name: "Chris Führich",
    position: "Mittelfeld",
    number: 10,
    photo:
      "https://img.a.transfermarkt.technology/portrait/big/283059-1697046460.jpg"
  },

  {
    id: 11,
    name: "Bilal El Khannouss",
    position: "Mittelfeld",
    number: 11,
    photo:
      "https://img.a.transfermarkt.technology/portrait/big/661675-1697046482.jpg"
  },

  {
    id: 16,
    name: "Atakan Karazor",
    position: "Mittelfeld",
    number: 16,
    photo:
      "https://img.a.transfermarkt.technology/portrait/big/327672-1697046498.jpg"
  },

  {
    id: 21,
    name: "Grischa Prömel",
    position: "Mittelfeld",
    number: 21,
    photo:
      "https://img.a.transfermarkt.technology/portrait/big/296438-1697046517.jpg"
  },

  {
    id: 28,
    name: "Nikolas Nartey",
    position: "Mittelfeld",
    number: 28,
    photo:
      "https://img.a.transfermarkt.technology/portrait/big/434206-1697046534.jpg"
  },

  {
    id: 39,
    name: "Ertugrul Yigit",
    position: "Mittelfeld",
    number: 39,
    photo: ""
  },

  {
    id: 43,
    name: "Jarzinho Malanga",
    position: "Mittelfeld",
    number: 43,
    photo: ""
  },

  {
    id: 8,
    name: "Tiago Tomás",
    position: "Angriff",
    number: 8,
    photo:
      "https://img.a.transfermarkt.technology/portrait/big/513918-1697046560.jpg"
  },

  {
    id: 9,
    name: "Ermedin Demirović",
    position: "Angriff",
    number: 9,
    photo:
      "https://img.a.transfermarkt.technology/portrait/big/315344-1697046577.jpg"
  },

  {
    id: 17,
    name: "Dzenan Pejcinovic",
    position: "Angriff",
    number: 17,
    photo:
      "https://img.a.transfermarkt.technology/portrait/big/859219-1697046594.jpg"
  },

  {
    id: 18,
    name: "Jamie Leweling",
    position: "Angriff",
    number: 18,
    photo:
      "https://img.a.transfermarkt.technology/portrait/big/555000-1697046612.jpg"
  },

  {
    id: 25,
    name: "Jeremy Arevalo",
    position: "Angriff",
    number: 25,
    photo: ""
  },

  {
    id: 26,
    name: "Deniz Undav",
    position: "Angriff",
    number: 26,
    photo:
      "https://img.a.transfermarkt.technology/portrait/big/378652-1697046634.jpg"
  },

  {
    id: 31,
    name: "Justin Diehl",
    position: "Angriff",
    number: 31,
    photo:
      "https://img.a.transfermarkt.technology/portrait/big/872470-1697046651.jpg"
  },

  {
    id: 44,
    name: "Leo Sauer",
    position: "Angriff",
    number: 44,
    photo:
      "https://img.a.transfermarkt.technology/portrait/big/781847-1697046671.jpg"
  }

];


/*
 * =========================================
 * KADERSTATISTIKEN
 * =========================================
 */

async function getVfbSquadStats(
  matches
) {

  const players =
    VFB_SQUAD.map(
      player => ({

        ...player,

        appearances: 0,
        starts: 0,
        goals: 0,
        assists: 0,
        minutes: 0

      })
    );

  const playerMap =
    new Map();

  players.forEach(
    player => {

      playerMap.set(
        player.name
          .toLowerCase()
          .replace(
            /[^a-z0-9äöüß ]/gi,
            ""
          ),
        player
      );

    }
  );

  /*
   * Nur bereits beendete Spiele.
   *
   * Dadurch vermeiden wir unnötig viele
   * API-Anfragen.
   */
  const finishedMatches =
    matches
      .filter(
        match =>
          [
            "FINISHED",
            "AWARDED",
            "IN_PLAY",
            "PAUSED"
          ].includes(
            match.status
          )
      )
      .slice(-10);

  for (
    const match of finishedMatches
  ) {

    try {

      const raw =
        await apiRequest(
          `/matches/${match.id}`
        );

      const detail =
        mapMatchDetails(raw);

      const allLineups = [

        ...(detail.lineups?.home?.lineup || []),
        ...(detail.lineups?.home?.bench || []),
        ...(detail.lineups?.away?.lineup || []),
        ...(detail.lineups?.away?.bench || [])

      ];

      for (
        const lineupPlayer
        of allLineups
      ) {

        if (
          !lineupPlayer.name
        ) {
          continue;
        }

        const normalized =
          lineupPlayer.name
            .toLowerCase()
            .replace(
              /[^a-z0-9äöüß ]/gi,
              ""
            );

        let found =
          playerMap.get(
            normalized
          );

        if (!found) {

          found =
            players.find(
              player =>
                normalized.includes(
                  player.name
                    .toLowerCase()
                    .replace(
                      /[^a-z0-9äöüß ]/gi,
                      ""
                    )
                ) ||
                player.name
                  .toLowerCase()
                  .replace(
                    /[^a-z0-9äöüß ]/gi,
                    ""
                  )
                  .includes(
                    normalized
                  )
            );

        }

        if (
          !found
        ) {
          continue;
        }

        const isStarter =
          (
            detail.lineups?.home?.lineup ||
            []
          ).some(
            p =>
              p.id ===
              lineupPlayer.id
          ) ||
          (
            detail.lineups?.away?.lineup ||
            []
          ).some(
            p =>
              p.id ===
              lineupPlayer.id
          );

        if (
          isStarter
        ) {

          found.appearances++;
          found.starts++;

        }

      }

      /*
       * Tore und Assists
       */
      for (
        const goal
        of detail.goals || []
      ) {

        if (
          goal.scorer
        ) {

          const scorer =
            players.find(
              player =>
                player.name
                  .toLowerCase()
                  .includes(
                    goal.scorer
                      .toLowerCase()
                  ) ||
                goal.scorer
                  .toLowerCase()
                  .includes(
                    player.name
                      .toLowerCase()
                  )
            );

          if (
            scorer
          ) {
            scorer.goals++;
          }

        }

        if (
          goal.assist
        ) {

          const assist =
            players.find(
              player =>
                player.name
                  .toLowerCase()
                  .includes(
                    goal.assist
                      .toLowerCase()
                  ) ||
                goal.assist
                  .toLowerCase()
                  .includes(
                    player.name
                      .toLowerCase()
                  )
            );

          if (
            assist
          ) {
            assist.assists++;
          }

        }

      }

      /*
       * Einwechselungen zählen als Einsatz.
       */
      for (
        const substitution
        of detail.substitutions ||
        []
      ) {

        if (
          !substitution.playerIn
        ) {
          continue;
        }

        const player =
          players.find(
            p =>
              p.name
                .toLowerCase()
                .includes(
                  substitution.playerIn
                    .toLowerCase()
                ) ||
              substitution.playerIn
                .toLowerCase()
                .includes(
                  p.name
                    .toLowerCase()
                )
          );

        if (
          player
        ) {

          player.appearances++;

        }

      }

    } catch (error) {

      console.error(
        `Statistik Match ${match.id}:`,
        error.message
      );

    }

  }

  return {

    goalkeepers:
      players.filter(
        p =>
          p.position ===
          "Torwart"
      ),

    defenders:
      players.filter(
        p =>
          p.position ===
          "Abwehr"
      ),

    midfielders:
      players.filter(
        p =>
          p.position ===
          "Mittelfeld"
      ),

    attackers:
      players.filter(
        p =>
          p.position ===
          "Angriff"
      )

  };

}


/*
 * =========================================
 * DASHBOARD
 * =========================================
 */

async function buildDashboard() {

  console.log(
    "======================================"
  );

  console.log(
    "Baue Cannstatt 1893 News Dashboard..."
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

  let squad = null;

  try {

    squad =
      await getVfbSquadStats(
        matches
      );

  } catch (error) {

    console.error(
      "Kaderstatistik Fehler:",
      error.message
    );

    squad = {

      goalkeepers:
        VFB_SQUAD.filter(
          p =>
            p.position ===
            "Torwart"
        ),

      defenders:
        VFB_SQUAD.filter(
          p =>
            p.position ===
            "Abwehr"
        ),

      midfielders:
        VFB_SQUAD.filter(
          p =>
            p.position ===
            "Mittelfeld"
        ),

      attackers:
        VFB_SQUAD.filter(
          p =>
            p.position ===
            "Angriff"
        )

    };

  }

  return {

    updatedAt:
      new Date().toISOString(),

    news,

    nextGame,

    fixtures:
      bundesliga,

    championsLeague,

    table,

    squad,

    live: [],

    attribution:
      "Data provided by football-data.org"

  };

}


/*
 * =========================================
 * DASHBOARD CACHE
 * =========================================
 */

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

    /*
     * Nicht einfach leere Seite ausgeben.
     */
    return {

      updatedAt:
        new Date().toISOString(),

      news: [],

      nextGame: null,

      fixtures: [],

      championsLeague: [],

      table: [],

      squad: {

        goalkeepers: [],
        defenders: [],
        midfielders: [],
        attackers: []

      },

      live: [],

      error:
        error.message,

      attribution:
        "Data provided by football-data.org"

    };

  }

}


/*
 * =========================================
 * MATCH DETAIL CACHE
 * =========================================
 */

async function getMatchDetails(
  id
) {

  const numericId =
    Number(id);

  if (
    !Number.isFinite(
      numericId
    )
  ) {

    throw new Error(
      "Ungültige Match-ID."
    );

  }

  const cached =
    matchDetailCache.get(
      numericId
    );

  if (
    cached &&
    Date.now() -
      cached.time <
      MATCH_DETAIL_CACHE_TIME
  ) {

    return cached.data;

  }

  const raw =
    await apiRequest(
      `/matches/${numericId}`
    );

  const data =
    mapMatchDetails(
      raw
    );

  matchDetailCache.set(
    numericId,
    {
      data,
      time:
        Date.now()
    }
  );

  return data;

}


/*
 * =========================================
 * HTTP SERVER
 * =========================================
 */

const server =
  http.createServer(
    async (
      req,
      res
    ) => {

      try {

        const url =
          new URL(
            req.url,
            `http://${req.headers.host}`
          );

        /*
         * HEALTH
         */
        if (
          url.pathname ===
          "/health"
        ) {

          res.writeHead(
            200,
            {
              "Content-Type":
                "application/json; charset=utf-8"
            }
          );

          res.end(
            JSON.stringify(
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

                kickerConfigured:
                  Boolean(
                    KICKER_RSS_URL
                  ),

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
            )
          );

          return;

        }


        /*
         * DASHBOARD
         */
        if (
          url.pathname ===
          "/api/dashboard"
        ) {

          const dashboard =
            await getDashboard();

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
              dashboard
            )
          );

          return;

        }


        /*
         * MATCH DETAIL
         */
        const matchRoute =
          url.pathname.match(
            /^\/api\/match\/(\d+)$/
          );

        if (
          matchRoute
        ) {

          const id =
            matchRoute[1];

          const data =
            await getMatchDetails(
              id
            );

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
              {

                success:
                  true,

                match:
                  data,

                attribution:
                  "Data provided by football-data.org"

              }
            )
          );

          return;

        }


        /*
         * STATISCHE DATEIEN
         */
        let filePath =
          url.pathname;

        if (
          filePath ===
          "/"
        ) {

          filePath =
            "/index.html";

        }

        const safePath =
          path.normalize(
            filePath
          );

        const absolutePath =
          path.join(
            __dirname,
            safePath
          );

        if (
          !absolutePath.startsWith(
            __dirname
          )
        ) {

          res.writeHead(
            403
          );

          res.end(
            "Forbidden"
          );

          return;

        }

        if (
          fs.existsSync(
            absolutePath
          ) &&
          fs.statSync(
            absolutePath
          ).isFile()
        ) {

          const ext =
            path.extname(
              absolutePath
            ).toLowerCase();

          const contentTypes = {

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

            ".webp":
              "image/webp",

            ".ico":
              "image/x-icon"

          };

          const contentType =
            contentTypes[ext] ||
            "application/octet-stream";

          res.writeHead(
            200,
            {
              "Content-Type":
                contentType,

              "Cache-Control":
                "no-cache"

            }
          );

          fs.createReadStream(
            absolutePath
          ).pipe(
            res
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
          "Not Found"
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


server.listen(
  PORT,
  () => {

    console.log(
      "======================================"
    );

    console.log(
      "Cannstatt 1893 News Server gestartet"
    );

    console.log(
      `Port: ${PORT}`
    );

    console.log(
      `Football-Data API: ${
        TOKEN
          ? "konfiguriert"
          : "FEHLT"
      }`
    );

    console.log(
      `VfB RSS: ${
        VFB_RSS_URL
      }`
    );

    console.log(
      `Kicker RSS: ${
        KICKER_RSS_URL
      }`
    );

    console.log(
      "Dashboard Cache: 10 Minuten"
    );

    console.log(
      "======================================"
    );

  }
);
