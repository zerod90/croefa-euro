/* =====================================================================
   Z-score — prikaz stranice

   Podaci: data.js (window.ZDATA), izračun: zscore-calc.js (ZScore).
   Adresa: #w/4 (tjedan 4), #w/4/Ime momčadi (detalj), #s (sezona),
   #o (objašnjenje).
   ===================================================================== */

"use strict";

const { CATEGORIES, computeWeek, computeSeason, formatZ, formatPct, esc } = ZScore;
const WEEKS = window.ZDATA.weeks;
const LATEST_WEEK = WEEKS[WEEKS.length - 1].week;

const VIEWS = [
  {
    id: "w",
    name: "Tjedan",
    icon: '<path d="M5 20V10M12 20V4M19 20v-7" stroke="currentColor" stroke-width="2.4" fill="none" stroke-linecap="round"/>',
  },
  {
    id: "s",
    name: "Sezona",
    icon:
      '<rect x="4" y="5" width="16" height="15" rx="2" stroke="currentColor" stroke-width="2" fill="none"/>' +
      '<path d="M4 10h16M9 3v4M15 3v4" stroke="currentColor" stroke-width="2"/>',
  },
  {
    id: "o",
    name: "Objašnjenje",
    icon:
      '<circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2" fill="none"/>' +
      '<path d="M12 11v6M12 7.5v.5" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>',
  },
];

/* =====================================================================
   Stanje stranice
   ===================================================================== */

const state = {
  view: "w",
  week: LATEST_WEEK,
  team: null, // ime momčadi za detalj (null = tablica)
  pctMode: "impact", // "impact" ili "simple"
  show: "z", // toplinska karta: "z" = z-vrijednosti, "stat" = statistika
  sort: { key: "rank", asc: true },
};

function readHash() {
  const [view, week, team] = location.hash.slice(1).split("/");
  state.view = VIEWS.some((v) => v.id === view) ? view : "w";
  state.week = WEEKS.some((w) => w.week === +week) ? +week : LATEST_WEEK;
  state.team = team ? decodeURIComponent(team) : null;
}

function navigate(changes) {
  Object.assign(state, changes);
  const parts = [state.view];
  if (state.view === "w") {
    parts.push(state.week);
    if (state.team) parts.push(encodeURIComponent(state.team));
  }
  const hash = parts.join("/");
  if (location.hash.slice(1) !== hash) location.hash = hash;
  else render();
}

/* =====================================================================
   Pomoćne funkcije za prikaz
   ===================================================================== */

/** Boja za z-vrijednost: crvena (loše) → žuta → zelena (dobro). */
function heatColor(z, limit = 2) {
  const t = Math.max(-1, Math.min(1, z / limit)); // -1 .. 1
  const hue = 60 + t * 60; // 0 (crvena) .. 60 (žuta) .. 120 (zelena)
  const light = 62 - Math.abs(t) * 6;
  return `hsl(${hue} 70% ${light}%)`;
}

function heatCell(z, text, limit, extraClass = "") {
  return `<td class="heat ${extraClass}" style="background: ${heatColor(z, limit)}">${text}</td>`;
}

function formatSigned(value, decimals = 2) {
  const text = Math.abs(value).toFixed(decimals).replace(".", ",");
  if (value > 0.0001) return `<span class="pos">+${text}</span>`;
  if (value < -0.0001) return `<span class="neg">−${text}</span>`;
  return `<span class="muted">${text}</span>`;
}

/** Omjer pobjeda-poraza(-neriješenih), npr. "5-4" ili "4-2-1". */
function recordText(r) {
  return r.ties ? `${r.wins}-${r.losses}-${r.ties}` : `${r.wins}-${r.losses}`;
}

/** Oznaka W / L / T s rezultatom, npr. [W] 5-4. */
function resultBadge(result) {
  let letter = "T";
  if (result.wins > result.losses) letter = "W";
  if (result.wins < result.losses) letter = "L";
  return `<span class="res ${letter}">${letter}</span>${recordText(result)}`;
}

/** Atribut "selected" za odabranu opciju u padajućem izborniku. */
function selectedIf(condition) {
  return condition ? "selected" : "";
}

/** Obojeni stupac grafa oko nule; maxAbs = vrijednost koja ispuni pola širine. */
function barFill(z, maxAbs, colorLimit) {
  const width = Math.min(Math.abs(z) / maxAbs, 1) * 50; // % širine
  const left = z >= 0 ? 50 : 50 - width;
  const color = heatColor(z, colorLimit);
  return `<span class="bar-fill" style="left: ${left}%; width: ${width}%; background: ${color}"></span>`;
}

