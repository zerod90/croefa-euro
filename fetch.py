"""
CROEFA Euro natjecanja - dohvat statistike s Yahoo Fantasy API-ja.

Upotreba:
    python fetch.py auth            -> ispiše link za Yahoo prijavu
    python fetch.py auth KOD        -> spremi token (KOD koji Yahoo prikaže nakon prijave)
    python fetch.py leagues         -> ispiše tvoje Yahoo lige i momčadi (provjera mapiranja)
    python fetch.py update          -> dohvati sve dane do jučer (ET) i izgradi data.js
    python fetch.py demo            -> izgradi data.js s izmišljenim (demo) podacima

Sve datoteke su u istom folderu kao skripta:
    config.json   - client_id / client_secret Yahoo aplikacije, ključevi liga, aliasi imena
    token.json    - OAuth token (ne dijeliti!)
    cache/        - sirovi dnevni podaci (jedan JSON po danu)
    data.js       - podaci koje čita index.html
"""

import base64
import datetime as dt
import difflib
import glob
import json
import os
import random
import re
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

import openpyxl

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
PODLOGE = os.path.join(ROOT, "Podloge")
# na GitHubu (i lokalno) raspored se čita iz app/raspored ako postoji
SCHEDULE_DIR = os.path.join(HERE, "raspored") if os.path.isdir(os.path.join(HERE, "raspored")) else PODLOGE
CONFIG = os.path.join(HERE, "config.json")
TOKEN = os.path.join(HERE, "token.json")
CACHE = os.path.join(HERE, "cache")
OUT = os.path.join(HERE, "data.js")

API = "https://fantasysports.yahooapis.com/fantasy/v2/"
AUTH_URL = "https://api.login.yahoo.com/oauth2/request_auth"
TOKEN_URL = "https://api.login.yahoo.com/oauth2/get_token"

COMPS = [
    ("LP", "Liga prvaka", "Raspored Lige prvaka.xlsx", 2.0, 3),
    ("EL", "Europa liga", "Raspored Europa lige.xlsx", 1.5, 2),
    ("KL", "Konferencijska liga", "Raspored Konferencijske lige.xlsx", 1.0, 1),
]

# redoslijed brojčanih statistika u data.js
STAT_KEYS = ["FGM", "FGA", "FTM", "FTA", "3PTM", "PTS", "REB", "AST", "ST", "BLK", "TO", "GP"]
# Yahoo stat_id -> naš ključ (9004003 = FGM/A, 9007006 = FTM/A)
SIMPLE_IDS = {
    "10": "3PTM",
    "12": "PTS",
    "15": "REB",
    "16": "AST",
    "17": "ST",
    "18": "BLK",
    "19": "TO",
    "3": "FGA",
    "4": "FGM",
    "6": "FTA",
    "7": "FTM",
    "0": "GP",
}
INACTIVE_SLOTS = {"BN", "IL", "IL+", "NA"}


# ----------------------------------------------------------------------------- util
def norm(s):
    s = unicodedata.normalize("NFKD", s.replace("đ", "d").replace("Đ", "D"))
    s = "".join(c for c in s if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]", "", s.lower())


def load_json(path, default=None):
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    return default


def save_json(path, obj):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=1)


def et_yesterday():
    # NBA datumi su po US Eastern vremenu; tijekom Euro sezone (stu-sij) to je UTC-5
    return (dt.datetime.utcnow() - dt.timedelta(hours=5)).date() - dt.timedelta(days=1)


def daterange(a, b):
    d = a
    while d <= b:
        yield d
        d += dt.timedelta(days=1)


