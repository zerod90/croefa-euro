/* =====================================================================
   Euro kupovi — automatski recap matchupa (u stilu ESPN-a)

   Spaja dvije vrste priče:
   - LIGA: rezultat, niz pobjeda, tablica, utrka za finale, koeficijent,
     dvoboj domaćih liga, prethodni međusobni susret, preokret,
     bodovi ostavljeni na klupi;
   - IGRAČI: igrač matchupa, najbolja pojedinačna večer, triple-double,
     najbolji strijelac poražene momčadi.

   Koristi funkcije i podatke iz app.js (scoreMatchup, standings,
   collectPlayers, DATA, STAT…). Učitava se prije app.js, a funkcije se
   pozivaju tek kad se stranica crta, kad je sve već učitano.

   Rečenice su složene tako da imena momčadi ostaju u osnovnom obliku
   ("... protiv ekipe Knežija Storks"), jer se imena ne mogu sklanjati.
   ===================================================================== */

"use strict";

/* ---------- Pomoćne funkcije ---------- */

/** "6:3" */
function scoreText(m) {
  return m.ties ? `${m.winsA}:${m.winsB}:${m.ties}` : `${m.winsA}:${m.winsB}`;
}

/** Popis s "i" na kraju: ["A", "B", "C"] -> "A, B i C" */
function joinList(items) {
  if (items.length <= 1) return items.join("");
  return items.slice(0, -1).join(", ") + " i " + items[items.length - 1];
}

/** Ime momčadi podebljano. */
function teamName(name) {
  return `<b>${esc(name)}</b>`;
}

/** Ukupna "fantasy vrijednost" igrača za odabir igrača matchupa. */
function playerValue(s) {
  return (
    s[STAT.PTS] + 1.2 * s[STAT.REB] + 1.5 * s[STAT.AST] + 3 * s[STAT.ST] + 3 * s[STAT.BLK] +
    s[STAT["3PTM"]] - s[STAT.TO]
  );
}

/** "24 PTS · 11 REB · 10 AST" (samo značajni brojevi; kratice kao na Yahoou). */
function statLine(s) {
  const parts = [`${s[STAT.PTS]} PTS`];
  if (s[STAT.REB] >= 5) parts.push(`${s[STAT.REB]} REB`);
  if (s[STAT.AST] >= 4) parts.push(`${s[STAT.AST]} AST`);
  if (s[STAT.ST] >= 3) parts.push(`${s[STAT.ST]} ST`);
  if (s[STAT.BLK] >= 3) parts.push(`${s[STAT.BLK]} BLK`);
  if (s[STAT["3PTM"]] >= 4) parts.push(`${s[STAT["3PTM"]]} 3PTM`);
  return parts.join(" · ");
}

/** Hrvatska množina: 1 utakmica, 2 utakmice, 5 utakmica. */
function plural(n, one, few, many) {
  const lastTwo = n % 100;
  const last = n % 10;
  if (last === 1 && lastTwo !== 11) return one;
  if (last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14)) return few;
  return many;
}

/** Koliko kategorija (PTS, REB, AST, ST, BLK) ima 10 ili više: 2 = double-double, 3 = triple-double. */
function doubleDigits(s) {
  return [STAT.PTS, STAT.REB, STAT.AST, STAT.ST, STAT.BLK].filter((i) => s[i] >= 10).length;
}

function playerName(playerId) {
  const info = DATA.players[playerId] || ["Nepoznat igrač"];
  return esc(info[0]);
}

/* ---------- Liga: niz, prethodni susret, tablica ---------- */

/** Ishod za momčad u jednom kolu: "W", "L", "T" ili null (nije igrala / nije gotovo). */
function teamOutcome(round, team) {
  if (roundStatus(round) !== "done") return null;
  const game = round.games.find((g) => g.includes(team));
  if (!game || game[0] === "TBD") return null;

  const m = scoreMatchup(game[0], game[1], round.start, round.end);
  const mine = game[0] === team ? m.winsA : m.winsB;
  const theirs = game[0] === team ? m.winsB : m.winsA;
  if (mine > theirs) return "W";
  if (mine < theirs) return "L";
  return "T";
}

/** Niz istih ishoda zaključno s ovim kolom, npr. 3 pobjede zaredom. */
function streakUpTo(comp, team, roundNumber) {
  const rounds = roundsWithFinal(comp).filter((r) => r.n <= roundNumber);
  let streak = 0;
  let kind = null;

  for (let i = rounds.length - 1; i >= 0; i--) {
    const outcome = teamOutcome(rounds[i], team);
    if (!outcome) continue;
    if (kind === null) kind = outcome;
    if (outcome !== kind) break;
    streak++;
  }
  return { kind, streak };
}

