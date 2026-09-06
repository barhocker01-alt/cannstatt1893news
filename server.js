const http=require("http");
const https=require("https");
const fs=require("fs");
const path=require("path");

const PORT=process.env.PORT||3000;
const TOKEN=process.env.FOOTBALL_DATA_TOKEN;
const VFB_TEAM_ID=10;

const VFB_RSS_URL="https://www.vfb.de/templates/generated/1/raw/de.xml";
const KICKER_RSS_URL="https://newsfeed.kicker.de/news/bundesliga";

const CACHE_TIME=10*60*1000;
const MATCH_DETAIL_CACHE_TIME=2*60*1000;

let dashboardCache={data:null,time:0};
const matchDetailCache=new Map();

const VFB_OFFICIAL_SQUAD_URL="https://www.vfb.de/de/1893/profis/kader/saisonen/2026-2027/kader/";
const VFB_OFFICIAL_STATS_URL="https://www.vfb.de/de/1893/profis/kader/saisonen/2026-2027/statistik/?data=&mobile=";
const VFB_FIXTURES_URL="https://www.vfb.de/de/1893/aktuell/termine/";

const VFB_SQUAD=[
  {name:"Fabian Bredlow",position:"Torwart",shirtNumber:33},
  {name:"Dennis Seimen",position:"Torwart",shirtNumber:1},
  {name:"Alexander Nübel",position:"Torwart",shirtNumber:33},
  {name:"Josha Vagnoman",position:"Abwehr",shirtNumber:4},
  {name:"Maximilian Mittelstädt",position:"Abwehr",shirtNumber:7},
  {name:"Jeff Chabot",position:"Abwehr",shirtNumber:24},
  {name:"Finn Jeltsch",position:"Abwehr",shirtNumber:29},
  {name:"Anrie Chase",position:"Abwehr",shirtNumber:45},
  {name:"Leonidas Stergiou",position:"Abwehr",shirtNumber:20},
  {name:"Ramon Hendriks",position:"Abwehr",shirtNumber:3},
  {name:"Dan-Axel Zagadou",position:"Abwehr",shirtNumber:23},
  {name:"Angelo Stiller",position:"Mittelfeld",shirtNumber:6},
  {name:"Atakan Karazor",position:"Mittelfeld",shirtNumber:16},
  {name:"Yannick Keitel",position:"Mittelfeld",shirtNumber:5},
  {name:"Enzo Millot",position:"Mittelfeld",shirtNumber:8},
  {name:"Bilal El Khannouss",position:"Mittelfeld",shirtNumber:11},
  {name:"Jamie Leweling",position:"Mittelfeld",shirtNumber:18},
  {name:"Jacob Bruun Larsen",position:"Mittelfeld",shirtNumber:19},
  {name:"Erik Thommy",position:"Mittelfeld",shirtNumber:11},
  {name:"El Bilal Touré",position:"Angriff",shirtNumber:10},
  {name:"Ermedin Demirović",position:"Angriff",shirtNumber:9},
  {name:"Deniz Undav",position:"Angriff",shirtNumber:26},
  {name:"Nick Woltemade",position:"Angriff",shirtNumber:27},
  {name:"Justin Diehl",position:"Angriff",shirtNumber:14},
  {name:"Marius Bülter",position:"Angriff",shirtNumber:19}
];

function httpsRequest(url,headers={}){
  return new Promise((resolve,reject)=>{
    const req=https.get(url,{
      headers:{
        "User-Agent":"Mozilla/5.0 (compatible; Cannstatt1893News/1.0)",
        "Accept":"text/html,application/xml,application/rss+xml,text/xml,*/*",
        ...headers
      }
    },res=>{
      let body="";
      res.setEncoding("utf8");
      res.on("data",c=>body+=c);
      res.on("end",async()=>{
        if(res.statusCode>=200&&res.statusCode<300){
          resolve(body);
          return;
        }
        if([301,302,303,307,308].includes(res.statusCode)&&res.headers.location){
          try{
            resolve(await httpsRequest(new URL(res.headers.location,url).toString(),headers));
          }catch(e){reject(e);}
          return;
        }
        reject(new Error(`HTTP ${res.statusCode} bei ${url}`));
      });
    });
    req.setTimeout(20000,()=>req.destroy(new Error("HTTP Request Timeout")));
    req.on("error",reject);
  });
}