/** Legenda boja: od crvene (lošije) do zelene (bolje). */
const COLOR_LEGEND = `
  <span class="legend">
    <span>lošije</span>
    <span class="scale"></span>
    <span>bolje od prosjeka</span>
  </span>`;

function categoryText(cat, value) {
  return cat.made ? formatPct(value) : value;
}

function weekLabel(week) {
  const fmt = (iso) => {
    const [, m, d] = iso.split("-");
    return `${+d}.${+m}.`;
  };
  return `${week.week}. tjedan · ${fmt(week.start)}–${fmt(week.end)}`;
}

function currentWeek() {
  return WEEKS.find((w) => w.week === state.week);
}

/* ---------- Sortiranje tablica ---------- */

/** Vrijednost po kojoj se sortira za svaki stupac (ostali stupci su kategorije). */
const SORT_VALUES = {
  rank: (t) => t.rank,
  team: (t) => t.team,
  zTotal: (t) => t.zTotal,
  result: (t) => t.result.wins - t.result.losses,
  allPlay: (t) => t.allPlay.pct,
  luck: (t) => t.luck,
};

/**
 * Stupci koji se pri prvom kliku sortiraju uzlazno (1, 2, 3… / A–Ž).
 * Ostali se sortiraju silazno, tako da je najbolji gore.
 */
const ASCENDING_FIRST = ["rank", "team"];

function sortValue(team, key) {
  const getter = SORT_VALUES[key];
  return getter ? getter(team) : team.z[key];
}

/** Sortira momčadi prema odabranom stupcu i smjeru iz state.sort. */
function sortTeams(teams) {
  const { key, asc } = state.sort;

  return [...teams].sort((a, b) => {
    const va = sortValue(a, key);
    const vb = sortValue(b, key);
    const cmp = typeof va === "string" ? va.localeCompare(vb) : va - vb;
    return asc ? cmp : -cmp;
  });
}

/** Klik na isti stupac mijenja smjer; klik na novi stupac kreće od prirodnog smjera. */
function toggleSort(key) {
  if (state.sort.key === key) {
    state.sort.asc = !state.sort.asc;
  } else {
    state.sort = { key, asc: ASCENDING_FIRST.includes(key) };
  }
}

/** Zaglavlje stupca koje se može sortirati klikom. */
function sortHeader(key, label, extraClass = "") {
  const classes = ["sortable", extraClass];
  if (state.sort.key === key) {
    classes.push("sorted");
    if (state.sort.asc) classes.push("asc");
  }
  return `<th class="${classes.join(" ")}" data-sort="${key}">${label}</th>`;
}

/* =====================================================================
   Zaglavlje i navigacija
   ===================================================================== */

function renderChrome() {
  document.getElementById("topviews").innerHTML = VIEWS.map((v) => {
    const on = v.id === state.view ? "on" : "";
    return `<button class="view ${on}" data-view="${v.id}">${v.name}</button>`;
  }).join("");

  document.getElementById("bottomnav").innerHTML = VIEWS.map(
    (v) => `
      <button class="${v.id === state.view ? "on" : ""}" data-view="${v.id}">
        <svg viewBox="0 0 24 24">${v.icon}</svg>${v.name}
      </button>`,
  ).join("");

  document.getElementById("upd").innerHTML =
    `Ažurirano ${esc(window.ZDATA.updated)}<br>tjedana: ${WEEKS.length}`;
}

function controlsBar({ weekSelect = true, showToggle = false } = {}) {
  const weekOptions = WEEKS.map(
    (w) => `<option value="${w.week}" ${selectedIf(w.week === state.week)}>${weekLabel(w)}</option>`,
  ).join("");

  const pctOptions = `
    <option value="impact" ${selectedIf(state.pctMode === "impact")}>Postoci: ponderirano</option>
    <option value="simple" ${selectedIf(state.pctMode === "simple")}>Postoci: jednostavno</option>`;

  const showOptions = `
    <option value="z" ${selectedIf(state.show === "z")}>Prikaz: z-vrijednosti</option>
    <option value="stat" ${selectedIf(state.show === "stat")}>Prikaz: statistika</option>`;

  return `
    <div class="bar">
      ${weekSelect ? `<select id="weekSel">${weekOptions}</select>` : ""}
      <select id="pctSel" title="Kako se računaju FG% i FT%">${pctOptions}</select>
      ${showToggle ? `<select id="showSel">${showOptions}</select>` : ""}
    </div>`;
}

