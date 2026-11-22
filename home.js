/* =====================================================================
   Početna stranica portala — pregled top 3 iz zadnjeg tjedna Z-scorea
   ===================================================================== */

"use strict";

function renderZScorePreview() {
  const box = document.getElementById("zPreview");
  const weeks = window.ZDATA ? window.ZDATA.weeks : [];
  if (!box || !weeks.length) return;

  const lastWeek = weeks[weeks.length - 1];
  const top3 = ZScore.computeWeek(lastWeek).teams.slice(0, 3);

  const items = top3
    .map((t) => `<li><b>${ZScore.esc(t.team)}</b> — ${ZScore.formatZ(t.zTotal)}</li>`)
    .join("");

  box.innerHTML = `Zadnji tjedan (${lastWeek.week}.):<ol>${items}</ol>`;
}

renderZScorePreview();