# ----------------------------------------------------------------------------- raspored
def parse_schedule():
    comps = []
    rx = re.compile(r"(\d{1,2})\.(\d{1,2})\.(\d{4})?\.?\s*-\s*(\d{1,2})\.(\d{1,2})\.(\d{4})")
    for cid, name, fname, win_pts, bonus in COMPS:
        ws = openpyxl.load_workbook(os.path.join(SCHEDULE_DIR, fname), data_only=True).worksheets[0]
        teams, rounds = [], []
        for row in ws.iter_rows(values_only=True):
            a = str(row[0]).strip() if row[0] else ""
            c = str(row[2]).strip() if len(row) > 2 and row[2] else ""
            if not a:
                continue
            m = rx.search(a)
            if m and ("kolo" in a.lower() or "finale" in a.lower()):
                d1, m1, y1, d2, m2, y2 = m.groups()
                y2 = int(y2)
                y1 = int(y1) if y1 else (y2 - 1 if int(m1) > int(m2) else y2)
                rounds.append(
                    {
                        "n": len(rounds) + 1,
                        "label": "Finale" if "finale" in a.lower() else f"{len(rounds) + 1}. kolo",
                        "final": "finale" in a.lower(),
                        "start": dt.date(y1, int(m1), int(d1)).isoformat(),
                        "end": dt.date(y2, int(m2), int(d2)).isoformat(),
                        "games": [],
                    }
                )
            elif c and rounds:
                rounds[-1]["games"].append([a, c])
            elif not rounds:
                teams.append(a)
        comps.append(
            {"id": cid, "name": name, "winPts": win_pts, "bonus": bonus, "teams": teams, "rounds": rounds}
        )
    return comps


def euro_teams(comps):
    return [t for c in comps for t in c["teams"]]


def season_range(comps):
    starts = [r["start"] for c in comps for r in c["rounds"]]
    ends = [r["end"] for c in comps for r in c["rounds"]]
    return dt.date.fromisoformat(min(starts)), dt.date.fromisoformat(max(ends))


# ----------------------------------------------------------------------------- Yahoo OAuth
def cfg():
    c = load_json(CONFIG) or {}
    # GitHub Actions: ključevi dolaze iz skrivenih varijabli (secrets)
    if os.environ.get("YAHOO_CLIENT_ID"):
        c.update(client_id=os.environ["YAHOO_CLIENT_ID"], client_secret=os.environ["YAHOO_CLIENT_SECRET"])
    if not c or not c.get("client_id") or c["client_id"].startswith("UPISI"):
        sys.exit("U app/config.json upiši client_id i client_secret Yahoo aplikacije (vidi UPUTE.md).")
    return c


def redirect_uri():
    return (load_json(CONFIG, {}) or {}).get("redirect_uri") or "oob"


