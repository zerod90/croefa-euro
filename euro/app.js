/* =====================================================================
   CROEFA Euro kupovi — logika stranice

   Podaci dolaze iz data.js (window.DATA), koji generira fetch.py.
   Ova datoteka iz dnevnih statistika računa rezultate matchupa,
   tablice i koeficijente, te iscrtava odabrani prikaz.
   ===================================================================== */

"use strict";

const DATA = window.DATA;

/* Datum zadnjeg dana za koji imamo statistiku (YYYY-MM-DD). */
const LAST_DATE = DATA.lastDate || "0000-00-00";

/* Redoslijed statistika u nizovima iz data.js, npr. STAT.PTS = 5. */
const STAT_KEYS = DATA.statKeys;
const STAT = Object.fromEntries(STAT_KEYS.map((key, i) => [key, i]));

/* Pozicije u postavi koje se NE broje u rezultat. */
const INACTIVE_SLOTS = ["BN", "IL", "IL+", "NA"];

/* Redoslijed pozicija za prikaz postave jednog dana. */
const SLOT_ORDER = ["PG", "SG", "G", "SF", "PF", "F", "C", "Util", ...INACTIVE_SLOTS];

const WIDE_SCREEN = "(min-width: 900px)";

/* Boja svakog natjecanja (definirane u style.css). */
const COMP_COLOR = {
  LP: "var(--LP)",
  EL: "var(--EL)",
  KL: "var(--KL)",
};

/* ---------------------------------------------------------------------
   9 kategorija
   - value: kako se iz zbroja statistika dobije vrijednost kategorije
   - pct:   postotak (uspoređuje se na 3 decimale, kao Yahoo)
   - lowerWins: manja vrijednost pobjeđuje (izgubljene lopte)
   - detail: dodatni redak iznad postotka (npr. 166/366)
   --------------------------------------------------------------------- */
const CATEGORIES = [
  {
    key: "FG%",
    pct: true,
    value: (s) => (s[STAT.FGA] ? s[STAT.FGM] / s[STAT.FGA] : null),
    detailLabel: "FGM/A",
    detail: (s) => `${s[STAT.FGM]}/${s[STAT.FGA]}`,
  },
  {
    key: "FT%",
    pct: true,
    value: (s) => (s[STAT.FTA] ? s[STAT.FTM] / s[STAT.FTA] : null),
    detailLabel: "FTM/A",
    detail: (s) => `${s[STAT.FTM]}/${s[STAT.FTA]}`,
  },
  { key: "3PTM", value: (s) => s[STAT["3PTM"]] },
  { key: "PTS", value: (s) => s[STAT.PTS] },
  { key: "REB", value: (s) => s[STAT.REB] },
  { key: "AST", value: (s) => s[STAT.AST] },
  { key: "ST", value: (s) => s[STAT.ST] },
  { key: "BLK", value: (s) => s[STAT.BLK] },
  { key: "TO", value: (s) => s[STAT.TO], lowerWins: true },
];

/* Prikazi (kartice u izborniku). */
const VIEWS = [
  {
    id: "m",
    name: "Matchup",
    icon: '<path d="M4 6h16M4 12h16M4 18h10" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/>',
  },
  {
    id: "t",
    name: "Tablica",
    icon: '<path d="M5 20V10M12 20V4M19 20v-7" stroke="currentColor" stroke-width="2.4" fill="none" stroke-linecap="round"/>',
  },
  {
    id: "r",
    name: "Raspored",
    icon:
      '<rect x="4" y="5" width="16" height="15" rx="2" stroke="currentColor" stroke-width="2" fill="none"/>' +
      '<path d="M4 10h16M9 3v4M15 3v4" stroke="currentColor" stroke-width="2"/>',
  },
  {
    id: "k",
    name: "Koeficijenti",
    icon:
      '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM7 6H4v1a3 3 0 0 0 3 3M17 6h3v1a3 3 0 0 1-3 3"' +
      ' stroke="currentColor" stroke-width="2" fill="none" stroke-linejoin="round"/>',
  },
];

/* =====================================================================
   Pomoćne funkcije
   ===================================================================== */

