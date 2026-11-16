// Finds a club logo, in this order:
//   1. Wikipedia: search the club name, take the article's logo image
//   2. Wider candidate pool (second Wikipedia search + TheSportsDB)
// Every candidate logo is compared with the colours of the crest on the page.
// - A name match whose colours don't fit the crest is rejected.
// - If no name match is good enough, the candidate with the closest colours wins
//   (as long as its name is at least somewhat similar).
// - Every club gets its own logo: a logo already given to another club is skipped.
//   Second / youth / women's teams share their parent club's logo.
// Manual corrections ("overrides") always win.

const API_KEY = "123"; // TheSportsDB free key
const SPORTS_BASE = `https://www.thesportsdb.com/api/v1/json/${API_KEY}/`;
const WIKI_API = "https://en.wikipedia.org/w/api.php";
const SPORTS_SPACING_MS = 2200; // TheSportsDB free tier: about 30 requests/minute
const WIKI_SPACING_MS = 250;

const CACHE_KEY = "badgeCache5"; // automatic results (bumped: stricter colour fallback)
const OVERRIDE_KEY = "badgeOverrides"; // your manual corrections (never expire)
const CLAIM_KEY = "logoClaims"; // which club owns which logo

// ---- tuning (all values are 0..1) ----
const NAME_OK = 0.72; // a name at least this similar counts as a name match
const NAME_EXACT = 0.95; // practically identical name
// The colour-only fallback (no good name match) is now used rarely and only
// when both the name and the colours are already a decent fit, so it stops
// handing out an unrelated club's logo just because the shirt colour matches.
const NAME_MIN_FALLBACK = 0.62; // minimum name similarity for the colour fallback
const COLOR_MIN = 0.35; // a name match needs at least this colour similarity
const COLOR_MIN_EXACT = 0.2; // ...or this much when the name is practically identical
const COLOR_FALLBACK_MIN = 0.78; // colour-only picks need at least this similarity
const MAX_COLOR_CHECKS = 4; // candidate images analysed per search round

