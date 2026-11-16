// Club logos and nation flags for matchsimulator.com
// (cups, team lists, logo packs, match pages).
//
// Clubs:   the crest's colours and the club name are read from the page and sent
//          to the background script, which searches Wikipedia, checks the
//          candidates against the crest colours and picks a logo.
// Nations: a nation (a /nation/ link, or a name like "Netherlands") gets a flag;
//          every flag has the same 4:3 shape and size. The site's own small flag
//          images are replaced with the same up-to-date flags.
//
// Crests are only handled when they scroll into view.
// ALT+CLICK any club crest to correct it.

const LOGO_SELECTOR = ".logo";
const DEBUG = true;

// ---- flags ----
// Flags inside a crest box (4:3): 1 = exactly the box's own standard size.
// Raise this only if you want crest flags bigger than the site's normal size.
const FLAG_BOX_SCALE = 1;
// Or set a number to force one fixed pixel width for every crest flag instead
// (this overrides FLAG_BOX_SCALE).
const FLAG_BOX_WIDTH_PX = null;
const flagUrl = (code) => `https://cdn.jsdelivr.net/gh/lipis/flag-icons/flags/4x3/${code}.svg`;

const MARK = "msLogoDone";
// The id after /team/ or /nation/ isn't always a plain number - custom/modded
// entries can have a hash-like id (e.g. "6aaf17343635f3.53383616") - so this
// accepts anything up to the next slash, not just digits.
const LINK_HREF = /\/(team|nation)\/([^/?#]+)(?:\/([^/?#]*))?/;
const LINK_SELECTOR = 'a[href*="/team/"],a[href*="/nation/"]';
const warned = new WeakSet();
const observed = new WeakSet();
const pending = new Map(); // club key -> Promise of badge info
let ready = false;

function cleanName(s) {
  return (s || "").replace(/\s+/g, " ").trim();
}

function plausible(s, min = 3) {
  // not just digits/punctuation (scores, dates, ...)
  return s.length >= min && s.length <= 40 && !/^[\d\s:.\-\u2013]+$/.test(s);
}

const nameKey = (s) =>
  cleanName(s).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

// ---------- small persistent name maps ----------

function makeStore(storageKey) {
  let data = {};
  let timer = null;
  return {
    load(done) {
      try {
        chrome.storage.local.get(storageKey, (r) => {
          data = (r && r[storageKey]) || {};
          done();
        });
      } catch (e) {
        done();
      }
    },
    get: (k) => data[k],
    set(k, v) {
      if (data[k] === undefined) data[k] = v;
      else if (data[k] !== v && data[k] !== "?") data[k] = "?"; // conflict: don't guess
      else return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        try {
          chrome.storage.local.get(storageKey, (r) => {
            const cur = (r && r[storageKey]) || {};
            for (const [kk, vv] of Object.entries(data)) {
              if (cur[kk] === undefined) cur[kk] = vv;
              else if (cur[kk] !== vv) cur[kk] = "?";
            }
            data = cur;
            chrome.storage.local.set({ [storageKey]: cur });
          });
        } catch (e) {}
      }, 2000);
    },
  };
}
const knownClubs = makeStore("knownClubs2"); // club name -> club key
const flagIds = makeStore("flagIds2"); // site flag number -> country code (bumped: discard anything learned before the link-matching fix)

// ---------- nations and flags ----------

// code|name;other name;...   (codes from the flag-icons set)
const NATION_DATA = `af|Afghanistan
al|Albania
dz|Algeria
as|American Samoa
ad|Andorra
ao|Angola
ai|Anguilla
ag|Antigua and Barbuda
ar|Argentina
am|Armenia
aw|Aruba
au|Australia
at|Austria
az|Azerbaijan
bs|Bahamas
bh|Bahrain
bd|Bangladesh
bb|Barbados
by|Belarus
be|Belgium
bz|Belize
bj|Benin
bm|Bermuda
bt|Bhutan
bo|Bolivia
bq|Bonaire
ba|Bosnia and Herzegovina;Bosnia-Herzegovina;Bosnia
bw|Botswana
br|Brazil
vg|British Virgin Islands
bn|Brunei
bg|Bulgaria
bf|Burkina Faso
bi|Burundi
kh|Cambodia
cm|Cameroon
ca|Canada
cv|Cape Verde;Cabo Verde;Cape Verde Islands
ky|Cayman Islands
cf|Central African Republic
td|Chad
cl|Chile
cn|China;China PR
co|Colombia
km|Comoros
cg|Congo
cd|DR Congo;Congo DR;Democratic Republic of the Congo
ck|Cook Islands
cr|Costa Rica
hr|Croatia
cu|Cuba
cw|Cura\u00e7ao;Curacao
cy|Cyprus
cz|Czech Republic;Czechia
dk|Denmark
dj|Djibouti
dm|Dominica
do|Dominican Republic
ec|Ecuador
eg|Egypt
sv|El Salvador
gb-eng|England
gq|Equatorial Guinea
er|Eritrea
ee|Estonia
sz|Eswatini;Swaziland
et|Ethiopia
fo|Faroe Islands
fj|Fiji
fi|Finland
fr|France
ga|Gabon
gm|Gambia;The Gambia
ge|Georgia
de|Germany
gh|Ghana
gi|Gibraltar
gr|Greece
gl|Greenland
gd|Grenada
gp|Guadeloupe
gu|Guam
gt|Guatemala
gn|Guinea
gw|Guinea-Bissau
gy|Guyana
ht|Haiti
hn|Honduras
hk|Hong Kong
hu|Hungary
is|Iceland
in|India
id|Indonesia
ir|Iran;IR Iran
iq|Iraq
ie|Republic of Ireland;Ireland
il|Israel
it|Italy
ci|Ivory Coast;C\u00f4te d'Ivoire;Cote d'Ivoire
jm|Jamaica
jp|Japan
jo|Jordan
kz|Kazakhstan
ke|Kenya
ki|Kiribati
xk|Kosovo
kw|Kuwait
kg|Kyrgyzstan
la|Laos
lv|Latvia
lb|Lebanon
ls|Lesotho
lr|Liberia
ly|Libya
li|Liechtenstein
lt|Lithuania
lu|Luxembourg
mo|Macau
mg|Madagascar
mw|Malawi
my|Malaysia
mv|Maldives
ml|Mali
mt|Malta
mq|Martinique
mr|Mauritania
mu|Mauritius
yt|Mayotte
mx|Mexico
md|Moldova
mn|Mongolia
me|Montenegro
ms|Montserrat
ma|Morocco
mz|Mozambique
mm|Myanmar
na|Namibia
nr|Nauru
np|Nepal
nl|Netherlands;Holland
nc|New Caledonia
nz|New Zealand
ni|Nicaragua
ne|Niger
ng|Nigeria
kp|North Korea;Korea DPR
mk|North Macedonia
gb-nir|Northern Ireland
mp|Northern Mariana Islands
no|Norway
om|Oman
pk|Pakistan
pw|Palau
ps|Palestine
pa|Panama
pg|Papua New Guinea
py|Paraguay
pe|Peru
ph|Philippines
pl|Poland
pt|Portugal
pr|Puerto Rico
qa|Qatar
re|R\u00e9union;Reunion
ro|Romania
ru|Russia
rw|Rwanda
kn|St Kitts and Nevis;Saint Kitts and Nevis
lc|Saint Lucia;St Lucia
mf|Saint Martin
pm|Saint Pierre and Miquelon
vc|Saint Vincent and the Grenadines;St Vincent and the Grenadines
ws|Samoa
sm|San Marino
st|Sao Tome and Principe;S\u00e3o Tom\u00e9 and Pr\u00edncipe
sa|Saudi Arabia
gb-sct|Scotland
sn|Senegal
rs|Serbia
sc|Seychelles
sl|Sierra Leone
sg|Singapore
sx|Sint Maarten
sk|Slovakia
si|Slovenia
sb|Solomon Islands
so|Somalia
za|South Africa
kr|South Korea;Korea Republic;Korea
ss|South Sudan
es|Spain
lk|Sri Lanka
sd|Sudan
sr|Suriname
se|Sweden
ch|Switzerland
sy|Syria
tw|Taiwan;Chinese Taipei
tj|Tajikistan
tz|Tanzania
th|Thailand
tl|Timor-Leste;East Timor
tg|Togo
to|Tonga
tt|Trinidad and Tobago
tn|Tunisia
tr|Turkey;T\u00fcrkiye;Turkiye
tm|Turkmenistan
tc|Turks and Caicos Islands
tv|Tuvalu
ug|Uganda
ua|Ukraine
ae|United Arab Emirates;UAE
us|USA;United States;United States of America
uy|Uruguay
vi|US Virgin Islands;U.S. Virgin Islands
uz|Uzbekistan
vu|Vanuatu
ve|Venezuela
vn|Vietnam
gb-wls|Wales
ye|Yemen
zm|Zambia
zw|Zimbabwe
je|Jersey
gg|Guernsey
im|Isle of Man
es-ct|Catalonia`;