/** Zaštita teksta prije umetanja u HTML. */
function esc(text) {
  const map = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  return String(text ?? "").replace(/[&<>"']/g, (ch) => map[ch]);
}

/** "2026-11-02" -> "2.11." */
function formatDate(iso) {
  const [, month, day] = iso.split("-");
  return `${+day}.${+month}.`;
}

/** "2026-11-02" -> "pon" */
function dayName(iso) {
  const names = ["ned", "pon", "uto", "sri", "čet", "pet", "sub"];
  return names[new Date(iso + "T12:00").getDay()];
}

/** Datum pomaknut za n dana (radi s ISO tekstom). */
function addDays(iso, n) {
  const date = new Date(iso + "T12:00Z");
  date.setUTCDate(date.getUTCDate() + n);
  return date.toISOString().slice(0, 10);
}

/** Svi datumi od..do (uključivo). */
function datesBetween(from, to) {
  const dates = [];
  for (let d = from; d <= to; d = addDays(d, 1)) dates.push(d);
  return dates;
}

/** Niz nula za zbrajanje statistika. */
function emptyStats() {
  return new Array(STAT_KEYS.length).fill(0);
}

/** Dodaje statistike iz `extra` u `total`. */
function addStats(total, extra) {
  extra.forEach((v, i) => (total[i] += v));
}

/** Postotak bez vodeće nule: 0.454 -> ".454" */
function formatPct(value) {
  return value.toFixed(3).replace(/^0/, "");
}

/** Na širokom ekranu (desktop) igrači obje momčadi prikazuju se jedni uz druge. */
function isWideScreen() {
  return matchMedia(WIDE_SCREEN).matches;
}

/* =====================================================================
   Logo momčadi (slika s Yahooa ili krug s inicijalima)
   ===================================================================== */

/** Stalna boja izvedena iz imena momčadi. */
function colorHue(name) {
  let hue = 0;
  for (const ch of name) hue = (hue * 31 + ch.charCodeAt(0)) % 360;
  return hue;
}

/** "Knežija Storks" -> "KS" */
function initials(name) {
  return name
    .replace(/[^\p{L}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase();
}

function teamLogo(name, big = false) {
  const team = DATA.teams[name] || {};
  const cls = big ? "logo big" : "logo";

  if (team.logo) {
    return `<span class="${cls}"><img src="${esc(team.logo)}" alt="" loading="lazy"></span>`;
  }
  const color = `hsl(${colorHue(name)} 45% 38%)`;
  return `<span class="${cls}" style="--lc: ${color}">${esc(initials(name))}</span>`;
}

/* =====================================================================
   Računanje rezultata
   ===================================================================== */

/** Status kola u odnosu na zadnji dan s podacima: future / live / done. */
function roundStatus(round) {
  if (LAST_DATE < round.start) return "future";
  if (LAST_DATE >= round.end) return "done";
  return "live";
}

/** Zadnji dan kola za koji već imamo podatke. */
function roundLastDay(round) {
  return LAST_DATE < round.end ? LAST_DATE : round.end;
}

/** Zbroj dnevnih statistika momčadi (samo aktivna postava) od..do. */
function teamTotals(team, from, to) {
  const total = emptyStats();
  const days = DATA.days[team] || {};
  for (const date of datesBetween(from, to)) {
    if (days[date]) addStats(total, days[date]);
  }
  return total;
}

/**
 * Tko je dobio kategoriju: 1 = prva momčad, 2 = druga, 0 = neriješeno.
 * Postoci se uspoređuju zaokruženi na 3 decimale (kao na Yahoou).
 */
function categoryWinner(cat, valueA, valueB) {
  const round = (v) => (v == null ? null : cat.pct ? Math.round(v * 1000) : v);
  const a = round(valueA);
  const b = round(valueB);

  if (a != null && b != null) {
    if (a === b) return 0;
    const aBetter = cat.lowerWins ? a < b : a > b;
    return aBetter ? 1 : 2;
  }
  // samo jedna momčad ima vrijednost (npr. nitko nije šutirao slobodna bacanja)
  if (a != null) return cat.lowerWins ? 0 : 1;
  if (b != null) return cat.lowerWins ? 0 : 2;
  return 0;
}

/** Rezultat matchupa između dvije momčadi za razdoblje od..do. */
function scoreMatchup(teamA, teamB, from, to) {
  const statsA = teamTotals(teamA, from, to);
  const statsB = teamTotals(teamB, from, to);
  const result = { statsA, statsB, winsA: 0, winsB: 0, ties: 0, categories: [] };

  for (const cat of CATEGORIES) {
    const valueA = cat.value(statsA);
    const valueB = cat.value(statsB);
    const winner = categoryWinner(cat, valueA, valueB);

    if (winner === 1) result.winsA++;
    else if (winner === 2) result.winsB++;
    else result.ties++;

    result.categories.push({ cat, valueA, valueB, winner });
  }
  return result;
}

/** Rezultat utakmice iz rasporeda (null ako kolo još nije počelo). */
function gameResult(round, game) {
  if (game[0] === "TBD" || roundStatus(round) === "future") return null;
  return scoreMatchup(game[0], game[1], round.start, roundLastDay(round));
}

/**
 * Poredak natjecanja nakon završenih kola regularnog dijela.
 * options.uptoRound   — računaj samo do tog kola (za recap "nakon 3. kola")
 * options.includeLive — uračunaj i kolo u tijeku s trenutnim rezultatom (projekcija)
 */
function standings(comp, options = {}) {
  const { uptoRound = Infinity, includeLive = false } = options;
  const rows = {};
  for (const team of comp.teams) {
    rows[team] = { team, played: 0, w: 0, l: 0, t: 0, catW: 0, catL: 0, catT: 0 };
  }

  for (const round of comp.rounds) {
    const status = roundStatus(round);
    const counts = status === "done" || (includeLive && status === "live");
    if (round.final || !counts || round.n > uptoRound) continue;

    for (const [teamA, teamB] of round.games) {
      const A = rows[teamA];
      const B = rows[teamB];
      if (!A || !B) continue;

      const m = scoreMatchup(teamA, teamB, round.start, round.end);
      A.played++;
      B.played++;
      A.catW += m.winsA;
      A.catL += m.winsB;
      A.catT += m.ties;
      B.catW += m.winsB;
      B.catL += m.winsA;
      B.catT += m.ties;

      if (m.winsA > m.winsB) {
        A.w++;
        B.l++;
      } else if (m.winsB > m.winsA) {
        B.w++;
        A.l++;
      } else {
        A.t++;
        B.t++;
      }
    }
  }

  const list = Object.values(rows);
  for (const row of list) {
    row.pct = row.played ? (row.w + row.t / 2) / row.played : 0;
    row.coef = row.w * comp.winPts + (row.t * comp.winPts) / 2 + comp.bonus;
  }

  // poredak: % pobjeda, razlika kategorija, osvojene kategorije, abeceda
  return list.sort(
    (x, y) =>
      y.pct - x.pct ||
      y.catW - y.catL - (x.catW - x.catL) ||
      y.catW - x.catW ||
      x.team.localeCompare(y.team),
  );
}

/** Kola natjecanja; finale se popuni s prve dvije momčadi kad je regularni dio gotov. */
function roundsWithFinal(comp) {
  const regular = comp.rounds.filter((r) => !r.final);
  const regularDone = regular.every((r) => roundStatus(r) === "done");

  return comp.rounds.map((round) => {
    if (!round.final) return round;
    if (!regularDone) return { ...round, games: [["TBD", "TBD"]] };

    const table = standings(comp);
    return { ...round, games: [[table[0].team, table[1].team]] };
  });
}

/** Pobjede iz finala (ulaze u koeficijent): { ime momčadi: 1 ili 0.5 }. */
function finalWins(comp) {
  const final = roundsWithFinal(comp).find((r) => r.final);
  if (!final || roundStatus(final) !== "done") return {};

  const [teamA, teamB] = final.games[0];
  if (teamA === "TBD") return {};

  const m = scoreMatchup(teamA, teamB, final.start, final.end);
  if (m.winsA > m.winsB) return { [teamA]: 1 };
  if (m.winsB > m.winsA) return { [teamB]: 1 };
  return { [teamA]: 0.5, [teamB]: 0.5 };
}

/* =====================================================================
   Stanje stranice i adresa (#LP/m/3/1 = natjecanje/prikaz/kolo/matchup)
   ===================================================================== */

const state = {
  comp: "LP", // LP, EL ili KL
  view: "m", // m = matchup, t = tablica, r = raspored, k = koeficijenti
  round: null, // broj kola (null = trenutno kolo)
  match: null, // redni broj matchupa u kolu (null = popis)
  day: "all", // "all" ili datum za prikaz jednog dana
  side: 0, // koja momčad je odabrana u tablici igrača na mobitelu
};

function currentComp() {
  return DATA.comps.find((c) => c.id === state.comp);
}

/** Kolo koje je u tijeku, inače zadnje završeno, inače prvo. */
function currentRoundNumber(comp) {
  const live = comp.rounds.find((r) => roundStatus(r) === "live");
  if (live) return live.n;

  const done = comp.rounds.filter((r) => roundStatus(r) === "done");
  if (done.length) return done[done.length - 1].n;

  return 1;
}

function readHash() {
  const [comp, view, round, match] = location.hash.slice(1).split("/");

  if (DATA.comps.some((c) => c.id === comp)) state.comp = comp;
  if (VIEWS.some((v) => v.id === view)) state.view = view;
  state.round = round ? +round : null;
  state.match = match != null && match !== "" ? +match : null;
}

/** Promijeni stanje i adresu; prikaz se osvježi. */
function navigate(changes) {
  Object.assign(state, changes);

  const hash = [state.comp, state.view, state.round ?? "", state.match ?? ""]
    .join("/")
    .replace(/\/+$/, "");

  if (location.hash.slice(1) !== hash) location.hash = hash;
  else render();
}

/* =====================================================================
   Zajednički dijelovi prikaza
   ===================================================================== */

function demoBanner() {
  if (!DATA.demo) return "";
  return `
    <div class="demo">
      <b>DEMO podaci</b> — izmišljene brojke dok se ne spoji Yahoo (python fetch.py update).
    </div>`;
}

function statusPill(round) {
  const status = roundStatus(round);
  if (status === "live") return `<span class="pill live">U tijeku</span>`;
  if (status === "done") return `<span class="pill">Završeno</span>`;
  return `<span class="pill">Nije počelo</span>`;
}

function formatCategoryValue(cat, value) {
  if (value == null) return "–";
  return cat.pct ? formatPct(value) : value;
}

/** Zaglavlje: gumbi natjecanja, izbornik prikaza i vrijeme ažuriranja. */
function renderChrome() {
  const comp = currentComp();
  document.documentElement.style.setProperty("--c", COMP_COLOR[comp.id]);

  document.getElementById("comps").innerHTML = DATA.comps
    .map((c) => {
      const color = COMP_COLOR[c.id];
      const shortName = c.name.replace("Konferencijska", "Konf.");
      return `
        <button class="comp ${c.id === state.comp ? "on" : ""}" style="--c: ${color}" data-comp="${c.id}">
          <span class="dot" style="background: ${color}"></span>
          <span class="long">${esc(c.name)}</span>
          <span class="short">${esc(shortName)}</span>
        </button>`;
    })
    .join("");

  document.getElementById("topviews").innerHTML = VIEWS.map(
    (v) => `<button class="view ${v.id === state.view ? "on" : ""}" data-view="${v.id}">${v.name}</button>`,
  ).join("");

  document.getElementById("bottomnav").innerHTML = VIEWS.map(
    (v) => `
      <button class="${v.id === state.view ? "on" : ""}" data-view="${v.id}">
        <svg viewBox="0 0 24 24">${v.icon}</svg>${v.name}
      </button>`,
  ).join("");

  const lastDate = DATA.lastDate
    ? formatDate(DATA.lastDate) + DATA.lastDate.slice(0, 4) + "."
    : "—";
  document.getElementById("upd").innerHTML =
    `Ažurirano ${esc(DATA.generated)}<br>statistika do ${lastDate}`;
}

/* =====================================================================
   Prikaz: Matchup (popis kola)
   ===================================================================== */

function viewMatchups() {
  const comp = currentComp();
  const rounds = roundsWithFinal(comp);
  const roundNumber = state.round || currentRoundNumber(comp);
  const round = rounds.find((r) => r.n === roundNumber) || rounds[0];

  if (state.match != null) {
    return viewMatchupDetail(round, round.games[state.match]);
  }

  const roundOptions = rounds
    .map(
      (r) => `
        <option value="${r.n}" ${r.n === round.n ? "selected" : ""}>
          ${esc(r.label)} · ${formatDate(r.start)}–${formatDate(r.end)}
        </option>`,
    )
    .join("");

  const cards = round.games.map((game, i) => matchupCard(round, game, i)).join("");

  return `
    ${demoBanner()}
    <div class="bar">
      <select id="roundSel">${roundOptions}</select>
      ${statusPill(round)}
    </div>
    <div class="grid">${cards}</div>`;
}

function matchupCard(round, game, index) {
  const m = gameResult(round, game);
  const [teamA, teamB] = game;

  const row = (team, score, lost) => `
    <div class="mrow ${lost ? "lose" : ""}">
      ${team === "TBD" ? "" : teamLogo(team)}
      <span class="nm">${esc(team)}</span>
      <span class="sc">${score}</span>
    </div>`;

  // kratki naslov recapa ispod rezultata (samo kad je kolo počelo)
  const recap = m ? buildRecap(currentComp(), round, game) : null;
  const recapLine = recap ? `<div class="recap-line">${recap.headline}</div>` : "";

  return `
    <div class="card" data-match="${index}">
      ${row(teamA, m ? m.winsA : "–", m && m.winsA < m.winsB)}
      ${row(teamB, m ? m.winsB : "–", m && m.winsB < m.winsA)}
      ${recapLine}
      <div class="foot">
        <span>${m && m.ties ? `neriješeno ${m.ties}` : "&nbsp;"}</span>
        ${statusPill(round)}
      </div>
    </div>`;
}

/* =====================================================================
   Prikaz: detalj jednog matchupa
   ===================================================================== */

function viewMatchupDetail(round, game) {
  if (!game || game[0] === "TBD") {
    return `<div class="empty">Finalisti još nisu poznati.</div>`;
  }

  const [teamA, teamB] = game;
  const future = roundStatus(round) === "future";
  const days = future ? [] : datesBetween(round.start, roundLastDay(round));

  if (state.day !== "all" && !days.includes(state.day)) state.day = "all";

  const from = state.day === "all" ? round.start : state.day;
  const to = state.day === "all" ? roundLastDay(round) : state.day;

  // prije početka kola računamo "prazan" rezultat (0:0 u svemu)
  const noData = "9999-01-01";
  const selected = future
    ? scoreMatchup(teamA, teamB, noData, noData)
    : scoreMatchup(teamA, teamB, from, to);
  const total = future
    ? selected
    : scoreMatchup(teamA, teamB, round.start, roundLastDay(round));

  const dayOptions = [
    `<option value="all">Ukupno kolo (${formatDate(round.start)}–${formatDate(round.end)})</option>`,
    ...days.map(
      (d) => `<option value="${d}" ${d === state.day ? "selected" : ""}>${dayName(d)} ${formatDate(d)}</option>`,
    ),
  ].join("");

  const players = future
    ? `<div class="empty">Kolo još nije počelo.</div>`
    : playersSection(teamA, teamB, from, to);

  return `
    ${demoBanner()}
    <div class="bar">
      <button class="back" data-back>‹ ${esc(round.label)}</button>
      <select id="daySel" ${future ? "disabled" : ""}>${dayOptions}</select>
    </div>
    ${matchupHeader(round, teamA, teamB, total)}
    ${recapBox(round, game)}
    <div class="dwrap">
      ${categoryTable(selected)}
      <div>${players}</div>
    </div>`;
}

/** Okvir s automatskim recapom matchupa (cijelo kolo, neovisno o odabranom danu). */
function recapBox(round, game) {
  const recap = buildRecap(currentComp(), round, game);
  if (!recap) return "";

  const paragraphs = recap.paragraphs.map((p) => `<p>${p}</p>`).join("");
  const label = roundStatus(round) === "future" ? "Najava" : "Recap";

  return `
    <div class="recap">
      <div class="recap-label">${label}</div>
      <h2 class="recap-title">${recap.headline}</h2>
      ${paragraphs}
      <div class="recap-note">Automatski sastavljeno iz statistike matchupa i tablice natjecanja.</div>
    </div>`;
}

/** Veliko zaglavlje: logo, ime, rezultat. */
function matchupHeader(round, teamA, teamB, total) {
  const subtitle = (team) => {
    const info = DATA.teams[team] || {};
    return esc(info.manager || info.league || "");
  };

  const side = (team, alignRight) => `
    <div class="side ${alignRight ? "r" : ""}">
      ${teamLogo(team, true)}
      <div class="tn">${esc(team)}</div>
      <div class="mgr">${subtitle(team)}</div>
    </div>`;

  return `
    <div class="mhead">
      ${side(teamA, false)}
      <div class="mid">
        <div class="score">
          <span>${total.winsA}</span>
          <small>${total.ties ? total.ties + " ner." : "vs"}</small>
          <span>${total.winsB}</span>
        </div>
        <div class="gp">Odigrano: ${total.statsA[STAT.GP]} · ${total.statsB[STAT.GP]}</div>
        <div class="status">${statusPill(round)}</div>
      </div>
      ${side(teamB, true)}
    </div>`;
}

/** Usporedba 9 kategorija; pobjednik kategorije je označen. */
function categoryTable(m) {
  let rows = "";

  for (const { cat, valueA, valueB, winner } of m.categories) {
    if (cat.detail) {
      rows += `
        <div class="crow sub">
          <div>${cat.detail(m.statsA)}</div>
          <div class="lab">${cat.detailLabel}</div>
          <div>${cat.detail(m.statsB)}</div>
        </div>`;
    }
    rows += `
      <div class="crow">
        <div class="${winner === 1 ? "w" : ""}">${formatCategoryValue(cat, valueA)}</div>
        <div class="lab">${cat.key}</div>
        <div class="${winner === 2 ? "w" : ""}">${formatCategoryValue(cat, valueB)}</div>
      </div>`;
  }

  const title = state.day === "all" ? "Ukupno" : `${dayName(state.day)} ${formatDate(state.day)}`;
  const score = `${m.winsA}–${m.winsB}${m.ties ? "–" + m.ties : ""}`;

  return `
    <div class="cats">
      <h3>${title} · ${score}</h3>
      ${rows}
    </div>`;
}

/** Tablice igrača: na desktopu obje momčadi, na mobitelu kartice za odabir. */
function playersSection(teamA, teamB, from, to) {
  if (isWideScreen()) {
    const box = (team) => `
      <div class="box">
        <h3>${esc(team)}</h3>
        ${playersTable(team, from, to)}
      </div>`;
    return `<div class="cols two">${box(teamA)}${box(teamB)}</div>`;
  }

  const tab = (team, index) =>
    `<button class="${state.side === index ? "on" : ""}" data-side="${index}">${esc(team)}</button>`;

  return `
    <div class="box">
      <div class="tabs2">${tab(teamA, 0)}${tab(teamB, 1)}</div>
      ${playersTable(state.side === 0 ? teamA : teamB, from, to)}
    </div>`;
}

/* =====================================================================
   Tablica igrača jedne momčadi
   ===================================================================== */

/**
 * Zbroji statistiku po igraču za razdoblje.
 * active = zbroj dana kad je igrač bio u aktivnoj postavi (broji se),
 * bench  = zbroj dana na klupi / IL (ne broji se).
 */
function collectPlayers(team, from, to) {
  const lineups = DATA.lineups[team] || {};
  const players = {};

  for (const date of datesBetween(from, to)) {
    for (const [playerId, slot, ...stats] of lineups[date] || []) {
      if (!players[playerId]) {
        players[playerId] = {
          playerId,
          slot,
          active: emptyStats(),
          bench: emptyStats(),
          activeDays: 0,
          order: Object.keys(players).length,
        };
      }
      const p = players[playerId];
      p.slot = slot;

      if (INACTIVE_SLOTS.includes(slot)) {
        addStats(p.bench, stats);
      } else {
        p.activeDays++;
        addStats(p.active, stats);
      }
    }
  }
  return Object.values(players);
}

function statCells(s) {
  return `
    <td>${s[STAT.FGM]}/${s[STAT.FGA]}</td>
    <td>${s[STAT.FTM]}/${s[STAT.FTA]}</td>
    <td>${s[STAT["3PTM"]]}</td>
    <td>${s[STAT.PTS]}</td>
    <td>${s[STAT.REB]}</td>
    <td>${s[STAT.AST]}</td>
    <td>${s[STAT.ST]}</td>
    <td>${s[STAT.BLK]}</td>
    <td>${s[STAT.TO]}</td>`;
}

function playersTable(team, from, to) {
  const players = collectPlayers(team, from, to);
  if (!players.length) return `<div class="empty">Nema podataka.</div>`;

  const singleDay = from === to;

  if (singleDay) {
    // jedan dan: redoslijed kao u postavi (PG, SG, ... BN, IL)
    const slotIndex = (p) => SLOT_ORDER.indexOf(p.slot);
    players.sort((x, y) => slotIndex(x) - slotIndex(y) || x.order - y.order);
  } else {
    // više dana: prvo igrači koji su igrali u postavi, zatim po poenima
    const played = (p) => (p.activeDays ? 1 : 0);
    const points = (p) => p.active[STAT.PTS];
    players.sort((x, y) => played(y) - played(x) || points(y) - points(x));
  }

  const total = emptyStats();

  const rows = players
    .map((p) => {
      const [name, nbaTeam, positions] = DATA.players[p.playerId] || ["?", "", ""];
      const onBench = !p.activeDays;
      const stats = singleDay && onBench ? p.bench : p.active;

      if (!onBench) addStats(total, stats);

      // jedan dan: pozicija u postavi; više dana: broj odigranih utakmica u postavi
      const badge = singleDay ? esc(p.slot) : stats[STAT.GP];

      return `
        <tr class="${onBench ? "bench" : ""}">
          <td class="l sticky1">
            <span class="slot">${badge}</span>
            <span class="pn">${esc(name)}<small>${esc(nbaTeam)} · ${esc(positions)}</small></span>
          </td>
          ${statCells(stats)}
        </tr>`;
    })
    .join("");

  const note = singleDay
    ? "Sivo = klupa / IL (ne broji se)."
    : "Zbroj samo dana kad je igrač bio u aktivnoj postavi. GP = odigrane utakmice u aktivnoj postavi.";

  return `
    <div class="scroll">
      <table>
        <thead>
          <tr>
            <th class="l sticky1">${singleDay ? "Poz." : "GP"} · Igrač</th>
            <th>FGM/A</th><th>FTM/A</th><th>3PTM</th><th>PTS</th><th>REB</th>
            <th>AST</th><th>ST</th><th>BLK</th><th>TO</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
          <tr class="tot">
            <td class="l sticky1">Ukupno (aktivni)</td>
            ${statCells(total)}
          </tr>
        </tbody>
      </table>
    </div>
    <div class="note">${note}</div>`;
}

/* =====================================================================
   Prikaz: Tablica
   ===================================================================== */

function viewStandings() {
  const comp = currentComp();
  const table = standings(comp);
  const regular = comp.rounds.filter((r) => !r.final);
  const finished = regular.filter((r) => roundStatus(r) === "done").length;

  const rows = table
    .map((row, i) => {
      const diff = row.catW - row.catL;
      return `
        <tr class="${i < 2 ? "q" : ""}">
          <td class="rank">${i + 1}</td>
          <td class="l"><span class="tname">${teamLogo(row.team)}${esc(row.team)}</span></td>
          <td>${row.w}-${row.l}-${row.t}</td>
          <td>${formatPct(row.pct)}</td>
          <td>${row.catW}-${row.catL}-${row.catT}</td>
          <td>${diff > 0 ? "+" : ""}${diff}</td>
        </tr>`;
    })
    .join("");

  return `
    ${demoBanner()}
    <div class="box stand">
      <h3>${esc(comp.name)} — tablica</h3>
      <div class="scroll">
        <table>
          <thead>
            <tr>
              <th>#</th><th class="l">Momčad</th><th>P-I-N</th>
              <th>Pct</th><th>Kategorije</th><th>+/-</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div class="note">
        Odigrano ${finished}/${regular.length} kola regularnog dijela (računaju se samo završena kola).
        Prve dvije momčadi idu u dvotjedno finale.
        Poredak: postotak pobjeda, zatim razlika kategorija.
      </div>
    </div>`;
}

/* =====================================================================
   Prikaz: Raspored
   ===================================================================== */

function viewSchedule() {
  const rounds = roundsWithFinal(currentComp());

  const html = rounds
    .map((round) => {
      const games = round.games
        .map((game, i) => {
          const m = gameResult(round, game);
          return `
            <div class="sgame" data-round="${round.n}" data-match="${i}">
              <span class="a ${m && m.winsA > m.winsB ? "won" : ""}">${esc(game[0])}</span>
              <span class="s">${m ? `${m.winsA} : ${m.winsB}` : "–"}</span>
              <span class="b ${m && m.winsB > m.winsA ? "won" : ""}">${esc(game[1])}</span>
            </div>`;
        })
        .join("");

      return `
        <div class="round">
          <h4>
            ${esc(round.label)}
            <span>${formatDate(round.start)}–${formatDate(round.end)}${round.end.slice(0, 4)}.</span>
            ${statusPill(round)}
          </h4>
          ${games}
        </div>`;
    })
    .join("");

  return `${demoBanner()}<div class="rgrid">${html}</div>`;
}

/* =====================================================================
   Prikaz: Koeficijenti
   ===================================================================== */

function viewCoefficients() {
  const clubs = [];
  const leagues = {};

  for (const comp of DATA.comps) {
    const bonusWins = finalWins(comp);

    for (const row of standings(comp)) {
      const extra = bonusWins[row.team] || 0;
      const coef = row.coef + extra * comp.winPts;
      const league = (DATA.teams[row.team] || {}).league || "?";

      clubs.push({ team: row.team, comp, wins: row.w + extra, ties: row.t, coef });

      leagues[league] = leagues[league] || { sum: 0, count: 0 };
      leagues[league].sum += coef;
      leagues[league].count++;
    }
  }

  clubs.sort((a, b) => b.coef - a.coef || a.team.localeCompare(b.team));

  const clubRows = clubs
    .map(
      (c, i) => `
        <tr>
          <td class="rank">${i + 1}</td>
          <td class="l"><span class="tname">${teamLogo(c.team)}${esc(c.team)}</span></td>
          <td class="l"><span class="pill comp-tag" style="background: ${COMP_COLOR[c.comp.id]}">${c.comp.id}</span></td>
          <td>${c.wins}${c.ties ? ` (+${c.ties} ner.)` : ""}</td>
          <td>${c.comp.bonus}</td>
          <td><b>${c.coef.toFixed(1)}</b></td>
        </tr>`,
    )
    .join("");

  const leagueRows = Object.entries(leagues)
    .sort((a, b) => b[1].sum / b[1].count - a[1].sum / a[1].count)
    .map(
      ([name, v]) => `
        <tr>
          <td class="l">${esc(name)}</td>
          <td>${v.count}</td>
          <td>${v.sum.toFixed(1)}</td>
          <td><b>${(v.sum / v.count).toFixed(2)}</b></td>
        </tr>`,
    )
    .join("");

  return `
    ${demoBanner()}
    <div class="cols">
      <div class="box">
        <h3>Ligaški koeficijent</h3>
        <div class="scroll">
          <table>
            <thead>
              <tr><th class="l">Liga</th><th>Momčadi</th><th>Bodovi</th><th>Koef.</th></tr>
            </thead>
            <tbody>${leagueRows}</tbody>
          </table>
        </div>
      </div>

      <div class="box stand">
        <h3>Klupski koeficijent 26/27</h3>
        <div class="scroll">
          <table>
            <thead>
              <tr>
                <th>#</th><th class="l">Momčad</th><th class="l">Natj.</th>
                <th>Pobjede</th><th>Bonus</th><th>Koef.</th>
              </tr>
            </thead>
            <tbody>${clubRows}</tbody>
          </table>
        </div>
        <div class="note">
          Pobjeda: LP 2 · EL 1,5 · KL 1 bod (neriješeno = pola).
          Bonus za plasman: LP 3 · EL 2 · KL 1. Računaju se završena kola i finale.
        </div>
      </div>
    </div>`;
}

/* =====================================================================
   Iscrtavanje i događaji
   ===================================================================== */

const VIEW_RENDERERS = {
  m: viewMatchups,
  t: viewStandings,
  r: viewSchedule,
  k: viewCoefficients,
};

function render() {
  renderChrome();
  document.getElementById("main").innerHTML = VIEW_RENDERERS[state.view]();
}

/* klikovi na gumbe i kartice */
document.addEventListener("click", (event) => {
  const el = event.target.closest("[data-comp], [data-view], [data-match], [data-back], [data-side]");
  if (!el) return;
  const data = el.dataset;

  if (data.comp) {
    navigate({ comp: data.comp, round: null, match: null, day: "all" });
  } else if (data.view) {
    navigate({ view: data.view, match: null, round: data.view === "m" ? state.round : null });
  } else if (data.back != null) {
    navigate({ match: null });
  } else if (data.side != null) {
    state.side = +data.side;
    render();
  } else if (data.match != null) {
    const round = data.round ? +data.round : state.round || currentRoundNumber(currentComp());
    navigate({ view: "m", round, match: +data.match, day: "all", side: 0 });
    window.scrollTo(0, 0);
  }
});

/* promjena kola ili dana u padajućem izborniku */
document.addEventListener("change", (event) => {
  if (event.target.id === "roundSel") {
    navigate({ round: +event.target.value });
  } else if (event.target.id === "daySel") {
    state.day = event.target.value;
    render();
  }
});

/* tipka natrag / naprijed u pregledniku */
window.addEventListener("hashchange", () => {
  readHash();
  render();
});

/* prelazak mobitel <-> desktop mijenja raspored tablica igrača */
let wasWide = isWideScreen();
window.addEventListener("resize", () => {
  const wide = isWideScreen();
  if (wide !== wasWide) {
    wasWide = wide;
    render();
  }
});

readHash();
render();
