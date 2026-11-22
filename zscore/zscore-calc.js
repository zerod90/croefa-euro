/* =====================================================================
   Z-score — izračun (bez prikaza)

   Koristi ga Z-score stranica i početna stranica portala.

   Postupak za jedan tjedan:
   1. za svaku od 9 kategorija izračuna se prosjek i standardna
      devijacija svih momčadi u ligi,
   2. z = (vrijednost momčadi − prosjek) / standardna devijacija
      (za izgubljene lopte obrnuto, jer je manje bolje),
   3. ukupni Z-score = prosjek z-vrijednosti svih 9 kategorija.

   Dodatno: all-play (rezultat da je momčad igrala protiv svih),
   stvarni rezultat matchupa i "sreća" (stvarno − očekivano).
   ===================================================================== */

"use strict";

const ZScore = (() => {
  /* indeksi u retku podataka: [ime, FGM, FGA, FTM, FTA, 3PTM, PTS, REB, AST, ST, BLK, TO] */
  const COL = { FGM: 1, FGA: 2, FTM: 3, FTA: 4, TPM: 5, PTS: 6, REB: 7, AST: 8, ST: 9, BLK: 10, TO: 11 };

  /* 9 kategorija. made/att = postotna kategorija, col = brojčana. */
  const CATEGORIES = [
    { key: "FG%", made: COL.FGM, att: COL.FGA },
    { key: "FT%", made: COL.FTM, att: COL.FTA },
    { key: "3PTM", col: COL.TPM },
    { key: "PTS", col: COL.PTS },
    { key: "REB", col: COL.REB },
    { key: "AST", col: COL.AST },
    { key: "ST", col: COL.ST },
    { key: "BLK", col: COL.BLK },
    { key: "TO", col: COL.TO, lowerWins: true },
  ];

  /* ---------- pomoćne funkcije ---------- */

  function esc(text) {
    const map = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
    return String(text ?? "").replace(/[&<>"']/g, (ch) => map[ch]);
  }

  function mean(values) {
    return values.reduce((a, b) => a + b, 0) / values.length;
  }

  /** Standardna devijacija populacije (kao STDEV.P u Excelu). */
  function stdDev(values) {
    const m = mean(values);
    return Math.sqrt(mean(values.map((v) => (v - m) ** 2)));
  }

  /** 0.639 -> "0,639", -1.272 -> "−1,272" */
  function formatZ(z, decimals = 3) {
    const text = Math.abs(z).toFixed(decimals).replace(".", ",");
    return (z < 0 ? "−" : "") + text;
  }

  function formatPct(value) {
    return value.toFixed(3).replace(/^0/, "");
  }

  /** Stvarna vrijednost kategorije za prikaz i usporedbu. */
  function categoryValue(cat, row) {
    if (cat.made) return row[cat.att] ? row[cat.made] / row[cat.att] : 0;
    return row[cat.col];
  }

  /* ---------- matchup između dvije momčadi (Yahoo pravila) ---------- */

  /** Vraća { wins, losses, ties } iz perspektive prve momčadi. */
  function headToHead(rowA, rowB) {
    const result = { wins: 0, losses: 0, ties: 0 };

    for (const cat of CATEGORIES) {
      let a = categoryValue(cat, rowA);
      let b = categoryValue(cat, rowB);
      if (cat.made) {
        // postoci se uspoređuju na 3 decimale, kao na Yahoou
        a = Math.round(a * 1000);
        b = Math.round(b * 1000);
      }
      if (a === b) result.ties++;
      else if (cat.lowerWins ? a < b : a > b) result.wins++;
      else result.losses++;
    }
    return result;
  }

  /** Ishod matchupa: 1 = pobjeda, 0.5 = neriješeno, 0 = poraz. */
  function outcome(h2h) {
    if (h2h.wins > h2h.losses) return 1;
    if (h2h.wins < h2h.losses) return 0;
    return 0.5;
  }

  /* ---------- glavni izračun za jedan tjedan ---------- */

  /**
   * @param week     tjedan iz ZDATA (matchups: [[redA, redB], ...])
   * @param pctMode  "impact" (postoci ponderirani brojem pokušaja) ili "simple"
   */
  function computeWeek(week, pctMode = "impact") {
    // 1) popis momčadi s protivnikom
    const teams = [];
    for (const [rowA, rowB] of week.matchups) {
      teams.push({ team: rowA[0], row: rowA, opponentRow: rowB });
      teams.push({ team: rowB[0], row: rowB, opponentRow: rowA });
    }

    // 2) z-vrijednosti po kategorijama
    for (const t of teams) {
      t.values = {};
      t.z = {};
      t.catRank = {};
    }

    for (const cat of CATEGORIES) {
      let inputs;

      if (cat.made && pctMode === "impact") {
        // utjecaj na postotak: pogođeno − pokušaji × prosječni postotak lige
        const leaguePct =
          teams.reduce((s, t) => s + t.row[cat.made], 0) / teams.reduce((s, t) => s + t.row[cat.att], 0);
        inputs = teams.map((t) => t.row[cat.made] - t.row[cat.att] * leaguePct);
      } else {
        inputs = teams.map((t) => categoryValue(cat, t.row));
      }

      const m = mean(inputs);
      const sd = stdDev(inputs);

      teams.forEach((t, i) => {
        const z = sd ? (inputs[i] - m) / sd : 0;
        t.values[cat.key] = categoryValue(cat, t.row);
        t.z[cat.key] = cat.lowerWins ? -z : z;
      });

      // poredak u kategoriji (1 = najbolji)
      [...teams]
        .sort((a, b) => b.z[cat.key] - a.z[cat.key])
        .forEach((t, i) => (t.catRank[cat.key] = i + 1));
    }

    // 3) ukupni Z-score, stvarni rezultat, all-play, sreća
    for (const t of teams) {
      t.zTotal = mean(CATEGORIES.map((c) => t.z[c.key]));
      t.zSum = CATEGORIES.reduce((s, c) => s + t.z[c.key], 0);

      t.opponent = t.opponentRow[0];
      t.result = headToHead(t.row, t.opponentRow);

      t.allPlay = { wins: 0, losses: 0, ties: 0, catWins: 0, catLosses: 0, catTies: 0, vs: [] };
      for (const other of teams) {
        if (other === t) continue;
        const h2h = headToHead(t.row, other.row);
        const o = outcome(h2h);
        if (o === 1) t.allPlay.wins++;
        else if (o === 0) t.allPlay.losses++;
        else t.allPlay.ties++;
        t.allPlay.catWins += h2h.wins;
        t.allPlay.catLosses += h2h.losses;
        t.allPlay.catTies += h2h.ties;
        t.allPlay.vs.push({ team: other.team, ...h2h, outcome: o });
      }
      const games = teams.length - 1;
      t.allPlay.pct = (t.allPlay.wins + t.allPlay.ties / 2) / games;

      // sreća: stvarni ishod (1 / 0.5 / 0) minus očekivani (all-play postotak)
      t.luck = outcome(t.result) - t.allPlay.pct;
    }

    // 4) ukupni poredak po Z-scoreu
    teams.sort((a, b) => b.zTotal - a.zTotal);
    teams.forEach((t, i) => (t.rank = i + 1));

    return { week, teams };
  }

  /* ---------- sezona (svi tjedni zajedno) ---------- */

  function computeSeason(weeks, pctMode = "impact") {
    const byTeam = {};

    for (const week of weeks) {
      for (const t of computeWeek(week, pctMode).teams) {
        const s = (byTeam[t.team] = byTeam[t.team] || {
          team: t.team,
          weeks: {},
          record: { wins: 0, losses: 0, ties: 0 },
          allPlay: { wins: 0, losses: 0, ties: 0 },
          luck: 0,
        });

        s.weeks[week.week] = { zTotal: t.zTotal, rank: t.rank };

        const o = outcome(t.result);
        if (o === 1) s.record.wins++;
        else if (o === 0) s.record.losses++;
        else s.record.ties++;

        s.allPlay.wins += t.allPlay.wins;
        s.allPlay.losses += t.allPlay.losses;
        s.allPlay.ties += t.allPlay.ties;
        s.luck += t.luck;
      }
    }

    const teams = Object.values(byTeam);
    for (const s of teams) {
      const zs = Object.values(s.weeks).map((w) => w.zTotal);
      s.zAvg = mean(zs);
      s.weeksPlayed = zs.length;
      const apGames = s.allPlay.wins + s.allPlay.losses + s.allPlay.ties;
      s.allPlay.pct = apGames ? (s.allPlay.wins + s.allPlay.ties / 2) / apGames : 0;
    }

    teams.sort((a, b) => b.zAvg - a.zAvg);
    teams.forEach((s, i) => (s.rank = i + 1));
    return teams;
  }

  return { CATEGORIES, computeWeek, computeSeason, formatZ, formatPct, esc, outcome };
})();