/* =====================================================================
   Prikaz: Tjedan
   ===================================================================== */

function viewWeek() {
  const week = currentWeek();
  const data = computeWeek(week, state.pctMode);

  if (state.team) {
    const team = data.teams.find((t) => t.team === state.team);
    if (team) return viewTeam(data, team);
  }

  return `
    ${controlsBar({ showToggle: true })}
    ${rankingTable(data)}
    ${heatmapTable(data)}
    ${barChart(data)}`;
}

/** Glavna tablica: poredak, Z-score, stvarni rezultat, all-play, sreća. */
function rankingTable(data) {
  const rows = sortTeams(data.teams)
    .map(
      (t) => `
        <tr class="clickable" data-team="${esc(t.team)}">
          <td class="rank">${t.rank}</td>
          <td class="l sticky1"><b>${esc(t.team)}</b></td>
          ${heatCell(t.zTotal, formatZ(t.zTotal), 1.2, "total")}
          <td class="l">${resultBadge(t.result)} <span class="muted">vs ${esc(t.opponent)}</span></td>
          <td>${recordText(t.allPlay)} <span class="muted">(${formatPct(t.allPlay.pct)})</span></td>
          <td>${formatSigned(t.luck)}</td>
        </tr>`,
    )
    .join("");

  return `
    <div class="box stand section">
      <h3>Z-score poredak <small>${esc(weekLabel(data.week))}</small></h3>
      <div class="scroll">
        <table>
          <thead>
            <tr>
              ${sortHeader("rank", "#")}
              ${sortHeader("team", "Momčad", "l sticky1")}
              ${sortHeader("zTotal", "Z-score")}
              ${sortHeader("result", "Matchup", "l")}
              ${sortHeader("allPlay", "All-play")}
              ${sortHeader("luck", "Sreća")}
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div class="note">
        Z-score = prosjek z-vrijednosti 9 kategorija (0 = prosjek lige).
        All-play = rezultat da je momčad taj tjedan igrala protiv svih ostalih.
        Sreća = stvarni ishod − all-play postotak.
        Klik na momčad otvara detalje, klik na stupac sortira.
      </div>
    </div>`;
}

/** Toplinska karta: z-vrijednost (ili statistika) po kategorijama. */
function heatmapTable(data) {
  const showStats = state.show === "stat";

  const rows = sortTeams(data.teams)
    .map((t) => {
      const cells = CATEGORIES.map((cat) => {
        const text = showStats ? categoryText(cat, t.values[cat.key]) : formatZ(t.z[cat.key], 2);
        return heatCell(t.z[cat.key], text, 2);
      }).join("");

      return `
        <tr class="clickable" data-team="${esc(t.team)}">
          <td class="l sticky1"><b>${esc(t.team)}</b></td>
          ${cells}
          ${heatCell(t.zTotal, formatZ(t.zTotal), 1.2, "total")}
        </tr>`;
    })
    .join("");

  const catHeaders = CATEGORIES.map((c) => sortHeader(c.key, c.key)).join("");
  const subtitle = showStats ? "statistika, boja = z-vrijednost" : "z-vrijednosti";

  return `
    <div class="box section">
      <h3>Po kategorijama <small>${subtitle}</small></h3>
      <div class="scroll">
        <table>
          <thead>
            <tr>
              ${sortHeader("team", "Momčad", "l sticky1")}
              ${catHeaders}
              ${sortHeader("zTotal", "Ukupno")}
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div class="note">
        ${COLOR_LEGEND}
        Kod TO je obrnuto: manje izgubljenih lopti = pozitivan z.
      </div>
    </div>`;
}

/** Vodoravni stupci: Z-score svake momčadi oko nule. */
function barChart(data) {
  const maxAbs = Math.max(...data.teams.map((t) => Math.abs(t.zTotal)), 0.5);

  const rows = data.teams
    .map(
      (t) => `
        <div class="bar-row clickable" data-team="${esc(t.team)}">
          <span class="name">${t.rank}. ${esc(t.team)}</span>
          <span class="bar-track">${barFill(t.zTotal, maxAbs, 1.2)}</span>
          <span class="val">${formatZ(t.zTotal)}</span>
        </div>`,
    )
    .join("");

  return `
    <div class="box section">
      <h3>Z-score graf</h3>
      <div class="bars">${rows}</div>
    </div>`;
}

/* =====================================================================
   Prikaz: detalj jedne momčadi u tjednu
   ===================================================================== */

