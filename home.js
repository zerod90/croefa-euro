/* =====================================================================
   Početna stranica portala — pregled top 3 iz zadnjeg tjedna Z-scorea
   za svaku ligu koja ima podatke
   ===================================================================== */

"use strict";

/** Top 3 jedne lige kao HTML, ili poruka da podataka još nema. */
function leaguePreview(league) {
  const title = `<b>${ZScore.esc(league.name)}</b>`;
  if (!league.weeks.length) {
    return `<div>${title}: <span class="small">još nema podataka</span></div>`;
  }

  const lastWeek = league.weeks[league.weeks.length - 1];
  const top3 = ZScore.computeWeek(lastWeek).teams.slice(0, 3);
  const items = top3
    .map((t) => `<li>${ZScore.esc(t.team)} — ${ZScore.formatZ(t.zTotal)}</li>`)
    .join("");

  return `<div>${title} · ${lastWeek.week}. tjedan<ol>${items}</ol></div>`;
}

function renderZScorePreview() {
  const box = document.getElementById("zPreview");
  if (!box || !window.ZDATA) return;
  box.innerHTML = window.ZDATA.leagues.map(leaguePreview).join("");
}

renderZScorePreview();