/** Drugi susret istih momčadi u natjecanju (dvokružno), ako je već odigran. */
function otherMeeting(comp, round, teamA, teamB) {
  for (const r of comp.rounds) {
    if (r.n === round.n || r.final || roundStatus(r) !== "done") continue;
    const game = r.games.find((g) => g.includes(teamA) && g.includes(teamB));
    if (game) {
      return { round: r, game, result: scoreMatchup(game[0], game[1], r.start, r.end) };
    }
  }
  return null;
}

/** Tablica nakon određenog kola (uz projekciju za kolo u tijeku). */
function tableAfter(comp, roundNumber) {
  return standings(comp, { uptoRound: roundNumber, includeLive: true });
}

/* ---------- Tijek matchupa po danima ---------- */

/** Je li pobjednik do zadnjeg dana gubio — preokret u zadnjoj večeri? */
function lastNightComeback(round, teamA, teamB, final) {
  const days = datesBetween(round.start, roundLastDay(round));
  if (days.length < 2 || final.winsA === final.winsB) return false;

  const beforeLast = scoreMatchup(teamA, teamB, round.start, days[days.length - 2]);
  const finalLeaderA = final.winsA > final.winsB;
  const leaderBeforeA = beforeLast.winsA > beforeLast.winsB;
  const leaderBeforeB = beforeLast.winsB > beforeLast.winsA;
  return finalLeaderA ? leaderBeforeB : leaderBeforeA;
}

/* ---------- Kategorije: tko je što osvojio, najtješnja, najveća razlika ---------- */

function categoryStory(m, teamA, teamB) {
  const wonA = [];
  const wonB = [];
  const tied = [];
  let closest = null;
  let biggest = null;

  for (const c of m.categories) {
    if (c.winner === 1) wonA.push(c.cat.key);
    else if (c.winner === 2) wonB.push(c.cat.key);
    else tied.push(c.cat.key);

    if (c.valueA == null || c.valueB == null || c.winner === 0) continue;
    // relativna razlika, da se postoci i brojevi mogu usporediti
    const top = Math.max(Math.abs(c.valueA), Math.abs(c.valueB)) || 1;
    const diff = Math.abs(c.valueA - c.valueB) / top;
    if (!closest || diff < closest.diff) closest = { ...c, diff };
    if (!biggest || diff > biggest.diff) biggest = { ...c, diff };
  }

  const show = (c) =>
    `${formatCategoryValue(c.cat, c.valueA)} : ${formatCategoryValue(c.cat, c.valueB)}`;

  const parts = [];
  if (wonA.length) parts.push(`${teamName(teamA)} osvaja ${joinList(wonA)}`);
  if (wonB.length) parts.push(`${teamName(teamB)} uzima ${joinList(wonB)}`);
  let text = parts.join(", a ") + ".";
  if (tied.length) text += ` Neriješeno je završilo u ${joinList(tied)}.`;

  if (closest) {
    const extra = closest.cat.pct ? "" : ` — razlika od samo ${Math.abs(closest.valueA - closest.valueB)}`;
    text += ` Najtješnja je bila kategorija <b>${closest.cat.key}</b> (${show(closest)})${extra}.`;
  }
  if (biggest && biggest !== closest && biggest.diff > 0.25) {
    text += ` Najveća razlika bila je u <b>${biggest.cat.key}</b> (${show(biggest)}).`;
  }
  return text;
}

/* ---------- Igrači ---------- */

/** Igrač matchupa (najveća ukupna vrijednost u aktivnoj postavi). */
function bestPlayer(team, from, to) {
  const players = collectPlayers(team, from, to).filter((p) => p.activeDays);
  if (!players.length) return null;
  players.sort((a, b) => playerValue(b.active) - playerValue(a.active));
  return players[0];
}

/** Najbolja pojedinačna večer jednog igrača (samo aktivna postava), iz obje momčadi. */
function bestSingleGame(teams, from, to) {
  let best = null;
  for (const team of teams) {
    const lineups = DATA.lineups[team] || {};
    for (const date of datesBetween(from, to)) {
      for (const [playerId, slot, ...stats] of lineups[date] || []) {
        if (INACTIVE_SLOTS.includes(slot) || !stats[STAT.GP]) continue;
        const value = playerValue(stats);
        if (!best || value > best.value) best = { team, date, playerId, stats, value };
      }
    }
  }
  return best;
}