function viewTeam(data, team) {
  const n = data.teams.length;
  const ap = team.allPlay;

  const kpis = `
    <div class="kpis">
      <div class="kpi">
        <div class="lab">Z-score</div>
        <div class="num">${formatZ(team.zTotal)}</div>
        <div class="sub">${team.rank}. od ${n}</div>
      </div>
      <div class="kpi">
        <div class="lab">Matchup</div>
        <div class="num">${resultBadge(team.result)}</div>
        <div class="sub">vs ${esc(team.opponent)}</div>
      </div>
      <div class="kpi">
        <div class="lab">All-play</div>
        <div class="num">${recordText(ap)}</div>
        <div class="sub">kategorije ${ap.catWins}-${ap.catLosses}-${ap.catTies}</div>
      </div>
      <div class="kpi">
        <div class="lab">Sreća</div>
        <div class="num">${formatSigned(team.luck)}</div>
        <div class="sub">stvarno − očekivano</div>
      </div>
    </div>`;

  const catRows = CATEGORIES.map((cat) => {
    const z = team.z[cat.key];
    return `
      <tr>
        <td class="l"><b>${cat.key}</b></td>
        <td>${categoryText(cat, team.values[cat.key])}</td>
        ${heatCell(z, formatZ(z, 2), 2)}
        <td>${team.catRank[cat.key]}.</td>
        <td class="l bar-cell">
          <span class="bar-track">${barFill(z, 2.5, 2)}</span>
        </td>
      </tr>`;
  }).join("");

  // protiv svakoga: prvo pobjede, zatim po razlici kategorija
  const catDiff = (v) => v.wins - v.losses;
  const vsList = [...ap.vs].sort((a, b) => b.outcome - a.outcome || catDiff(b) - catDiff(a));

  const vsRows = vsList
    .map((v) => {
      const isOpponent = v.team === team.opponent;
      const label = isOpponent ? `<span class="muted">(stvarni protivnik)</span>` : "";
      return `
        <tr class="${isOpponent ? "tot" : ""}">
          <td class="l">${esc(v.team)} ${label}</td>
          <td>${resultBadge(v)}</td>
        </tr>`;
    })
    .join("");

  const backLabel = `‹ Svi · ${esc(weekLabel(data.week))}`;

  return `
    ${controlsBar()}
    <div class="bar"><button class="back" data-back>${backLabel}</button></div>
    <div class="team-head"><h2>${esc(team.team)}</h2>${team.rank}. mjesto po Z-scoreu</div>
    ${kpis}
    <div class="cols two">
      <div class="box">
        <h3>Kategorije</h3>
        <div class="scroll">
          <table>
            <thead>
              <tr>
                <th class="l">Kat.</th><th>Stat.</th><th>z</th><th>Mjesto</th>
                <th class="l">ispod / iznad prosjeka</th>
              </tr>
            </thead>
            <tbody>${catRows}</tbody>
          </table>
        </div>
      </div>
      <div class="box">
        <h3>All-play: protiv svake momčadi</h3>
        <div class="scroll">
          <table><tbody>${vsRows}</tbody></table>
        </div>
      </div>
    </div>`;
}

/* =====================================================================
   Prikaz: Sezona
   ===================================================================== */

function viewSeason() {
  const season = computeSeason(WEEKS, state.pctMode);
  const weekNumbers = WEEKS.map((w) => w.week);

  const rows = season
    .map((s) => {
      const weekCells = weekNumbers
        .map((n) => {
          const w = s.weeks[n];
          return w ? heatCell(w.zTotal, formatZ(w.zTotal, 2), 1.2) : `<td class="muted">–</td>`;
        })
        .join("");

      return `
        <tr>
          <td class="rank">${s.rank}</td>
          <td class="l sticky1"><b>${esc(s.team)}</b></td>
          ${heatCell(s.zAvg, formatZ(s.zAvg), 1.2, "total")}
          ${weekCells}
          <td>${recordText(s.record)}</td>
          <td>${recordText(s.allPlay)} <span class="muted">(${formatPct(s.allPlay.pct)})</span></td>
          <td>${formatSigned(s.luck)}</td>
        </tr>`;
    })
    .join("");

  const weekHeaders = weekNumbers.map((n) => `<th>T${n}</th>`).join("");
  const weekCount = `${WEEKS.length} ${WEEKS.length === 1 ? "tjedan" : "tjedana"}`;

  return `
    ${controlsBar({ weekSelect: false })}
    <div class="box stand section">
      <h3>Sezona — prosječni Z-score <small>${weekCount}</small></h3>
      <div class="scroll">
        <table>
          <thead>
            <tr>
              <th>#</th><th class="l sticky1">Momčad</th><th>Prosjek</th>
              ${weekHeaders}
              <th>Stvarno</th><th>All-play</th><th>Sreća</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div class="note">
        Prosjek = prosječni tjedni Z-score. Stvarno = omjer pobjeda u matchupima (P-I-N).
        All-play = zbroj svih tjedana. Sreća = zbroj tjednih (stvarno − očekivano);
        pozitivno znači više pobjeda nego što je igra zaslužila.
      </div>
    </div>`;
}