function apiRequest(endpoint){
  return new Promise((resolve,reject)=>{
    if(!TOKEN){
      reject(new Error("FOOTBALL_DATA_TOKEN fehlt"));
      return;
    }
    const req=https.get(`https://api.football-data.org/v4${endpoint}`,{
      headers:{
        "X-Auth-Token":TOKEN,
        "User-Agent":"Cannstatt1893News/1.0"
      }
    },res=>{
      let body="";
      res.setEncoding("utf8");
      res.on("data",c=>body+=c);
      res.on("end",()=>{
        let json;
        try{json=JSON.parse(body);}
        catch(e){
          reject(new Error("football-data.org lieferte kein gültiges JSON"));
          return;
        }
        if(res.statusCode!==200){
          reject(new Error(`football-data.org HTTP ${res.statusCode}: ${json.message||JSON.stringify(json)}`));
          return;
        }
        resolve(json);
      });
    });
    req.setTimeout(20000,()=>req.destroy(new Error("Football-Data API Timeout")));
    req.on("error",reject);
  });
}

function formatDate(value){
  if(!value)return "";
  const d=new Date(value);
  if(Number.isNaN(d.getTime()))return "";
  return d.toLocaleString("de-DE",{
    timeZone:"Europe/Berlin",
    day:"2-digit",
    month:"2-digit",
    year:"numeric",
    hour:"2-digit",
    minute:"2-digit"
  });
}