const natKey = (s) =>
  nameKey(s).replace(/[.\u2019'`]/g, "").replace(/[-\u2013]/g, " ").replace(/\s+/g, " ").trim();

const NATIONS = new Map();
for (const line of NATION_DATA.split("\n")) {
  const [code, names] = line.split("|");
  for (const n of names.split(";")) NATIONS.set(natKey(n), code);
}

// "Netherlands", "Netherlands National Team", "Netherlands U21" -> "nl"
function nationCode(name) {
  const k = natKey(name)
    .replace(/\b(national (football )?team|national)\b/g, " ")
    .replace(/\b(u ?\d{2}|under ?\d{2}|women|womens|men|mens|olympic)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return NATIONS.get(k) || null;
}

// ---------- crest colours ----------

function parseColor(str) {
  const m = /rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)/.exec(str || "");
  if (!m) return null;
  let a = 1;
  if (m[4] !== undefined) a = m[4].endsWith("%") ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
  return a < 0.3 ? null : [Math.round(+m[1]), Math.round(+m[2]), Math.round(+m[3])];
}

// The generated crest is drawn with coloured layers; read their colours
function readCrestColors(logo) {
  const out = [];
  const add = (str) => {
    const c = parseColor(str);
    if (!c) return;
    if (out.some((o) => Math.hypot(o[0] - c[0], o[1] - c[1], o[2] - c[2]) < 14)) return;
    out.push(c);
  };
  for (const el of [logo, ...logo.querySelectorAll("*:not(img)")]) {
    const cs = getComputedStyle(el);
    add(cs.backgroundColor);
    const bi = cs.backgroundImage;
    if (bi && bi !== "none") for (const m of bi.matchAll(/rgba?\([^)]*\)/g)) add(m[0]);
  }
  // an all-grey crest carries no colour information
  if (out.every((c) => Math.max(...c) - Math.min(...c) < 20)) return [];
  return out.slice(0, 4);
}

// ---------- which club is this crest? ----------

const idSlugs = new Map(); // link id -> slugs seen (to spot ids shared by several clubs)

function teamFromAnchor(a) {
  const m = (a.getAttribute("href") || "").match(LINK_HREF);
  if (!m) return null;
  let rawSlug = m[3] || "";
  try { rawSlug = decodeURIComponent(rawSlug); } catch (e) {}
  const slugKey = rawSlug.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "");
  const slug = cleanName(rawSlug.replace(/-+/g, " "));
  let name = cleanName(a.textContent);
  // Abbreviations like "FEY" can't be searched: prefer the full name from the link
  if ((!plausible(name) || name.length <= 4) && plausible(slug)) name = slug;
  if (!plausible(name)) return null;

  // "t" = team link, "c" = nation link. The id number alone is not always unique
  // (modded clubs can share one), so the name is part of the key: "t123:club-name".
  const idKey = (m[1] === "nation" ? "c" : "t") + m[2];
  const key = idKey + (slugKey ? ":" + slugKey : "");

  if (slugKey) {
    let seen = idSlugs.get(idKey);
    if (!seen) idSlugs.set(idKey, (seen = new Set()));
    if (!seen.has(slugKey)) {
      seen.add(slugKey);
      if (seen.size === 2 && DEBUG) {
        console.log(`[Club Logos] id ${idKey} is shared by several clubs (${[...seen].join(", ")}); telling them apart by name`);
      }
    }
  }
  return { key, name };
}

// Some layouts wrap a crest/flag in a class that says which side it is,
// with no team name or id anywhere nearby (e.g. "home-team-logo").
function homeAwaySide(el) {
  if (el.closest('[class*="home-team"],[class*="homeTeam"],[class*="team-home"],[class*="home-goals"]')) return "home";
  if (el.closest('[class*="away-team"],[class*="awayTeam"],[class*="team-away"],[class*="away-goals"]')) return "away";
  return null;
}

// Some pages (the lineup editor) spell the two names out directly
function homeAwayNamesFromPage() {
  const h = document.querySelector('[class*="home-team-name"]');
  const a = document.querySelector('[class*="away-team-name"]');
  const home = h && cleanName(h.textContent);
  const away = a && cleanName(a.textContent);
  return home && away ? [home, away] : null;
}

// A match or lineup-editing page's title is usually "Home - Away | Match Simulator"
function matchTeams() {
  const title = (document.title || "").split("|")[0].trim();
  const parts = title.split(/\s+-\s+/).map(cleanName);
  return parts.length === 2 && parts.every((p) => p) ? parts : null;
}

