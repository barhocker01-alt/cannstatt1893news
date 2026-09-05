const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = process.env.PORT || 3000;
const TOKEN = process.env.FOOTBALL_DATA_TOKEN;
const VFB_TEAM_ID = 10;
const CACHE_TIME = 10 * 60 * 1000;

const VFB_RSS_URL = "https://www.vfb.de/templates/generated/1/raw/de.xml";
const VFB_STATS_URL = "https://www.vfb.de/de/1893/profis/kader/saisonen/2026-2027/statistik/?data=&mobile=";
const KICKER_NEWS_RSS = "https://news.google.com/rss/search?q=" + encodeURIComponent("VfB Stuttgart site:kicker.de") + "&hl=de&gl=DE&ceid=DE:de";
const BUNDESLIGA_NEWS_RSS = "https://news.google.com/rss/search?q=" + encodeURIComponent("VfB Stuttgart site:bundesliga.com") + "&hl=de&gl=DE&ceid=DE:de";

let visitorStats = {
  day: new Date().toISOString().slice(0, 10),
  visitorsToday: 0,
  pageViewsToday: 0,
  totalVisitors: 0,
  totalPageViews: 0
};
const activeVisitors = new Map();
const ACTIVE_WINDOW = 2 * 60 * 1000;

function resetVisitorDayIfNeeded() {
  const today = new Date().toISOString().slice(0, 10);
  if (visitorStats.day !== today) {
    visitorStats.day = today;
    visitorStats.visitorsToday = 0;
    visitorStats.pageViewsToday = 0;
  }
}

function getCookie(req, name) {
  const header = req.headers.cookie || "";
  const match = header.match(new RegExp("(?:^|;\\s*)" + name + "=([^;]+)"));
  return match ? decodeURIComponent(match[1]) : null;
}

function trackVisitor(req, res) {
  resetVisitorDayIfNeeded();
  let visitorId = getCookie(req, "c1893_visitor");
  const now = Date.now();
  if (!visitorId) {
    visitorId = crypto.randomUUID();
    res.setHeader("Set-Cookie", "c1893_visitor=" + encodeURIComponent(visitorId) + "; Path=/; Max-Age=31536000; SameSite=Lax");
  }
  const lastSeen = activeVisitors.get(visitorId);
  if (!lastSeen || now - lastSeen > ACTIVE_WINDOW) {
    visitorStats.visitorsToday++;
    visitorStats.totalVisitors++;
  }
  visitorStats.pageViewsToday++;
  visitorStats.totalPageViews++;
  activeVisitors.set(visitorId, now);
  for (const [id, timestamp] of activeVisitors.entries()) {
    if (now - timestamp > ACTIVE_WINDOW) activeVisitors.delete(id);
  }
  return activeVisitors.size;
}

const CURRENT_VOTING = {
  id: "motm-vfb-2026-09-04",
  title: "Man of the Match",
  question: "Wer war dein bester VfB-Spieler?",
  description: "Stimme für deinen Man of the Match.",
  options: [
    { id: "vagnoman", name: "Josha Vagnoman" },
    { id: "stiller", name: "Angelo Stiller" },
    { id: "undav", name: "Deniz Undav" },
    { id: "demirovic", name: "Ermedin Demirovic" },
    { id: "jeltsch", name: "Finn Jeltsch" }
  ]
};

let votingData = {
  votingId: CURRENT_VOTING.id,
  votes: { vagnoman: 0, stiller: 0, undav: 0, demirovic: 0, jeltsch: 0 },
  totalVotes: 0
};

function resetVotingIfNeeded() {
  if (votingData.votingId === CURRENT_VOTING.id) return;
  votingData = { votingId: CURRENT_VOTING.id, votes: {}, totalVotes: 0 };
  for (const option of CURRENT_VOTING.options) votingData.votes[option.id] = 0;
}