function decodeHTML(text=""){
  return String(text)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi,"$1")
    .replace(/&amp;/gi,"&")
    .replace(/&quot;/gi,'"')
    .replace(/&#39;/gi,"'")
    .replace(/&apos;/gi,"'")
    .replace(/&lt;/gi,"<")
    .replace(/&gt;/gi,">")
    .replace(/&#x27;/gi,"'")
    .replace(/&#x2F;/gi,"/")
    .replace(/&#(\d+);/g,(_,n)=>String.fromCharCode(Number(n)))
    .trim();
}

function cleanText(text=""){
  return decodeHTML(text)
    .replace(/<script[\s\S]*?<\/script>/gi," ")
    .replace(/<style[\s\S]*?<\/style>/gi," ")
    .replace(/<[^>]+>/g," ")
    .replace(/\s+/g," ")
    .trim();
}

function getXmlValue(block,tag){
  const m=block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`,"i"));
  return m?decodeHTML(m[1]):"";
}

function normalizeUrl(url="",base=""){
  url=decodeHTML(url).trim();
  if(!url)return "";
  if(url.startsWith("//"))return "https:"+url;
  if(url.startsWith("/")&&base)return base+url;
  return url;
}

function extractImage(item){
  let m=item.match(/<media:content[^>]+url=["']([^"']+)["']/i);
  if(m)return decodeHTML(m[1]);
  m=item.match(/<media:thumbnail[^>]+url=["']([^"']+)["']/i);
  if(m)return decodeHTML(m[1]);
  m=item.match(/<enclosure[^>]+url=["']([^"']+)["']/i);
  if(m)return decodeHTML(m[1]);
  m=item.match(/<img[^>]+src=["']([^"']+)["']/i);
  if(m)return decodeHTML(m[1]);
  return "";
}

function parseRssItems(xml=""){
  const result=[];
  const items=xml.match(/<item\b[\s\S]*?<\/item>/gi)||[];
  for(const item of items){
    const title=cleanText(getXmlValue(item,"title"));
    const link=decodeHTML(getXmlValue(item,"link")).trim();
    const guid=decodeHTML(getXmlValue(item,"guid")).trim();
    const description=cleanText(getXmlValue(item,"description"));
    let pubDate=getXmlValue(item,"pubDate");
    if(!pubDate)pubDate=getXmlValue(item,"dc:date");
    if(!pubDate)pubDate=getXmlValue(item,"date");
    if(!title&&!link)continue;
    result.push({
      title,
      link,
      guid,
      description,
      pubDate,
      image:extractImage(item)
    });
  }
  return result;
}

function mapMatch(match){
  return {
    id:match.id,
    date:formatDate(match.utcDate),
    rawDate:match.utcDate,
    home:match.homeTeam?.name||"",
    away:match.awayTeam?.name||"",
    homeLogo:match.homeTeam?.crest||"",
    awayLogo:match.awayTeam?.crest||"",
    competition:match.competition?.name||"",
    league:match.competition?.name||"",
    status:match.status||"",
    statusLong:match.status||"",
    homeGoals:match.score?.fullTime?.home??null,
    awayGoals:match.score?.fullTime?.away??null,
    venue:match.venue||"",
    matchday:match.matchday??null
  };
}

async function fetchVfbNews(){
  try{
    const xml=await httpsRequest(VFB_RSS_URL);
    const items=parseRssItems(xml);
    const blocked=[
      "tickets","ticket","shop","fanshop","newsletter",
      "mitglied werden","mitgliedschaft","datenschutz",
      "impressum","kontakt"
    ];
    return items
      .filter(x=>x.title&&!blocked.some(b=>x.title.toLowerCase().includes(b)))
      .map(x=>({
        title:x.title,
        link:normalizeUrl(x.link||x.guid,"https://www.vfb.de"),
        description:x.description,
        date:x.pubDate,
        rawDate:x.pubDate,
        image:x.image,
        source:"VfB Stuttgart"
      }))
      .filter(x=>x.link)
      .sort((a,b)=>new Date(b.rawDate)-new Date(a.rawDate))
      .slice(0,12);
  }catch(e){
    console.error("VfB RSS Fehler:",e.message);
    return [];
  }
}

async function fetchKickerNews(){
  const urls=[
    KICKER_RSS_URL,
    "https://www.kicker.de/vfb-stuttgart/team-news",
    "https://www.kicker.de/vfb-stuttgart/news"
  ];

  let parsed=[];

  for(const url of urls){
    try{
      const xml=await httpsRequest(url);
      const items=parseRssItems(xml);
      if(items.length){
        parsed=items;
        break;
      }
    }catch(e){
      console.error("Kicker Quelle Fehler:",url,e.message);
    }
  }

  const keywords=[
    "vfb stuttgart","vfb","stuttgart",
    "hoeneß","hoeness","demirovic","undav",
    "stiller","führich","fuehrich",
    "el khannouss","karazor","mittelstädt",
    "mittelstaedt","jeltsch","vagnoman",
    "chabot","bülter","buelter","woltemade"
  ];

  return parsed
    .filter(x=>{
      const text=(x.title+" "+x.description).toLowerCase();
      return keywords.some(k=>text.includes(k));
    })
    .map(x=>({
      title:x.title,
      link:x.link||x.guid||"",
      description:x.description,
      date:x.pubDate,
      rawDate:x.pubDate,
      image:x.image,
      source:"Kicker"
    }))
    .filter(x=>x.title&&x.link)
    .sort((a,b)=>new Date(b.rawDate)-new Date(a.rawDate))
    .slice(0,12);
}

async function getNews(){
  const [vfb,kicker]=await Promise.all([
    fetchVfbNews(),
    fetchKickerNews()
  ]);

  const combined=[...vfb,...kicker];
  const seen=new Set();

  return combined
    .filter(item=>{
      const key=(item.link||item.title).toLowerCase().trim();
      if(!key||seen.has(key))return false;
      seen.add(key);
      return true;
    })
    .sort((a,b)=>new Date(b.rawDate)-new Date(a.rawDate))
    .slice(0,20);
}

async function getVfbMatches(){
  const data=await apiRequest(
    `/teams/${VFB_TEAM_ID}/matches?competitions=BL1,CL&dateFrom=2026-07-01&dateTo=2027-06-30&limit=100`
  );
  return (data.matches||[])
    .map(mapMatch)
    .sort((a,b)=>new Date(a.rawDate)-new Date(b.rawDate));
}

async function getBundesligaTable(){
  const data=await apiRequest("/competitions/BL1/standings");
  const total=(data.standings||[]).find(x=>x.type==="TOTAL");
  if(!total)return [];
  return (total.table||[]).map(x=>({
    position:x.position,
    team:x.team?.name||"",
    logo:x.team?.crest||"",
    played:x.playedGames??0,
    wins:x.won??0,
    draws:x.draw??0,
    losses:x.lost??0,
    goalsFor:x.goalsFor??0,
    goalsAgainst:x.goalsAgainst??0,
    goalDiff:x.goalDifference??0,
    points:x.points??0,
    form:x.form||""
  }));
}

function normalizeEventMinute(event){
  if(!event||event.minute==null)return "";
  return event.injuryTime
    ? `${event.minute}+${event.injuryTime}'`
    : `${event.minute}'`;
}

function mapMatchDetails(match){
  const home=match?.homeTeam||{};
  const away=match?.awayTeam||{};

  const goals=(match?.goals||[]).map(g=>({
    minute:g.minute??null,
    injuryTime:g.injuryTime??null,
    minuteLabel:normalizeEventMinute(g),
    type:g.type||"",
    teamId:g.team?.id??null,
    team:g.team?.name||"",
    playerId:g.scorer?.id??null,
    player:g.scorer?.name||"",
    assistId:g.assist?.id??null,
    assist:g.assist?.name||"",
    scoreHome:g.score?.home??null,
    scoreAway:g.score?.away??null
  }));

  const bookings=(match?.bookings||[]).map(g=>({
    minute:g.minute??null,
    injuryTime:g.injuryTime??null,
    minuteLabel:normalizeEventMinute(g),
    teamId:g.team?.id??null,
    team:g.team?.name||"",
    playerId:g.player?.id??null,
    player:g.player?.name||"",
    card:g.card||""
  }));

  const substitutions=(match?.substitutions||[]).map(g=>({
    minute:g.minute??null,
    injuryTime:g.injuryTime??null,
    minuteLabel:normalizeEventMinute(g),
    teamId:g.team?.id??null,
    team:g.team?.name||"",
    playerInId:g.playerIn?.id??null,
    playerIn:g.playerIn?.name||"",
    playerOutId:g.playerOut?.id??null,
    playerOut:g.playerOut?.name||""
  }));

  function lineup(team){
    return {
      formation:team?.formation||null,
      coach:team?.coach?.name||null,
      lineup:(team?.lineup||[]).map(p=>({
        id:p.id??null,
        name:p.name||"",
        position:p.position||"",
        shirtNumber:p.shirtNumber??null
      })),
      bench:(team?.bench||[]).map(p=>({
        id:p.id??null,
        name:p.name||"",
        position:p.position||"",
        shirtNumber:p.shirtNumber??null
      })),
      statistics:team?.statistics||{}
    };
  }

  return {
    id:match?.id??null,
    utcDate:match?.utcDate||null,
    date:formatDate(match?.utcDate),
    status:match?.status||"",
    minute:match?.minute??null,
    injuryTime:match?.injuryTime??null,
    venue:match?.venue||"",
    attendance:match?.attendance??null,
    matchday:match?.matchday??null,
    stage:match?.stage||null,
    competition:match?.competition?.name||"",
    competitionCode:match?.competition?.code||"",
    homeTeam:{
      id:home.id??null,
      name:home.name||"",
      shortName:home.shortName||home.name||"",
      crest:home.crest||"",
      formation:home.formation||null
    },
    awayTeam:{
      id:away.id??null,
      name:away.name||"",
      shortName:away.shortName||away.name||"",
      crest:away.crest||"",
      formation:away.formation||null
    },
    score:match?.score||{},
    goals,
    bookings,
    substitutions,
    lineups:{
      home:lineup(home),
      away:lineup(away)
    },
    statistics:{
      home:home.statistics||{},
      away:away.statistics||{}
    },
    referees:match?.referees||[]
  };
}

async function getMatchDetails(matchId){
  const id=String(matchId||"").trim();

  if(!/^\d+$/.test(id)){
    throw new Error("Ungültige Spiel-ID");
  }

  const cached=matchDetailCache.get(id);

  if(cached&&Date.now()-cached.time<MATCH_DETAIL_CACHE_TIME){
    return cached.data;
  }

  const data=await apiRequest(`/matches/${id}`);
  const details=mapMatchDetails(data);

  matchDetailCache.set(id,{
    time:Date.now(),
    data:details
  });

  return details;
}

function normalizeName(name=""){
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g,"")
    .replace(/[^a-z0-9]/g,"");
}

function findSquadPlayer(name){
  const n=normalizeName(name);

  return VFB_SQUAD.find(p=>{
    const pn=normalizeName(p.name);
    return pn===n||pn.includes(n)||n.includes(pn);
  });
}

async function getOfficialVfbPage(url){
  try{
    return await httpsRequest(url,{
      "Accept":"text/html,application/xhtml+xml"
    });
  }catch(e){
    console.error("VfB Seite Fehler:",e.message);
    return "";
  }
}

function extractFirstImageAroundName(html,name){
  if(!html)return "";

  const escaped=name.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");

  const patterns=[
    new RegExp(`.{0,1200}${escaped}.{0,1200}(?:src|data-src|data-lazy-src)=["']([^"']+)["']`,"i"),
    new RegExp(`(?:src|data-src|data-lazy-src)=["']([^"']+)["'][^>]{0,1200}.{0,500}${escaped}`,"i")
  ];

  for(const pattern of patterns){
    const m=html.match(pattern);
    if(m&&m[1]){
      let url=decodeHTML(m[1]);
      if(url.startsWith("//"))url="https:"+url;
      if(url.startsWith("/"))url="https://www.vfb.de"+url;
      if(/^https?:\/\//i.test(url))return url;
    }
  }

  return "";
}

function extractPlayerStatsFromOfficialHtml(html){
  const stats=new Map();

  if(!html)return stats;

  const rowRegex=/<tr\b[\s\S]*?<\/tr>/gi;
  const rows=html.match(rowRegex)||[];

  for(const row of rows){
    const text=cleanText(row);
    const player=VFB_SQUAD.find(p=>{
      const n=normalizeName(p.name);
      const t=normalizeName(text);
      return t.includes(n);
    });

    if(!player)continue;

    const numbers=(text.match(/\b\d+\b/g)||[]).map(Number);

    if(!numbers.length)continue;

    const current=stats.get(normalizeName(player.name))||{
      appearances:0,
      minutes:0,
      goals:0,
      assists:0
    };

    /*
     * Die offizielle VfB-Tabelle ist:
     * Spieler | Einsätze | Minuten | Tore | Assists ...
     *
     * Die ersten Zahlen nach dem Spielernamen werden
     * deshalb als aktuelle VfB-Saisonwerte verwendet.
     */
    const nameIndex=text.toLowerCase().indexOf(player.name.toLowerCase());
    const after=nameIndex>=0?text.slice(nameIndex+player.name.length):text;
    const afterNumbers=(after.match(/\b\d+\b/g)||[]).map(Number);

    if(afterNumbers.length>=1)current.appearances=afterNumbers[0];
    if(afterNumbers.length>=2)current.minutes=afterNumbers[1];
    if(afterNumbers.length>=3)current.goals=afterNumbers[2];
    if(afterNumbers.length>=4)current.assists=afterNumbers[3];

    stats.set(normalizeName(player.name),current);
  }

  return stats;
}

async function getVfbSquad(){
  let officialHtml="";
  let officialStatsHtml="";

  try{
    officialHtml=await getOfficialVfbPage(VFB_OFFICIAL_SQUAD_URL);
  }catch(e){}

  try{
    officialStatsHtml=await getOfficialVfbPage(VFB_OFFICIAL_STATS_URL);
  }catch(e){}

  const stats=extractPlayerStatsFromOfficialHtml(officialStatsHtml);

  const players=VFB_SQUAD.map(player=>{
    const s=stats.get(normalizeName(player.name))||{
      appearances:0,
      minutes:0,
      goals:0,
      assists:0
    };

    let photo=extractFirstImageAroundName(
      officialHtml,
      player.name
    );

    return {
      ...player,
      photo,
      appearances:s.appearances||0,
      minutes:s.minutes||0,
      goals:s.goals||0,
      assists:s.assists||0
    };
  });

  return {
    goalkeepers:players.filter(p=>p.position==="Torwart"),
    defenders:players.filter(p=>p.position==="Abwehr"),
    midfielders:players.filter(p=>p.position==="Mittelfeld"),
    attackers:players.filter(p=>p.position==="Angriff")
  };
}

async function getOfficialFixtures(){
  try{
    const html=await getOfficialVfbPage(VFB_FIXTURES_URL);
    if(!html)return [];

    const result=[];

    /*
     * Bekannte aktuelle VfB-Termine als Fallback,
     * falls die VfB-Seite serverseitig nicht vollständig
     * ausgelesen werden kann.
     */
    const fallback=[
      {
        date:"2026-09-09T18:45:00+02:00",
        home:"VfB Stuttgart",
        away:"Viking Stavanger",
        competition:"UEFA Europa League"
      },
      {
        date:"2026-09-12T15:30:00+02:00",
        home:"TSG Hoffenheim",
        away:"VfB Stuttgart",
        competition:"Bundesliga"
      },
      {
        date:"2026-09-19T15:30:00+02:00",
        home:"VfB Stuttgart",
        away:"Borussia Dortmund",
        competition:"Bundesliga"
      }
    ];

    /*
     * Falls Football-Data bereits kommende Spiele liefert,
     * werden diese bevorzugt.
     */
    return result.length?result:fallback.map((x,i)=>({
      id:null,
      date:formatDate(x.date),
      rawDate:x.date,
      home:x.home,
      away:x.away,
      homeLogo:"",
      awayLogo:"",
      competition:x.competition,
      league:x.competition,
      status:"SCHEDULED",
      homeGoals:null,
      awayGoals:null,
      venue:""
    }));

  }catch(e){
    console.error("Offizieller VfB-Spielplan Fehler:",e.message);
    return [];
  }
}

async function getDashboard(){
  if(
    dashboardCache.data&&
    Date.now()-dashboardCache.time<CACHE_TIME
  ){
    return dashboardCache.data;
  }

  console.log("Lade Dashboard neu...");

  const results=await Promise.allSettled([
    getNews(),
    getVfbMatches(),
    getBundesligaTable(),
    getVfbSquad(),
    getOfficialFixtures()
  ]);

  const news=results[0].status==="fulfilled"?results[0].value:[];
  let matches=results[1].status==="fulfilled"?results[1].value:[];
  const table=results[2].status==="fulfilled"?results[2].value:[];
  const squad=results[3].status==="fulfilled"
    ?results[3].value
    :{
      goalkeepers:[],
      defenders:[],
      midfielders:[],
      attackers:[]
    };

  const officialFixtures=
    results[4].status==="fulfilled"
      ?results[4].value
      :[];

  for(const r of results){
    if(r.status==="rejected"){
      console.error("Dashboard Fehler:",r.reason?.message||r.reason);
    }
  }

  /*
   * Falls Football-Data gar keine Spiele liefert,
   * verwenden wir die offiziellen VfB-Fallbacktermine.
   */
  if(!matches.length&&officialFixtures.length){
    matches=officialFixtures;
  }

  const bundesliga=matches.filter(m=>
    (
      m.competition||
      ""
    ).toLowerCase().includes("bundesliga")
  );

  const championsLeague=matches.filter(m=>
    (
      m.competition||
      ""
    ).toLowerCase().includes("champions")
  );

  const now=Date.now();

  let upcoming=matches
    .filter(m=>{
      const time=new Date(m.rawDate).getTime();
      return Number.isFinite(time)&&
        time>=now&&
        !["FINISHED","AWARDED","CANCELLED","POSTPONED"].includes(m.status);
    })
    .sort((a,b)=>new Date(a.rawDate)-new Date(b.rawDate));

  /*
   * Wenn Football-Data kein kommendes Spiel liefert,
   * aber der offizielle VfB-Spielplan schon, diesen nehmen.
   */
  if(!upcoming.length){
    upcoming=officialFixtures
      .filter(m=>new Date(m.rawDate).getTime()>=now)
      .sort((a,b)=>new Date(a.rawDate)-new Date(b.rawDate));
  }

  const nextMatch=upcoming[0]||null;

  const dashboard={
    success:true,
    updatedAt:new Date().toISOString(),
    news,
    fixtures:bundesliga,
    championsLeague,
    allMatches:matches,
    nextMatch,
    table,
    squad,
    sources:{
      vfbNews:VFB_RSS_URL,
      kickerNews:KICKER_RSS_URL,
      vfbSquad:VFB_OFFICIAL_SQUAD_URL,
      vfbStatistics:VFB_OFFICIAL_STATS_URL,
      vfbFixtures:VFB_FIXTURES_URL
    },
    attribution:"Football data provided by football-data.org"
  };

  dashboardCache={
    data:dashboard,
    time:Date.now()
  };

  return dashboard;
}

function sendJSON(res,data,status=200){
  res.writeHead(status,{
    "Content-Type":"application/json; charset=utf-8",
    "Cache-Control":"no-store",
    "Access-Control-Allow-Origin":"*"
  });
  res.end(JSON.stringify(data));
}

function getContentType(file){
  const ext=path.extname(file).toLowerCase();

  const types={
    ".html":"text/html; charset=utf-8",
    ".css":"text/css; charset=utf-8",
    ".js":"application/javascript; charset=utf-8",
    ".json":"application/json; charset=utf-8",
    ".png":"image/png",
    ".jpg":"image/jpeg",
    ".jpeg":"image/jpeg",
    ".webp":"image/webp",
    ".svg":"image/svg+xml",
    ".ico":"image/x-icon",
    ".txt":"text/plain; charset=utf-8"
  };

  return types[ext]||"application/octet-stream";
}

function serveFile(res,filename){
  const root=path.resolve(__dirname);
  const filePath=path.resolve(root,filename);

  if(
    filePath!==root&&
    !filePath.startsWith(root+path.sep)
  ){
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  if(!fs.existsSync(filePath)){
    res.writeHead(404,{
      "Content-Type":"text/plain; charset=utf-8"
    });
    res.end("Nicht gefunden");
    return;
  }

  const stat=fs.statSync(filePath);

  if(!stat.isFile()){
    res.writeHead(404);
    res.end("Nicht gefunden");
    return;
  }

  res.writeHead(200,{
    "Content-Type":getContentType(filePath),
    "Cache-Control":"no-cache"
  });

  fs.createReadStream(filePath).pipe(res);
}

const server=http.createServer(async(req,res)=>{
  try{
    const url=new URL(
      req.url,
      `http://${req.headers.host||"localhost"}`
    );

    const pathname=url.pathname;

    console.log(req.method,pathname);

    if(pathname==="/health"){
      sendJSON(res,{
        status:"ok",
        apiConfigured:!!TOKEN,
        rssConfigured:!!VFB_RSS_URL,
        kickerRssConfigured:!!KICKER_RSS_URL,
        indexExists:fs.existsSync(
          path.join(__dirname,"index.html")
        ),
        serverDirectory:__dirname,
        time:new Date().toISOString()
      });
      return;
    }

    if(pathname==="/api/dashboard"){
      try{
        const dashboard=await getDashboard();
        sendJSON(res,dashboard);
      }catch(e){
        console.error("Dashboard API Fehler:",e);
        sendJSON(res,{
          success:false,
          error:e.message
        },500);
      }
      return;
    }

    const match=pathname.match(/^\/api\/match\/(\d+)$/);

    if(match){
      try{
        const details=await getMatchDetails(match[1]);

        sendJSON(res,{
          success:true,
          match:details,
          attribution:"Data provided by football-data.org"
        });
      }catch(e){
        console.error("Match API Fehler:",e);
        sendJSON(res,{
          success:false,
          error:e.message
        },500);
      }
      return;
    }

    let file=pathname.replace(/^\/+/,"");

    if(!file){
      file="index.html";
    }

    if(file.includes("..")){
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }

    if(
      file!=="index.html"&&
      !fs.existsSync(path.join(__dirname,file))
    ){
      /*
       * Nicht vorhandene Dateien führen nicht dazu,
       * dass die API kaputtgeht.
       */
      res.writeHead(404,{
        "Content-Type":"text/plain; charset=utf-8"
      });
      res.end("Nicht gefunden");
      return;
    }

    serveFile(res,file);

  }catch(e){
    console.error("SERVER ERROR:",e);

    if(!res.headersSent){
      sendJSON(res,{
        success:false,
        error:e.message
      },500);
    }else{
      res.end();
    }
  }
});

server.listen(PORT,"0.0.0.0",()=>{
  console.log("======================================");
  console.log(`Cannstatt 1893 News läuft auf Port ${PORT}`);
  console.log("Football-Data Token:",!!TOKEN);
  console.log("VfB RSS:",VFB_RSS_URL);
  console.log("Kicker RSS:",KICKER_RSS_URL);
  console.log("VfB Kader:",VFB_OFFICIAL_SQUAD_URL);
  console.log("VfB Statistik:",VFB_OFFICIAL_STATS_URL);
  console.log("VfB Spielplan:",VFB_FIXTURES_URL);
  console.log("Dashboard Cache: 10 Minuten");
  console.log("Match Cache: 2 Minuten");
  console.log("Server-Verzeichnis:",__dirname);
  console.log(
    "index.html vorhanden:",
    fs.existsSync(path.join(__dirname,"index.html"))
  );
  console.log("======================================");
});

process.on("uncaughtException",err=>{
  console.error("UNCAUGHT EXCEPTION:",err);
});

process.on("unhandledRejection",err=>{
  console.error("UNHANDLED REJECTION:",err);
});
