/* =====================================================================
   Z-score — tjedni podaci obje CROEFA lige

   Prepisano iz Yahoo matchupa ("Matchup Totals" = samo aktivni igrači).
   Kad Yahoo API proradi, ovu datoteku će generirati fetch.py.

   Redoslijed brojeva u svakom retku:
   [FGM, FGA, FTM, FTA, 3PTM, PTS, REB, AST, ST, BLK, TO]
   ===================================================================== */

window.ZDATA = {
  updated: "23.11.2026.",
  leagues: [
    {
      id: "SJB",
      name: "Sjeverno-južni bataljun",
      weeks: [
        {
          week: 4,
          start: "2026-11-09",
          end: "2026-11-15",
          matchups: [
            [
              ["Tragurium Titans", 221, 456, 111, 144, 67, 620, 213, 125, 40, 37, 71],
              ["Naplatne Lučko", 112, 241, 47, 61, 32, 303, 98, 57, 23, 25, 33],
            ],
            [
              ["Stenjevčani", 229, 485, 120, 145, 83, 661, 259, 191, 43, 27, 87],
              ["Zov Čitluka Zapruđe", 143, 314, 90, 112, 46, 422, 140, 99, 28, 16, 56],
            ],
            [
              ["Gajnice Hoops", 178, 400, 71, 87, 66, 493, 145, 104, 38, 14, 46],
              ["Timamu po Travnom", 217, 428, 112, 146, 69, 615, 184, 119, 30, 17, 53],
            ],
            [
              ["Manute Bol", 137, 283, 77, 92, 49, 400, 162, 85, 32, 26, 36],
              ["Strmec Phantoms", 197, 390, 95, 123, 48, 537, 222, 120, 42, 19, 57],
            ],
            [
              ["Gipsovi Ratnici DBK", 287, 542, 170, 198, 62, 806, 243, 181, 31, 18, 85],
              ["Strmec Bullies", 182, 390, 80, 100, 74, 518, 206, 110, 33, 25, 60],
            ],
            [
              ["Promili Strmec", 140, 327, 76, 90, 53, 409, 139, 116, 24, 32, 59],
              ["Epetij Spartium", 209, 479, 80, 105, 58, 556, 220, 145, 34, 31, 79],
            ],
            [
              ["Šugavi Dugavci", 158, 361, 89, 109, 54, 459, 124, 110, 23, 7, 55],
              ["Kutina Bricklayers", 173, 408, 106, 125, 59, 511, 154, 99, 33, 20, 60],
            ],
            [
              ["Knežija Storks", 249, 506, 130, 154, 61, 689, 205, 130, 37, 28, 86],
              ["Ceraff Ambasador - Pruđe", 180, 419, 68, 91, 75, 503, 248, 137, 32, 24, 65],
            ],
      ],
    },
  ],
    },
    {
      id: "PBL",
      name: "Plavo-bijela liga",
      // još nema podataka: dodati tjedne istim oblikom kao gore
      weeks: [],
    },
  ],
};