function getVotingResponse(req) {
  resetVotingIfNeeded();
  return {
    success: true,
    voting: CURRENT_VOTING,
    votes: votingData.votes,
    totalVotes: votingData.totalVotes,
    hasVoted: getCookie(req, "c1893_vote_" + CURRENT_VOTING.id) === "1"
  };
}

function castVote(req, res, optionId) {
  resetVotingIfNeeded();
  const valid = CURRENT_VOTING.options.some(option => option.id === optionId);
  if (!valid) return sendJson(res, 400, { success: false, error: "Ungültige Abstimmungsoption." });
  const cookieName = "c1893_vote_" + CURRENT_VOTING.id;
  if (getCookie(req, cookieName) === "1") {
    return sendJson(res, 409, { success: false, error: "Du hast bereits abgestimmt.", ...getVotingResponse(req) });
  }
  votingData.votes[optionId] = (votingData.votes[optionId] || 0) + 1;
  votingData.totalVotes++;
  res.setHeader("Set-Cookie", `${cookieName}=1; Path=/; Max-Age=31536000; SameSite=Lax`);
  return sendJson(res, 200, { ...getVotingResponse(req), message: "Danke für deine Stimme!" });
}

const VFB_SQUAD = [
  ["Fabian Bredlow", "Torwart", "https://www.vfb.de/?proxy=sportdb%2Fspieler%2F06165-1_bredlow.png"],
  ["Marius Funk", "Torwart", "https://www.vfb.de/?proxy=sportdb%2Fspieler%2F6dd79-33_funk.png"],
  ["Dennis Seimen", "Torwart", "https://www.vfb.de/?proxy=sportdb%2Fspieler%2Fa1564-41_seimen.png"],
  ["Stefan Drljaca", "Torwart", "https://www.vfb.de/?proxy=sportdb%2Fspieler%2F26729-46_drljaca.png"],
  ["Ameen Al-Dakhil", "Abwehr", "https://www.vfb.de/?proxy=sportdb%2Fspieler%2Fb6d82-2_al-dakhil.png"],
  ["Ramon Hendriks", "Abwehr", "https://www.vfb.de/?proxy=sportdb%2Fspieler%2F37072-3_hendriks.png"],
  ["Josha Vagnoman", "Abwehr", "https://www.vfb.de/?proxy=sportdb%2Fspieler%2F20236-4_vagnoman.png"],
  ["Maximilian Mittelstädt", "Abwehr", "https://www.vfb.de/?proxy=sportdb%2Fspieler%2F0efee-7_mittelsta--dt.png"],
  ["Luca Jaquez", "Abwehr", "https://www.vfb.de/?proxy=sportdb%2Fspieler%2F244f9-14_jaquez.png"],
  ["Leonidas Stergiou", "Abwehr", "https://www.vfb.de/?proxy=sportdb%2Fspieler%2F029f7-20_stergiou.png"],
  ["Lorenz Assignon", "Abwehr", "https://www.vfb.de/?proxy=sportdb%2Fspieler%2F38f68-22_assignon.png"],
  ["Dan-Axel Zagadou", "Abwehr", "https://www.vfb.de/?proxy=img%2Fdummy.png"],
  ["Jeff Chabot", "Abwehr", "https://www.vfb.de/?proxy=sportdb%2Fspieler%2Fa284d-24_chabot.png"],
  ["Finn Jeltsch", "Abwehr", "https://www.vfb.de/?proxy=sportdb%2Fspieler%2Ff076a-29_jeltsch.png"],
  ["Angelo Stiller", "Mittelfeld", "https://www.vfb.de/?proxy=sportdb%2Fspieler%2Fa2f7b-6_stiller.png"],
  ["Chris Führich", "Mittelfeld", "https://www.vfb.de/?proxy=sportdb%2Fspieler%2F95b40-10_fu--hrich.png"],
  ["Bilal El Khannouss", "Mittelfeld", "https://www.vfb.de/?proxy=sportdb%2Fspieler%2F1d484-11_el_khannouss.png"],
  ["Atakan Karazor", "Mittelfeld", "https://www.vfb.de/?proxy=sportdb%2Fspieler%2F4b88f-16_karazor.png"],
  ["Grischa Prömel", "Mittelfeld", "https://www.vfb.de/?proxy=sportdb%2Fspieler%2F9a7b9-21_pro--mel.png"],
  ["Nikolas Nartey", "Mittelfeld", "https://www.vfb.de/?proxy=sportdb%2Fspieler%2F76cc5-28_nartey.png"],
  ["Ertugrul Yigit", "Mittelfeld", "https://www.vfb.de/?proxy=img%2Fdummy.png"],
  ["Jarzinho Malanga", "Mittelfeld", "https://www.vfb.de/?proxy=img%2Fdummy.png"],
  ["Tiago Tomás", "Angriff", "https://www.vfb.de/?proxy=sportdb%2Fspieler%2F49f37-8_tomas.png"],
  ["Ermedin Demirovic", "Angriff", "https://www.vfb.de/?proxy=sportdb%2Fspieler%2F0ba85-9_demirovic.png"],
  ["Dzenan Pejcinovic", "Angriff", "https://www.vfb.de/?proxy=sportdb%2Fspieler%2F4c4de-17_pejcinovic.png"],
  ["Jamie Leweling", "Angriff", "https://www.vfb.de/?proxy=sportdb%2Fspieler%2Fe4223-18_leweling.png"],
  ["Jeremy Arévalo", "Angriff", "https://www.vfb.de/?proxy=img%2Fdummy.png"],
  ["Deniz Undav", "Angriff", "https://www.vfb.de/?proxy=sportdb%2Fspieler%2Fa56ab-22_undav.png"],
  ["Justin Diehl", "Angriff", "https://www.vfb.de/?proxy=img%2Fdummy.png"],
  ["Leo Sauer", "Angriff", "https://www.vfb.de/?proxy=sportdb%2Fspieler%2Fa1dfb-44_sauer.png"]
].map(([name, position, image]) => ({ name, position, image }));

function httpsRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { headers: options.headers || {} }, response => {
      let data = "";
      response.setEncoding("utf8");
      response.on("data", chunk => { data += chunk; });
      response.on("end", () => {
        if (response.statusCode >= 200 && response.statusCode < 300) {
          resolve({ statusCode: response.statusCode, headers: response.headers, data });
        } else {
          reject(new Error("HTTP " + response.statusCode + " bei " + url));
        }
      });
    });
    request.on("error", reject);
    request.setTimeout(20000, () => request.destroy(new Error("Request Timeout: " + url)));
  });
}

async function apiRequest(endpoint) {
  if (!TOKEN) throw new Error("FOOTBALL_DATA_TOKEN fehlt.");
  const response = await httpsRequest("https://api.football-data.org/v4" + endpoint, {
    headers: { "X-Auth-Token": TOKEN, "User-Agent": "Cannstatt1893News/1.0" }
  });
  return JSON.parse(response.data);
}

function formatDate(dateString) {
  if (!dateString) return "";
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" }).format(date);
}

function formatDateTime(dateString) {
  if (!dateString) return "";
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("de-DE", {
    day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit"
  }).format(date);
}

function mapMatch(match) {
  const homeTeam = match.homeTeam || {};
  const awayTeam = match.awayTeam || {};
  const fullTime = (match.score || {}).fullTime || {};
  const date = match.utcDate || match.date || null;
  return {
    id: match.id || null,
    homeTeam: { id: homeTeam.id || null, name: homeTeam.name || "", shortName: homeTeam.shortName || "", tla: homeTeam.tla || "", crest: homeTeam.crest || "" },
    awayTeam: { id: awayTeam.id || null, name: awayTeam.name || "", shortName: awayTeam.shortName || "", tla: awayTeam.tla || "", crest: awayTeam.crest || "" },
    score: { fullTime: { home: fullTime.home ?? null, away: fullTime.away ?? null } },
    competition: match.competition?.name || "",
    competitionCode: match.competition?.code || "",
    date,
    dateFormatted: formatDate(date),
    dateTimeFormatted: formatDateTime(date),
    status: match.status || "",
    matchday: match.matchday || null
  };
}