// Site name (lowercase) -> name to search for. Optional.
const ALIASES = {
  "man utd": "Manchester United",
  "man united": "Manchester United",
  "man city": "Manchester City",
  "spurs": "Tottenham Hotspur",
  "wolves": "Wolverhampton Wanderers",
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stripAccents = (s) => (s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");

// ---------- storage ----------

let cache = null;
let overrides = null;
let claims = null;
let queue = Promise.resolve();

async function loadCache() {
  if (!cache) cache = (await chrome.storage.local.get(CACHE_KEY))[CACHE_KEY] || {};
  return cache;
}
async function loadOverrides() {
  if (!overrides) overrides = (await chrome.storage.local.get(OVERRIDE_KEY))[OVERRIDE_KEY] || {};
  return overrides;
}
async function loadClaims() {
  if (!claims) claims = (await chrome.storage.local.get(CLAIM_KEY))[CLAIM_KEY] || {};
  return claims;
}
const saveCache = () => chrome.storage.local.set({ [CACHE_KEY]: cache });
const saveOverrides = () => chrome.storage.local.set({ [OVERRIDE_KEY]: overrides });
const saveClaims = () => chrome.storage.local.set({ [CLAIM_KEY]: claims });

// ---------- names ----------

function norm(s) {
  const base = stripAccents(s)
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\b(football|club|association|futbol|calcio)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const stripped = base
    .replace(/\b(fc|afc|cf|sc|ac|as|ss|rc|cd|ud|sd|fk|sk|bk|if|sv|vfb|vfl|tsg|ssc|rcd|ca)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return stripped || base;
}

function lev(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

// Similarity between two already-normalised names, 0..1
function sim(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const ratio = 1 - lev(a, b) / Math.max(a.length, b.length);
  const ta = new Set(a.split(" ")), tb = new Set(b.split(" "));
  const common = [...ta].filter((w) => tb.has(w)).length;
  const jaccard = common / new Set([...ta, ...tb]).size;
  const contain = common / Math.min(ta.size, tb.size);
  return Math.max(ratio, jaccard, contain * 0.85);
}

// Second / youth / women's teams share their parent club's logo
const SECOND_SUFFIX = /\s+(?:II|III|IV|B|C|2|3|U-?\d{2}|Under[- ]?\d{2}|Reserves?|Res|Youth|Academy|Primavera|Castilla|Next Gen|Women|Ladies|Fem|Femenino|Feminin|F\u00e9minin|Frauen|W)\.?$/i;
const SECOND_PREFIX = /^Jong\s+/i;

function family(name) {
  let base = name.trim();
  let isSecond = false;
  if (SECOND_PREFIX.test(base)) {
    base = base.replace(SECOND_PREFIX, "").trim();
    isSecond = true;
  }
  for (let i = 0; i < 2; i++) {
    const b2 = base.replace(SECOND_SUFFIX, "").trim();
    if (b2 !== base && b2.length >= 3) {
      base = b2;
      isSecond = true;
    }
  }
  return { base, isSecond };
}

function queryList(name) {
  const out = [];
  const alias = ALIASES[name.toLowerCase()];
  if (alias) out.push(alias);
  out.push(name);
  const plain = stripAccents(name);
  if (plain !== name) out.push(plain);
  const stripped = plain
    .replace(/^(FC|AFC|CF|SC|AC|AS|SS|RC|CD|UD|SD)\s+|\s+(FC|AFC|CF|SC)$/gi, "")
    .trim();
  if (stripped && stripped !== plain) out.push(stripped);
  const words = norm(name).split(" ").filter((w) => w.length >= 4).sort((a, b) => b.length - a.length);
  if (words[0]) out.push(words[0]);
  return [...new Set(out)].slice(0, 5);
}

// ---------- colours ----------

function toLab([r, g, b]) {
  const f = (v) => {
    v /= 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  const R = f(r), G = f(g), B = f(b);
  const X = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
  const Y = R * 0.2126 + G * 0.7152 + B * 0.0722;
  const Z = (B * 0.9505 + G * 0.1192 + R * 0.0193) / 1.08883;
  const h = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = h(X), fy = h(Y), fz = h(Z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}
const dE = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

const palettes = new Map(); // image url -> palette (memory only)

// Dominant colours of an image: [{rgb:[r,g,b], w:share}] or null
async function paletteOf(url) {
  if (palettes.has(url)) return palettes.get(url);
  let pal = null;
  try {
    const res = await fetch(url);
    if (res.ok) {
      const bmp = await createImageBitmap(await res.blob());
      const S = 48;
      const ctx = new OffscreenCanvas(S, S).getContext("2d", { willReadFrequently: true });
      ctx.drawImage(bmp, 0, 0, S, S);
      const { data } = ctx.getImageData(0, 0, S, S);
      const buckets = new Map();
      let total = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] < 128) continue; // transparent
        const k = ((data[i] >> 4) << 8) | ((data[i + 1] >> 4) << 4) | (data[i + 2] >> 4);
        const e = buckets.get(k) || { n: 0, r: 0, g: 0, b: 0 };
        e.n++; e.r += data[i]; e.g += data[i + 1]; e.b += data[i + 2];
        buckets.set(k, e);
        total++;
      }
      if (total) {
        pal = [...buckets.values()]
          .sort((a, b) => b.n - a.n)
          .slice(0, 6)
          .map((e) => ({ rgb: [e.r / e.n, e.g / e.n, e.b / e.n], w: e.n / total }))
          .filter((p) => p.w >= 0.03);
      }
    }
  } catch (e) {}
  palettes.set(url, pal);
  return pal;
}

// How well a logo's palette fits the crest colours, 0..1 (null = unknown)
function colorSimilarity(crest, pal) {
  if (!crest || !crest.length || !pal || !pal.length) return null;
  const cl = crest.map(toLab);
  const pl = pal.map((p) => ({ lab: toLab(p.rgb), w: p.w }));
  // every crest colour should appear in the logo...
  const fwd = cl.reduce((s, c) => s + Math.min(...pl.map((p) => dE(c, p.lab))), 0) / cl.length;
  // ...and the logo's main (non-white) colours should appear in the crest
  const chromatic = pl.filter((p) => p.lab[0] < 90);
  let bwd = fwd;
  if (chromatic.length) {
    const wsum = chromatic.reduce((s, p) => s + p.w, 0);
    bwd = chromatic.reduce((s, p) => s + p.w * Math.min(...cl.map((c) => dE(c, p.lab))), 0) / wsum;
  }
  return Math.max(0, 1 - (0.6 * fwd + 0.4 * bwd) / 60);
}

// ---------- candidate sources ----------

// Wikipedia: article lead images (club logos) for a search. Array or "RETRY".
async function wikiSearch(q) {
  const url =
    `${WIKI_API}?action=query&generator=search&gsrsearch=${encodeURIComponent(q)}&gsrlimit=6` +
    `&prop=pageimages&piprop=thumbnail%7Cname&pithumbsize=256&pilicense=any` +
    `&format=json&formatversion=2`;
  try {
    const res = await fetch(url, {
      headers: { "Api-User-Agent": "MatchSimulatorClubLogos/2.0 (personal browser extension)" },
    });
    if (!res.ok) return "RETRY";
    const data = await res.json();
    const pages = (data.query && data.query.pages) || [];
    return pages
      .slice()
      .sort((a, b) => a.index - b.index)
      // logos are svg/png files; photos (jpg) are skipped
      .filter((p) => p.thumbnail && /\.(svg|png)$/i.test(p.pageimage || ""))
      .map((p) => ({ url: p.thumbnail.source, label: p.title, source: "wikipedia" }));
  } catch (e) {
    return "RETRY";
  }
}

// TheSportsDB: soccer teams, or "RETRY"
async function fetchTeams(q) {
  try {
    const res = await fetch(SPORTS_BASE + "searchteams.php?t=" + encodeURIComponent(q));
    if (!res.ok) return "RETRY"; // includes 429 (rate limit)
    const data = await res.json();
    return (data.teams || []).filter((t) => t.strSport === "Soccer");
  } catch (e) {
    return "RETRY";
  }
}

const badgeOf = (t) => {
  const u = t.strBadge || t.strTeamBadge;
  return u ? u + "/tiny" : null;
};

async function sportsCandidates(name) {
  const out = [];
  const seen = new Set();
  for (const q of queryList(name).slice(0, 3)) {
    const teams = await fetchTeams(q);
    if (teams === "RETRY") return out.length ? out : "RETRY";
    for (const t of teams) {
      const url = badgeOf(t);
      if (!url || seen.has(url)) continue;
      seen.add(url);
      out.push({ url, label: t.strTeam, alt: t.strTeamAlternate || "", source: "thesportsdb" });
    }
    await sleep(SPORTS_SPACING_MS);
  }
  return out;
}

// ---------- choosing the logo ----------

// Returns {url, matched, score, nameScore, colorScore, via, from} or "RETRY"
async function chooseLogo(name, colors, nk) {
  const taken = await loadClaims();
  const wanted = norm(name);
  const cands = [];
  const seen = new Set();
  let retry = false;

  async function add(list) {
    if (list === "RETRY") {
      retry = true;
      return;
    }
    const fresh = [];
    for (const c of list) {
      if (!c.url || seen.has(c.url)) continue;
      seen.add(c.url);
      const names = [c.label, ...String(c.alt || "").split(",")].map((s) => norm(s.trim())).filter(Boolean);
      c.nameScore = Math.max(0, ...names.map((n) => sim(wanted, n)));
      c.colorScore = null;
      cands.push(c);
      fresh.push(c);
    }
    if (colors && colors.length) {
      const check = fresh
        .filter((c) => c.nameScore >= NAME_MIN_FALLBACK && !/\.svg$/i.test(c.url))
        .sort((a, b) => b.nameScore - a.nameScore)
        .slice(0, MAX_COLOR_CHECKS);
      for (const c of check) c.colorScore = colorSimilarity(colors, await paletteOf(c.url));
    }
  }

  // a logo another club already owns is not available (same family is fine)
  const free = (c) => !taken[c.url] || taken[c.url].nk === nk;
  const colorOk = (c) =>
    c.colorScore === null || c.colorScore >= (c.nameScore >= NAME_EXACT ? COLOR_MIN_EXACT : COLOR_MIN);
  const finish = (c, via) => ({
    url: c.url,
    matched: c.label,
    score: via === "name" ? c.nameScore : c.colorScore,
    nameScore: c.nameScore,
    colorScore: c.colorScore,
    via,
    from: c.source,
  });
  const pick = () => {
    const byName = cands
      .filter((c) => free(c) && c.nameScore >= NAME_OK && colorOk(c))
      .sort((a, b) => b.nameScore - a.nameScore || (b.colorScore || 0) - (a.colorScore || 0));
    if (byName.length) return finish(byName[0], "name");
    const byColor = cands
      .filter((c) => free(c) && c.nameScore >= NAME_MIN_FALLBACK && c.colorScore !== null && c.colorScore >= COLOR_FALLBACK_MIN)
      .sort((a, b) => b.colorScore - a.colorScore);
    return byColor.length ? finish(byColor[0], "colors") : null;
  };

  const q = ALIASES[name.toLowerCase()] || name;

  // Round 1: Wikipedia
  await add(await wikiSearch(q + " football club"));
  let best = pick();

  // Round 2: wider pool, then pick by name + colours (or colours alone)
  if (!best) {
    await sleep(WIKI_SPACING_MS);
    await add(await wikiSearch(q));
    await add(await sportsCandidates(name));
    best = pick();
  }

  if (best) return best;
  if (retry) return "RETRY";
  const close = cands.slice().sort((a, b) => b.nameScore - a.nameScore)[0];
  return { url: null, matched: close ? close.label : null, score: close ? close.nameScore : 0 };
}

async function lookup(key, name, colors) {
  const ov = await loadOverrides();
  if (key in ov) {
    return { url: ov[key].url, matched: ov[key].label || "manual choice", score: 1, source: "override" };
  }
  const c = await loadCache();
  if (key in c) return { ...c[key], source: "auto" };

  const result = queue.then(async () => {
    const fam = family(name);
    const nk = norm(fam.base) || key;
    const found = await chooseLogo(fam.base, colors, nk);
    if (found !== "RETRY") {
      c[key] = found; // misses are cached too, so they aren't searched again
      await saveCache();
      if (found.url) {
        const taken = await loadClaims();
        taken[found.url] = { key, nk };
        await saveClaims();
      }
    }
    return found === "RETRY" ? found : { ...found, source: "auto" };
  });
  queue = result.catch(() => {});
  return result;
}

// ---------- manual search (correction dialog) ----------

// Wikipedia info for a club: stadium (+ its place), manager, captain.
// Clubs don't always have all of these, and smaller/modded clubs may have none.
const WIKI_HEADERS = { "Api-User-Agent": "MatchSimulatorClubLogos/2.0 (personal browser extension)" };
const clubInfoCache = new Map(); // normalised club name -> Promise

async function wikiJson(params) {
  const res = await fetch(`${WIKI_API}?${params}&format=json&formatversion=2&origin=*`, { headers: WIKI_HEADERS });
  if (!res.ok) throw new Error("http " + res.status);
  return res.json();
}

async function wikiPlainSearch(q) {
  try {
    const d = await wikiJson(`action=query&list=search&srlimit=6&srsearch=${encodeURIComponent(q)}`);
    return ((d.query && d.query.search) || []).map((s) => s.title);
  } catch (e) {
    return [];
  }
}

async function wikiWikitext(title) {
  try {
    const d = await wikiJson(`action=parse&page=${encodeURIComponent(title)}&prop=wikitext&redirects=1`);
    return (d.parse && d.parse.wikitext) || null;
  } catch (e) {
    return null;
  }
}

// Wikitext -> readable text.
function stripWiki(s) {
  if (!s) return "";
  s = s.replace(/<!--[\s\S]*?-->/g, "").replace(/<ref[^>]*\/>/gi, "").replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, "");
  s = s.replace(/\{\{\s*(?:nowrap|small|nobr)\s*\|([^{}]*)\}\}/gi, "$1");
  for (let i = 0; i < 4; i++) s = s.replace(/\{\{[^{}]*\}\}/g, "");
  s = s.replace(/\[\[(?:File|Image|Category):[^\]]*\]\]/gi, "");
  s = s.replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, "$1");
  s = s.replace(/<br\s*\/?>/gi, ", ").replace(/<[^>]+>/g, "").replace(/'{2,}/g, "");
  return s.replace(/\s+/g, " ").replace(/^[,\s]+|[,\s]+$/g, "").trim();
}

function firstLink(raw) {
  const re = /\[\[([^\]|#]+)(?:\|[^\]]*)?\]\]/g;
  let m;
  while ((m = re.exec(raw || ""))) {
    if (!/^(File|Image|Category|Wikipedia):/i.test(m[1])) return m[1].trim();
  }
  return null;
}

function nameFromRaw(raw) {
  const link = firstLink(raw);
  if (link) return link.replace(/\s*\([^)]*\)\s*$/, "").trim();
  const t = stripWiki(raw).split(/,|;/)[0].trim();
  return t || null;
}

// Raw value of the first matching infobox parameter. It runs until the next
// parameter line, so "|" inside [[Link|Text]] no longer cuts it short.
function infoboxRaw(wt, fields) {
  for (const f of fields) {
    const re = new RegExp(`^[ \\t]*\\|[ \\t]*${f}[ \\t]*=[ \\t]*([\\s\\S]*?)(?=\\n[ \\t]*\\||\\n[ \\t]*\\}\\})`, "im");
    const m = re.exec(wt);
    if (m && stripWiki(m[1])) return m[1];
  }
  return null;
}

function placePartsFrom(raw) {
  return stripWiki(raw).split(",").map((x) => x.trim()).filter(Boolean);
}

const NOT_CAPTAIN = /vice|\b2nd\b|\b3rd\b|\b4th\b|second|third|fourth|assistant/i;

function captainFromSquad(wt) {
  for (const line of wt.split("\n")) {
    if (!/captain|\(c\)/i.test(line) || NOT_CAPTAIN.test(line)) continue;
    let m = /\|\s*name\s*=\s*((?:\[\[[^\]]*\]\]|[^|}\n])+)/i.exec(line);
    if (m) {
      const n = nameFromRaw(m[1]);
      if (n) return n;
    }
    m = /\[\[([^\]|]+)(?:\|([^\]]*))?\]\][^\n]{0,12}\((?:c|captain)\)/i.exec(line);
    if (m) return (m[2] || m[1]).trim();
  }
  return null;
}