function playerStory(teamA, teamB, from, to, m) {
  const sentences = [];
  const winnerTeam = m.winsA >= m.winsB ? teamA : teamB;
  const loserTeam = winnerTeam === teamA ? teamB : teamA;

  const mvp = bestPlayer(winnerTeam, from, to);
  if (mvp) {
    const games = mvp.active[STAT.GP];
    sentences.push(
      `Igrač matchupa je ${playerName(mvp.playerId)} (${esc(winnerTeam)}): ${statLine(mvp.active)}` +
        ` u ${games} ${plural(games, "utakmici", "utakmice", "utakmica")}.`,
    );
  }

  const game = bestSingleGame([teamA, teamB], from, to);
  if (game && (!mvp || game.playerId !== mvp.playerId || doubleDigits(game.stats) >= 2)) {
    const dd = doubleDigits(game.stats);
    const tag = dd >= 3 ? " — <b>triple-double!</b>" : dd === 2 ? " (double-double)" : "";
    sentences.push(
      `Najbolju pojedinačnu večer imao je ${playerName(game.playerId)} (${esc(game.team)}, ` +
        `${dayName(game.date)} ${formatDate(game.date)}): ${statLine(game.stats)}${tag}.`,
    );
  }

  const loserBest = bestPlayer(loserTeam, from, to);
  if (loserBest && m.winsA !== m.winsB) {
    sentences.push(
      `Kod ekipe ${teamName(loserTeam)} najviše se istaknuo ${playerName(loserBest.playerId)} ` +
        `(${statLine(loserBest.active)}).`,
    );
  }
  return sentences.join(" ");
}

/** Bodovi ostavljeni na klupi — bi li drugačija postava promijenila rezultat? */
function benchStory(teamA, teamB, from, to, m) {
  if (m.winsA === m.winsB) return "";
  const loserIsA = m.winsA < m.winsB;
  const loser = loserIsA ? teamA : teamB;

  const bench = emptyStats();
  for (const p of collectPlayers(loser, from, to)) addStats(bench, p.bench);
  if (bench[STAT.PTS] < 25) return "";

  // rezultat da su svi s klupe bili u postavi
  const withBench = teamTotals(loser, from, to);
  addStats(withBench, bench);
  const other = teamTotals(loserIsA ? teamB : teamA, from, to);
  let mine = 0;
  let theirs = 0;
  for (const cat of CATEGORIES) {
    const w = categoryWinner(cat, cat.value(withBench), cat.value(other));
    if (w === 1) mine++;
    if (w === 2) theirs++;
  }

  let text = `${teamName(loser)} je na klupi ostavio ${bench[STAT.PTS]} poena.`;
  if (mine > theirs) text += ` Da su i ti igrači bili u postavi, matchup bi završio ${mine}:${theirs} u njegovu korist.`;
  return text;
}

/* ---------- Liga: tablica, finale, koeficijent, domaće lige ---------- */

function leagueStory(comp, round, teamA, teamB, m, live) {
  const sentences = [];
  const tie = m.winsA === m.winsB;
  const winner = m.winsA > m.winsB ? teamA : teamB;
  const loser = winner === teamA ? teamB : teamA;

  // prethodni međusobni susret
  const meeting = otherMeeting(comp, round, teamA, teamB);
  if (meeting && !round.final) {
    const prev = meeting.result;
    const prevWinner = prev.winsA > prev.winsB ? meeting.game[0] : prev.winsB > prev.winsA ? meeting.game[1] : null;
    const when = `${meeting.round.n}. kolu`;
    if (meeting.round.n < round.n && prevWinner && !tie && prevWinner !== winner) {
      sentences.push(`${teamName(winner)} se osvetio za poraz u ${when} (${scoreText(prev)}).`);
    } else if (meeting.round.n < round.n && prevWinner) {
      sentences.push(`Prvi međusobni susret u ${when} također je pripao ekipi ${teamName(prevWinner)} (${scoreText(prev)}).`);
    }
  }

  // tablica i utrka za finale
  if (!round.final) {
    const table = tableAfter(comp, round.n);
    const posOf = (team) => table.findIndex((r) => r.team === team) + 1;
    const row = table.find((r) => r.team === (tie ? teamA : winner));
    const pos = posOf(row.team);
    const record = `${row.w}-${row.l}${row.t ? "-" + row.t : ""}`;
    const prefix = live ? "Ako rezultat ostane ovakav, " : "Nakon ovog kola ";
    const second = table[1];

    if (pos <= 2) {
      sentences.push(`${prefix}${teamName(row.team)} je ${pos}. u tablici (${record}) i u zoni je finala.`);
    } else {
      const behind = second.w + second.t / 2 - (row.w + row.t / 2);
      sentences.push(
        `${prefix}${teamName(row.team)} je ${pos}. (${record}), ` +
          (behind > 0 ? `${behind} ${behind === 1 ? "pobjedu" : "pobjede"} iza mjesta za finale.` : "u izjednačenoj borbi za finale."),
      );
    }
    if (!tie) {
      const lp = posOf(loser);
      if (lp === table.length) sentences.push(`${teamName(loser)} pada na začelje.`);
    }
  }

  // koeficijent i dvoboj domaćih liga
  if (!tie) {
    const lgW = (DATA.teams[winner] || {}).league;
    const lgL = (DATA.teams[loser] || {}).league;
    const pts = String(comp.winPts).replace(".", ",");
    const unit = comp.winPts === 1 ? "bod" : "boda";
    sentences.push(`Pobjeda ${live ? "bi donijela" : "donosi"} ${pts} ${unit} klupskog koeficijenta.`);

    if (lgW && lgL && lgW !== lgL) {
      sentences.push(
        `U dvoboju domaćih liga ${live ? "trenutno vodi" : "slavi"} <b>${esc(lgW)}</b> ` +
          `(${esc(winner)}) protiv predstavnika lige ${esc(lgL)}.`,
      );
    } else if (lgW) {
      sentences.push(`Interni okršaj dviju momčadi iz lige ${esc(lgW)}.`);
    }
  }
  return sentences.join(" ");
}