function findByMatchTitle(logo) {
  const teams = matchTeams();
  if (!teams) return null;
  let node = logo.parentElement;
  for (let i = 0; i < 5 && node && node !== document.body; i++, node = node.parentElement) {
    const text = (node.textContent || "").toLowerCase();
    const hits = teams.filter((n) => text.includes(n.toLowerCase()));
    if (hits.length === 1) return { key: "n:" + hits[0].toLowerCase(), name: hits[0] };
    if (hits.length > 1) break; // container holds both clubs: ambiguous
  }
  return null;
}

function findClubRaw(logo) {
  // 1. The crest sits inside a team/nation link
  const own = logo.closest(LINK_SELECTOR);
  if (own) {
    const t = teamFromAnchor(own);
    if (t) return t;
  }
  // 2. Climb up until a container holds exactly one distinct link
  let node = logo.parentElement;
  for (let i = 0; i < 4 && node && node !== document.body; i++, node = node.parentElement) {
    const links = [...node.querySelectorAll(LINK_SELECTOR)].map(teamFromAnchor).filter(Boolean);
    const keys = new Set(links.map((t) => t.key));
    if (keys.size === 1) return links[0];
    if (keys.size > 1) break; // e.g. a fixture row with two clubs: ambiguous
  }
  // 3. A "home"/"away" wrapper class + the page title (no name/id nearby at all)
  const side = homeAwaySide(logo);
  if (side) {
    const names = homeAwayNamesFromPage() || matchTeams();
    if (names) {
      const name = side === "home" ? names[0] : names[1];
      return { key: "n:" + name.toLowerCase(), name };
    }
  }
  // 4. Match pages: use the clubs named in the page title, paired up by position
  const fromTitle = findByMatchTitle(logo);
  if (fromTitle) return fromTitle;
  // 4. Attributes on the crest or its parents
  node = logo;
  for (let i = 0; i < 4 && node && node !== document.body; i++) {
    for (const attr of ["data-club", "data-team", "data-name", "aria-label", "alt"]) {
      const v = cleanName(node.getAttribute && node.getAttribute(attr));
      if (plausible(v, 4)) return { key: "n:" + v.toLowerCase(), name: v };
    }
    node = node.parentElement;
  }
  // 5. Text of neighbouring elements, moving up to 3 levels
  node = logo;
  for (let i = 0; i < 3 && node && node !== document.body; i++) {
    for (const sib of [node.nextElementSibling, node.previousElementSibling]) {
      if (!sib || sib.matches(LOGO_SELECTOR) || sib.querySelector(LOGO_SELECTOR)) continue;
      const t = cleanName(sib.textContent);
      if (plausible(t, 4)) return { key: "n:" + t.toLowerCase(), name: t };
    }
    node = node.parentElement;
  }
  return null;
}

function findClub(logo) {
  const club = findClubRaw(logo);
  if (!club) return null;
  if (club.key[0] === "t") {
    // remember name -> key so name-only pages (match pages) share corrections
    knownClubs.set(nameKey(club.name), club.key);
    return club;
  }
  if (club.key[0] === "c") return club;
  const k = knownClubs.get(nameKey(club.name));
  return k && k !== "?" ? { key: k, name: club.name } : club;
}

// ---------- asking the background script ----------

async function askWithRetry(club, colors, attempt) {
  const res = await new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "badge", key: club.key, name: club.name, colors }, (r) =>
      resolve(chrome.runtime.lastError ? "RETRY" : r)
    );
  });
  // "RETRY" = temporary problem (e.g. rate limit): wait and ask again.
  if (res === "RETRY" && attempt < 5) {
    await new Promise((r) => setTimeout(r, 15000));
    return askWithRetry(club, colors, attempt + 1);
  }
  return res === "RETRY" ? null : res || null;
}

function getBadge(club, colors) {
  if (!pending.has(club.key)) pending.set(club.key, askWithRetry(club, colors, 0));
  return pending.get(club.key);
}

// ---------- putting logos and flags on the page ----------

function describe(info) {
  if (info.source === "override") return "your choice";
  const pct = (v) => Math.round((v || 0) * 100) + "%";
  const parts = [];
  if (info.via === "colors") parts.push(`closest colours ${pct(info.colorScore)}`);
  else {
    parts.push(`name ${pct(info.nameScore != null ? info.nameScore : info.score)}`);
    if (info.colorScore != null) parts.push(`colours ${pct(info.colorScore)}`);
  }
  if (info.from) parts.push(info.from);
  return parts.join(", ");
}

function hideCrestLayers(logo) {
  logo.querySelectorAll(".logo-inner, .logo-outer").forEach((el) => {
    el.style.display = "none";
  });
}

function applyLogo(logo, club, info) {
  if (logo.querySelector("img[data-ms-logo]")) return;
  hideCrestLayers(logo);
  const img = document.createElement("img");
  img.src = info.url;
  img.alt = "";
  img.dataset.msLogo = "1";
  img.title = `${club.name} \u2192 ${info.matched} (${describe(info)}). Alt+click to correct.`;
  img.style.cssText =
    "position:absolute;top:0;left:0;width:100%;height:100%;object-fit:contain;";
  logo.appendChild(img);
}

// nationCode() first (instant, the built-in list); if the name isn't
// recognised - a modded or renamed federation - ask Wikipedia/Commons.
async function resolveFlagSrc(name) {
  if (!name) return null;
  const code = nationCode(name);
  if (code) return flagUrl(code);
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "nationFlag", name }, (res) =>
      resolve(chrome.runtime.lastError ? null : (res && res.url) || null)
    );
  });
}

function applyFlag(logo, club, src) {
  if (logo.querySelector("img[data-ms-logo]")) return;
  hideCrestLayers(logo);
  const img = document.createElement("img");
  img.src = src;
  img.alt = club.name;
  img.dataset.msLogo = "1";
  img.title = club.name;
  const size = FLAG_BOX_WIDTH_PX
    ? `width:${FLAG_BOX_WIDTH_PX}px;height:${Math.round((FLAG_BOX_WIDTH_PX * 3) / 4)}px;`
    : `width:${FLAG_BOX_SCALE * 100}%;aspect-ratio:4/3;height:auto;`;
  img.style.cssText =
    "position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);object-fit:fill;max-width:none;" + size;
  logo.appendChild(img);
}

function resetLogo(logo) {
  logo.querySelectorAll("img[data-ms-logo]").forEach((el) => el.remove());
  logo.querySelectorAll(".logo-inner, .logo-outer").forEach((el) => {
    el.style.display = "";
  });
  delete logo.dataset[MARK];
  observed.delete(logo);
}