async function getVfbMatches() {
  const data = await apiRequest(`/teams/${VFB_TEAM_ID}/matches?competitions=BL1&season=2026`);
  const matches = Array.isArray(data.matches) ? data.matches.map(mapMatch).sort((a, b) => new Date(a.date) - new Date(b.date)) : [];
  const now = Date.now();
  const nextGame = matches.find(match => {
    const date = new Date(match.date).getTime();
    return date >= now && !["FINISHED", "CANCELLED", "POSTPONED"].includes(match.status);
  }) || null;
  return { nextGame, fixtures: matches };
}

async function getBundesligaTable() {
  const data = await apiRequest("/competitions/BL1/standings?season=2026");
  const standings = Array.isArray(data.standings) ? data.standings : [];
  const total = standings.find(item => item.type === "TOTAL") || standings[0];
  const table = Array.isArray(total?.table) ? total.table : [];
  return table.map(row => ({
    position: row.position || 0,
    team: {
      id: row.team?.id || null,
      name: row.team?.name || "",
      shortName: row.team?.shortName || "",
      tla: row.team?.tla || "",
      crest: row.team?.crest || ""
    },
    played: row.playedGames ?? 0,
    wins: row.won ?? 0,
    draws: row.draw ?? 0,
    losses: row.lost ?? 0,
    points: row.points ?? 0,
    goalsFor: row.goalsFor ?? 0,
    goalsAgainst: row.goalsAgainst ?? 0,
    goalDiff: row.goalDifference ?? 0,
    playedGames: row.playedGames ?? 0,
    won: row.won ?? 0,
    draw: row.draw ?? 0,
    lost: row.lost ?? 0,
    goalDifference: row.goalDifference ?? 0
  }));
}