/* =====================================================================
   Prikaz: Objašnjenje
   ===================================================================== */

function viewExplain() {
  return `
    <div class="box">
      <h3>Što je Z-score?</h3>
      <div class="explain">
        <p>
          Z-score pokazuje koliko je momčad u nekom tjednu bila <b>jača ili slabija od prosjeka lige</b>,
          neovisno o tome protiv koga je igrala. Tako se vidi tko je stvarno bio dobar, a tko je
          samo imao lakog (ili teškog) protivnika.
        </p>

        <h4>1. Z-vrijednost po kategoriji</h4>
        <p>
          Za svaku od 9 kategorija izračuna se prosjek svih 16 momčadi i standardna devijacija
          (koliko se momčadi međusobno razlikuju). Zatim:
          <code>z = (vrijednost momčadi − prosjek lige) / standardna devijacija</code>
        </p>
        <p>
          z = 0 znači točno prosjek, +1 je jedna standardna devijacija iznad prosjeka, −1 ispod.
          Kod <b>TO</b> je obrnuto jer je manje bolje.
        </p>

        <h4>2. Postoci (FG% i FT%)</h4>
        <p>
          <b>Ponderirano</b> (zadano): postotak se mjeri utjecajem, tj. koliko je momčad pogodila više
          od očekivanog uz prosječni postotak lige: <code>pogođeno − pokušaji × postotak lige</code>.
          Tako 50% iz 500 šuteva vrijedi više od 50% iz 200 šuteva, kao i u stvarnom matchupu.
          <br>
          <b>Jednostavno</b>: uspoređuje se sam postotak, bez obzira na broj pokušaja.
        </p>

        <h4>3. Ukupni Z-score</h4>
        <p>Prosjek z-vrijednosti svih 9 kategorija. Na temelju njega je poredak.</p>

        <h4>4. All-play</h4>
        <p>
          Rezultat koji bi momčad imala da je taj tjedan igrala matchup protiv <b>svih 15</b> ostalih
          momčadi (po Yahoo pravilima, 9 kategorija). Npr. 12-3 znači da bi pobijedila 12 momčadi.
        </p>

        <h4>5. Sreća</h4>
        <p>
          Stvarni ishod matchupa (pobjeda = 1, neriješeno = 0,5, poraz = 0) minus all-play postotak.
          Momčad koja je pobijedila iako bi izgubila od većine lige ima veliku pozitivnu sreću;
          momčad koja je izgubila iako bi pobijedila skoro sve ima veliku negativnu.
        </p>

        <h4>Boje</h4>
        ${COLOR_LEGEND}

        <h4>Izvor podataka</h4>
        <p>
          Tjedni zbrojevi iz Yahoo matchupa (samo aktivni igrači, bez klupe i IL).
          Standardna devijacija je populacijska (kao STDEV.P u Excelu).
        </p>
      </div>
    </div>`;
}

/* =====================================================================
   Iscrtavanje i događaji
   ===================================================================== */

const VIEW_RENDERERS = { w: viewWeek, s: viewSeason, o: viewExplain };

function render() {
  renderChrome();
  document.getElementById("main").innerHTML = VIEW_RENDERERS[state.view]();
}

document.addEventListener("click", (event) => {
  const el = event.target.closest("[data-view], [data-team], [data-sort], [data-back]");
  if (!el) return;
  const data = el.dataset;

  if (data.view) {
    navigate({ view: data.view, team: null });
  } else if (data.sort) {
    toggleSort(data.sort);
    render();
  } else if (data.back != null) {
    navigate({ team: null });
  } else if (data.team) {
    navigate({ view: "w", team: data.team });
    window.scrollTo(0, 0);
  }
});

document.addEventListener("change", (event) => {
  const { id, value } = event.target;
  if (id === "weekSel") navigate({ week: +value });
  else if (id === "pctSel") {
    state.pctMode = value;
    render();
  } else if (id === "showSel") {
    state.show = value;
    render();
  }
});

window.addEventListener("hashchange", () => {
  readHash();
  render();
});

readHash();
render();