def token_request(data):
    c = cfg()
    basic = base64.b64encode(f"{c['client_id']}:{c['client_secret']}".encode()).decode()
    req = urllib.request.Request(
        TOKEN_URL,
        data=urllib.parse.urlencode(data).encode(),
        headers={"Authorization": "Basic " + basic, "Content-Type": "application/x-www-form-urlencoded"},
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        tok = json.load(r)
    tok["obtained"] = time.time()
    old = load_json(TOKEN, {})
    if "refresh_token" not in tok and "refresh_token" in old:
        tok["refresh_token"] = old["refresh_token"]
    save_json(TOKEN, tok)
    return tok


def cmd_auth(code=None):
    c = cfg()
    if not code:
        q = urllib.parse.urlencode(
            {
                "client_id": c["client_id"],
                "redirect_uri": redirect_uri(),
                "response_type": "code",
                "language": "en-us",
            }
        )
        print(
            "Otvori ovaj link, prijavi se i odobri pristup, pa pokreni:\n"
            "  python fetch.py auth <KOD>\n\n" + AUTH_URL + "?" + q
        )
        return
    code = code.strip()
    if "code=" in code:  # zalijepljen cijeli URL nakon preusmjeravanja
        code = urllib.parse.parse_qs(urllib.parse.urlparse(code).query)["code"][0]
    token_request({"grant_type": "authorization_code", "redirect_uri": redirect_uri(), "code": code})
    print("Token spremljen u token.json.")


def access_token():
    tok = load_json(TOKEN)
    if not tok and os.environ.get("YAHOO_REFRESH_TOKEN"):
        tok = {"refresh_token": os.environ["YAHOO_REFRESH_TOKEN"], "obtained": 0, "expires_in": 0}
        save_json(TOKEN, tok)
    if not tok:
        sys.exit("Nema tokena. Pokreni: python fetch.py auth")
    if time.time() > tok["obtained"] + tok.get("expires_in", 3600) - 120:
        tok = token_request(
            {
                "grant_type": "refresh_token",
                "redirect_uri": redirect_uri(),
                "refresh_token": tok["refresh_token"],
            }
        )
    return tok["access_token"]


def strip_ns(el):
    for e in el.iter():
        if "}" in e.tag:
            e.tag = e.tag.split("}", 1)[1]
    return el


def api(path, retries=3):
    url = API + path
    for i in range(retries):
        req = urllib.request.Request(url, headers={"Authorization": "Bearer " + access_token()})
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return strip_ns(ET.fromstring(r.read()))
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", "replace")[:300]
            if e.code in (401,) and i < retries - 1:
                tok = load_json(TOKEN)
                tok["obtained"] = 0
                save_json(TOKEN, tok)
                continue
            if e.code in (429, 500, 502, 503, 999) and i < retries - 1:
                time.sleep(10 * (i + 1))
                continue
            raise RuntimeError(f"Yahoo API {e.code} za {path}: {body}")
        except urllib.error.URLError:
            if i < retries - 1:
                time.sleep(5)
                continue
            raise


def txt(el, path, default=""):
    x = el.find(path)
    return x.text if x is not None and x.text is not None else default


# ----------------------------------------------------------------------------- lige i momčadi
def discover(save=True):
    """Pronađe NBA lige prijavljenog korisnika i sve momčadi u njima."""
    c = cfg()
    keys = c.get("league_keys") or []
    if not keys:
        root = api("users;use_login=1/games;game_keys=nba/leagues")
        keys = [txt(l, "league_key") for l in root.iter("league")]
    leagues, teams = [], {}
    for lk in keys:
        root = api(f"league/{lk}/teams")
        lname = txt(root, ".//league/name")
        leagues.append({"key": lk, "name": lname})
        for t in root.iter("team"):
            teams[txt(t, "team_key")] = {
                "name": txt(t, "name"),
                "league": lname,
                "league_key": lk,
                "logo": txt(t, "team_logos/team_logo/url"),
                "manager": txt(t, "managers/manager/nickname"),
            }
    return leagues, teams


def map_teams(sched_names, yteams, aliases):
    """schedule ime -> yahoo team_key"""
    by_norm = {norm(v["name"]): k for k, v in yteams.items()}
    out, problems = {}, []
    for n in sched_names:
        target = aliases.get(n, n)
        k = by_norm.get(norm(target))
        if not k:
            close = difflib.get_close_matches(norm(target), list(by_norm), n=1, cutoff=0.6)
            if close:
                k = by_norm[close[0]]
                problems.append(f"  ~ '{n}' -> '{yteams[k]['name']}' (približno)")
        if k:
            out[n] = k
        else:
            problems.append(f"  ! '{n}' nije pronađen među Yahoo momčadima")
    return out, problems


def cmd_leagues():
    comps = parse_schedule()
    leagues, yteams = discover()
    for l in leagues:
        print(f"\n{l['name']}  ({l['key']})")
        for k, t in yteams.items():
            if t["league_key"] == l["key"]:
                print(f"   {k:22s} {t['name']}  [{t['manager']}]")
    m, problems = map_teams(euro_teams(comps), yteams, cfg().get("aliases", {}))
    print("\nMapiranje Euro momčadi:")
    for n, k in m.items():
        print(f"   {n:28s} -> {yteams[k]['name']}")
    if problems:
        print("\nUpozorenja (dodaj u config.json -> aliases ako treba):\n" + "\n".join(problems))


# ----------------------------------------------------------------------------- dnevni dohvat
def parse_stats(stats_el):
    s = dict.fromkeys(STAT_KEYS, 0)
    if stats_el is None:
        return s
    for st in stats_el.iter("stat"):
        sid, val = txt(st, "stat_id"), txt(st, "value")
        if sid in ("9004003", "9007006") and "/" in val:
            a, b = val.split("/")
            if sid == "9004003":
                s["FGM"], s["FGA"] = int(a or 0), int(b or 0)
            else:
                s["FTM"], s["FTA"] = int(a or 0), int(b or 0)
        elif sid in SIMPLE_IDS:
            try:
                s[SIMPLE_IDS[sid]] = int(float(val))
            except ValueError:
                pass
    return s


def fetch_day(day, team_keys):
    """Za jedan dan: postava + statistika igrača za svaku momčad, te ukupno za momčad."""
    d = day.isoformat()
    result = {"date": d, "teams": {}, "players": {}}
    for tk in team_keys:
        root = api(f"team/{tk}/roster;date={d}/players/stats;type=date;date={d}")
        lineup, tot = [], dict.fromkeys(STAT_KEYS, 0)
        for p in root.iter("player"):
            pid = txt(p, "player_id")
            slot = txt(p, "selected_position/position")
            st = parse_stats(p.find("player_stats/stats"))
            if not st["GP"]:
                st["GP"] = (
                    1 if any(st[k] for k in ("FGA", "FTA", "PTS", "REB", "AST", "ST", "BLK", "TO")) else 0
                )
            result["players"][pid] = [
                txt(p, "name/full"),
                txt(p, "editorial_team_abbr").upper(),
                txt(p, "display_position"),
                txt(p, "headshot/url"),
            ]
            lineup.append([pid, slot] + [st[k] for k in STAT_KEYS])
            if slot not in INACTIVE_SLOTS:
                for k in STAT_KEYS:
                    tot[k] += st[k]
        result["teams"][tk] = {"lineup": lineup, "sum": [tot[k] for k in STAT_KEYS]}
        time.sleep(0.3)
    # službeni Yahoo zbroj momčadi za taj dan (ako je dostupan)
    for tk in team_keys:
        try:
            root = api(f"team/{tk}/stats;type=date;date={d}")
            st = parse_stats(root.find(".//team_stats/stats"))
            st["GP"] = result["teams"][tk]["sum"][STAT_KEYS.index("GP")]
            result["teams"][tk]["official"] = [st[k] for k in STAT_KEYS]
        except Exception as e:  # noqa
            print(f"   (nema službenog zbroja za {tk} {d}: {e})")
        time.sleep(0.2)
    return result


def cmd_update(refetch_days=3):
    os.makedirs(CACHE, exist_ok=True)
    comps = parse_schedule()
    c = cfg()
    leagues, yteams = discover()
    mapping, problems = map_teams(euro_teams(comps), yteams, c.get("aliases", {}))
    for p in problems:
        print(p)
    start, end = season_range(comps)
    last = min(et_yesterday(), end)
    keys = sorted(set(mapping.values()))
    for day in daterange(start, last):
        path = os.path.join(CACHE, day.isoformat() + ".json")
        if os.path.exists(path) and (last - day).days >= refetch_days:
            continue
        print("Dohvaćam", day)
        save_json(path, fetch_day(day, keys))
    build(comps, mapping, yteams, demo=False)


# ----------------------------------------------------------------------------- izgradnja data.js
def build(comps, mapping, yteams, demo):
    days, lineups, players = {}, {}, {}
    last = None
    for path in sorted(
        glob.glob(os.path.join(CACHE if not demo else os.path.join(HERE, "cache_demo"), "*.json"))
    ):
        day = load_json(path)
        d = day["date"]
        last = d
        players.update(day["players"])
        for name, tk in mapping.items():
            t = day["teams"].get(tk)
            if not t:
                continue
            days.setdefault(name, {})[d] = t.get("official") or t["sum"]
            lineups.setdefault(name, {})[d] = t["lineup"]
    teams = {}
    for name, tk in mapping.items():
        y = yteams.get(tk, {})
        teams[name] = {
            "league": y.get("league", ""),
            "logo": y.get("logo", ""),
            "manager": y.get("manager", ""),
        }
    data = {
        "generated": dt.datetime.now().strftime("%d.%m.%Y. %H:%M"),
        "demo": demo,
        "lastDate": last,
        "statKeys": STAT_KEYS,
        "comps": comps,
        "teams": teams,
        "days": days,
        "lineups": lineups,
        "players": players,
    }
    with open(OUT, "w", encoding="utf-8") as f:
        f.write("window.DATA = ")
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
        f.write(";\n")
    print(f"data.js izgrađen ({os.path.getsize(OUT) // 1024} KB), zadnji dan: {last}")


# ----------------------------------------------------------------------------- demo
def roster_players():
    """Iz Excel rostera uzme imena igrača po momčadi (za realističan demo)."""
    out = {}
    for f in glob.glob(os.path.join(PODLOGE, "Rosteri", "*.xlsx")):
        for ws in openpyxl.load_workbook(f, data_only=True).worksheets:
            names = []
            for row in ws.iter_rows(min_row=4, max_col=1, values_only=True):
                v = row[0]
                if not v or str(v).startswith("Roster"):
                    if v:
                        break
                    continue
                m = re.match(r"(?:\d+\w\w draft pick - )?(.+?)\s*\(?([A-Z]{2,4})\s*-\s*([A-Z,]+)\)?$", str(v))
                if m:
                    names.append((m.group(1).strip(), m.group(2), m.group(3)))
                else:
                    nm = re.sub(r"^\d+\w\w draft pick - ", "", str(v)).strip()
                    names.append((nm, "", "F"))
            out[norm(ws.title)] = names[:15]
    return out


def cmd_demo():
    random.seed(7)
    comps = parse_schedule()
    names = euro_teams(comps)
    rp = roster_players()
    demo_dir = os.path.join(HERE, "cache_demo")
    os.makedirs(demo_dir, exist_ok=True)
    for f in glob.glob(os.path.join(demo_dir, "*.json")):
        os.remove(f)
    mapping = {n: "demo." + norm(n) for n in names}
    yteams = {}
    pid_seq = 1000
    rosters = {}
    for i, n in enumerate(names):
        key = difflib.get_close_matches(norm(n), list(rp), n=1, cutoff=0.5)
        plist = rp[key[0]] if key else [(f"Igrač {j + 1}", "NBA", "F") for j in range(15)]
        r = []
        for pn, team, pos in plist:
            pid_seq += 1
            skill = random.uniform(0.6, 1.4)
            r.append((str(pid_seq), pn, team, pos, skill))
        rosters[n] = r
        yteams[mapping[n]] = {
            "name": n,
            "league": "CROEFA Sjeverno-južni bataljun" if i % 2 else "Croefa Plavo-bijela liga",
            "logo": "",
            "manager": "",
        }
    start, _ = season_range(comps)
    last = dt.date(2026, 11, 20)
    for day in daterange(start, last):
        res = {"date": day.isoformat(), "teams": {}, "players": {}}
        for n, r in rosters.items():
            lineup, tot = [], [0] * len(STAT_KEYS)
            for idx, (pid, pn, team, pos, skill) in enumerate(r):
                res["players"][pid] = [pn, team, pos, ""]
                slot = (
                    ["PG", "SG", "G", "SF", "PF", "F", "C", "Util", "Util", "Util"][idx] if idx < 10 else "BN"
                )
                plays = random.random() < 0.5
                if plays:
                    fga = max(1, int(random.gauss(14, 4) * skill))
                    fgm = int(fga * random.uniform(0.35, 0.6))
                    fta = int(random.uniform(0, 7) * skill)
                    ftm = int(fta * random.uniform(0.6, 0.95))
                    tpm = int(random.uniform(0, 4) * skill)
                    pts = fgm * 2 + tpm + ftm
                    st = [
                        fgm,
                        fga,
                        ftm,
                        fta,
                        tpm,
                        pts,
                        int(random.uniform(2, 11) * skill),
                        int(random.uniform(0, 8) * skill),
                        random.randint(0, 3),
                        random.randint(0, 2),
                        random.randint(0, 4),
                        1,
                    ]
                else:
                    st = [0] * len(STAT_KEYS)
                lineup.append([pid, slot] + st)
                if slot != "BN":
                    tot = [a + b for a, b in zip(tot, st)]
            res["teams"][mapping[n]] = {"lineup": lineup, "sum": tot}
        save_json(os.path.join(demo_dir, day.isoformat() + ".json"), res)
    build(comps, mapping, yteams, demo=True)


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    cmd = sys.argv[1] if len(sys.argv) > 1 else "update"
    if cmd == "auth":
        cmd_auth(sys.argv[2] if len(sys.argv) > 2 else None)
    elif cmd == "leagues":
        cmd_leagues()
    elif cmd == "demo":
        cmd_demo()
    elif cmd == "update":
        cmd_update()
    else:
        print(__doc__)