function decodeXml(value) {
  if (!value) return "";
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function stripHtml(value) {
  if (!value) return "";
  return value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function getXmlTag(block, tag) {
  const match = block.match(new RegExp("<" + tag + "(?:\\s[^>]*)?>([\\s\S]*?)<\\/" + tag + ">", "i"));
  return match ? decodeXml(match[1].trim()) : "";
}

function getXmlLink(block) {
  const match = block.match(/<link[^>]*>([\s\S]*?)<\/link>/i);
  return match ? decodeXml(match[1].trim()) : "";
}

function parseRssItems(xml, source, sourceLabel, limit = 20) {
  const items = xml.match(/<item[\s\S]*?<\/item>/gi) || [];
  return items.map(item => {
    const title = getXmlTag(item, "title");
    const link = getXmlLink(item);
    const pubDate = getXmlTag(item, "pubDate");
    const description = stripHtml(getXmlTag(item, "description"));
    let date = "";
    if (pubDate) {
      const parsed = new Date(pubDate);
      if (!Number.isNaN(parsed.getTime())) date = parsed.toISOString();
    }
    return { source, sourceLabel, title, link, pubDate, date, dateFormatted: date ? formatDateTime(date) : "", description, image: "" };
  }).filter(item => item.title && item.link).slice(0, limit);
}

async function getRssNews(url, source, sourceLabel, limit = 20) {
  try {
    const response = await httpsRequest(url, { headers: { "User-Agent": "Cannstatt1893News/1.0" } });
    return parseRssItems(response.data || "", source, sourceLabel, limit);
  } catch (error) {
    console.error(`${sourceLabel}-News konnten nicht geladen werden:`, error.message);
    return [];
  }
}

function isVfbRelevantNews(item) {
  const text = `${item.title || ""} ${item.description || ""}`.toLowerCase();
  const terms = [
    "vfb", "stuttgart", "cannstatt", "vagnoman", "mittelstädt", "mittelstaedt",
    "el khannouss", "demirovic", "demirović", "undav", "führich", "fuehrich",
    "stiller", "jeltsch", "chabot", "pejcinovic", "pejčinović", "sauer", "bouanani",
    "arévalo", "arevalo", "prömel", "promel", "hoeneß", "hoeness"
  ];
  
  return terms.some(term => text.includes(term));
}

function normalizeNewsTitle(title) {
  return String(title || "").toLowerCase().replace(/&amp;/g, "&").replace(/[^a-z0-9äöüß]/gi, "");
}

function dedupeNews(items) {
  const seenLinks = new Set();
  const seenTitles = new Set();
  return items.filter(item => {
    const linkKey = String(item.link || "").trim().toLowerCase();
    const titleKey = normalizeNewsTitle(item.title);
    if ((linkKey && seenLinks.has(linkKey)) || (titleKey && seenTitles.has(titleKey))) return false;
    if (linkKey) seenLinks.add(linkKey);
    if (titleKey) seenTitles.add(titleKey);
    return true;
  });
}

async function getNews() {
  const [vfbNews, kickerNews, bundesligaNews] = await Promise.all([
    getRssNews(VFB_RSS_URL, "vfb.de", "VfB Stuttgart", 20),
    getRssNews(KICKER_NEWS_RSS, "kicker.de", "kicker", 30),
    getRssNews(BUNDESLIGA_NEWS_RSS, "bundesliga.com", "Bundesliga", 20)
  ]);
  const combined = dedupeNews([
    ...vfbNews,
    ...kickerNews.filter(isVfbRelevantNews),
    ...bundesligaNews.filter(isVfbRelevantNews)
  ]);
  combined.sort((a, b) => (new Date(b.date || 0).getTime() || 0) - (new Date(a.date || 0).getTime() || 0));
  return combined.slice(0, 12);
}

function getVfbTransfers() {
  return {
    season: "2026/2027",
    arrivals: [
      { name: "Grischa Prömel", from: "TSG Hoffenheim", type: "Transfer" },
      { name: "Marius Funk", from: "Energie Cottbus", type: "Transfer" },
      { name: "Laurin Ulrich", from: "1. FC Magdeburg", type: "Ende der Leihe" },
      { name: "Jovan Milosevic", from: "SV Werder Bremen", type: "Ende der Leihe" },
      { name: "Leonidas Stergiou", from: "1. FC Heidenheim", type: "Ende der Leihe" },
      { name: "Dennis Seimen", from: "SC Paderborn 07", type: "Ende der Leihe" },
      { name: "Dzenan Pejcinovic", from: "VfL Wolfsburg", type: "Transfer" }
    ],
    departures: [
      { name: "Noah Darvich", to: "SV Elversberg", type: "Leihe" },
      { name: "Yannik Keitel", to: "FC Augsburg", type: "Leihe" },
      { name: "Florian Hellstern", to: "SpVgg Greuther Fürth", type: "Leihe" },
      { name: "Alexander Nübel", to: "FC Bayern München", type: "Ende der Leihe" },
      { name: "Pascal Stenzel", to: "Ziel unbekannt", type: "Abgang" },
      { name: "Laurin Ulrich", to: "SC Paderborn", type: "Leihe" },
      { name: "Jovan Milosevic", to: "SC Braga", type: "Transfer" },
      { name: "Lazar Jovanovic", to: "Udinese Calcio", type: "Transfer" },
      { name: "Chema", to: "Brighton & Hove Albion", type: "Transfer" },
      { name: "Mirza Catovic", to: "FC Barcelona II", type: "Leihe" }
    ]
  };
}

function emptyPlayerStats(player) {
  return {
    name: player.name,
    position: player.position,
    image: player.image,
    appearances: 0,
    goals: 0,
    assists: 0,
    substitutionsIn: 0,
    substitutionsOut: 0,
    yellowCards: 0,
    secondYellow: 0,
    redCards: 0,
    minutes: 0
  };
}

async function getVfbSquad() {
  const stats = VFB_SQUAD.map(player => ({ name: player.name, position: player.position, image: player.image, stats: emptyPlayerStats(player) }));
  try {
    const response = await httpsRequest(VFB_STATS_URL, { headers: { "User-Agent": "Cannstatt1893News/1.0" } });
    const html = response.data || "";
    const rows = html.match(/<tr[\s\S]*?<\/tr>/gi) || [];
    for (const row of rows) {
      const text = stripHtml(row);
      if (!text) continue;
      const player = VFB_SQUAD.find(candidate => text.includes(candidate.name));
      if (!player) continue;
      const target = stats.find(item => item.name === player.name);
      if (!target) continue;
      const cells = row.match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/gi) || [];
      const values = cells.map(cell => stripHtml(cell)).filter(Boolean);
      const numbers = values.map(value => {
        const cleaned = value.replace(/\./g, "").replace(/,/g, ".");
        return /^-?\d+(?:\.\d+)?$/.test(cleaned) ? Number(cleaned) : null;
      }).filter(value => value !== null);
      if (numbers.length >= 9) {
        target.stats.appearances = numbers[0] || 0;
        target.stats.goals = numbers[1] || 0;
        target.stats.assists = numbers[2] || 0;
        target.stats.substitutionsIn = numbers[3] || 0;
        target.stats.substitutionsOut = numbers[4] || 0;
        target.stats.yellowCards = numbers[5] || 0;
        target.stats.secondYellow = numbers[6] || 0;
        target.stats.redCards = numbers[7] || 0;
        target.stats.minutes = numbers[8] || 0;
      }
    }
    return stats;
  } catch (error) {
    console.error("VfB-Statistik konnte nicht geladen werden:", error.message);
    return stats;
  }
}

async function getChampionsLeague() {
  try {
    const data = await apiRequest(`/teams/${VFB_TEAM_ID}/matches?competitions=CL&season=2026`);
    return Array.isArray(data.matches) ? data.matches.map(mapMatch).sort((a, b) => new Date(a.date) - new Date(b.date)).slice(0, 8) : [];
  } catch (error) {
    console.error("Champions-League-Spiele konnten nicht geladen werden:", error.message);
    return [];
  }
}

async function buildDashboard() {
  const [matches, table, news, transfers, squad, championsLeague] = await Promise.all([
    getVfbMatches(),
    getBundesligaTable(),
    getNews(),
    Promise.resolve(getVfbTransfers()),
    getVfbSquad(),
    getChampionsLeague()
  ]);
  return {
    success: true,
    generatedAt: new Date().toISOString(),
    attribution: { footballData: "football-data.org", vfb: "VfB Stuttgart" },
    nextGame: matches.nextGame,
    fixtures: matches.fixtures,
    championsLeague,
    table,
    news,
    transfers,
    squad
  };
}

let dashboardCache = null;
let dashboardCacheTime = 0;

async function getDashboard() {
  const now = Date.now();
  if (dashboardCache && now - dashboardCacheTime < CACHE_TIME) return dashboardCache;
  try {
    dashboardCache = await buildDashboard();
    dashboardCacheTime = now;
    return dashboardCache;
  } catch (error) {
    console.error("Dashboard API Fehler:", error.message);
    if (dashboardCache) return dashboardCache;
    throw error;
  }
}

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-cache",
    "Access-Control-Allow-Origin": "*"
  });
  res.end(JSON.stringify(data));
}