async function findCaptain(wt) {
  const fromBox = infoboxRaw(wt, ["captain"]);
  if (fromBox) {
    const n = nameFromRaw(fromBox);
    if (n) return n;
  }
  const direct = captainFromSquad(wt);
  if (direct) return direct;
  // The squad is often a separate template page.
  const tpls = [];
  const re = /\{\{\s*([^{}|]*squad[^{}|]*)/gi;
  let m;
  while ((m = re.exec(wt))) {
    const t = m[1].trim();
    if (/^(fs|football squad)\b/i.test(t) || tpls.includes(t)) continue;
    tpls.push(t);
    if (tpls.length >= 2) break;
  }
  for (const t of tpls) {
    const tw = await wikiWikitext(/^template:/i.test(t) ? t : "Template:" + t);
    const c = tw && captainFromSquad(tw);
    if (c) return c;
  }
  return null;
}

async function stadiumPlace(stadiumRaw, stadiumName) {
  const link = firstLink(stadiumRaw);
  if (link) {
    const wt = await wikiWikitext(link);
    if (wt) {
      const loc = infoboxRaw(wt, ["location", "city", "address"]);
      if (loc) {
        const parts = placePartsFrom(loc);
        if (parts.length) return parts;
      }
    }
  }
  return [];
}

async function loadClubInfo(name) {
  const result = { stadium: null, placeParts: [], manager: null, captain: null, title: null };
  try {
    let titles = await wikiPlainSearch(name + " football club");
    if (!titles.length) titles = await wikiPlainSearch(name);
    let title = null;
    for (const t of titles) {
      if (sim(norm(t.replace(/\s*\([^)]*\)/, "")), norm(name)) >= 0.6) { title = t; break; }
    }
    if (!title) return result;
    const wt = await wikiWikitext(title);
    if (!wt) return result;
    result.title = title;
    const ground = infoboxRaw(wt, ["ground", "stadium"]);
    if (ground) {
      result.stadium = nameFromRaw(ground);
      result.placeParts = await stadiumPlace(ground, result.stadium);
      if (!result.placeParts.length) {
        // "Stadium name, City" written as plain text in the infobox
        const parts = placePartsFrom(ground);
        if (parts.length > 1) result.placeParts = parts.slice(1);
      }
    }
    const mgr = infoboxRaw(wt, ["manager", "head_coach", "coach"]);
    if (mgr) result.manager = nameFromRaw(mgr);
    result.captain = await findCaptain(wt);
  } catch (e) {}
  return result;
}

function clubInfo(name) {
  const key = norm(name);
  if (!clubInfoCache.has(key)) clubInfoCache.set(key, loadClubInfo(name));
  return clubInfoCache.get(key);
}

// A flag for a nation not in content.js's built-in list (a modded or renamed
// federation, e.g. from a customization pack): search Commons for "Flag of X".
const COMMONS_API = "https://commons.wikimedia.org/w/api.php";
const flagCache = new Map();

async function wikiFlagUrl(name) {
  const key = name.toLowerCase();
  if (flagCache.has(key)) return flagCache.get(key);
  let url = null;
  try {
    const headers = { "Api-User-Agent": "MatchSimulatorClubLogos/2.0 (personal browser extension)" };
    const searchUrl =
      `${COMMONS_API}?action=query&list=search&srnamespace=6&srsearch=` +
      encodeURIComponent(`intitle:"Flag of ${name}"`) +
      `&format=json&formatversion=2&srlimit=3`;
    const sres = await fetch(searchUrl, { headers });
    if (sres.ok) {
      const sdata = await sres.json();
      const hits = (sdata.query && sdata.query.search) || [];
      const pick = hits.find((h) => /\.(svg|png)$/i.test(h.title)) || hits[0];
      if (pick) {
        const infoUrl =
          `${COMMONS_API}?action=query&titles=${encodeURIComponent(pick.title)}` +
          `&prop=imageinfo&iiprop=url&format=json&formatversion=2`;
        const ires = await fetch(infoUrl, { headers });
        if (ires.ok) {
          const idata = await ires.json();
          const page = idata.query && idata.query.pages && idata.query.pages[0];
          url = (page && page.imageinfo && page.imageinfo[0] && page.imageinfo[0].url) || null;
        }
      }
    }
  } catch (e) {}
  flagCache.set(key, url);
  return url;
}

async function manualSearch(q) {
  const wiki = await wikiSearch(q);
  let teams = await fetchTeams(q);
  if (Array.isArray(teams) && !teams.length && stripAccents(q) !== q) teams = await fetchTeams(stripAccents(q));
  if (wiki === "RETRY" && teams === "RETRY") {
    return { error: "The logo sources are busy or unreachable. Try again in a moment." };
  }
  const results = [];
  const seen = new Set();
  const push = (r) => {
    if (r.url && !seen.has(r.url)) {
      seen.add(r.url);
      results.push(r);
    }
  };
  if (Array.isArray(wiki)) wiki.forEach((w) => push({ name: w.label, country: "Wikipedia", league: "", url: w.url }));
  if (Array.isArray(teams)) {
    teams.forEach((t) =>
      push({ name: t.strTeam, country: t.strCountry || "", league: t.strLeague || "", url: badgeOf(t) })
    );
  }
  return { results: results.slice(0, 16) };
}

// ---------- corrections ----------

async function setOverride(key, url, label, name) {
  const ov = await loadOverrides();
  ov[key] = { url: url || null, label: label || null };
  await saveOverrides();
  if (!url) return;
  // The chosen logo now belongs to this club: free it from any other club's automatic result
  const c = await loadCache();
  const taken = await loadClaims();
  for (const [k, v] of Object.entries(c)) {
    if (k !== key && v && v.url === url) delete c[k];
  }
  await saveCache();
  taken[url] = { key, nk: norm(family(name || key).base) || key };
  await saveClaims();
}

// Merge corrections from an imported file. Only https image links are accepted.
// Accepted entries: "t123:name": "https://..."  or  "t123:name": {"url": "https://..." | null, "label": "..."}
async function importOverrides(data) {
  const ov = await loadOverrides();
  let imported = 0, skipped = 0;
  for (const [key, val] of Object.entries(data || {})) {
    let url, label;
    if (typeof val === "string") {
      url = val;
      label = "imported";
    } else if (val && typeof val === "object") {
      url = val.url;
      label = val.label || "imported";
    } else {
      skipped++;
      continue;
    }
    const okKey = /^([tc]\d+(:.+)?|n:.+)$/.test(key);
    const okUrl = url === null || (typeof url === "string" && /^https:\/\/\S+$/i.test(url));
    if (!okKey || !okUrl) {
      skipped++;
      continue;
    }
    ov[key] = { url, label };
    imported++;
  }
  await saveOverrides();
  return { imported, skipped };
}

async function clearOverride(key) {
  const ov = await loadOverrides();
  delete ov[key];
  await saveOverrides();
  const c = await loadCache();
  delete c[key]; // search again automatically
  await saveCache();
  const taken = await loadClaims();
  for (const [u, cl] of Object.entries(taken)) {
    if (cl.key === key) delete taken[u];
  }
  await saveClaims();
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg) return;
  switch (msg.type) {
    case "badge":
      lookup(msg.key, String(msg.name || "").trim(), Array.isArray(msg.colors) ? msg.colors : []).then(sendResponse);
      return true;
    case "nationFlag":
      wikiFlagUrl(String(msg.name || "").trim()).then((url) => sendResponse({ url }));
      return true;
    case "clubInfo":
      clubInfo(String(msg.name || "").trim()).then(sendResponse);
      return true;
    case "search":
      manualSearch(String(msg.query || "").trim()).then(sendResponse);
      return true;
    case "setOverride":
      setOverride(msg.key, msg.url, msg.label, msg.name).then(() => sendResponse(true));
      return true;
    case "clearOverride":
      clearOverride(msg.key).then(() => sendResponse(true));
      return true;
    case "exportOverrides":
      loadOverrides().then(sendResponse);
      return true;
    case "importOverrides":
      importOverrides(msg.data).then(sendResponse);
      return true;
    case "clearCache":
      cache = {};
      claims = {};
      Promise.all([chrome.storage.local.remove(CACHE_KEY), chrome.storage.local.remove(CLAIM_KEY)]).then(() =>
        sendResponse(true)
      );
      return true;
  }
});