/* ---------- Naslov ---------- */

function headline(comp, round, teamA, teamB, m, live) {
  const score = scoreText(m);
  if (m.winsA === m.winsB) {
    return live
      ? `Izjednačeno: ${teamName(teamA)} i ${teamName(teamB)} ${score}`
      : `Remi: ${teamName(teamA)} i ${teamName(teamB)} dijele bodove (${score})`;
  }
  const winner = m.winsA > m.winsB ? teamA : teamB;
  const loser = winner === teamA ? teamB : teamA;
  const margin = Math.abs(m.winsA - m.winsB);
  const big = Math.max(m.winsA, m.winsB);
  const small = Math.min(m.winsA, m.winsB);
  const result = `${big}:${small}`;

  if (live) return `${teamName(winner)} vodi protiv ekipe ${teamName(loser)} ${result}`;

  let verb = "slavi protiv ekipe";
  if (margin >= 7) verb = "deklasira ekipu";
  else if (margin >= 4) verb = "uvjerljivo svladava ekipu";
  else if (margin === 1) verb = "tijesno nadvisuje ekipu";

  let text = `${teamName(winner)} ${verb} ${teamName(loser)} ${result}`;
  if (round.final) text = `🏆 ${teamName(winner)} osvaja ${esc(comp.name)}! ${result} u finalu`;

  const streak = streakUpTo(comp, winner, round.n);
  if (!round.final && streak.kind === "W" && streak.streak >= 3) text += ` za ${streak.streak}. uzastopnu pobjedu`;
  return text;
}

/* ---------- Najava (kolo još nije počelo) ---------- */

function previewRecap(comp, round, teamA, teamB) {
  const table = standings(comp);
  const describe = (team) => {
    const pos = table.findIndex((r) => r.team === team) + 1;
    const r = table[pos - 1];
    return r && r.played ? `${teamName(team)} (${pos}. mjesto, ${r.w}-${r.l}${r.t ? "-" + r.t : ""})` : teamName(team);
  };

  const paragraphs = [`${describe(teamA)} dočekuje ekipu ${describe(teamB)} u ${round.label.toLowerCase()}.`];
  const meeting = otherMeeting(comp, round, teamA, teamB);
  if (meeting) {
    paragraphs.push(`U prvom susretu (${meeting.round.n}. kolo) rezultat je bio ${scoreText(meeting.result)}.`);
  }
  return {
    headline: `Najava: ${teamName(teamA)} — ${teamName(teamB)}`,
    paragraphs,
  };
}

/* ---------- Glavna funkcija ---------- */

/**
 * Recap za jedan matchup. Vraća { headline, paragraphs } (HTML tekst)
 * ili null ako matchup još nema momčadi (finale prije kraja regularnog dijela).
 */
function buildRecap(comp, round, game) {
  const [teamA, teamB] = game;
  if (teamA === "TBD") return null;

  const status = roundStatus(round);
  if (status === "future") return previewRecap(comp, round, teamA, teamB);

  const live = status === "live";
  const from = round.start;
  const to = roundLastDay(round);
  const m = scoreMatchup(teamA, teamB, from, to);

  const paragraphs = [categoryStory(m, teamA, teamB)];
  if (!live && lastNightComeback(round, teamA, teamB, m)) {
    paragraphs[0] = "<b>Preokret u zadnjoj večeri!</b> " + paragraphs[0];
  }
  paragraphs.push(playerStory(teamA, teamB, from, to, m));
  const bench = benchStory(teamA, teamB, from, to, m);
  if (bench) paragraphs.push(bench);
  paragraphs.push(leagueStory(comp, round, teamA, teamB, m, live));

  return {
    headline: headline(comp, round, teamA, teamB, m, live),
    paragraphs: paragraphs.filter(Boolean),
  };
}