const PUBLIC_DIR = __dirname;
const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf"
};

function serveStatic(req, res) {
  const parsedUrl = new URL(req.url, "http://" + (req.headers.host || "localhost"));
  let pathname = decodeURIComponent(parsedUrl.pathname);
  if (pathname === "/") pathname = "/index.html";
  const safePath = path.normalize(pathname);
  const filePath = path.join(PUBLIC_DIR, safePath);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    return res.end("Forbidden");
  }
  fs.stat(filePath, (error, stats) => {
    if (error || !stats.isFile()) {
      const fallback = path.join(PUBLIC_DIR, "index.html");
      return fs.readFile(fallback, (fallbackError, data) => {
        if (fallbackError) {
          res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
          return res.end("404 - Seite nicht gefunden");
        }
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(data);
      });
    }
    const extension = path.extname(filePath).toLowerCase();
    res.writeHead(200, { "Content-Type": MIME_TYPES[extension] || "application/octet-stream" });
    fs.createReadStream(filePath).pipe(res);
  });
}

async function handleApiRequest(req, res) {
  const parsedUrl = new URL(req.url, "http://" + (req.headers.host || "localhost"));
  const pathname = parsedUrl.pathname;

  if (pathname === "/api/dashboard" && req.method === "GET") {
    sendJson(res, 200, await getDashboard());
    return true;
  }

  if (pathname === "/api/stats" && req.method === "GET") {
    const activeVisitorsCount = trackVisitor(req, res);
    sendJson(res, 200, {
      success: true,
      day: visitorStats.day,
      visitorsToday: visitorStats.visitorsToday,
      pageViewsToday: visitorStats.pageViewsToday,
      totalVisitors: visitorStats.totalVisitors,
      totalPageViews: visitorStats.totalPageViews,
      activeVisitors: activeVisitorsCount
    });
    return true;
  }

  if (pathname === "/api/voting" && req.method === "GET") {
    sendJson(res, 200, getVotingResponse(req));
    return true;
  }

  if (pathname === "/api/voting" && req.method === "POST") {
    let body = "";
    await new Promise((resolve, reject) => {
      req.on("data", chunk => {
        body += chunk;
        if (body.length > 10000) reject(new Error("Request body zu groß."));
      });
      req.on("end", resolve);
      req.on("error", reject);
    });
    let payload;
    try { payload = JSON.parse(body || "{}"); }
    catch { sendJson(res, 400, { success: false, error: "Ungültige Anfrage." }); return true; }
    castVote(req, res, String(payload.optionId || ""));
    return true;
  }

  if (pathname === "/health" && req.method === "GET") {
    sendJson(res, 200, { success: true, status: "ok", service: "Cannstatt 1893 News", timestamp: new Date().toISOString() });
    return true;
  }
  return false;
}

const server = http.createServer(async (req, res) => {
  try {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      return res.end();
    }
    const parsedUrl = new URL(req.url, "http://" + (req.headers.host || "localhost"));
    const isVotingPost = req.method === "POST" && parsedUrl.pathname === "/api/voting";
    if (req.method !== "GET" && !isVotingPost) {
      res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8", "Allow": "GET, POST, OPTIONS" });
      return res.end("Method Not Allowed");
    }
    if (await handleApiRequest(req, res)) return;
    serveStatic(req, res);
  } catch (error) {
    console.error("Serverfehler:", error);
    if (!res.headersSent) res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Interner Serverfehler");
  }
});

server.listen(PORT, () => {
  console.log("=================================================");
  console.log("Cannstatt 1893 News");
  console.log("Server läuft auf Port " + PORT);
  console.log("Football-Data Token:", TOKEN ? "vorhanden" : "FEHLT!");
  console.log("Fan-Voting: AKTIV");
  console.log("News-Cache: 10 Minuten");
  console.log("=================================================");
});

process.on("uncaughtException", error => console.error("UNCAUGHT EXCEPTION:", error));
process.on("unhandledRejection", error => console.error("UNHANDLED REJECTION:", error));