function process(logo) {
  if (logo.dataset[MARK]) return;
  const club = findClub(logo);
  if (!club) {
    observed.delete(logo); // try again on the next page change
    if (DEBUG && !warned.has(logo)) {
      warned.add(logo);
      console.log("[Club Logos] no club found for", logo);
    }
    return;
  }
  logo.dataset[MARK] = "1";
  logo.dataset.msKey = club.key;
  logo.dataset.msName = club.name;

  // Nations get a flag, not a club logo. A "/nation/" link (key starts "c")
  // is always a nation, even when its name isn't in the built-in list (a
  // modded or renamed federation) - those get the Wikipedia/Commons fallback.
  const quickCode = nationCode(club.name);
  if (quickCode) {
    applyFlag(logo, club, flagUrl(quickCode));
    if (DEBUG) console.log(`[Club Logos] ${club.name} -> flag ${quickCode}`);
    return;
  }
  if (club.key[0] === "c") {
    resolveFlagSrc(club.name).then((src) => {
      if (src) {
        applyFlag(logo, club, src);
        if (DEBUG) console.log(`[Club Logos] ${club.name} -> flag (via Wikipedia)`);
      } else if (DEBUG) {
        console.log(`[Club Logos] no flag found for nation "${club.name}"`);
      }
    });
    return;
  }

  const colors = readCrestColors(logo);
  getBadge(club, colors).then((info) => {
    if (info && info.url) {
      if (DEBUG) console.log(`[Club Logos] ${club.name} (${club.key}) -> ${info.matched} [${describe(info)}; ${colors.length} crest colours]`);
      applyLogo(logo, club, info);
    } else if (DEBUG) {
      const near = info && info.matched ? `closest was "${info.matched}" at ${Math.round((info.score || 0) * 100)}%` : "nothing found";
      console.log(`[Club Logos] no logo for ${club.name} (${club.key}): ${near}. Alt+click the crest to pick one.`);
    }
  });
}

// ---------- the site's own small flag images ----------

const TEAM_OR_NATION_LINK = 'a[href*="/team/"],a[href*="/nation/"]';

function flagContextNames(img) {
  const out = [img.alt, img.title, img.getAttribute("aria-label")];
  const ownLink = img.closest(TEAM_OR_NATION_LINK);
  if (ownLink) {
    const t = teamFromAnchor(ownLink);
    if (t) out.unshift(t.name);
  }
  // In some tables the flag sits next to the link as a sibling, not inside
  // it or a shared wrapper (e.g. <a href=".../new-caledonia">NCA</a> <img>).
  // A nearby team/nation link's full name is more reliable than text like
  // "NCA", so it's tried first.
  // Climb from the flag outwards, but stop at the first level that holds a
  // team/nation link: higher up (the whole table row) the *other* team's link
  // is also inside, which made the away flag copy the home flag. A level with
  // two different links is ambiguous and is not used.
  let node = img.parentElement;
  for (let i = 0; i < 3 && node; i++, node = node.parentElement) {
    const links = new Map();
    const texts = [];
    for (const ch of node.childNodes) {
      if (ch === img || (ch.nodeType === 1 && ch.contains(img))) continue;
      if (ch.nodeType === 1) {
        const found = ch.matches(TEAM_OR_NATION_LINK) ? [ch] : [...(ch.querySelectorAll ? ch.querySelectorAll(TEAM_OR_NATION_LINK) : [])];
        let any = false;
        for (const a of found) {
          const t = teamFromAnchor(a);
          if (t) { links.set(t.name, true); any = true; }
        }
        if (any) continue;
      }
      const t = cleanName(ch.textContent);
      if (t && t.length < 40) texts.push(t);
    }
    if (links.size === 1) {
      out.unshift([...links.keys()][0]);
      break;
    }
    if (links.size > 1) break;
    out.push(...texts);
  }
  return out.filter(Boolean);
}

// A flag image has stayed "a flag slot" once it's been handled, even after
// its own src briefly reverts to the site's own asset, so the slots keep a
// stable order to pair up with "home, away".
function isFlagSlot(img) {
  return img.dataset.msFlag === "1" || /\/img\/flags\/\d+\./.test(img.getAttribute("src") || "");
}

function roleName(img, scope, home, away) {
  const list = [...scope.querySelectorAll("img")].filter(isFlagSlot);
  const idx = list.indexOf(img);
  return idx < 0 ? null : idx % 2 === 0 ? home : away;
}

