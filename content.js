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
// Phones and tablets have no Alt key: there a long press does what Alt+click does.
const TOUCH = (() => { try { return matchMedia("(pointer: coarse)").matches; } catch (e) { return false; } })();
const HOW = TOUCH ? "Long-press" : "Alt+click";

// ---- flags ----
// Flags inside a crest box (4:3): 1 = exactly the box's own standard size.
// Raise this only if you want crest flags bigger than the site's normal size.
const FLAG_BOX_SCALE = 1;
// Or set a number to force one fixed pixel width for every crest flag instead
// (this overrides FLAG_BOX_SCALE).
const FLAG_BOX_WIDTH_PX = null;
// Codes starting with "wiki:" name a Commons file (regions with no ISO code)
const flagUrl = (code) =>
  code.startsWith("wiki:")
    ? `https://commons.wikimedia.org/wiki/Special:FilePath/${code.slice(5)}`
    : `https://cdn.jsdelivr.net/gh/lipis/flag-icons/flags/4x3/${code}.svg`;

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
let disabled = false; // true while the extension is switched off (premium account or manual setting)

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
es-ct|Catalonia
wiki:Flag_of_Zanzibar.svg|Zanzibar;Zanzibar Islands
tt|Trinidad & Tobago;Trinidad Tobago;T&T`;

const natKey = (s) =>
  nameKey(String(s || "").replace(/\s*&\s*/g, " and ").replace(/\s*[\[(]\s*(?:mod|modded|custom|fictional)\s*[\])]/gi, "")).replace(/[.\u2019'`]/g, "").replace(/[-\u2013]/g, " ").replace(/\s+/g, " ").trim();

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
    if (hits.length === 1) {
      const side = teams.indexOf(hits[0]) === 0 ? "home" : "away";
      return idClub(side, hits[0]) || { key: "n:" + hits[0].toLowerCase(), name: hits[0] };
    }
    if (hits.length > 1) break; // container holds both clubs: ambiguous
  }
  return null;
}

// ---------- tracking clubs by their id on match / lineup pages ----------
// Match and lineup-editor pages show names but no ids. Pages that do carry ids
// (cup fixture tables, team lists) are learned from, so the logo of a match page
// uses the same per-club id key as everywhere else:
//  1. a fixture row links "/match/<hash>/..." and holds both team links: hash -> both clubs
//  2. pressing Simulate / Edit line-ups in such a row remembers that pair for the page that opens next
const fixtureTeams = makeStore("fixtureTeams1"); // match hash -> [homeKey, homeName, awayKey, awayName]
const PENDING_KEY = "msPendingPair";
// the store compares values with !==, so a list is kept as one string
const FX_SEP = "\u241f";
const fxGet = (h) => {
  const v = fixtureTeams.get(h);
  const parts = typeof v === "string" && v !== "?" ? v.split(FX_SEP) : null;
  return parts && parts.length === 4 ? parts : null;
};
const fxSet = (h, teams) => fixtureTeams.set(h, teams.join(FX_SEP));

const slugOf = (s) => nameKey(s).replace(/[^a-z0-9]+/g, "");
const sameClubName = (a, b) => {
  const x = slugOf(a), y = slugOf(b);
  return !!x && !!y && (x === y || (x.length >= 4 && y.includes(x)) || (y.length >= 4 && x.includes(y)));
};

function teamsFromRow(row) {
  if (!row) return null;
  const seen = new Map();
  for (const a of row.querySelectorAll(LINK_SELECTOR)) {
    const t = teamFromAnchor(a);
    if (t && !seen.has(t.key)) seen.set(t.key, t);
    if (seen.size === 2) break;
  }
  const list = [...seen.values()];
  return list.length === 2 ? [list[0].key, list[0].name, list[1].key, list[1].name] : null;
}

function learnFixtures() {
  document.querySelectorAll('a[href*="/match/"]').forEach((a) => {
    const m = /\/match\/([0-9a-f]{8,})\//.exec(a.getAttribute("href") || "");
    if (!m || fxGet(m[1])) return;
    const teams = teamsFromRow(a.closest("tr, li, .fixture, .match-row"));
    if (teams) fxSet(m[1], teams);
  });
}

document.addEventListener(
  "click",
  (e) => {
    const btn = e.target.closest && e.target.closest('button[onclick*="simulateMatch"], [onclick*="simulateMatch"]');
    if (!btn) return;
    const teams = teamsFromRow(btn.closest("tr"));
    if (!teams) return;
    try {
      localStorage.setItem(PENDING_KEY, JSON.stringify({ t: Date.now(), teams }));
    } catch (err) {}
  },
  true
);

function pageHash() {
  const m = /^\/match\/([0-9a-f]{8,})\//.exec(location.pathname);
  return m ? m[1] : null;
}

// The club behind the home/away side of the current match page, by id key.
function idClub(side, pageName) {
  const i = side === "home" ? 0 : 2;
  const h = pageHash();
  let teams = h ? fxGet(h) : null;
  let fromPending = false;
  if (!teams) {
    try {
      const p = JSON.parse(localStorage.getItem(PENDING_KEY) || "null");
      if (p && Date.now() - p.t < 15 * 60 * 1000) {
        teams = p.teams;
        fromPending = true;
      }
    } catch (e) {}
  }
  if (!teams || !sameClubName(teams[i + 1], pageName)) return null;
  if (fromPending && h) {
    const names = homeAwayNamesFromPage() || matchTeams();
    if (names && sameClubName(teams[1], names[0]) && sameClubName(teams[3], names[1])) fxSet(h, teams);
  }
  return { key: teams[i], name: pageName };
}

function findClubRaw(logo) {
  // 0. Team lists (logo packs / customization packs): each row is
  //    <div id="teamContainer_<id>"> - that id is the club's own id, so every
  //    club gets its own key ("t<id>:<name>", the same scheme as team links).
  const row = logo.closest('[id^="teamContainer_"]');
  if (row) {
    const id = row.id.replace(/^teamContainer_/, "");
    let name = "";
    for (const el of row.querySelectorAll(".card-body div, .card-body span")) {
      if (el.matches(LOGO_SELECTOR) || el.querySelector(LOGO_SELECTOR) || el.closest(LOGO_SELECTOR)) continue;
      if (el.querySelector("button, svg")) continue;
      const t = cleanName(el.textContent);
      if (plausible(t, 2) && !el.firstElementChild) { name = t; break; }
    }
    if (id && name) {
      const slugKey = name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "");
      return { key: "t" + id + (slugKey ? ":" + slugKey : ""), name };
    }
  }
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
      return idClub(side, name) || { key: "n:" + name.toLowerCase(), name };
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

// Modded teams show up as "Portland Hearts of Pine [Mod]"; the tag must not
// reach the Wikipedia/flag lookups. The key keeps the tag, so corrections stay per modded club.
const stripTag = (s) => cleanName(String(s || "").replace(/\s*[\[(]\s*(?:mod|modded|custom|fictional)\s*[\])]/gi, ""));

function findClub(logo) {
  const raw = findClubRaw(logo);
  const club = raw && { ...raw, name: stripTag(raw.name) || raw.name };
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
  if (info.confidence != null) parts.push(`accuracy ${pct(info.confidence)}`);
  parts.push(`name ${pct(info.nameScore != null ? info.nameScore : info.score)}`);
  parts.push(info.colorScore != null ? `colours ${pct(info.colorScore)}` : "colours not checked");
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
  img.title = `${club.name} \u2192 ${info.matched} (${describe(info)}). ${HOW} to correct.`;
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
  if (disabled || !featureOn("logos")) return;
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
  let w = rect.width || img.width;
  let h = rect.height || img.height;
  // A flag is never legitimately huge. A measurement this big means the image
  // had no size of its own and was showing at its natural size (e.g. the 512px
  // flags in the "Automatically qualified" cards), so use a small 4:3 size that
  // fits the line of text beside it instead of locking the huge one in.
  const MAX_FLAG = 96;
  if (w > MAX_FLAG || h > MAX_FLAG || !(w > 0) || !(h > 0)) {
    const box = img.closest(".logo-container") || img.parentElement;
    const br = box ? box.getBoundingClientRect() : null;
    if (br && br.height > 0 && br.height <= MAX_FLAG && br.width <= MAX_FLAG * 2) {
      h = br.height;
      w = Math.round(h * 4 / 3);
    } else {
      h = 28;
      w = 37;
    }
  }
  img.dataset.msFlag = "1";
  img.src = src;
  img.removeAttribute("srcset");
  img.style.setProperty("object-fit", "fill", "important");
  img.style.setProperty("width", w + "px", "important");
  img.style.setProperty("height", h + "px", "important");
  img.style.setProperty("max-width", "none", "important");
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
  if (!ready || disabled) return;
  learnFixtures();
  if (!featureOn("logos")) return;
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
  const detailsBtn = el("button", "padding:6px 10px;cursor:pointer;", "Edit manager / stadium / captain");
  detailsBtn.addEventListener("click", () => { closePicker(); openDetailsDialog(club.name); });
  const resetAllBtn = el("button", "padding:6px 10px;cursor:pointer;", "Reset all logos");
  const closeBtn = el("button", "padding:6px 10px;cursor:pointer;margin-left:auto;", "Close");
  footer.append(noneBtn, resetBtn, detailsBtn, resetAllBtn, exportBtn, importBtn, closeBtn);
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
  resetAllBtn.addEventListener("click", () => { if (confirmResetAll()) closePicker(); });
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
    if (!e.altKey || disabled) return;
    const refEl = e.target.closest && e.target.closest(".ms-referee");
    if (refEl) {
      e.preventDefault();
      e.stopPropagation();
      editReferee();
      return;
    }
    const part = e.target.closest && e.target.closest(".ms-coach, .stadium-name, .ms-captain-badge");
    if (part) {
      const n = clubNameForElement(part);
      if (n) {
        e.preventDefault();
        e.stopPropagation();
        openDetailsDialog(n);
      }
      return;
    }
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
  if (disabled || !featureOn("details")) return;
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
    askInfo(name, (info) => {
      if (body.dataset.msFor !== name) return;
      body.dataset.msInfoLoaded = "1";
      body.dataset.msManager = info.manager || "";
      body.dataset.msCaptain = info.captain || "";
      processEditorSide(side);
      if (DEBUG) console.log(`[Club Logos] editor ${side} ${name}: manager=${info.manager} captain=${info.captain}`);
    });
    return;
  }
  if (store.msInfoLoaded && !body.querySelector(":scope > .ms-coach")) {
    const line = document.createElement("div");
    line.className = "ms-coach";
    line.dataset.msClub = name;
    line.title = HOW + " to change the manager, stadium or captain";
    line.style.cssText = "padding:8px 12px 2px;font-size:13px;opacity:" + (store.msManager ? ".8" : ".45") + ";";
    line.textContent = store.msManager ? "Manager: " + store.msManager : "Manager: unknown (" + HOW + " to add)";
    tableHost.insertAdjacentElement("afterend", line);
  }
  markEditorCaptain(side, store.msCaptain);
}

function processEditorPage() {
  if (disabled || !featureOn("details")) return;
  processEditorSide("home");
  processEditorSide("away");
}

