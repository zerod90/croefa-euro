# CROEFA Euro kupovi — upute

Aplikacija = `index.html` + `data.js`. Otvori `index.html` u pregledniku (radi i na mobitelu i na kompu).
`data.js` svako jutro generira `fetch.py` iz Yahoo Fantasy API-ja.

## Kako se računa
- Za svaku Euro momčad uzima se **dnevna statistika aktivne postave** iz domaće Yahoo lige
  (igrači na BN / IL / IL+ se ne broje) — isto kao Yahoo matchup u domaćoj ligi.
- Kolo = zbroj dana od–do iz rasporeda (5. kolo i finale traju 2 tjedna).
- 9 kategorija: FG%, FT%, 3PTM, PTS, REB, AST, ST, BLK, TO (manje TO pobjeđuje). Postoci se uspoređuju na 3 decimale.
- Tablica: samo završena kola; poredak po % pobjeda pa razlici kategorija. Top 2 → finale (popuni se automatski).
- Koeficijent: pobjeda LP 2 / EL 1,5 / KL 1 (neriješeno pola) + bonus 3 / 2 / 1.

## Jednokratno postavljanje Yahoo pristupa
1. Na https://developer.yahoo.com/apps/create/ napravi aplikaciju:
   - Application Name: npr. `croefa-euro`
   - Application Type: **Confidential Client**
   - Redirect URI(s): `oob` (ako ga ne prihvati, upiši `https://localhost:8080/`)
   - API Permissions: **Fantasy Sports → Read**
2. Client ID i Client Secret upiši u `config.json`. Ako si koristio `https://localhost:8080/`, upiši i to pod `redirect_uri`.
3. U ovom folderu:
   ```
   python fetch.py auth
   ```
   Otvori ispisani link, prijavi se Yahoo računom koji je član **obje** lige, odobri.
   Yahoo prikaže kod (ili preusmjeri na localhost — onda kopiraj cijeli URL iz adresne trake):
   ```
   python fetch.py auth KOD_ILI_URL
   ```
4. Provjeri lige i mapiranje imena momčadi:
   ```
   python fetch.py leagues
   ```
   Ako neko ime iz rasporeda ne pronađe, dodaj ga u `config.json`:
   `"aliases": {"Ime iz rasporeda": "Ime na Yahoo"}`
5. Prvi puni dohvat (od 02.11. do jučer, par minuta):
   ```
   python fetch.py update
   ```

## Svako jutro
`run_daily.ps1` pokreće `fetch.py update` (dohvaća nove dane + ponovno zadnja 3 dana zbog Yahoo ispravaka).
Zakaži ga u Task Scheduleru npr. u 08:00. Log ide u `update.log`.

## Datoteke
- `token.json` — tvoj Yahoo token, **ne dijeli ga** (kao ni `config.json` sa secretom).
- `cache/` — sirovi dnevni podaci; slobodno obriši pa `update` sve ponovno povuče.
- `python fetch.py demo` — izmišljeni podaci za testiranje izgleda.