// A fixture/match link's slug is "home-vs-away" - a reliable source of the two
// full names when there's no readable text near the flag itself (e.g. the
// live ticker shows only a 3-letter code like "KIR" beside the flag).
function fixtureSlugTeams(img) {
  const a = img.closest('a[href*="/fixture/"],a[href*="/match/"]');
  if (!a) return null;
  const m = (a.getAttribute("href") || "").match(/\/(?:fixture|match)\/[^/]+\/([^/?#]+)/);
  if (!m) return null;
  const parts = m[1].split(/-vs-/i);
  if (parts.length !== 2) return null;
  const clean = (s) => {
    try { s = decodeURIComponent(s); } catch (e) {}
    return cleanName(s.replace(/-+/g, " "));
  };
  const home = clean(parts[0]), away = clean(parts[1]);
  return home && away ? { anchor: a, home, away } : null;
}

async function processFlagImg(img) {
  let code = null;
  let bestName = null;
  const tryName = (t) => {
    if (!t) return false;
    bestName = bestName || t;
    code = nationCode(t);
    return !!code;
  };
  for (const t of flagContextNames(img)) {
    if (tryName(t)) break;
  }
  // Nearby text didn't resolve it: try a "home"/"away" wrapper class
  if (!code) {
    const side = homeAwaySide(img);
    const names = side && (homeAwayNamesFromPage() || matchTeams());
    if (names) tryName(side === "home" ? names[0] : names[1]);
  }
  // Still nothing: try the fixture/match link's own slug
  if (!code) {
    const fx = fixtureSlugTeams(img);
    if (fx) tryName(roleName(img, fx.anchor, fx.home, fx.away));
  }
  // Still nothing, and we're on the match's own page: use its title
  if (!code) {
    const mt = matchTeams();
    if (mt) tryName(roleName(img, document, mt[0], mt[1]));
  }
  // No numeric-id-based guessing: several of the site's own minor-nation flag
  // images share one placeholder asset number (seen directly: Fiji and Tuvalu
  // both used id 197), so "this number = this country" is not reliable here.
  let src = code ? flagUrl(code) : null;
  // A name was found but it's not in the built-in list (modded/renamed): ask
  // Wikipedia/Commons rather than leaving the site's own flag in place.
  if (!src && bestName) src = await resolveFlagSrc(bestName);
  if (!src) return;
  // Keep the site's own standard size for this flag slot: measure it before
  // swapping the image, then lock that size in so every flag here stays the
  // same size the site normally uses, whatever that is on this page.
  const rect = img.getBoundingClientRect();
  const w = img.width || rect.width;
  const h = img.height || rect.height;
  img.dataset.msFlag = "1";
  img.src = src;
  img.removeAttribute("srcset");
  img.style.setProperty("object-fit", "fill", "important");
  if (w > 0) img.style.setProperty("width", w + "px", "important");
  if (h > 0) img.style.setProperty("height", h + "px", "important");
}

// ---------- scanning ----------

// Only crests near the viewport are looked up
const io = new IntersectionObserver(
  (entries) => {
    for (const e of entries) {
      if (e.isIntersecting) {
        io.unobserve(e.target);
        process(e.target);
      }
    }
  },
  { rootMargin: "300px" }
);

function scan() {
  if (!ready) return;
  document.querySelectorAll('img[src*="/img/flags/"]:not([data-ms-flag])').forEach(processFlagImg);
  document.querySelectorAll(LOGO_SELECTOR).forEach((logo) => {
    if (logo.dataset[MARK]) {
      // During a live simulation the site can rebuild a crest's own content
      // (wiping the logo image we added) without replacing the crest box
      // itself, so it looks untouched to us. Notice that and put it back,
      // reusing the result already found rather than searching again.
      if (!logo.querySelector("img[data-ms-logo]")) {
        delete logo.dataset[MARK];
        process(logo);
      }
      return;
    }
    if (observed.has(logo)) return;
    observed.add(logo);
    io.observe(logo);
  });
}

function refreshKey(key) {
  pending.delete(key);
  document.querySelectorAll(LOGO_SELECTOR).forEach((logo) => {
    if (logo.dataset.msKey === key) resetLogo(logo);
  });
  scan();
}

function refreshAll() {
  pending.clear();
  document.querySelectorAll(LOGO_SELECTOR).forEach(resetLogo);
  scan();
}

// ---------- backup: export / import of corrections ----------

function exportCorrections() {
  chrome.runtime.sendMessage({ type: "exportOverrides" }, (data) => {
    if (chrome.runtime.lastError || !data) return;
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "club-logo-corrections.json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
}

function importCorrections() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "application/json,.json";
  input.addEventListener("change", async () => {
    const file = input.files && input.files[0];
    if (!file) return;
    let data;
    try {
      data = JSON.parse(await file.text());
    } catch (e) {
      alert("Club Logos: that file isn't valid JSON.");
      return;
    }
    chrome.runtime.sendMessage({ type: "importOverrides", data }, (res) => {
      if (chrome.runtime.lastError || !res) {
        alert("Club Logos: import failed.");
        return;
      }
      alert(`Club Logos: imported ${res.imported} correction(s)` + (res.skipped ? `, skipped ${res.skipped} invalid.` : "."));
      closePicker();
      refreshAll();
    });
  });
  input.click();
}

// ---------- correction dialog (Alt+click on a crest) ----------

function closePicker() {
  const old = document.getElementById("ms-logo-picker");
  if (old) old.remove();
}

function el(tag, css, text) {
  const e = document.createElement(tag);
  if (css) e.style.cssText = css;
  if (text) e.textContent = text;
  return e;
}

function openPicker(logo) {
  closePicker();
  const club = logo.dataset.msKey
    ? { key: logo.dataset.msKey, name: logo.dataset.msName }
    : findClub(logo);
  if (!club) {
    alert("Club Logos: couldn't tell which club this crest belongs to.");
    return;
  }
  if (nationCode(club.name) || club.key[0] === "c") {
    alert(`Club Logos: "${club.name}" is a nation, so it shows a flag automatically.`);
    return;
  }

  const box = el(
    "div",
    "position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:min(440px,92vw);" +
      "max-height:80vh;overflow:auto;background:#fff;color:#111;border-radius:10px;" +
      "box-shadow:0 10px 40px rgba(0,0,0,.45);padding:14px;z-index:2147483647;" +
      "font:14px system-ui,sans-serif;"
  );
  box.id = "ms-logo-picker";
  box.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Escape") closePicker();
  });
  box.addEventListener("click", (e) => e.stopPropagation());

  box.appendChild(el("div", "font-weight:600;", `Correct logo for: ${club.name}`));
  box.appendChild(el("div", "color:#777;font-size:12px;margin-bottom:8px;", `Club id: ${club.key}`));

  const row = el("div", "display:flex;gap:6px;margin-bottom:8px;");
  const input = el("input", "flex:1;padding:6px 8px;border:1px solid #bbb;border-radius:6px;color:#111;background:#fff;");
  input.type = "text";
  input.value = club.name;
  const searchBtn = el("button", "padding:6px 12px;cursor:pointer;", "Search");
  row.append(input, searchBtn);
  box.appendChild(row);

  const status = el("div", "margin-bottom:8px;color:#555;font-size:13px;");
  const grid = el("div", "display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:10px;");

  const urlRow = el("div", "display:flex;gap:6px;margin-bottom:10px;");
  const urlInput = el("input", "flex:1;padding:6px 8px;border:1px solid #bbb;border-radius:6px;color:#111;background:#fff;");
  urlInput.type = "text";
  urlInput.placeholder = "Or paste a direct image URL (https://...)";
  const urlBtn = el("button", "padding:6px 12px;cursor:pointer;", "Use URL");
  urlRow.append(urlInput, urlBtn);
  box.append(status, grid, urlRow);

  const footer = el("div", "display:flex;flex-wrap:wrap;gap:6px;");
  const noneBtn = el("button", "padding:6px 10px;cursor:pointer;", "No logo (keep site crest)");
  const resetBtn = el("button", "padding:6px 10px;cursor:pointer;", "Reset to automatic");
  const exportBtn = el("button", "padding:6px 10px;cursor:pointer;", "Export all corrections");
  const importBtn = el("button", "padding:6px 10px;cursor:pointer;", "Import corrections");
  const closeBtn = el("button", "padding:6px 10px;cursor:pointer;margin-left:auto;", "Close");
  footer.append(noneBtn, resetBtn, exportBtn, importBtn, closeBtn);
  box.appendChild(footer);

  function send(msg) {
    chrome.runtime.sendMessage({ ...msg, name: club.name }, () => {
      closePicker();
      refreshKey(club.key);
    });
  }

  function runSearch() {
    const q = input.value.trim();
    if (!q) return;
    status.textContent = "Searching...";
    grid.textContent = "";
    chrome.runtime.sendMessage({ type: "search", query: q }, (res) => {
      if (chrome.runtime.lastError || !res) {
        status.textContent = "No response from the extension. Reload the page and try again.";
        return;
      }
      if (res.error) {
        status.textContent = res.error;
        return;
      }
      if (!res.results.length) {
        status.textContent = "No clubs found. Try a shorter or different name.";
        return;
      }
      status.textContent = "Click the correct badge:";
      for (const r of res.results) {
        const b = el("button", "display:flex;flex-direction:column;align-items:center;gap:3px;padding:6px 2px;cursor:pointer;background:#f6f6f6;border:1px solid #ddd;border-radius:6px;color:#111;font-size:11px;line-height:1.2;");
        const img = el("img", "width:40px;height:40px;object-fit:contain;");
        img.src = r.url;
        img.alt = "";
        b.append(img, el("span", "", r.name), el("span", "color:#777;", r.country));
        b.title = [r.name, r.league, r.country].filter(Boolean).join(" - ");
        b.addEventListener("click", () =>
          send({ type: "setOverride", key: club.key, url: r.url, label: r.name })
        );
        grid.appendChild(b);
      }
    });
  }

  searchBtn.addEventListener("click", runSearch);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") runSearch();
  });
  noneBtn.addEventListener("click", () => send({ type: "setOverride", key: club.key, url: null, label: null }));
  resetBtn.addEventListener("click", () => send({ type: "clearOverride", key: club.key }));
  closeBtn.addEventListener("click", closePicker);
  urlBtn.addEventListener("click", () => {
    const u = urlInput.value.trim();
    if (!/^https:\/\/\S+$/i.test(u)) {
      status.textContent = "Paste a full https:// image link.";
      return;
    }
    send({ type: "setOverride", key: club.key, url: u, label: "custom URL" });
  });
  exportBtn.addEventListener("click", exportCorrections);
  importBtn.addEventListener("click", importCorrections);

  document.body.appendChild(box);
  input.focus();
  input.select();
  runSearch();
}