// The lineup tab has no coach line, so one is added under each team's name.
function processLineupCards() {
  if (disabled || !featureOn("details")) return;
  document.querySelectorAll(".card-header.d-flex").forEach((header) => {
    if (header.dataset.msCoachDone) return;
    const span = header.querySelector("span");
    const name = span && cleanName(span.textContent);
    if (!name) return;
    header.dataset.msCoachDone = "1";
    askInfo(name, (info) => {
      const line = document.createElement("div");
      line.className = "ms-coach";
      line.dataset.msClub = name;
      line.title = HOW + " to change the manager, stadium or captain";
      line.style.cssText = "width:100%;text-align:center;padding:2px 0 4px;font-size:12px;opacity:" + (info.manager ? ".75" : ".45") + ";";
      line.textContent = info.manager ? "Manager: " + info.manager : "Manager: unknown (" + HOW + " to add)";
      header.insertAdjacentElement("afterend", line);
      if (DEBUG) console.log(`[Club Logos] manager for ${name}: ${info.manager || "none"}`);
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
  if (disabled || !featureOn("details")) return;
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
  askInfo(home, (info) => {
    if (stadiumHome !== home) return;
    if (info.stadium) {
      const place = pickPlace(info.placeParts, info.stadium);
      stadiumText = place ? `${info.stadium}, ${place}` : info.stadium;
    } else {
      stadiumText = "Stadium unknown (" + HOW + " to add)";
    }
    const cur = document.querySelector(".stadium-name");
    if (cur) {
      cur.textContent = stadiumText;
      cur.title = HOW + " to change the stadium, manager or captain";
    }
    if (DEBUG) console.log(`[Club Logos] stadium for ${home}: ${stadiumText}`);
  });
}

// A new version of the extension starts from clean VAR data, so decisions made by an older
// version are made again with the current rules (nothing the user typed is touched).
try {
  const ver = chrome.runtime.getManifest().version;
  if (localStorage.getItem("msExtVersion") !== ver) {
    localStorage.removeItem("msVarGoals2");
    localStorage.removeItem("msVarSeen2");
    localStorage.setItem("msExtVersion", ver);
  }
} catch (e) {}

let timer = null;
new MutationObserver(() => {
  clearTimeout(timer);
  timer = setTimeout(() => {
    detectPremium();
    scan();
    fillStadium();
    processLineupCards();
    fillReferee();
    updateCoachCards();
    processEditorPage();
    reapplyCaptains();
    updateSuspensionTable();
    autoVarScan();
    applyVarToCup();
    applyVarToStatsPage();
    applyVarToStandings();
    fixResultLetters();
    if (pageHash()) expireSuspensions(pageHash());
  }, 300);
}).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["href"] });

// While a cup is being simulated the site updates scores in place, and not every kind of
// in-place change is seen above, so the VAR changes are also re-checked now and then.
setInterval(() => {
  if (disabled || document.hidden) return;
  try { autoVarScan(); varApplyAll(); fixResultLetters(); } catch (e) {}
}, 1500);

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

// ---------- your own manager / stadium / captain entries ----------
// Wikipedia has nothing for many modded or niche clubs, so these can be typed in
// (Alt+click the manager line, the stadium, a captain armband, or use the
// logo dialog). Entries are kept per club name; "-" hides a value.
let infoOv = {};
const INFO_OV_KEY = "infoOverrides1";
const ovKeyOf = (name) => slugOf(stripTag(name));
const ovFor = (name) => infoOv[ovKeyOf(name)] || {};

function saveInfoOv() {
  try { chrome.storage.local.set({ [INFO_OV_KEY]: infoOv }); } catch (e) {}
}

function applyInfoOverrides(info, name) {
  const ov = ovFor(name);
  const out = Object.assign({}, info || {});
  const pick = (v) => (v === "-" ? null : v);
  if (ov.manager) out.manager = pick(ov.manager);
  if (ov.captain) out.captain = pick(ov.captain);
  if (ov.stadium) {
    out.stadium = pick(ov.stadium);
    out.placeParts = ov.place && ov.place !== "-" ? [ov.place] : [];
  } else if (ov.place) {
    out.placeParts = ov.place === "-" ? [] : [ov.place];
  }
  return out;
}

// club info from Wikipedia with your entries applied
function askInfo(name, cb) {
  const nation = !!nationCode(stripTag(name));
  chrome.runtime.sendMessage({ type: "clubInfo", name, nation }, (info) => {
    const bad = chrome.runtime.lastError || !info;
    cb(applyInfoOverrides(bad ? {} : info, name), bad ? null : info);
  });
}

function clubNameForElement(t) {
  if (t.closest(".ms-coach")) return t.closest(".ms-coach").dataset.msClub || null;
  if (t.closest(".stadium-name")) return stadiumHome || null;
  const badge = t.closest(".ms-captain-badge");
  if (badge) {
    const pc = badge.closest('[id^="homePlayerCard"], [id^="awayPlayerCard"]');
    if (pc) {
      const side = pc.id.startsWith("home") ? "home" : "away";
      const n = document.querySelector(`.${side}-team-name`);
      return n ? cleanName(n.textContent) : null;
    }
    const span = badge.closest(".card") && badge.closest(".card").querySelector(".card-header.d-flex span");
    return span ? cleanName(span.textContent) : null;
  }
  return null;
}

function refreshDetails() {
  document.querySelectorAll(".ms-coach, .ms-captain-badge").forEach((n) => n.remove());
  document.querySelectorAll(".card-header.d-flex").forEach((h) => { delete h.dataset.msCoachDone; delete h.dataset.msCaptain; });
  document.querySelectorAll("[data-ms-for]").forEach((b) => { delete b.dataset.msFor; delete b.dataset.msInfoLoaded; });
  const st = document.querySelector(".stadium-name");
  if (st) { st.textContent = ""; delete st.dataset.msAsking; }
  stadiumHome = ""; stadiumText = "";
  processLineupCards();
  fillReferee();
  updateCoachCards();
  processEditorPage();
  fillStadium();
}

function openDetailsDialog(name) {
  const old = document.getElementById("ms-details");
  if (old) old.remove();
  const ov = Object.assign({}, ovFor(name));
  const box = el(
    "div",
    "position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:min(400px,92vw);max-height:90vh;overflow:auto;background:#fff;color:#111;" +
      "border-radius:10px;box-shadow:0 10px 40px rgba(0,0,0,.45);padding:14px;z-index:2147483647;font:14px system-ui,sans-serif;"
  );
  box.id = "ms-details";
  box.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Escape") box.remove(); });
  box.addEventListener("click", (e) => e.stopPropagation());
  box.append(el("div", "font-weight:600;", `Details for: ${stripTag(name)}`));
  box.append(el("div", "color:#777;font-size:12px;margin-bottom:8px;", 'Leave a field empty for the automatic (Wikipedia) value, or type "-" to show nothing.'));

  const fields = {};
  [["manager", "Manager"], ["stadium", "Stadium"], ["place", "Place (city)"], ["captain", "Captain (as on Wikipedia, e.g. full name)"]].forEach(([k, label]) => {
    box.append(el("div", "font-size:12px;color:#555;margin-top:6px;", label));
    const input = el("input", "width:100%;padding:6px 8px;border:1px solid #bbb;border-radius:6px;color:#111;background:#fff;box-sizing:border-box;");
    input.type = "text";
    input.value = ov[k] || "";
    input.placeholder = "automatic";
    fields[k] = input;
    box.append(input);
  });
  // show what the automatic lookup found as placeholders
  chrome.runtime.sendMessage({ type: "clubInfo", name, nation: !!nationCode(stripTag(name)) }, (info) => {
    if (chrome.runtime.lastError || !info) return;
    const place = pickPlace(info.placeParts, info.stadium);
    if (info.manager) fields.manager.placeholder = info.manager + " (automatic)";
    if (info.stadium) fields.stadium.placeholder = info.stadium + " (automatic)";
    if (place) fields.place.placeholder = place + " (automatic)";
    if (info.captain) fields.captain.placeholder = info.captain + " (automatic)";
  });

  const row = el("div", "display:flex;gap:6px;margin-top:12px;");
  const save = el("button", "padding:6px 12px;cursor:pointer;", "Save");
  const auto = el("button", "padding:6px 12px;cursor:pointer;", "Use automatic");
  const close = el("button", "padding:6px 12px;cursor:pointer;margin-left:auto;", "Close");
  row.append(save, auto, close);
  box.append(row);

  save.addEventListener("click", () => {
    const next = {};
    for (const [k, input] of Object.entries(fields)) if (input.value.trim()) next[k] = input.value.trim();
    if (Object.keys(next).length) infoOv[ovKeyOf(name)] = next;
    else delete infoOv[ovKeyOf(name)];
    saveInfoOv();
    box.remove();
    refreshDetails();
  });
  auto.addEventListener("click", () => {
    delete infoOv[ovKeyOf(name)];
    saveInfoOv();
    box.remove();
    refreshDetails();
  });
  close.addEventListener("click", () => box.remove());
  document.body.appendChild(box);
  fields.manager.focus();
}

// ---------- referees ----------
// The site shows no referee, so one is picked per match from a pool of well-known referees,
// the same one on every page load. In a national-team match a referee from one of the two
// countries is skipped. Alt+click the referee line to type another name for this match.
const REFEREES = [
  ["Szymon Marciniak", "POL", "pl"], ["Michael Oliver", "ENG", "gb-eng"], ["Anthony Taylor", "ENG", "gb-eng"],
  ["Cl\u00e9ment Turpin", "FRA", "fr"], ["Fran\u00e7ois Letexier", "FRA", "fr"], ["Slavko Vin\u010di\u0107", "SVN", "si"],
  ["Danny Makkelie", "NED", "nl"], ["Felix Zwayer", "GER", "de"], ["Daniel Siebert", "GER", "de"],
  ["Istv\u00e1n Kov\u00e1cs", "ROU", "ro"], ["Artur Soares Dias", "POR", "pt"], ["Jes\u00fas Gil Manzano", "ESP", "es"],
  ["Carlos del Cerro Grande", "ESP", "es"], ["Glenn Nyberg", "SWE", "se"], ["Davide Massa", "ITA", "it"],
  ["Marco Guida", "ITA", "it"], ["Facundo Tello", "ARG", "ar"], ["Wilton Sampaio", "BRA", "br"],
  ["Raphael Claus", "BRA", "br"], ["Ismail Elfath", "USA", "us"], ["Mustapha Ghorbal", "ALG", "dz"],
  ["Alireza Faghani", "AUS", "au"], ["Ma Ning", "CHN", "cn"], ["Andr\u00e9s Matonte", "URU", "uy"],
  ["Piero Maza", "CHI", "cl"],
];
const REF_OV_KEY = "msRefOverrides";

function refereeFor(hash, teams) {
  const codes = teams.map((t) => (nationCode(stripTag(t)) || "").toLowerCase()).filter(Boolean);
  let pool = REFEREES.filter((r) => !codes.includes(r[2]));
  if (!pool.length) pool = REFEREES;
  const u = seededRandoms(hash + "|referee", 1)[0];
  return pool[Math.floor(u * pool.length)];
}

function refOverrides() {
  try { return JSON.parse(localStorage.getItem(REF_OV_KEY) || "{}"); } catch (e) { return {}; }
}

function fillReferee() {
  if (disabled || !featureOn("details")) return;
  const slot = document.querySelector(".stadium-name");
  const hash = pageHash();
  const teams = homeAwayNamesFromPage() || matchTeams();
  if (!slot || !hash || !teams) return;
  let line = document.querySelector(".ms-referee");
  if (!line) {
    line = document.createElement("div");
    line.className = "ms-referee fw-200";
    line.style.cssText = "font-size:12px;opacity:.75;margin-top:2px;";
    line.title = HOW + " to change the referee for this match";
    slot.insertAdjacentElement("afterend", line);
  }
  const ov = refOverrides()[hash];
  const ref = refereeFor(hash, teams);
  const text = ov ? `Referee: ${ov}` : `Referee: ${ref[0]} (${ref[1]})`;
  if (line.textContent !== text) line.textContent = text;
}

function editReferee() {
  const hash = pageHash();
  if (!hash) return;
  const all = refOverrides();
  const cur = all[hash] || "";
  const v = prompt('Referee for this match (leave empty for the automatic one):', cur);
  if (v === null) return;
  if (v.trim()) all[hash] = v.trim();
  else delete all[hash];
  try { localStorage.setItem(REF_OV_KEY, JSON.stringify(all)); } catch (e) {}
  fillReferee();
}

// ---------- coach cards ----------
// The site has no cards for managers, so they are rolled from the match: a team whose own
// players collect cards is more likely to see its manager booked. A card is a real event:
// it gets a minute, appears in the Summary timeline and in the Commentary, and shows as a
// small card next to "Manager: ..." on the Lineups tab. The roll is seeded by match + side,
// so it is the same on every page load, and a card never goes away while the match is live.
const COACH_KEY = "msCoachCards3";

function seededRandoms(seed, n) {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  const out = [];
  for (let i = 0; i < n; i++) {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    out.push(((t ^ (t >>> 14)) >>> 0) / 4294967296);
  }
  return out;
}

// -> { y: minute|0, r: minute|0 }  (0 = no card of that kind)
function rollCoachCard(hash, side, yellows, reds) {
  const [u1, u2, u3, u4, u5] = seededRandoms(hash + "|" + side, 5);
  const pYellow = Math.min(0.75, 0.07 + 0.14 * reds + 0.05 * yellows);
  const pRed = Math.min(0.5, 0.1 + 0.1 * reds);
  const pDirectRed = Math.min(0.2, 0.012 * reds);
  const yMin = 18 + Math.floor(u4 * 67); // 18..84
  const out = { y: 0, r: 0 };
  if (u3 < pDirectRed) {
    out.r = 25 + Math.floor(u5 * 60);
  } else if (u1 < pYellow) {
    out.y = yMin;
    if (u2 < pRed) out.r = Math.min(90, yMin + 4 + Math.floor(u5 * 18));
  }
  return out;
}

// cards of the team's own players, from the Summary timeline (home events have no side class)
function countPlayerCards(side) {
  let yellows = 0, reds = 0;
  document.querySelectorAll("#timelineContainer .timeline-event").forEach((ev) => {
    if (ev.dataset.msCoach) return; // our own events
    const away = ev.classList.contains("side-away");
    if ((side === "away") !== away) return;
    if (ev.querySelector("i.yellow-card")) yellows++;
    else if (ev.querySelector("i.red-card")) reds++;
  });
  return { yellows, reds };
}

const minuteValue = (txt) => {
  const m = /(\d+)'/.exec(txt || "");
  if (!m) return null;
  const add = /\+\s*(\d+)/.exec(txt);
  return +m[1] + (add ? +add[1] / 100 : 0);
};

// minute the match has reached (Infinity once it's finished)
function currentMinute() {
  const items = document.querySelectorAll("#feedTab .timeline > .timeline-item");
  let best = 0;
  for (const it of items) {
    const content = cleanName(it.querySelector(".timeline-item-content") ? it.querySelector(".timeline-item-content").textContent : "");
    if (/match finished|full[- ]time/i.test(content)) return Infinity;
    const v = minuteValue(it.querySelector(".timeline-item-marker-text") ? it.querySelector(".timeline-item-marker-text").textContent : "");
    if (v !== null && v > best) best = v;
  }
  return best;
}

const YELLOW_LINES = [
  (t, m) => `Tempers flare on the touchline and ${t} manager ${m} is shown a yellow card.`,
  (t, m) => `${m} (${t} manager) is booked for protesting too loudly from the technical area.`,
  (t, m) => `The referee has had enough of ${m} on the touchline: yellow card for the ${t} manager.`,
];
const RED_LINES = [
  (t, m) => `Red card! ${t} manager ${m} is sent to the stands.`,
  (t, m) => `${m} sees red on the touchline and the ${t} manager has to leave the technical area!`,
  (t, m) => `The ${t} manager ${m} is dismissed by the referee after a furious protest.`,
];

// kinds: coach/bench yellow & red cards, VAR checks
const KIND = {
  yellow: { ind: "bg-yellow-soft text-yellow", icon: "fa-mobile bg-yellow", sum: "fa-mobile yellow-card" },
  red: { ind: "bg-red-soft text-red", icon: "fa-mobile bg-red", sum: "fa-mobile red-card" },
  var: { ind: "bg-primary-soft text-primary", icon: "fa-video", sum: "fa-video text-primary" },
};

function addFeedEvent(tag, minute, kind, text) {
  const list = document.querySelector("#feedTab .timeline");
  if (!list || list.querySelector(`[data-ms-coach="${tag}"]`)) return;
  const k = KIND[kind];
  const item = document.createElement("div");
  item.className = "timeline-item";
  item.dataset.msCoach = tag;
  const marker = document.createElement("div");
  marker.className = "timeline-item-marker";
  const mt = document.createElement("div");
  mt.className = "timeline-item-marker-text";
  mt.textContent = Math.floor(minute) + "'";
  const ind = document.createElement("div");
  ind.className = "timeline-item-marker-indicator " + k.ind;
  const icon = document.createElement("i");
  icon.className = "fas " + k.icon;
  ind.appendChild(icon);
  marker.append(mt, ind);
  const content = document.createElement("div");
  content.className = "timeline-item-content";
  content.textContent = text;
  item.append(marker, content);
  // newest first: go above the first item that is not later than this minute
  placeByMinute(list, item, minute);
}

function addSummaryEvent(tag, minute, kind, side, label) {
  const box = document.querySelector("#timelineContainer");
  if (!box || box.querySelector(`[data-ms-coach="${tag}"]`)) return;
  const ev = document.createElement("div");
  ev.className = "timeline-event" + (side === "away" ? " side-away" : "");
  ev.dataset.msCoach = tag;
  const mn = document.createElement("div");
  mn.className = "event-minute";
  mn.textContent = Math.floor(minute) + "'";
  const ic = document.createElement("div");
  ic.className = "event-icon";
  const i = document.createElement("i");
  i.className = "fas " + KIND[kind].sum;
  ic.appendChild(i);
  const pl = document.createElement("div");
  pl.className = "event-player";
  pl.textContent = label;
  ev.append(mn, ic, pl);
  placeByMinute(box, ev, minute);
}

// Our own entries are put where their minute belongs (newest first). The site builds its
// timeline in steps, so an entry added early can end up below events that arrive later;
// settleOrder() moves it again whenever it is out of place.
const SUM_MINUTE = (e) => minuteValue((e.querySelector(".event-minute") || {}).textContent);
const FEED_MINUTE = (it) => {
  if (/match finished/i.test(it.textContent)) return null;
  const t = it.querySelector(".timeline-item-marker-text");
  return t ? minuteValue(t.textContent) : null;
};
function placeByMinute(box, ev, minute) {
  const feed = ev.classList.contains("timeline-item");
  const sel = feed ? ".timeline-item" : ".timeline-event";
  const get = feed ? FEED_MINUTE : SUM_MINUTE;
  let before = null;
  for (const e of box.querySelectorAll(":scope > " + sel)) {
    if (e === ev) continue;
    const v = get(e);
    if (v !== null && v <= minute) { before = e; break; }
  }
  // not found: after the last readable event (older than all), or at the end
  if (before) box.insertBefore(ev, before);
  else box.appendChild(ev);
}
function settleOrder() {
  for (const [boxSel, sel, get] of [["#timelineContainer", ".timeline-event", SUM_MINUTE], ["#feedTab .timeline", ".timeline-item", FEED_MINUTE]]) {
    const box = document.querySelector(boxSel);
    if (!box) continue;
    const items = [...box.querySelectorAll(":scope > " + sel)];
    items.filter((e) => e.dataset.msCoach).forEach((ev) => {
      const mine = get(ev);
      if (mine === null) return;
      const idx = items.indexOf(ev);
      const wrong = items.some((o, i) => {
        if (o === ev) return false;
        const v = get(o);
        return v !== null && ((i < idx && v < mine) || (i > idx && v > mine));
      });
      if (wrong) { placeByMinute(box, ev, mine); items.splice(0, items.length, ...box.querySelectorAll(":scope > " + sel)); }
    });
  }
}

// team + manager of each side, from the Lineups tab
function sideInfo() {
  const out = {};
  document.querySelectorAll(".ms-coach").forEach((line) => {
    const card = line.previousElementSibling && line.previousElementSibling.closest(".card");
    if (!card) return;
    const side = card.querySelector('[id^="playerH"]') ? "home" : card.querySelector('[id^="playerA"]') ? "away" : null;
    if (!side) return;
    const m = /^Manager:\s*(.+?)\s*(?:\((?:Alt\+click|Long-press)[^)]*\))?$/.exec(cleanName(line.textContent));
    out[side] = { team: line.dataset.msClub || "", manager: m && !/^unknown/i.test(m[1]) ? m[1] : "", line };
  });
  return out;
}

const pickFrom = (arr, seed) => arr[Math.floor(seededRandoms(seed, 1)[0] * arr.length)];

// ---------- bench players can be booked / sent off ----------
const BENCH_YELLOW = [
  (p, t) => `${p} is booked on the bench for dissent: yellow card for the ${t} substitute.`,
  (p, t) => `The referee turns to the ${t} bench and shows ${p} a yellow card.`,
];
const BENCH_RED = [
  (p, t) => `Red card for ${p}! The ${t} substitute is sent off from the bench.`,
  (p, t) => `${p} lost his cool on the ${t} bench and is shown a straight red!`,
];

// players of a side who have not come on (no "arrow up" icon in the squad tables)
function unusedBench(side) {
  const prefix = side === "home" ? "playerH" : "playerA";
  const out = [];
  document.querySelectorAll(`.player-td-achievements[id^="${prefix}"]`).forEach((div) => {
    if (div.querySelector("i.fa-arrow-up")) return;
    const td = div.closest("td.player-td");
    const first = td && [...td.childNodes].find((n) => n.nodeType === 3 && cleanName(n.textContent));
    const name = first && cleanName(first.textContent);
    if (name) out.push({ name, div });
  });
  return out;
}

// ---------- suspensions after bench cards ----------
// The site's own "Player availability" card lists suspensions, but it knows nothing of the
// bench cards made here, so they are remembered locally and added to that table.
const SUSP_KEY = "msSuspensions1";
const loadSusp = () => { try { return JSON.parse(localStorage.getItem(SUSP_KEY) || "{}") || {}; } catch (e) { return {}; } };
const saveSusp = (o) => { try { localStorage.setItem(SUSP_KEY, JSON.stringify(o)); } catch (e) {} };

function recordSuspension(hash, side, b) {
  const all = loadSusp();
  const id = hash + "|" + side;
  if (all[id]) return;
  const fx = fxGet(hash);
  const info = sideInfo();
  const cup = (document.querySelector('a[href*="/cup/"]') || { getAttribute: () => "" }).getAttribute("href").match(/\/cup\/(\d+)/);
  all[id] = {
    p: b.name,
    key: fx ? fx[side === "home" ? 0 : 2] : "",
    team: (info[side] && info[side].team) || (fx ? fx[side === "home" ? 1 : 3] : ""),
    cup: cup ? cup[1] : "",
    hash,
    red: !!b.red,
  };
  saveSusp(all);
}

// served: the team has played its next match
function expireSuspensions(hash) {
  if (!featureOn("cards")) return;
  if (currentMinute() !== Infinity) return;
  const fx = fxGet(hash);
  if (!fx) return;
  const all = loadSusp();
  let changed = false;
  for (const [id, r] of Object.entries(all)) {
    if (r.hash === hash) continue;
    if ((r.key && (r.key === fx[0] || r.key === fx[2])) || (!r.key && (sameClubName(r.team, fx[1]) || sameClubName(r.team, fx[3])))) {
      delete all[id];
      changed = true;
    }
  }
  if (changed) saveSusp(all);
}

function updateSuspensionTable() {
  if (!featureOn("cards")) return;
  const tbody = document.querySelector("#availabilityTypeSuspensions tbody");
  if (!tbody) return;
  const table = tbody.closest("table");
  // the columns follow the page: the cup page has Name, Team, Until; a team page only Name, Until
  const heads = [...table.querySelectorAll("thead th")].map((th) => cleanName(th.textContent).toLowerCase());
  const cols = heads.length ? heads : ["name", "team", "until"];
  const hasTeam = cols.includes("team");
  const all = loadSusp();
  const cupNow = (location.pathname.match(/^\/cup\/(\d+)/) || [])[1] || "";
  // on a team page only that team's suspensions belong in the table
  const teamPage = /\/team\/([^/]+)\/([^/?#]*)/.exec(location.pathname);
  const sameTeamPage = (r) => {
    if (!teamPage) return true;
    const key = r.key || "";
    if (key && key.startsWith("t" + decodeURIComponent(teamPage[1]) + ":")) return true;
    return slugOf(stripTag(r.team || "")) === slugOf(decodeURIComponent(teamPage[2]));
  };
  const anchors = [...document.querySelectorAll('a[href*="/team/"]')];
  tbody.querySelectorAll("tr[data-ms-susp]").forEach((tr) => {
    if (!all[tr.dataset.msSusp] || !sameTeamPage(all[tr.dataset.msSusp])) tr.remove();
  });
  const nameIx = Math.max(0, cols.indexOf("name"));
  const teamIx = cols.indexOf("team");
  for (const [id, r] of Object.entries(all)) {
    if (r.cup && cupNow && r.cup !== cupNow) continue;
    if (!sameTeamPage(r)) continue;
    if (tbody.querySelector(`tr[data-ms-susp="${id}"]`)) continue;
    let href = "";
    if (hasTeam) {
      const a = anchors.find((x) => {
        const t = teamFromAnchor(x);
        return t && ((r.key && t.key === r.key) || (!r.key && sameClubName(t.name, r.team)));
      });
      if (!a) continue; // the team is not on this page
      href = a.getAttribute("href");
    }
    const same = [...tbody.querySelectorAll("tr")].some(
      (tr) =>
        tr.cells[nameIx] &&
        cleanName(tr.cells[nameIx].textContent) === r.p &&
        (!hasTeam || (tr.cells[teamIx] && sameClubName(tr.cells[teamIx].textContent, r.team)))
    );
    if (same) continue;
    const tr = document.createElement("tr");
    tr.dataset.msSusp = id;
    cols.forEach((c) => {
      const td = document.createElement("td");
      if (c === "name") td.textContent = r.p;
      else if (c === "team") {
        const link = document.createElement("a");
        link.href = href;
        link.className = "text-black fw-normal";
        link.textContent = r.team || "";
        td.appendChild(link);
      } else if (c === "until") {
        const bold = document.createElement("b");
        bold.textContent = "Next match";
        td.appendChild(bold);
      }
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  }
}

function updateBenchCards(hash, now, state) {
  const info = sideInfo();
  let changed = false;
  for (const side of ["home", "away"]) {
    if (!info[side]) continue;
    const [u1, u2, u3, u4] = seededRandoms(hash + "|" + side + "|bench", 4);
    const red = u1 < 0.035;
    const yellow = !red && u1 < 0.035 + 0.14;
    if (!red && !yellow) continue;
    const minute = 22 + Math.floor(u4 * 66);
    state[side].bench = state[side].bench || null;
    if (!state[side].bench) {
      if (now < minute) continue;
      const pool = unusedBench(side);
      if (!pool.length) continue;
      state[side].bench = { name: pool[Math.floor(u3 * pool.length)].name, red, minute };
      changed = true;
    }
    const b = state[side].bench;
    const kind = b.red ? "red" : "yellow";
    // a straight red always means a ban; a yellow only now and then (seeded)
    const suspended = b.red || seededRandoms(hash + "|" + side + "|benchban", 1)[0] < 0.2;
    if (suspended) recordSuspension(hash, side, b);
    const text = pickFrom(b.red ? BENCH_RED : BENCH_YELLOW, hash + side + "bt")(b.name, info[side].team || "the");
    addFeedEvent(side + "-bench", b.minute, kind, text);
    addSummaryEvent(side + "-bench", b.minute, kind, side, b.name + " (bench)");
    // the card also shows beside the player in the squad table
    const row = unusedBench(side).find((p) => p.name === b.name);
    if (row && !row.div.querySelector("[data-ms-coach]")) {
      const item = document.createElement("div");
      item.className = "player-achievement-item";
      item.dataset.msCoach = side + "-bench";
      const i = document.createElement("i");
      i.className = "fas fa-mobile " + (b.red ? "text-danger bg-danger" : "text-yellow bg-yellow");
      if (suspended) item.title = "Suspended for the next match";
      item.appendChild(i);
      row.div.appendChild(item);
    }
  }
  return changed;
}

// ---------- VAR ----------
// VAR checks are only ever confirmations ("goal stands", "red card stands"): the score and the
// cards of the match never change. Which goals / red cards get checked is seeded per event.
const VAR_GOAL = [
  (p) => `VAR is checking the goal by ${p}... after a long look the goal stands!`,
  (p) => `The referee goes to the monitor for ${p}'s goal. VAR confirms it: goal given.`,
  (p) => `Check complete: no offside, no foul. ${p}'s goal stands after VAR.`,
];
const VAR_RED = [
  (p) => `VAR reviews the red card for ${p}. The decision stands, he has to go.`,
  (p) => `The referee checks the monitor for the ${p} incident and confirms the red card.`,
];

// VAR can also overturn: a goal is disallowed (offside / foul / handball) and a card is
// cancelled. The overturned event stays in the timeline, struck through, and the counters
// (goals, cards, scoreboard) are lowered to match. Decisions are seeded per event.
const VAR_OFFSIDE = [
  (p) => `VAR check on ${p}'s goal... the line is drawn and he was offside! The goal is disallowed.`,
  (p) => `No goal! After a long VAR review ${p} is judged offside by a toe. The goal is ruled out.`,
  (p) => `The flag stays down but VAR spots an offside in the build-up. ${p}'s goal does not count.`,
];
const VAR_FOUL = [
  (p) => `VAR spots a foul in the build-up to ${p}'s goal. The referee overturns it: no goal.`,
  (p) => `The referee watches the monitor and chalks off ${p}'s goal for a push in the box.`,
];
const VAR_HAND = [
  (p) => `Handball in the build-up! VAR sends the referee to the monitor and ${p}'s goal is disallowed.`,
];
const VAR_CARD_CANCEL = {
  red: [
    (p) => `VAR downgrades it: the red card for ${p} is overturned after the review, he can stay on.`,
    (p) => `The referee reviews the challenge by ${p} and cancels the red card. Play resumes.`,
  ],
  yellow: [
    (p) => `The referee checks the monitor and withdraws the yellow card shown to ${p}: no booking.`,
    (p) => `VAR advises a second look and ${p}'s yellow card is rescinded.`,
  ],
};

const VAR_SCORE_SEL = {
  home: "#homeGoals,#homeGoalsSm",
  away: "#awayGoals,#awayGoalsSm",
};

// lower a number the site writes itself; if the site rewrites it, rebase on its new value
function applyDelta(el, delta) {
  if (!el || !/^\s*\d+\s*$/.test(el.textContent)) return;
  const cur = +el.textContent;
  if (el.dataset.msShown !== undefined && String(cur) === el.dataset.msShown && el.dataset.msDelta === String(delta)) return;
  let base = cur;
  if (el.dataset.msShown !== undefined && String(cur) === el.dataset.msShown) base = +el.dataset.msBase;
  const shown = Math.max(0, base - delta);
  el.dataset.msBase = String(base);
  el.dataset.msDelta = String(delta);
  el.dataset.msShown = String(shown);
  el.textContent = String(shown);
}

function isPenaltyGoal(player, minute) {
  const shootout = (() => {
    const ps = document.getElementById("penaltyScore");
    if (ps && !ps.classList.contains("hidden")) return true;
    return !!document.querySelector('[id^="penaltyHome_"]:not(.text-gray-400),[id^="penaltyAway_"]:not(.text-gray-400)');
  })();
  if (shootout && minute >= 120) return true;
  const sur = player.split(" ").pop().toLowerCase();
  const mn = Math.floor(minute);
  for (const it of document.querySelectorAll("#feedTab .timeline > .timeline-item:not([data-ms-coach])")) {
    const t = minuteValue((it.querySelector(".timeline-item-marker-text") || {}).textContent);
    if (t === null || Math.floor(t) !== mn) continue;
    const c = (it.querySelector(".timeline-item-content") || it).textContent.toLowerCase();
    if (/penalt|spot[- ]kick|from the spot/.test(c) && (sur.length < 3 || c.includes(sur))) return true;
  }
  return false;
}

// One roll per event, seeded by who/what/which-time-for-that-player (not by the minute text,
// which differs between the page and the data the server sends), so reading the data of a
// match gives the same decisions as watching it.
function varRoll(hash, side, kind, player, idx, isPen) {
  const seed = `${hash}|var2|${side}|${kind}|${player}|${idx}`;
  const [u0, v] = seededRandoms(seed, 2);
  return { seed, u: kind === "goal" && isPen ? 1 : u0, v };
}
const varOverturned = (kind, u) => (kind === "goal" ? u < 0.13 : kind === "red" ? u < 0.2 : u < 0.07);

function updateVar(hash) {
  const delta = { home: { goal: 0, yellow: 0, red: 0 }, away: { goal: 0, yellow: 0, red: 0 } };
  const cancelled = [];
  const evNodes = [...document.querySelectorAll("#timelineContainer > .timeline-event")].filter((e) => !e.dataset.msCoach);
  const seenCount = new Map();
  const evIdx = new Map();
  for (const ev of [...evNodes].reverse()) {
    const pl = ev.querySelector(".event-player");
    const nm = cleanName(pl && pl.childNodes[0] ? pl.childNodes[0].textContent : "");
    const kd = ev.querySelector("i.red-card") ? "red" : ev.querySelector("i.yellow-card") ? "yellow" : ev.querySelector("i.goal") || (ev.querySelector("i.fa-futbol") && !ev.querySelector("i.text-danger")) ? "goal" : "";
    if (!kd) continue;
    const k = (ev.classList.contains("side-away") ? "away" : "home") + "|" + kd + "|" + nm;
    evIdx.set(ev, seenCount.get(k) || 0);
    seenCount.set(k, (seenCount.get(k) || 0) + 1);
  }
  evNodes.forEach((ev) => {
    const minute = minuteValue((ev.querySelector(".event-minute") || {}).textContent);
    if (minute === null) return;
    const player = cleanName((ev.querySelector(".event-player") || {}).childNodes && ev.querySelector(".event-player").childNodes[0] ? ev.querySelector(".event-player").childNodes[0].textContent : "");
    const side = ev.classList.contains("side-away") ? "away" : "home";
    const isRed = !!ev.querySelector("i.red-card");
    const isYellow = !isRed && !!ev.querySelector("i.yellow-card");
    const isGoal = !isRed && !isYellow && (!!ev.querySelector("i.goal") || (!!ev.querySelector("i.fa-futbol") && !ev.querySelector("i.text-danger")));
    if (!isGoal && !isRed && !isYellow) return;
    // goals from the spot are never overturned by VAR (penalties in play and in a shoot-out)
    const { seed, u, v } = varRoll(hash, side, isGoal ? "goal" : isRed ? "red" : "yellow", player, evIdx.get(ev) || 0, isGoal && isPenaltyGoal(player, minute));
    const tag = "var-" + side + "-" + Math.floor(minute) + "-" + player.replace(/\W+/g, "");
    const mn = Math.floor(minute);
    let overturned = null; // text of the VAR decision
    let label = "";
    let confirmed = null;
    if (isGoal) {
      if (u < 0.13) {
        const pool = v < 0.6 ? VAR_OFFSIDE : v < 0.85 ? VAR_FOUL : VAR_HAND;
        overturned = pickFrom(pool, seed + "t")(player);
        label = pool === VAR_OFFSIDE ? "VAR: goal disallowed (offside)" : pool === VAR_FOUL ? "VAR: goal disallowed (foul)" : "VAR: goal disallowed (handball)";
      } else if (u < 0.3) confirmed = pickFrom(VAR_GOAL, seed + "t")(player);
    } else if (isRed) {
      if (u < 0.2) {
        overturned = pickFrom(VAR_CARD_CANCEL.red, seed + "t")(player);
        label = "VAR: red card overturned";
      } else if (u < 0.6) confirmed = pickFrom(VAR_RED, seed + "t")(player);
    } else if (u < 0.07) {
      overturned = pickFrom(VAR_CARD_CANCEL.yellow, seed + "t")(player);
      label = "VAR: yellow card cancelled";
    }
    if (overturned) {
      ev.classList.add("ms-var-off");
      delta[side][isGoal ? "goal" : isRed ? "red" : "yellow"]++;
      const asEl = ev.querySelector(".event-player span");
      cancelled.push({ kind: isGoal ? "goal" : isRed ? "red" : "yellow", side, player, assist: asEl ? cleanName(asEl.textContent) : "" });
      addFeedEvent(tag, minute, "var", overturned);
      addSummaryEvent(tag, minute, "var", side, label);
      // strike the original commentary line of the same minute that names the player
      const surname = player.split(" ").pop().toLowerCase();
      document.querySelectorAll("#feedTab .timeline > .timeline-item:not([data-ms-coach])").forEach((it) => {
        const t = minuteValue((it.querySelector(".timeline-item-marker-text") || {}).textContent);
        if (t === null || Math.floor(t) !== mn) return;
        const c = (it.querySelector(".timeline-item-content") || it).textContent.toLowerCase();
        const goalish = /goal|scor|net|finish/.test(c), cardish = /card|booked|sent off|red|yellow/.test(c);
        if (surname.length > 2 && c.includes(surname) && (isGoal ? goalish : cardish)) it.classList.add("ms-var-off");
      });
    } else if (confirmed) {
      addFeedEvent(tag, minute, "var", confirmed);
      addSummaryEvent(tag, minute, "var", side, isGoal ? "VAR: goal stands" : "VAR: red card stands");
    }
  });
  if (!document.getElementById("ms-var-style")) {
    const st = document.createElement("style");
    st.id = "ms-var-style";
    st.textContent = ".ms-var-off .event-player,.ms-var-off .timeline-item-content{text-decoration:line-through;opacity:.55}.ms-var-off .event-icon,.ms-var-off .timeline-item-marker-indicator{opacity:.45}";
    document.head.appendChild(st);
  }
  for (const side of ["home", "away"]) {
    applyDelta(document.getElementById(side + "GoalsCount"), delta[side].goal);
    applyDelta(document.getElementById(side + "YellowCardsCount"), delta[side].yellow);
    applyDelta(document.getElementById(side + "RedCardsCount"), delta[side].red);
    // the scoreboard, where the page has one with a plain number in it
    document.querySelectorAll(VAR_SCORE_SEL[side]).forEach((el) => { if (!el.children.length) applyDelta(el, delta[side].goal); });
  }
  hideCancelledIcons(cancelled);
  recordVarGoals(hash, cancelled);
}

// The cancelled card / goal icon also disappears from the lineups (pitch and squad tables).
// Players are found by the name in the squad tables; their achievement boxes share one id.
const ICON_SEL = {
  yellow: "i.fa-mobile.text-yellow",
  red: "i.fa-mobile.text-danger",
  goal: "i.fa-futbol.text-primary, i.fa-futbol.text-success",
};
function hideCancelledIcons(list) {
  const want = new Map(); // container id -> {kind: count}
  for (const c of list) {
    const prefix = c.side === "home" ? "playerH" : "playerA";
    let id = null;
    document.querySelectorAll(`td.player-td`).forEach((td) => {
      const first = td.childNodes[0];
      const box = td.querySelector(`.player-td-achievements[id^="${prefix}"]`);
      if (box && first && cleanName(first.textContent) === c.player) id = box.id;
    });
    if (!id) {
      // starters are only on the pitch, which shows the surname
      const sur = cleanName(c.player.replace(/^(?:[A-Z]\.\s*)+/, ""));
      const hits = [];
      document.querySelectorAll(".pitch .player-wrapper").forEach((w) => {
        const box = w.querySelector(`.player-achievement[id^="${prefix}"]`);
        const nm = w.querySelector(".player-name");
        if (box && nm && cleanName(nm.textContent) === sur) hits.push(box.id);
      });
      if (hits.length === 1) id = hits[0];
    }
    if (!id) continue;
    const w = want.get(id) || {};
    w[c.kind] = (w[c.kind] || 0) + 1;
    want.set(id, w);
  }
  for (const [id, w] of want) {
    document.querySelectorAll(`[id="${id}"]`).forEach((box) => {
      for (const [kind, n] of Object.entries(w)) {
        const items = [...box.querySelectorAll(".player-achievement-item")].filter(
          (it) => !it.dataset.msCoach && it.querySelector(ICON_SEL[kind]) && !(kind === "goal" && it.querySelector("i.text-danger"))
        );
        let hidden = items.filter((it) => it.dataset.msVarHidden).length;
        for (const it of items) {
          if (hidden >= n) break;
          if (it.dataset.msVarHidden) continue;
          it.dataset.msVarHidden = kind;
          it.style.setProperty("display", "none", "important");
          hidden++;
        }
      }
    });
  }
}

// ---- disallowed goals, remembered for the cup pages ----
const VARGOAL_KEY = "msVarGoals2";
const loadVarGoals = () => { try { return JSON.parse(localStorage.getItem(VARGOAL_KEY) || "{}") || {}; } catch (e) { return {}; } };
// the cup a page belongs to (a cup page URL, otherwise its breadcrumb / cup links)
function cupIdOnPage() {
  const m = /^\/cup\/(?:player-stats\/)?(\d+)/.exec(location.pathname);
  if (m) return m[1];
  const a = document.querySelector('a[href^="/cup/"]');
  const mm = a && /\/cup\/(?:player-stats\/)?(\d+)/.exec(a.getAttribute("href"));
  return mm ? mm[1] : "";
}
// saved decisions that belong to the cup being looked at (older ones without a cup id stay in)
function varRecsHere(all) {
  const cup = cupIdOnPage();
  return Object.entries(all).filter(([, r]) => !r.cup || !cup || r.cup === cup);
}

function recordVarGoals(hash, list) {
  if (!list.length) {
    // the match was played again and nothing is cancelled any more: drop the old decision
    if (currentMinute() === Infinity) {
      const old = loadVarGoals();
      if (old[hash]) {
        delete old[hash];
        try { localStorage.setItem(VARGOAL_KEY, JSON.stringify(old)); } catch (e) {}
      }
    }
    return;
  }
  const all = loadVarGoals();
  const info = sideInfo();
  const fx = fxGet(hash);
  // the name shown over the team's crest is always there, even when the manager line has no club
  const headName = (side) => {
    const el = document.querySelector("." + side + "-team-name");
    return el ? cleanName(el.textContent) : "";
  };
  const teamOf = (side) => (info[side] && info[side].team) || (fx ? fx[side === "home" ? 1 : 3] : "") || headName(side);
  const rec = { home: 0, away: 0, scorers: [], yellows: [], reds: [], assists: [], ht: teamOf("home"), at: teamOf("away"), cup: cupIdOnPage(), watched: 1 };
  // the score the site itself gave the finished match, before the extension lowered it
  const orig = (id) => { const el = document.getElementById(id); return el && el.dataset.msBase !== undefined ? +el.dataset.msBase : null; };
  if (currentMinute() === Infinity) {
    const ho = orig("homeGoals"), ao = orig("awayGoals");
    if (ho !== null && ao !== null) { rec.ho = ho; rec.ao = ao; }
  }
  for (const c of list) {
    const row = { p: c.player, team: teamOf(c.side) };
    if (c.kind === "goal") {
      rec[c.side]++;
      rec.scorers.push(row);
      if (c.assist) rec.assists.push({ p: c.assist, team: row.team });
    }
    else if (c.kind === "yellow") rec.yellows.push(row);
    else rec.reds.push(row);
  }
  const old = all[hash];
  // a decision that was made stays made
  const n = (r) => r ? r.scorers.length + (r.yellows || []).length + (r.reds || []).length + (r.assists || []).length : 0;
  if (old && n(old) > n(rec)) {
    if (!old.ht && rec.ht) { old.ht = rec.ht; old.at = rec.at; }
    if (!old.cup && rec.cup) old.cup = rec.cup;
    if (old.ho === undefined && rec.ho !== undefined) {
      old.ho = rec.ho; old.ao = rec.ao;
      try { localStorage.setItem(VARGOAL_KEY, JSON.stringify(all)); } catch (e) {}
    }
    return;
  }
  if (old && old.ho !== undefined && rec.ho === undefined) { rec.ho = old.ho; rec.ao = old.ao; }
  all[hash] = rec;
  try { localStorage.setItem(VARGOAL_KEY, JSON.stringify(all)); } catch (e) {}
}

// Records made by older builds lack the team names / the original score. Names come from the
// fixture store; the original score is picked up later from a fixture link or a form tooltip.
function varRecords() {
  const all = loadVarGoals();
  const list = [];
  for (const [hash, r] of Object.entries(all)) {
    if (!r.ht || !r.at) {
      const fx = fxGet(hash);
      if (fx) { r.ht = r.ht || fx[1]; r.at = r.at || fx[3]; }
    }
    list.push({ hash, r });
  }
  return list;
}
function saveVarRec(hash, r) {
  const all = loadVarGoals();
  all[hash] = r;
  try { localStorage.setItem(VARGOAL_KEY, JSON.stringify(all)); } catch (e) {}
}

// the W/D/L badge next to a fixture result follows the lowered score
function fixResultLetters() {
  if (!featureOn("var")) return;
  document.querySelectorAll("a[data-ms-orig][data-ms-shown]").forEach((a) => {
    const tr = a.closest("tr");
    const f = tr && tr.querySelector(".form-div");
    if (!f || f.dataset.msVar) return;
    const o = /^(\d+)-(\d+)$/.exec(a.dataset.msOrig), n = /^(\d+)-(\d+)$/.exec(a.dataset.msShown);
    if (!o || !n) return;
    const res = (x, y) => (x > y ? "W" : x < y ? "L" : "D");
    const old = f.textContent.trim();
    // which side is this page's team? the one whose old result letter fits
    const home = res(+o[1], +o[2]) === old;
    const away = res(+o[2], +o[1]) === old;
    if (!home && !away) return;
    const letter = home ? res(+n[1], +n[2]) : res(+n[2], +n[1]);
    f.dataset.msVar = "1";
    f.classList.remove("W", "D", "L");
    f.classList.add(letter);
    f.textContent = letter;
  });
}

// ---- decisions for matches that were simulated from a cup page, without opening them ----
// The match page's own HTML carries the events as data, so it is fetched once per match,
// the same rolls are made, and the result is stored like an opened match.
const VARSEEN_KEY = "msVarSeen2";
const loadSeen = () => { try { return JSON.parse(localStorage.getItem(VARSEEN_KEY) || "{}") || {}; } catch (e) { return {}; } };
const varInFlight = new Set();
const retryAt = new Map();
function varApplyAll() {
  if (!featureOn("var")) return;
  try { applyVarToCup(); applyVarToStatsPage(); applyVarToStandings(); } catch (e) {}
}
let varFetches = 0;

function parseMatchEvents(html) {
  const out = [];
  let from = 0;
  for (;;) {
    const i = html.indexOf('{"id":', from);
    if (i < 0) break;
    from = i + 6;
    if (!html.startsWith('"team_id"', html.indexOf(",", i) + 1)) continue;
    let depth = 0, inStr = false, j = i;
    for (; j < html.length; j++) {
      const c = html[j];
      if (inStr) { if (c === "\\") j++; else if (c === '"') inStr = false; }
      else if (c === '"') inStr = true;
      else if (c === "{") depth++;
      else if (c === "}" && --depth === 0) break;
    }
    try { const o = JSON.parse(html.slice(i, j + 1)); if (o && o.event) out.push(o); } catch (e) {}
    from = j + 1;
  }
  return out;
}

async function evaluateFinishedMatch(hash, href, cup) {
  const res = await fetch(href, { credentials: "same-origin" });
  if (!res.ok) throw new Error("http " + res.status);
  const html = await res.text();
  const events = parseMatchEvents(html);
  if (!events.length) return null;
  const sideOf = (e) => (e.side === "A" ? "away" : "home");
  const names = { home: "", away: "" };
  for (const e of events) if (e.team_name && !names[sideOf(e)]) names[sideOf(e)] = e.team_name;
  const fx = fxGet(hash);
  if (!names.home && fx) names.home = fx[1];
  if (!names.away && fx) names.away = fx[3];
  // The page's own score number is filled in by its script as the match is replayed, so the
  // score is counted from the events instead: goals (an own goal counts for the side it is
  // listed under), leaving out shoot-out kicks.
  const tally = (side) => events.filter((e) => (e.event === "goal" || e.event === "ownGoal") && e.side === side && e.penalties_info == null).length;
  const ho = tally("H"), ao = tally("A");
  const rec = { home: 0, away: 0, scorers: [], yellows: [], reds: [], assists: [], ht: names.home, at: names.away, ho, ao, cup };
  const counts = new Map();
  for (const e of events) {
    const kind = e.event === "goal" ? "goal" : e.event === "foulYellow" ? "yellow" : e.event === "foulRed" ? "red" : null;
    if (!kind || !e.player_name) continue;
    const side = sideOf(e);
    const key = side + "|" + kind + "|" + e.player_name;
    const idx = counts.get(key) || 0;
    counts.set(key, idx + 1);
    const isPen = kind === "goal" && (e.penalties_info != null || e.minute >= 120);
    const { u } = varRoll(hash, side, kind, e.player_name, idx, isPen);
    if (!varOverturned(kind, u)) continue;
    const row = { p: e.player_name, team: names[side] };
    if (kind === "goal") {
      rec[side]++;
      rec.scorers.push(row);
      if (e.assisting_player_name) rec.assists.push({ p: e.assisting_player_name, team: names[side] });
    } else if (kind === "yellow") rec.yellows.push(row);
    else rec.reds.push(row);
  }
  return rec;
}

// the score a fixture link had from the site (before the extension lowered it)
function origScore(a) {
  const t = a.textContent.trim();
  return a.dataset.msShown !== undefined && t === a.dataset.msShown && a.dataset.msOrig ? a.dataset.msOrig : t;
}

function autoVarScan() {
  if (disabled || !featureOn("var") || varFetches >= 3) return;
  const seen = loadSeen();
  const cup = cupIdOnPage();
  for (const a of document.querySelectorAll('a[href*="/match/"]')) {
    const m = /\/match\/([0-9a-f]{8,})\//.exec(a.getAttribute("href") || "");
    if (!m || varInFlight.has(m[1])) continue;
    // only finished matches: a fixture link that shows a result
    let shownScore = origScore(a).replace(/\s+/g, "");
    // a link that only says "View match" is a finished match too (the score is not shown yet)
    if (/^view\s*match$/i.test(origScore(a))) shownScore = "";
    else if (!/^\d+-\d+$/.test(shownScore)) continue;
    // already evaluated for exactly this result; a live match whose score moved is looked at again
    if (seen[m[1]] && (!shownScore || seen[m[1]] === shownScore)) continue;
    if (retryAt.get(m[1]) > Date.now()) continue;
    if (pageHash() === m[1]) continue; // the page being watched does its own
    const hash = m[1];
    varInFlight.add(hash);
    varFetches++;
    evaluateFinishedMatch(hash, a.getAttribute("href"), cup)
      .then((rec) => {
        // the data has to agree with the score on the page, otherwise the match is still being played
        if (!rec || (shownScore && `${rec.ho}-${rec.ao}` !== shownScore)) { retryAt.set(hash, Date.now() + 2500); return; }
        const s2 = loadSeen();
        s2[hash] = shownScore || `${rec.ho}-${rec.ao}`;
        try { localStorage.setItem(VARSEEN_KEY, JSON.stringify(s2)); } catch (e) {}
        const all = loadVarGoals();
        const any = rec.home || rec.away || rec.scorers.length || rec.yellows.length || rec.reds.length;
        // a record made by watching the match itself is left alone, anything older is replaced
        if (any && !(all[hash] && all[hash].watched && all[hash].ho === rec.ho && all[hash].ao === rec.ao)) all[hash] = rec;
        else if (!any && all[hash] && !all[hash].watched) delete all[hash];
        else return;
        try { localStorage.setItem(VARGOAL_KEY, JSON.stringify(all)); } catch (e) {}
        varApplyAll(); // show it straight away
      })
      .catch(() => { retryAt.set(hash, Date.now() + 5000); })
      .then(() => { varInFlight.delete(hash); varFetches--; });
    if (varFetches >= 3) break;
  }
}

// cup page: lower the fixture results and the top-scorer table by the disallowed goals
function applyVarToCup() {
  if (!featureOn("var")) return;
  const all = loadVarGoals();
  if (!Object.keys(all).length) return;
  document.querySelectorAll('a[href*="/match/"]').forEach((a) => {
    const m = /\/match\/([0-9a-f]{8,})\//.exec(a.getAttribute("href") || "");
    const rec = m && all[m[1]];
    if (!rec) return;
    const cur = a.textContent.trim();
    if (a.dataset.msShown === cur) return;
    const mm = /^(\d+)\s*-\s*(\d+)$/.exec(cur);
    if (!mm) return;
    // only when the page still shows the result the decision was made on
    if (rec.ho !== undefined && (+mm[1] !== rec.ho || +mm[2] !== rec.ao)) return;
    const shown = Math.max(0, +mm[1] - rec.home) + "-" + Math.max(0, +mm[2] - rec.away);
    a.dataset.msOrig = cur;
    a.dataset.msShown = shown;
    (a.querySelector("strong") || a).textContent = shown;
    if (rec.ho === undefined) { rec.ho = +mm[1]; rec.ao = +mm[2]; saveVarRec(m[1], rec); }
  });
  for (const [boxId, field] of [["playerStatsGoals", "scorers"], ["playerStatsYellowCards", "yellows"], ["playerStatsRedCards", "reds"], ["playerStatsAssists", "assists"]]) {
    const table = document.querySelector("#" + boxId + " table");
    if (!table) continue;
    const cut = [];
    for (const [, rec] of varRecsHere(all)) for (const sc of rec[field] || []) cut.push(sc);
    if (!cut.length) continue;
    // after the numbers dropped, the list is put back in order (most first, ties keep their order)
    {
      const rowsAll = [...table.querySelectorAll("tbody tr, tr")].filter((tr, i, a) => a.indexOf(tr) === i);
      const val = (tr) => { const b = tr.querySelector("td:last-child b"); return b && /^\d+$/.test(b.textContent.trim()) && tr.cells.length >= 3 ? +b.textContent.trim() : null; };
      const scored = rowsAll.filter((tr) => val(tr) !== null);
      if (scored.length > 1 && scored.some((tr) => tr.querySelector("td:last-child b").dataset.msShown !== undefined)) {
        const parent = scored[0].parentNode;
        const sorted = scored.map((tr, i) => ({ tr, i })).sort((x, y) => val(y.tr) - val(x.tr) || x.i - y.i).map((o) => o.tr);
        if (sorted.some((tr, i) => tr !== scored[i]) && scored.every((tr) => tr.parentNode === parent)) sorted.forEach((tr) => parent.appendChild(tr));
      }
    }
    let rank = 0;
    table.querySelectorAll("tr").forEach((tr) => {
      const b = tr.querySelector("td:last-child b");
      if (!b || tr.cells.length < 3 || !/^\d+$/.test(b.textContent.trim())) return;
      if (b.dataset.msShown !== b.textContent.trim()) {
        const name = cleanName(tr.cells[1].textContent);
        // a team page has no team column: the name alone has to do
        const team = tr.cells.length >= 4 ? cleanName(tr.cells[2].textContent) : "";
        const n = cut.filter((sc) => sc.p === name && (!team || sameClubName(sc.team, team))).length;
        if (n) {
          const shown = String(Math.max(0, +b.textContent - n));
          b.dataset.msShown = shown;
          b.textContent = shown;
        }
      }
      // nobody is listed with 0, and the ranks follow on
      if (b.textContent.trim() === "0") { tr.style.setProperty("display", "none", "important"); return; }
      tr.style.removeProperty("display");
      const rk = tr.cells[0];
      if (rk && /^\d+$/.test(rk.textContent.trim())) {
        rank++;
        if (rk.textContent.trim() !== String(rank)) rk.textContent = String(rank);
      }
    });
  }
}

// the full "Player stats" page: one row per player with G / A / YC / RC columns
function applyVarToStatsPage() {
  if (!featureOn("var")) return;
  const all = loadVarGoals();
  if (!Object.keys(all).length) return;
  document.querySelectorAll("table").forEach((table) => {
    const heads = [...table.querySelectorAll("thead th")].map((th) => cleanName(th.textContent));
    if (heads[0] !== "Player" || heads[1] !== "Team") return;
    const cols = { scorers: heads.indexOf("G"), assists: heads.indexOf("A"), yellows: heads.indexOf("YC"), reds: heads.indexOf("RC") };
    table.querySelectorAll("tbody tr").forEach((tr) => {
      if (tr.cells.length < heads.length) return;
      const name = cleanName(tr.cells[0].textContent), team = cleanName(tr.cells[1].textContent);
      for (const [field, ci] of Object.entries(cols)) {
        if (ci < 0) continue;
        const cell = tr.cells[ci];
        const txt = cell.textContent.trim();
        if (!/^\d+$/.test(txt) || cell.dataset.msShown === txt) continue;
        let n = 0;
        for (const [, rec] of varRecsHere(all)) for (const sc of rec[field] || []) if (sc.p === name && sameClubName(sc.team, team)) n++;
        if (!n) continue;
        const shown = String(Math.max(0, +txt - n));
        cell.dataset.msShown = shown;
        cell.textContent = shown;
      }
    });
  });
}

// league table: goals for/against, results and points follow the disallowed goals
function applyVarToStandings() {
  if (!featureOn("var")) return;
  const table = document.getElementById("leagueTable");
  if (!table) return;
  const entries = varRecords();
  // a record without its original score: take it from an untouched form tooltip
  table.querySelectorAll(".form-div:not([data-ms-var])").forEach((dot) => {
    const t = dot.getAttribute("data-bs-original-title") || dot.getAttribute("title") || "";
    const m = /^(.*?) (\d+)-(\d+) (.*)$/.exec(t);
    if (!m) return;
    const e = entries.find((x) => x.r.ho === undefined && x.r.ht && x.r.at && sameClubName(x.r.ht, m[1]) && sameClubName(x.r.at, m[4]));
    if (e) { e.r.ho = +m[2]; e.r.ao = +m[3]; saveVarRec(e.hash, e.r); }
  });
  const here = new Set(varRecsHere(Object.fromEntries(entries.map((e) => [e.hash, e.r]))).map(([h]) => h));
  const recs = entries
    .filter((e) => here.has(e.hash))
    // a record with no cup id has to be proven by a link to its match on this page
    .filter((e) => e.r.cup || document.querySelector(`a[href*="/match/${e.hash}"]`) || table.querySelector(".form-div"))
    .map((e) => e.r)
    .filter((r) => r.ho !== undefined && r.ht && r.at);
  if (!recs.length) return;
  let heads = [...table.querySelectorAll("thead th")].map((th) => cleanName(th.textContent));
  // the small table on a team page has no header: rank, team, played, points
  if (!heads.length) {
    const first = table.querySelector("tbody tr");
    if (first && first.cells.length === 4) heads = ["", "Team", "P", "PTS"];
  }
  const col = (n) => heads.indexOf(n);
  const C = { P: col("P"), W: col("W"), D: col("D"), L: col("L"), GF: col("GF"), GA: col("GA"), GD: col("GD"), PTS: col("PTS") };
  if (C.PTS < 0 || col("Team") < 0) return;
  const res = (f, a) => (f > a ? "W" : f < a ? "L" : "D");
  const pts = { W: 3, D: 1, L: 0 };
  const rows = [...table.querySelectorAll("tbody tr")];
  let changed = false;
  const bump = (cell, d) => {
    if (!cell || !d) return false;
    const el = cell.querySelector("b") || cell;
    const txt = el.textContent.trim();
    if (!/^-?\d+$/.test(txt) || el.dataset.msShown === txt) return false;
    const shown = String(+txt + d);
    el.dataset.msShown = shown;
    el.textContent = shown;
    return true;
  };
  for (const tr of rows) {
    if (tr.cells.length < heads.length) continue;
    const team = cleanName(tr.cells[col("Team")].textContent);
    const d = { W: 0, D: 0, L: 0, GF: 0, GA: 0, GD: 0, PTS: 0 };
    let hit = false;
    // a stored result only counts if this row still shows that very result: its form dot
    // carries the original score (the compact table has no dots, so it only gets the sanity check)
    const dotTips = [...tr.querySelectorAll(".form-div")].map((dt) => dt.getAttribute("data-bs-original-title") || dt.getAttribute("title") || "");
    const confirmed = (r) =>
      !dotTips.length ||
      dotTips.some((t) => {
        const m = /^(.*?) (\d+)-(\d+) (.*)$/.exec(t);
        return m && sameClubName(r.ht, m[1]) && sameClubName(r.at, m[4]) && r.ho === +m[2] && r.ao === +m[3];
      });
    for (const r of recs) {
      for (const side of ["home", "away"]) {
        if (!sameClubName(side === "home" ? r.ht : r.at, team)) continue;
        if (!confirmed(r)) continue;
        const other = side === "home" ? "away" : "home";
        const f0 = side === "home" ? r.ho : r.ao, a0 = side === "home" ? r.ao : r.ho;
        const f1 = Math.max(0, f0 - r[side]), a1 = Math.max(0, a0 - r[other]);
        const r0 = res(f0, a0), r1 = res(f1, a1);
        hit = true;
        d.GF += f1 - f0; d.GA += a1 - a0; d.GD += f1 - f0 - (a1 - a0);
        if (r0 !== r1) { d[r0]--; d[r1]++; d.PTS += pts[r1] - pts[r0]; }
      }
    }
    if (!hit) continue;
    // never produce a negative count (W, D, L, GF, GA, PTS, or P of 0): the table is not what the record saw
    const played = C.P >= 0 ? +tr.cells[C.P].textContent.trim() : 1;
    const cur = (k) => { const c = tr.cells[C[k]]; return c ? +((c.querySelector("b") || c).textContent.trim()) : NaN; };
    const pIdx = C.P >= 0 ? C.P : 2;
    const playedN = +tr.cells[pIdx].textContent.trim();
    if (!(playedN > 0) || (C.PTS >= 0 && d.PTS && cur("PTS") + d.PTS > 3 * playedN) || ["W", "D", "L", "GF", "GA", "PTS"].some((k) => C[k] >= 0 && d[k] && cur(k) + d[k] < 0)) continue;
    for (const k of Object.keys(d)) if (C[k] >= 0 && bump(tr.cells[C[k]], d[k])) changed = true;
  }
  // the form dots: "Home 0-3 Away" with the result letter from this row's team
  rows.forEach((tr) => {
    const team = cleanName((tr.cells[col("Team")] || { textContent: "" }).textContent);
    tr.querySelectorAll(".form-div").forEach((dot) => {
      const t = dot.getAttribute("data-bs-original-title") || dot.getAttribute("title") || "";
      const m = /^(.*?) (\d+)-(\d+) (.*)$/.exec(t);
      if (!m) return;
      const r = recs.find((x) => sameClubName(x.ht, m[1]) && sameClubName(x.at, m[4]) && x.ho === +m[2] && x.ao === +m[3]);
      if (!r) return;
      const h = Math.max(0, r.ho - r.home), a = Math.max(0, r.ao - r.away);
      const mine = sameClubName(m[1], team) ? res(h, a) : res(a, h);
      const nt = `${m[1]} ${h}-${a} ${m[4]}`;
      if (dot.hasAttribute("data-bs-original-title")) dot.setAttribute("data-bs-original-title", nt);
      if (dot.hasAttribute("title")) dot.setAttribute("title", nt);
      dot.classList.remove("W", "D", "L");
      dot.classList.add(mine);
      if (dot.textContent.trim() !== mine) dot.textContent = mine;
    });
  });
  if (!changed) return;
  // re-rank: points, goal difference, goals for; the position cells (with their colours) stay put
  const num = (tr, k) => (C[k] >= 0 ? +((tr.cells[C[k]].querySelector("b") || tr.cells[C[k]]).textContent.trim()) || 0 : 0);
  const rankCells = rows.map((tr) => tr.cells[0]);
  const order = rows
    .map((tr, i) => ({ tr, i }))
    .sort((x, y) => num(y.tr, "PTS") - num(x.tr, "PTS") || num(y.tr, "GD") - num(x.tr, "GD") || num(y.tr, "GF") - num(x.tr, "GF") || x.i - y.i)
    .map((o) => o.tr);
  const tbody = rows[0].parentNode;
  order.forEach((tr) => tbody.appendChild(tr));
  order.forEach((tr, i) => {
    if (tr.cells[0] !== rankCells[i]) tr.insertBefore(rankCells[i], tr.firstChild);
  });
}

function updateCoachCards() {
  if (disabled) return;
  const hash = pageHash();
  if (!hash) return;
  let all = {};
  try { all = JSON.parse(localStorage.getItem(COACH_KEY) || "{}"); } catch (e) {}
  const state = all[hash] || { home: { y: 0, r: 0 }, away: { y: 0, r: 0 } };
  state.home = state.home || { y: 0, r: 0 };
  state.away = state.away || { y: 0, r: 0 };
  let changed = false;
  const now = currentMinute();
  const cardsOn = featureOn("cards");
  document.querySelectorAll(cardsOn ? ".ms-coach" : ".ms-none").forEach((line) => {
    const card = line.previousElementSibling && line.previousElementSibling.closest(".card");
    if (!card) return;
    const side = card.querySelector('[id^="playerH"]') ? "home" : card.querySelector('[id^="playerA"]') ? "away" : null;
    if (!side) return;
    const team = line.dataset.msClub || "";
    const m = /^Manager:\s*(.+?)\s*(?:\((?:Alt\+click|Long-press)[^)]*\))?$/.exec(cleanName(line.textContent.replace(/\s*$/, "")));
    let manager = m && !/^unknown/i.test(m[1]) ? m[1] : "";
    const who = manager || "the manager";
    const { yellows, reds } = countPlayerCards(side);
    const rolled = rollCoachCard(hash, side, yellows, reds);
    const st = state[side];
    // a card is kept once it has been shown (same minute), never removed
    if (rolled.y && !st.y) { st.y = rolled.y; changed = true; }
    if (rolled.r && !st.r) { st.r = rolled.r; changed = true; }
    const pickLine = (arr, k) => arr[Math.floor(seededRandoms(hash + side + k, 1)[0] * arr.length)];
    const shownY = st.y && now >= st.y;
    const shownR = st.r && now >= st.r;
    if (shownY) {
      addFeedEvent(side + "-y", st.y, "yellow", pickLine(YELLOW_LINES, "y")(team, who));
      addSummaryEvent(side + "-y", st.y, "yellow", side, (manager || team + " manager") + " (manager)");
    }
    if (shownR) {
      addFeedEvent(side + "-r", st.r, "red", pickLine(RED_LINES, "r")(team, who));
      addSummaryEvent(side + "-r", st.r, "red", side, (manager || team + " manager") + " (manager)");
    }
    // card next to the manager line
    let badge = line.querySelector(".ms-coach-card");
    const level = shownR ? 2 : shownY ? 1 : 0;
    if (!level) { if (badge) badge.remove(); return; }
    if (!badge) {
      badge = document.createElement("span");
      badge.className = "ms-coach-card";
      line.appendChild(badge);
    }
    badge.title = level === 2 ? "Manager sent off (red card)" : "Manager booked (yellow card)";
    badge.style.cssText =
      "display:inline-block;width:9px;height:13px;margin-left:6px;border-radius:2px;vertical-align:-2px;" +
      "background:" + (level === 2 ? "#d62828" : "#f4c20d") + ";box-shadow:0 0 0 1px rgba(0,0,0,.25);";
  });
  if (cardsOn && updateBenchCards(hash, now, state)) changed = true;
  if (featureOn("var")) updateVar(hash);
  settleOrder();
  if (changed) {
    all[hash] = state;
    const keys = Object.keys(all);
    if (keys.length > 200) delete all[keys[0]];
    try { localStorage.setItem(COACH_KEY, JSON.stringify(all)); } catch (e) {}
  }
}

// ---------- settings: on/off and premium accounts ----------
// Accounts with premium get the site's own look: the extension stays off for them.
// "auto" detects it from the page (a locked "Simulate matchday" button = no premium);
// the mode can also be forced on or off in the settings panel (Alt+Shift+L).
let settings = { mode: "auto", premium: null, features: {} };
// What the extension adds can be chosen one by one (settings panel). Everything is on by default.
const FEATURES = [
  ["logos", "Club logos and nation flags", "The real crests and flags."],
  ["details", "Stadium, manager, captain and referee", "Stadium with place, manager line, captain armband, referee."],
  ["cards", "Coach and bench cards, suspensions", "Cards for managers and unused substitutes, and the bans that follow. (Coach cards need the manager line above.)"],
  ["var", "VAR checks and decisions", "VAR reviews, cancelled goals and cards, and the matching changes in standings and stats."],
];
const featureOn = (k) => !settings.features || settings.features[k] !== false;
const computeDisabled = () => settings.mode === "off" || (settings.mode === "auto" && settings.premium === true);

function detectPremium() {
  if (loaded < 5 || settings.mode !== "auto") return; // wait until the saved settings are read
  let found = null;
  if (document.querySelector('[data-bs-target="#premiumRequiredModal"]')) {
    found = false; // a premium-locked control is on screen: no premium
  } else {
    const btn = [...document.querySelectorAll("button, a.btn")].find(
      (b) => /simulate matchday/i.test(b.textContent || "") && !b.querySelector(".fa-crown") && !/locked/i.test(b.id || "")
    );
    if (btn) found = true;
  }
  if (found === null || found === settings.premium) return;
  settings.premium = found;
  const was = disabled;
  try {
    chrome.storage.local.set({ msSettings: settings }, () => {
      if (computeDisabled() !== was) location.reload();
    });
  } catch (e) {}
}

function saveFeature(key, on) {
  settings.features = Object.assign({}, settings.features, { [key]: on });
  chrome.storage.local.set({ msSettings: settings }, () => location.reload());
}

function saveMode(mode) {
  settings.mode = mode;
  chrome.storage.local.set({ msSettings: settings }, () => location.reload());
}

function resetAllLogos(withCorrections) {
  chrome.runtime.sendMessage({ type: "resetAll", corrections: !!withCorrections }, () => {
    refreshAll();
  });
}

function confirmResetAll() {
  if (!confirm("Reset ALL logos? They will be searched again from scratch.")) return false;
  const also = confirm("Also delete your manual corrections (" + HOW + " choices)?\n\nOK = delete them too\nCancel = keep them");
  resetAllLogos(also);
  return true;
}

function openSettings() {
  const old = document.getElementById("ms-settings");
  if (old) { old.remove(); return; }
  const box = el(
    "div",
    "position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:min(380px,92vw);max-height:90vh;overflow:auto;background:#fff;color:#111;" +
      "border-radius:10px;box-shadow:0 10px 40px rgba(0,0,0,.45);padding:14px;z-index:2147483647;font:14px system-ui,sans-serif;"
  );
  box.id = "ms-settings";
  box.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Escape") box.remove(); });
  box.append(el("div", "font-weight:600;margin-bottom:8px;", "Club Logos settings"));

  const status = settings.mode === "auto"
    ? (settings.premium === true ? "Premium detected: logos are off." : settings.premium === false ? "No premium detected: logos are on." : "Premium not checked yet: logos are on.")
    : settings.mode === "off" ? "Logos are switched off." : "Logos are switched on.";
  box.append(el("div", "color:#555;font-size:12px;margin-bottom:6px;", status));

  const sel = el("select", "width:100%;padding:6px;margin-bottom:10px;color:#111;background:#fff;border:1px solid #bbb;border-radius:6px;");
  [["auto", "Automatic (off while I have premium)"], ["on", "Always show logos"], ["off", "Never show logos"]].forEach(([v, t]) => {
    const o = el("option", "", t);
    o.value = v;
    if (settings.mode === v) o.selected = true;
    sel.appendChild(o);
  });
  sel.addEventListener("change", () => saveMode(sel.value));
  box.appendChild(sel);

  box.append(el("div", "font-weight:600;margin:4px 0 6px;", "What to add"));
  FEATURES.forEach(([key, title, hint]) => {
    const row = el("label", "display:flex;gap:8px;align-items:flex-start;margin-bottom:8px;cursor:pointer;");
    const cb = el("input", "margin-top:3px;flex:none;");
    cb.type = "checkbox";
    cb.checked = featureOn(key);
    cb.addEventListener("change", () => saveFeature(key, cb.checked));
    const txt = el("span", "");
    txt.append(el("span", "display:block;", title), el("span", "display:block;color:#666;font-size:12px;", hint));
    row.append(cb, txt);
    box.appendChild(row);
  });
  box.append(el("div", "color:#666;font-size:12px;margin-bottom:8px;", "Changing a choice reloads the page."));

  const btns = el("div", "display:flex;flex-direction:column;gap:6px;");
  const resetBtn = el("button", "padding:7px 10px;cursor:pointer;", "Reset all logos");
  resetBtn.addEventListener("click", () => { if (confirmResetAll()) box.remove(); });
  const exportBtn = el("button", "padding:7px 10px;cursor:pointer;", "Export corrections");
  exportBtn.addEventListener("click", exportCorrections);
  const importBtn = el("button", "padding:7px 10px;cursor:pointer;", "Import corrections");
  importBtn.addEventListener("click", importCorrections);
  const closeBtn = el("button", "padding:7px 10px;cursor:pointer;", "Close");
  closeBtn.addEventListener("click", () => box.remove());
  btns.append(resetBtn, exportBtn, importBtn, closeBtn);
  box.appendChild(btns);
  document.body.appendChild(box);
}

document.addEventListener("keydown", (e) => {
  if (e.altKey && e.shiftKey && (e.key === "L" || e.key === "l")) {
    e.preventDefault();
    openSettings();
  }
});

// ---------- touch devices ----------
// Long-press (about 0.6 s) on a crest, manager line, stadium, referee or captain armband acts
// like Alt+click. A small round button (bottom left) opens the settings panel, because there
// is no Alt+Shift+L on a phone.
const PRESS_TARGETS = () => LOGO_SELECTOR + ", .ms-coach, .stadium-name, .ms-referee, .ms-captain-badge";
let pressTimer = null, pressStart = null, suppressClickUntil = 0;

function cancelPress() {
  clearTimeout(pressTimer);
  pressTimer = null;
}

document.addEventListener(
  "touchstart",
  (e) => {
    if (disabled || e.touches.length !== 1) return;
    const target = e.target.closest && e.target.closest(PRESS_TARGETS());
    if (!target) return;
    const t = e.touches[0];
    pressStart = { x: t.clientX, y: t.clientY };
    cancelPress();
    pressTimer = setTimeout(() => {
      pressTimer = null;
      suppressClickUntil = Date.now() + 900;
      if (navigator.vibrate) { try { navigator.vibrate(30); } catch (err) {} }
      target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, altKey: true, view: window }));
    }, 600);
  },
  { passive: true, capture: true }
);
document.addEventListener(
  "touchmove",
  (e) => {
    if (!pressTimer || !pressStart) return;
    const t = e.touches[0];
    if (Math.hypot(t.clientX - pressStart.x, t.clientY - pressStart.y) > 12) cancelPress();
  },
  { passive: true, capture: true }
);
["touchend", "touchcancel"].forEach((n) => document.addEventListener(n, cancelPress, { passive: true, capture: true }));
// the browser's own tap/link/menu that follows a long press must not fire
document.addEventListener(
  "click",
  (e) => {
    if (Date.now() < suppressClickUntil && !e.altKey) {
      e.preventDefault();
      e.stopPropagation();
    }
  },
  true
);
document.addEventListener(
  "contextmenu",
  (e) => {
    if (TOUCH && e.target.closest && e.target.closest(PRESS_TARGETS())) e.preventDefault();
  },
  true
);

function addTouchUi() {
  if (!TOUCH || document.getElementById("ms-gear")) return;
  const style = document.createElement("style");
  style.textContent =
    "#ms-logo-picker button,#ms-details button,#ms-settings button{min-height:40px;padding:8px 12px !important}" +
    "#ms-logo-picker input,#ms-details input,#ms-settings select{font-size:16px !important;min-height:38px}";
  document.head.appendChild(style);
  const gear = el(
    "button",
    "position:fixed;left:10px;bottom:14px;width:40px;height:40px;border-radius:50%;border:0;background:#1f2937;color:#fff;" +
      "font-size:20px;line-height:40px;padding:0;opacity:.75;z-index:2147483000;box-shadow:0 2px 8px rgba(0,0,0,.4);",
    "\u2699"
  );
  gear.id = "ms-gear";
  gear.title = "Club Logos settings";
  gear.setAttribute("aria-label", "Club Logos settings");
  gear.addEventListener("click", (e) => { e.stopPropagation(); openSettings(); });
  document.body.appendChild(gear);
}
if (document.body) addTouchUi();
else document.addEventListener("DOMContentLoaded", addTouchUi);

let loaded = 0;
const onLoaded = () => {
  if (++loaded < 5) return;
  disabled = computeDisabled();
  if (disabled) return;
  ready = true;
  scan();
};
knownClubs.load(onLoaded);
flagIds.load(onLoaded);
fixtureTeams.load(onLoaded);
try {
  chrome.storage.local.get(INFO_OV_KEY, (r) => {
    infoOv = (r && r[INFO_OV_KEY]) || {};
    onLoaded();
  });
} catch (e) {
  onLoaded();
}
try {
  chrome.storage.local.get("msSettings", (r) => {
    if (r && r.msSettings) settings = Object.assign(settings, r.msSettings);
    onLoaded();
  });
} catch (e) {
  onLoaded();
}
setTimeout(() => {
  detectPremium();
  fillStadium();
  processLineupCards();
  processEditorPage();
  reapplyCaptains();
}, 1000);

if (DEBUG) {
  setTimeout(() => {
    console.log(
      `[Club Logos] ${document.querySelectorAll(LOGO_SELECTOR).length} crests (${LOGO_SELECTOR}) and ` +
        `${document.querySelectorAll('img[src*="/img/flags/"]').length} flag images on this page after 4s`
    );
  }, 4000);
}