// Alt+click on a crest opens the dialog (capture phase: beats the site's own links)
document.addEventListener(
  "click",
  (e) => {
    if (!e.altKey) return;
    const logo = e.target.closest && e.target.closest(LOGO_SELECTOR);
    if (!logo) return;
    e.preventDefault();
    e.stopPropagation();
    openPicker(logo);
  },
  true
);

// ---------- start ----------

// The match page has an empty ".stadium-name" slot; fill it with the home
// club's ground from Wikipedia when we can find one.
// A small red captain's armband: two white stripes, a white "C" in the middle.
// It is pinned to the corner of the shirt icon so it can't be pushed away by the name.
function captainBadge() {
  const span = document.createElement("span");
  span.className = "ms-captain-badge";
  span.title = "Captain";
  span.style.cssText = "position:absolute;top:-4px;right:-12px;line-height:0;z-index:5;pointer-events:none;";
  span.innerHTML =
    '<svg width="20" height="15" viewBox="0 0 16 12" xmlns="http://www.w3.org/2000/svg">' +
    '<rect x="0.5" y="0.5" width="15" height="11" rx="2" fill="#c0392b" stroke="#7a1f14" stroke-width="0.5"/>' +
    '<rect x="0.5" y="2.6" width="15" height="1.3" fill="#fff"/>' +
    '<rect x="0.5" y="8.1" width="15" height="1.3" fill="#fff"/>' +
    '<text x="8" y="8.7" text-anchor="middle" font-size="6.5" font-weight="700" fill="#fff" font-family="Arial, Helvetica, sans-serif">C</text>' +
    "</svg>";
  return span;
}

// The site often shows only a surname ("Kane") where Wikipedia has the full name.
function nameMatches(siteName, wikiName) {
  const s = nameKey(siteName).replace(/\./g, ""), w = nameKey(wikiName).replace(/\./g, "");
  if (!s || !w) return false;
  return s === w || w.endsWith(" " + s) || w.split(" ").pop() === s;
}

function markCaptain(card, captain) {
  if (!captain) return false;
  const wrappers = [...card.querySelectorAll(".player-wrapper")];
  const target = wrappers.find((w) => {
    const n = w.querySelector(".player-name");
    return n && nameMatches(cleanName(n.textContent), captain);
  });
  if (!target) return false;
  const icon = target.querySelector(".player-icon") || target;
  if (!icon.querySelector(".ms-captain-badge")) {
    if (getComputedStyle(icon).position === "static") icon.style.position = "relative";
    icon.appendChild(captainBadge());
  }
  return true;
}

// The site redraws the pitch while simulating; put the armband back if it vanished.
function reapplyCaptains() {
  document.querySelectorAll(".card-header.d-flex[data-ms-captain]").forEach((header) => {
    const card = header.closest(".card");
    if (card && !card.querySelector(".ms-captain-badge")) markCaptain(card, header.dataset.msCaptain);
  });
}

// Edit-lineups page (/match/edit-formations). Players there are
// ".lineup-player-card" blocks (ids homePlayerCard<N> / awayPlayerCard<N>) with
// names like "S. Mijnans". The manager goes right under the Starting XI list,
// the captain gets the armband next to the name.
const plainName = (s) =>
  cleanName(s).normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[.\u2019'`]/g, "").replace(/-/g, " ").toLowerCase().trim();

// "S. Mijnans" (initial + surname) against Wikipedia's full name.
function editorNameMatches(siteName, wikiName) {
  const s = plainName(siteName), w = plainName(wikiName);
  if (!s || !w) return false;
  const parts = s.split(/\s+/);
  if (parts.length < 2 || parts[0].length > 1) return nameMatches(siteName, wikiName); // not an initial form
  const initial = parts[0], surname = parts.slice(1).join(" ");
  return w.startsWith(initial) && (w === surname || w.endsWith(" " + surname));
}

function inlineCaptainBadge() {
  const b = captainBadge();
  b.style.cssText = "display:inline-block;position:static;vertical-align:middle;margin-left:5px;line-height:0;";
  return b;
}

function markEditorCaptain(side, captain) {
  if (!captain) return;
  const cards = [...document.querySelectorAll(`[id^="${side}PlayerCard"]`)];
  cards.forEach((card) => {
    const n = card.querySelector(".player-name");
    if (!n) return;
    const isCap = editorNameMatches(n.textContent, captain);
    const has = n.querySelector(".ms-captain-badge");
    if (isCap && !has) n.appendChild(inlineCaptainBadge());
    else if (!isCap && has) has.remove();
  });
}

function processEditorSide(side) {
  const first = document.getElementById(side + "Player1");
  const nameEl = document.querySelector(`.${side}-team-name`);
  if (!first || !nameEl) return;
  const name = cleanName(nameEl.textContent);
  if (!name) return;
  const body = first.closest(".card-body");
  const tableHost = first.closest("table");
  if (!body || !tableHost) return;
  const store = body.dataset;
  if (store.msFor !== name) {
    store.msFor = name;
    store.msManager = "";
    store.msCaptain = "";
    const old = body.querySelector(":scope > .ms-coach");
    if (old) old.remove();
    chrome.runtime.sendMessage({ type: "clubInfo", name }, (info) => {
      if (chrome.runtime.lastError || !info || body.dataset.msFor !== name) return;
      body.dataset.msManager = info.manager || "";
      body.dataset.msCaptain = info.captain || "";
      processEditorSide(side);
      if (DEBUG) console.log(`[Club Logos] editor ${side} ${name}: manager=${info.manager} captain=${info.captain}`);
    });
    return;
  }
  if (store.msManager && !body.querySelector(":scope > .ms-coach")) {
    const line = document.createElement("div");
    line.className = "ms-coach";
    line.style.cssText = "padding:8px 12px 2px;font-size:13px;opacity:.8;";
    line.textContent = "Manager: " + store.msManager;
    tableHost.insertAdjacentElement("afterend", line);
  }
  markEditorCaptain(side, store.msCaptain);
}

function processEditorPage() {
  processEditorSide("home");
  processEditorSide("away");
}

// The lineup tab has no coach line, so one is added under each team's name.
function processLineupCards() {
  document.querySelectorAll(".card-header.d-flex").forEach((header) => {
    if (header.dataset.msCoachDone) return;
    const span = header.querySelector("span");
    const name = span && cleanName(span.textContent);
    if (!name) return;
    header.dataset.msCoachDone = "1";
    chrome.runtime.sendMessage({ type: "clubInfo", name }, (info) => {
      if (chrome.runtime.lastError || !info) return;
      if (info.manager) {
        const line = document.createElement("div");
        line.className = "ms-coach";
        line.style.cssText = "width:100%;text-align:center;padding:2px 0 4px;font-size:12px;opacity:.75;";
        line.textContent = "Manager: " + info.manager;
        header.insertAdjacentElement("afterend", line);
        if (DEBUG) console.log(`[Club Logos] manager for ${name}: ${info.manager} (from ${info.title})`);
      } else if (DEBUG) {
        console.log(`[Club Logos] no manager found for ${name}`);
      }
      const card = header.closest(".card");
      if (info.captain) header.dataset.msCaptain = info.captain;
      if (card && info.captain) {
        const found = markCaptain(card, info.captain);
        if (DEBUG) console.log(`[Club Logos] captain for ${name}: ${info.captain}${found ? "" : " (not found in this lineup)"}`);
      } else if (card && DEBUG) {
        console.log(`[Club Logos] no captain found for ${name}`);
      }
    });
  });
}

// "Team of the Tournament": the best-rated player in each line (GK/DEF/MID/FWD)
// from matches you've viewed that belong to a given cup. Only this browser,
// only matches actually opened - not a full record of every match simulated.

function cupIdOnPage() {
  const own = /^\/cup\/(\d+)\//.exec(location.pathname);
  if (own) return own[1];
  for (const a of document.querySelectorAll('a[href^="/cup/"]')) {
    const m = /^\/cup\/(\d+)\//.exec(a.getAttribute("href") || "");
    if (m) return m[1];
  }
  return null;
}

function positionBand(y) {
  if (y === null) return "MID";
  if (y >= 80) return "GK";
  if (y >= 55) return "DEF";
  if (y >= 25) return "MID";
  return "FWD";
}

// Reads the current ratings shown on a match's Lineups pitch
function extractMatchRatings() {
  const wrappers = document.querySelectorAll(".player-wrapper");
  if (!wrappers.length) return [];
  const names = homeAwayNamesFromPage() || matchTeams();
  if (!names) return [];
  const out = [];
  wrappers.forEach((w) => {
    const nameEl = w.querySelector(".player-name");
    const ratingEl = w.querySelector(".match-rating");
    const achEl = w.querySelector('[id^="player"]');
    if (!nameEl || !ratingEl || !achEl) return;
    const rating = parseFloat(cleanName(ratingEl.textContent));
    if (!isFinite(rating)) return;
    const side = /^playerH/.test(achEl.id) ? "home" : /^playerA/.test(achEl.id) ? "away" : null;
    if (!side) return;
    const my = /--y:\s*([\d.]+)/.exec(w.getAttribute("style") || "");
    out.push({
      player: cleanName(nameEl.textContent),
      team: side === "home" ? names[0] : names[1],
      rating,
      band: positionBand(my ? parseFloat(my[1]) : null),
    });
  });
  return out;
}

function trackMatchRatings() {
  const recs = extractMatchRatings();
  if (!recs.length) return;
  const cup = cupIdOnPage();
  const key = "totw_all";
  chrome.storage.local.get(key, (r) => {
    const data = (r && r[key]) || {};
    let changed = false;
    for (const rec of recs) {
      const k = rec.team + "|" + rec.player;
      if (!data[k] || rec.rating > data[k].rating) {
        data[k] = { ...rec, cup };
        changed = true;
      }
    }
    if (changed) chrome.storage.local.set({ [key]: data });
  });
}

// One combined pool for every cup. Old per-cup keys (totw_<id>) are merged in once.
function loadAllRatings(done) {
  chrome.storage.local.get(null, (all) => {
    const data = Object.assign({}, (all && all.totw_all) || {});
    const legacy = Object.keys(all || {}).filter((k) => /^totw_\d+$/.test(k));
    legacy.forEach((lk) => {
      const cup = lk.slice(5);
      for (const [k, rec] of Object.entries(all[lk] || {})) {
        if (!data[k] || rec.rating > data[k].rating) data[k] = { ...rec, cup };
      }
    });
    if (legacy.length) {
      chrome.storage.local.set({ totw_all: data }, () => chrome.storage.local.remove(legacy));
    }
    done(data);
  });
}

// Finds the card/section whose heading matches, e.g. "Comments" or "Player availability".
function sectionByHeading(re) {
  const heads = document.querySelectorAll("h1,h2,h3,h4,h5,h6,.card-header,legend,.nav-link,.card-title");
  for (const h of heads) {
    if (h.closest("#ms-totw-wrap")) continue;
    if (re.test(cleanName(h.textContent))) return h.closest(".card") || h.closest("section") || h;
  }
  return null;
}

// Keeps the box above the comments section and under player availability.
function placeTotw() {
  const wrap = document.getElementById("ms-totw-wrap");
  if (!wrap) return;
  const comments = sectionByHeading(/^comments?\b/i);
  if (comments) {
    if (wrap.nextElementSibling !== comments) comments.parentNode.insertBefore(wrap, comments);
    return;
  }
  const avail = sectionByHeading(/player availability|availability/i);
  if (avail) {
    if (wrap.previousElementSibling !== avail) avail.insertAdjacentElement("afterend", wrap);
  }
}

function buildTotwBox(id, title, note, entries) {
  const bands = { GK: [], DEF: [], MID: [], FWD: [] };
  entries.forEach((e) => bands[e.band] && bands[e.band].push(e));
  Object.values(bands).forEach((list) => list.sort((a, b) => b.rating - a.rating));
  const xi = [...bands.GK.slice(0, 1), ...bands.DEF.slice(0, 4), ...bands.MID.slice(0, 3), ...bands.FWD.slice(0, 3)];
  if (!xi.length) return null;
  const box = document.createElement("div");
  box.id = id;
  box.className = "ms-totw";
  box.style.cssText =
    "margin:16px 0;padding:12px 14px;border:1px solid rgba(127,127,127,.35);" +
    "border-radius:8px;background:rgba(127,127,127,.06);font-size:14px;line-height:1.5;";
  const head = document.createElement("div");
  head.innerHTML = "<strong>\u{1F3C5} " + title + '</strong> <span style="font-size:11px;opacity:.6;">' + note + "</span>";
  const list = document.createElement("div");
  list.style.cssText = "margin-top:6px;display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:4px 12px;";
  xi.forEach((e) => {
    const row = document.createElement("div");
    row.textContent = `${e.band} \u2013 ${e.player} (${e.team}) ${e.rating.toFixed(1)}`;
    if (e.cup) row.title = "Cup " + e.cup;
    list.appendChild(row);
  });
  box.append(head, list);
  return box;
}

// Two boxes at the bottom of a cup page: this cup on its own, and all cups together.
function renderTeamOfTournament() {
  const m = /^\/cup\/(\d+)\//.exec(location.pathname);
  if (!m || document.getElementById("ms-totw-wrap")) return;
  loadAllRatings((data) => {
    if (document.getElementById("ms-totw-wrap")) return;
    const all = Object.values(data);
    if (!all.length) return;
    const wrap = document.createElement("div");
    wrap.id = "ms-totw-wrap";
    wrap.style.cssText = "margin:12px auto;padding:0 12px;max-width:1200px;";
    const mine = buildTotwBox(
      "ms-totw-cup", "Team of the Matchday \u2013 this cup", "(only this cup, from matches you've viewed)",
      all.filter((e) => String(e.cup) === m[1])
    );
    const every = buildTotwBox(
      "ms-totw-all", "Team of the Matchday \u2013 all cups", "(all cups together, from matches you've viewed)", all
    );
    if (mine) wrap.appendChild(mine);
    if (every) wrap.appendChild(every);
    if (!wrap.children.length) return;
    document.body.appendChild(wrap);
    placeTotw();
  });
}

// Wikipedia lists the location as "City, Region, Country"; take the city.
function pickPlace(parts, stadium) {
  const ok = (parts || []).filter(
    (p) => p && !/\d/.test(p) && p.toLowerCase() !== (stadium || "").toLowerCase() && !(typeof nationCode === "function" && nationCode(p))
  );
  if (!ok.length) return null;
  return ok[0]; // Wikipedia lists "City, Region, Country"
}

let stadiumHome = "", stadiumText = "";
function fillStadium() {
  const el = document.querySelector(".stadium-name");
  if (!el) return;
  const names = homeAwayNamesFromPage() || matchTeams();
  if (!names) return;
  const home = names[0];
  if (stadiumHome !== home) { stadiumHome = home; stadiumText = ""; el.textContent = ""; }
  if (stadiumText) { // the site may wipe it while re-rendering
    if (cleanName(el.textContent) !== stadiumText) el.textContent = stadiumText;
    return;
  }
  if (cleanName(el.textContent)) return; // the site filled it itself
  if (el.dataset.msAsking === home) return;
  el.dataset.msAsking = home;
  chrome.runtime.sendMessage({ type: "clubInfo", name: home }, (info) => {
    if (chrome.runtime.lastError || !info || !info.stadium) {
      if (DEBUG) console.log(`[Club Logos] no stadium found for ${home}`);
      return;
    }
    const place = pickPlace(info.placeParts, info.stadium);
    stadiumText = place ? `${info.stadium}, ${place}` : info.stadium;
    const cur = document.querySelector(".stadium-name");
    if (cur && !cleanName(cur.textContent) && stadiumHome === home) cur.textContent = stadiumText;
    if (DEBUG) console.log(`[Club Logos] stadium for ${home}: ${stadiumText} (from ${info.title})`);
  });
}

// When ratings from another cup/match are saved, rebuild the box instead of
// keeping the stale one this page drew first.
try {
  chrome.storage.onChanged.addListener((ch, area) => {
    if (area !== "local" || !ch.totw_all) return;
    const old = document.getElementById("ms-totw-wrap");
    if (old) old.remove();
    renderTeamOfTournament();
  });
} catch (e) {}

let timer = null;
new MutationObserver(() => {
  clearTimeout(timer);
  timer = setTimeout(() => {
    scan();
    fillStadium();
    processLineupCards();
    processEditorPage();
    placeTotw();
    reapplyCaptains();
    trackMatchRatings();
    renderTeamOfTournament();
  }, 300);
}).observe(document.body, { childList: true, subtree: true });

// While a cup is being simulated, the site reuses existing flag <img>
// elements and just changes their "src" as fixtures update live, instead of
// adding new elements. The childList observer above only catches new
// elements, so it misses that. This watches for "src" changing back to one
// of the site's own flag images, on any element, and swaps it again.
new MutationObserver((muts) => {
  for (const m of muts) {
    if (m.type !== "attributes" || m.attributeName !== "src") continue;
    const img = m.target;
    if (img.tagName === "IMG" && /\/img\/flags\/\d+\./.test(img.getAttribute("src") || "")) {
      processFlagImg(img);
    }
  }
}).observe(document.body, { subtree: true, attributes: true, attributeFilter: ["src"] });

let loaded = 0;
const onLoaded = () => {
  if (++loaded < 2) return;
  ready = true;
  scan();
};
knownClubs.load(onLoaded);
flagIds.load(onLoaded);
setTimeout(() => {
  fillStadium();
  processLineupCards();
  processEditorPage();
  placeTotw();
  reapplyCaptains();
  trackMatchRatings();
  renderTeamOfTournament();
}, 1000);

if (DEBUG) {
  setTimeout(() => {
    console.log(
      `[Club Logos] ${document.querySelectorAll(LOGO_SELECTOR).length} crests (${LOGO_SELECTOR}) and ` +
        `${document.querySelectorAll('img[src*="/img/flags/"]').length} flag images on this page after 4s`
    );
  }, 4000);
}