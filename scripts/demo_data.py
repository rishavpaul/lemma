"""Fill a scratch data folder with made-up practice history, for screenshots and the promo video.

    LEMMA_HOME=/tmp/lemma-demo .venv/bin/python scripts/demo_data.py

Nothing here is real: the sessions, transcripts, grades and articles are invented. Never point it at ~/Lemma.
"""
import json
import os
import random
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
if "LEMMA_HOME" not in os.environ:
    sys.exit("set LEMMA_HOME to a scratch folder first (this script writes fake data)")

from app import config, db  # noqa: E402

DAY = 86400
NOW = time.time()
random.seed(7)

config.ensure_dirs()
config.seed_config()
db.migrate()
db.sync_questions()
db.sync_problems()

LEVELS = [(0, "below_senior"), (2.5, "senior"), (3.0, "staff"), (3.5, "senior_staff_plus")]


def level(score: float) -> str:
    return [name for floor, name in LEVELS if score >= floor][-1]


def signal(score: float) -> str:
    return "strong_no" if score < 2 else "lean_no" if score < 2.75 else "lean_hire" if score < 3.4 else "strong_hire"


def qid(slug: str) -> int:
    return db.one("SELECT id FROM questions WHERE slug=?", (slug,))["id"]


# ---------- the hero session: a rate limiter, answered well ----------

TRANSCRIPTS = {
    "scope": "Before I draw anything, let me pin down what we are protecting. Functional: per-tenant, per-endpoint limits, a fast reject with a "
             "retry-after header, and limits that operators can change without a deploy. Out of scope: billing and quota plans. Non-functional: "
             "added latency under two milliseconds at p99, the limiter must fail open so it never becomes the outage, and counts can be off by "
             "about five percent. Scale: say 200 thousand requests per second at peak across three regions, ten thousand tenants, and the top "
             "tenant sending maybe five percent of traffic. That makes hot keys the hard part, not the arithmetic.",
    "hld": "The check sits in the gateway as a library call. Each gateway keeps a local token bucket per tenant-endpoint and syncs with a regional "
           "Redis cluster every hundred milliseconds, sending its consumed count and receiving the global remainder. The key is tenant, endpoint, "
           "window. Config lives in a versioned store and is pushed to gateways, so a limit change takes seconds. The write path is a Lua script "
           "doing increment-and-expire atomically; the read path never leaves the process unless the local bucket is empty.",
    "deep_dives": "The interesting problem is the hot tenant. A single Redis shard owns a key, so a tenant at ten thousand requests per second "
                  "melts it. I would split that key into N sub-counters, each gateway picks one by hash, and the limit is divided across them, "
                  "re-balanced on the sync interval. The tradeoff is accuracy: with N equal to eight we can overshoot by one sync window of "
                  "traffic, which I accept given the five percent budget. Token bucket over sliding window log because the memory is constant.",
    "reliability_ops": "If Redis is unreachable the gateway falls back to its local bucket with the last known share, divided by the number of "
                       "gateways, and raises an alert. We fail open after a staleness cutoff of thirty seconds. I would track rejection rate per "
                       "tenant, sync lag and overshoot against the true count from a sampled audit stream, and canary limit changes on one region first.",
    "tradeoffs_evolution": "Central counter gives exact limits but adds a network hop on every request. Local approximation gives latency for "
                           "bounded error. I chose approximation because rejection is cheap to be wrong about and the outage is not. Later I would "
                           "add cost-based limits, where expensive endpoints burn more tokens, and a global fairness layer for noisy neighbours.",
}


def section_grade(score: float, title: str) -> dict:
    return {
        "score": score, "level_signal": level(score),
        "summary": f"A clear, well-organised answer for {title.lower()}. You tied the numbers to decisions and named the real crux early. "
                   "What kept this from the top mark was a thin discussion of the alternative you rejected.",
        "gap_summary": "The main gap is the rejected alternative. You chose local approximation and said why, but a staff answer would also put a "
                       "number on the overshoot and say what traffic pattern would make you switch to a central counter.",
        "spoken_feedback": "",
        "concepts_writeup": "**Sliding window counter.** Keep two fixed windows and weight the previous one by how much of the current window has "
                            "elapsed. It approximates a true sliding window with two counters per key, so memory stays constant.\n\nAt a limit of 100 "
                            "per minute, 30 seconds in, with 80 requests in the previous window and 40 in this one, the estimate is "
                            "80 x 0.5 + 40 = 80. Cheap, and usually within a few percent.",
        "gaps": [
            {"tag": "depth.no_alternatives", "severity": "medium", "description": "Rejected design not compared with numbers."},
            {"tag": "estimates.no_peak", "severity": "low", "description": "Peak stated, burst factor not."},
        ],
        "concepts_to_study": [
            {"concept": "Sliding window counter", "why": "Cheaper than a log and more accurate than fixed windows.", "resource": "Cloudflare engineering blog on rate limiting"},
            {"concept": "Hot key splitting", "why": "The single biggest scaling risk for a counter store.", "resource": "Redis Cluster specification"},
        ],
        "evidence": [{"quote": "That makes hot keys the hard part, not the arithmetic.", "observation": "Named the crux in the first section."}],
        "fact_checks": [{"claim": "A Lua script runs atomically in Redis.", "verdict": "correct",
                         "explanation": "Redis executes a script as a single command without interleaving.",
                         "url": "https://redis.io/docs/latest/develop/interact/programmability/eval-intro/"}],
        "sources": [{"title": "Redis scripting", "url": "https://redis.io/docs/latest/develop/interact/programmability/eval-intro/"}],
        "language_review": {
            "register": "staff",
            "assessment": "Precise terminology and decisive phrasing. A couple of hedges crept in around the accuracy budget.",
            "issues": [{"said": "I guess we could maybe split the key", "problem": "Hedged where you had a firm recommendation.",
                        "better": "I would split the key into eight sub-counters."}],
        },
    }


def holistic(score: float) -> dict:
    names = ["problem_framing", "estimation", "data_modeling", "architecture", "technical_depth", "scalability_reliability",
             "operational_maturity", "tradeoff_reasoning", "communication_drive", "time_management"]
    ds = {n: {"score": max(1.0, min(4.0, score + random.choice([-0.5, -0.5, 0, 0, 0.5]))),
              "rationale": "Concrete and tied to the numbers stated up front."} for n in names}
    return {
        "overall_score": score, "overall_level": level(score), "hire_signal_at_staff": signal(score),
        "verdict": "A confident answer that found the hard part quickly and spent its time there. The design holds together end to end, "
                   "and the failure behaviour was considered rather than bolted on. To reach a clear staff signal, compare the rejected "
                   "design with numbers and say when you would change your mind.",
        "dimension_scores": ds,
        "strengths": ["Named hot keys as the crux inside the first two minutes.", "Failure mode chosen deliberately: fail open after a staleness cutoff.",
                      "Estimates drove the design instead of decorating it."],
        "recurring_patterns_vs_previous": ["Alternatives are mentioned but rarely costed."],
        "improvements_vs_previous": ["Opening with requirements and numbers is now automatic."],
        "drill_for_next_session": "Pick any design and spend two minutes arguing for the option you rejected, with numbers.",
        "sources": [],
        "interview_focus": {"shape": "Deep on one hard problem, light elsewhere.",
                            "priorities": [{"topic": "Hot-key handling", "minutes": 12, "explain": "It is the crux and the follow-up every interviewer asks."}],
                            "can_skip": ["Billing and quota plans"]},
    }


def _el(i, kind, x, y, w, h, **extra):
    base = {"id": f"{kind[0]}{i}", "type": kind, "x": x, "y": y, "width": w, "height": h, "angle": 0, "strokeColor": "#6b5a3e",
            "backgroundColor": "transparent", "fillStyle": "solid", "strokeWidth": 2, "strokeStyle": "solid", "roughness": 1, "opacity": 100,
            "groupIds": [], "frameId": None, "roundness": None, "seed": 100 + i, "version": 1, "versionNonce": 1, "isDeleted": False,
            "boundElements": None, "updated": 1, "link": None, "locked": False}
    base.update(extra)
    return base


def diagram() -> dict:
    boxes = [("Client", 40, 120, "#f4ecd8"), ("API gateway\n+ local bucket", 260, 120, "#f6dfae"), ("Regional Redis\n(sub-counters)", 520, 40, "#e7d6b0"),
             ("Config store\n(versioned)", 520, 210, "#e7d6b0"), ("Upstream\nservices", 780, 120, "#f4ecd8")]
    els = []
    for i, (t, x, y, c) in enumerate(boxes):
        els.append(_el(i, "rectangle", x, y, 170, 80, backgroundColor=c, roundness={"type": 3}))
        els.append(_el(i, "text", x + 10, y + 20, 150, 45, strokeColor="#3b3226", strokeWidth=1, text=t, fontSize=18, fontFamily=1,
                       textAlign="center", verticalAlign="middle", containerId=None, originalText=t, autoResize=True, lineHeight=1.25))
    for i, (x, y, dx, dy) in enumerate([(210, 160, 50, 0), (430, 140, 90, -50), (430, 180, 90, 70), (690, 160, 90, 0)]):
        els.append(_el(i, "arrow", x, y, abs(dx), abs(dy), roundness={"type": 2}, points=[[0, 0], [dx, dy]], lastCommittedPoint=None,
                       startBinding=None, endBinding=None, startArrowhead=None, endArrowhead="arrow"))
    return {"format": "excalidraw", "elements": els}


def insert_session(slug, days_ago, score, hero=False, status="done", minutes=48):
    started = NOW - days_ago * DAY - 3600 * random.randint(0, 4)
    finished = started + minutes * 60 if status == "done" else None
    sid = db.execute("INSERT INTO sessions(question_id,status,model,started_at,finished_at,show_feedback_live,diagram_json) VALUES(?,?,?,?,?,0,?)",
                     (qid(slug), status, "claude-sonnet-5-5", started, finished, json.dumps(diagram()) if hero or status == "in_progress" else None))
    for i, s in enumerate(config.load_framework()):
        key = s["key"]
        spoken = status == "done" or (status == "in_progress" and i < 2)
        text = (TRANSCRIPTS[key] if slug in ("rate-limiter", "ticketing-flash-sale") else
                "I would start by listing the requirements and putting numbers on them, then walk the read and write paths.") if spoken else None
        sec = db.execute("INSERT INTO sections(session_id,key,ord,duration_sec,budget_sec,transcript_raw,transcript_edited,status,diagram_json) VALUES(?,?,?,?,?,?,?,?,?)",
                         (sid, key, i, s["budget_sec"] * 0.9 if spoken else None, s["budget_sec"], text, text, "graded" if status == "done" else "transcribed" if spoken else "pending",
                          json.dumps(diagram()) if (hero and key in ("hld", "deep_dives")) or (status == "in_progress" and spoken) else None))
        if status == "done":
            ss = max(1.0, min(4.0, score + random.choice([-0.5, 0, 0, 0.5])))
            g = section_grade(ss, s["title"])
            db.execute("INSERT INTO section_grades(section_id,model,status,result_json,duration_s,created_at) VALUES(?,?,?,?,?,?)",
                       (sec, "claude-sonnet-5-5", "done", json.dumps(g), 14.0, finished))
            for gp in g["gaps"]:
                tag = gp["tag"] if hero else random.choice([gp["tag"], "depth.shallow", "data.partition_key_missing", "estimates.not_used"])
                db.execute("INSERT INTO gaps(session_id,section_key,tag,description,severity,source) VALUES(?,?,?,?,?,'section')",
                           (sid, key, tag, gp["description"], gp["severity"]))
        if hero and key == "deep_dives":
            db.execute("INSERT INTO probes(section_id,question,hint,answer,model,created_at,answered_at) VALUES(?,?,?,?,?,?,?)",
                       (sec, "If one tenant sends 30% of all traffic, your sub-counter split still funnels them through one Redis shard per sub-key. What breaks first?",
                        "Think about where the sub-keys land in the keyspace.",
                        "The sub-keys hash to different slots, so the load spreads, but my rebalancing runs on the sync interval, so I would shorten it for that tenant.",
                        "claude-sonnet-5-5", finished, finished))
    if status == "done":
        db.execute("INSERT INTO session_grades(session_id,model,status,result_json,duration_s,created_at) VALUES(?,?,?,?,?,?)",
                   (sid, "claude-sonnet-5-5", "done", json.dumps(holistic(score)), 22.0, finished))
    return sid


HISTORY = [
    ("news-feed", 21, 2.0), ("kv-store", 19, 2.5), ("chat", 16, 2.5), ("typeahead", 14, 2.5), ("job-scheduler", 11, 3.0),
    ("web-crawler", 8, 3.0), ("payments-ledger", 5, 3.0), ("notification-system", 3, 3.5), ("rate-limiter", 1, 3.5),
]
HERO = 0
for slug, ago, sc in HISTORY:
    sid = insert_session(slug, ago, sc, hero=slug == "rate-limiter")
    if slug == "rate-limiter":
        HERO = sid
insert_session("ticketing-flash-sale", 0, 0, status="in_progress")

for slug in ("rate-limiter", "news-feed", "kv-store", "chat"):
    brief = {"summary": "Reference answer for the demo.", "requirements": [], "estimates": [], "design": [], "deep_dives": [], "pitfalls": [], "sources": []}
    db.execute("INSERT INTO research(question_id,status,brief_json,brief_md,model,created_at) VALUES(?,?,?,?,?,?)",
               (qid(slug), "done", json.dumps(brief), "## Answer key\n\nPlaceholder reference brief for the demo.", "claude-sonnet-5-5", NOW - 25 * DAY))

# ---------- articles ----------

ARTICLES = [
    ("Token bucket vs sliding window", "Two ways to count requests, and when each one wins.", ["rate-limiter"],
     "A **token bucket** holds up to *b* tokens and refills at rate *r*. Each request spends one. It allows bursts up to *b* and then settles to *r*.\n\n"
     "A **sliding window** counts requests in the last *w* seconds. A log is exact but costs memory per request; a window counter weights the "
     "previous fixed window to approximate it with two integers.\n\n## Choosing\n\nUse a bucket when bursts are fine and you want constant memory. "
     "Use a window counter when you must say \"no more than N in any minute\" and can tolerate a few percent error."),
    ("Fan-out on write, fan-out on read", "Why feeds are hybrid, and what the celebrity problem really is.", ["news-feed"],
     "Fan-out on write copies each post into every follower's feed at publish time. Reads are one lookup. It breaks when an account has tens of "
     "millions of followers: one post becomes tens of millions of writes.\n\nFan-out on read merges followed accounts at request time. Writes are cheap; reads are slow.\n\n"
     "## The hybrid\n\nPush for ordinary accounts, pull for celebrities, merge on read."),
    ("Consistent hashing and virtual nodes", "How a key finds its home without a central directory.", ["kv-store"],
     "Place nodes on a ring by hash. A key belongs to the first node clockwise. Adding a node moves only the keys between it and its predecessor.\n\n"
     "**Virtual nodes** give each machine many ring positions, which evens out load and lets a bigger machine take more of the ring."),
    ("Idempotency keys", "Making retries safe in a payment API.", ["payments-ledger"],
     "The client sends a unique key with each mutation. The server stores the key with the result and returns the stored result on a replay.\n\n"
     "Store the key in the same transaction as the write, or a crash between the two creates a double charge."),
]
for title, summary, slugs, body in ARTICLES:
    aid = db.execute("INSERT INTO articles(title,summary,body,model,created_at,updated_at) VALUES(?,?,?,?,?,?)",
                     (title, summary, body, "claude-sonnet-5-5", NOW - 6 * DAY, NOW - 6 * DAY))
    for s in slugs:
        db.execute("INSERT INTO article_questions(article_id,question_id) VALUES(?,?)", (aid, qid(s)))

# ---------- usage ----------

for i in range(60):
    kind = random.choice(["grade_section", "grade_section", "grade_session", "research", "probe"])
    db.execute("INSERT INTO llm_calls(created_at,kind,model,ok,duration_s,input_tokens,output_tokens,cost_usd) VALUES(?,?,?,?,?,?,?,?)",
               (NOW - random.random() * 21 * DAY, kind, "claude-sonnet-5-5", 1, random.uniform(8, 40),
                random.randint(3000, 22000), random.randint(500, 3500), round(random.uniform(0.01, 0.12), 4)))

# ---------- coding ----------

BRIEF = {
    "kind": "function", "class_name": "Solution", "method": "groupAnagrams", "inplace_param": -1,
    "statement_md": "Given an array of strings `strs`, group the anagrams together. You may return the groups in any order.\n\n"
                    "Two strings are anagrams when they use the same letters the same number of times.\n\n"
                    "**Example**\n\n`strs = [\"eat\",\"tea\",\"tan\",\"ate\",\"nat\",\"bat\"]` returns `[[\"bat\"],[\"nat\",\"tan\"],[\"ate\",\"eat\",\"tea\"]]`.",
    "constraints": ["1 <= strs.length <= 10^4", "0 <= strs[i].length <= 100", "strs[i] is lowercase English letters"],
    "starter_code": "import java.util.*;\n\nclass Solution {\n    public List<List<String>> groupAnagrams(String[] strs) {\n        // your code here\n        return new ArrayList<>();\n    }\n}\n",
    "levels": [],
}
SOLUTION = ("import java.util.*;\n\nclass Solution {\n    public List<List<String>> groupAnagrams(String[] strs) {\n"
            "        Map<String, List<String>> groups = new HashMap<>();\n        for (String s : strs) {\n"
            "            char[] key = s.toCharArray();\n            Arrays.sort(key);\n"
            "            groups.computeIfAbsent(new String(key), k -> new ArrayList<>()).add(s);\n        }\n"
            "        return new ArrayList<>(groups.values());\n    }\n}\n")


def case(i, name, kind, ms=2):
    return {"id": f"c{i}", "kind": kind, "name": name, "level": 1, "ms": ms, "status": "ok", "stdout": "", "passed": True, "message": ""}


def problem_id(slug):
    return db.one("SELECT id FROM problems WHERE slug=?", (slug,))["id"]


db.execute("INSERT INTO problem_briefs(problem_id,brief_json,model,created_at) VALUES(?,?,?,?)",
           (problem_id("group-anagrams"), json.dumps(BRIEF), "claude-sonnet-5-5", NOW - 2 * DAY))

SPEC = {**BRIEF, "compare": "unordered", "support_code": "", "reference_solution": SOLUTION, "brute_solution": SOLUTION, "examples": [], "edge_cases": [],
        "generator_py": "", "checker_py": "", "perf_size": 10000, "hints": ["Two anagrams share one canonical form.", "Sort the letters, or count them."],
        "approach_md": "Key a hash map by the sorted letters.", "time_complexity": "O(n k log k)", "space_complexity": "O(n k)",
        "pitfalls": ["Empty strings group together."], "follow_ups": ["Make it O(n k)."]}
CASES = [{"id": f"c{i}", "kind": k, "name": n, "level": 1, "input": {"strs": ["eat", "tea", "tan"]}, "expected": [["eat", "tea"], ["tan"]]}
         for i, (k, n) in enumerate([("example", "Example 1"), ("example", "Example 2"), ("edge", "Empty string"), ("edge", "Single element"),
                                     ("random", "Random 500"), ("perf", "Perf 10^4")])]
sid_spec = db.execute("INSERT INTO problem_specs(problem_id,status,spec_json,secrets_json,cases_json,report_json,model,created_at) VALUES(?,?,?,?,?,?,?,?)",
                      (problem_id("group-anagrams"), "validated", json.dumps(SPEC), json.dumps({"hints": SPEC["hints"]}), json.dumps(CASES),
                       json.dumps({"rounds": 1, "kept": 6, "dropped": 0, "unverified": 0, "clean": True, "issues": []}), "claude-sonnet-5-5", NOW - 2 * DAY))

others = [p["slug"] for p in db.rows("SELECT slug FROM problems WHERE slug<>'group-anagrams' ORDER BY ord LIMIT 21")]
for n, slug in enumerate(others):
    t = NOW - (22 - n) * 0.8 * DAY
    aid = db.execute("INSERT INTO attempts(problem_id,spec_id,code,level,status,hints_used,solution_viewed,started_at,finished_at,active_sec,updated_at) "
                     "VALUES(?,?,?,?,?,?,?,?,?,?,?)", (problem_id(slug), None, SOLUTION, 1, "solved", 1 if n % 7 == 3 else 0, 0, t, t + 1500, 1500, t + 1500))
    db.execute("INSERT INTO runs(attempt_id,kind,status,passed,total,level,result_json,code,duration_ms,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
               (aid, "submit", "passed", 24, 24, 1, "{}", SOLUTION, 900, t + 1500))

pid = problem_id("group-anagrams")
aid = db.execute("INSERT INTO attempts(problem_id,spec_id,code,level,status,hints_used,solution_viewed,started_at,finished_at,active_sec,updated_at) "
                 "VALUES(?,?,?,?,?,?,?,?,?,?,?)", (pid, sid_spec, SOLUTION, 1, "solved", 0, 0, NOW - 3600, NOW - 2000, 1500, NOW - 2000))
verdict = {"status": "passed", "compile": {"ok": True, "output": "", "errors": []}, "passed": 8, "total": 8,
           "cases": [case(0, "Example 1", "example"), case(1, "Example 2", "example"), case(2, "Empty string", "edge"), case(3, "Single element", "edge"),
                     case(4, "All anagrams", "random"), case(5, "No anagrams", "random"), case(6, "Random 500", "random", 4), case(7, "Perf 10^4", "perf", 38)]}
rid = db.execute("INSERT INTO runs(attempt_id,kind,status,passed,total,level,result_json,code,duration_ms,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
                 (aid, "submit", "passed", 8, 8, 1, json.dumps(verdict), SOLUTION, 1100, NOW - 2000))
REVIEW = {
    "verdict_kind": "correct_optimal", "overall_score": 3.5, "overall_level": "senior_staff_plus", "hire_signal": "strong_hire",
    "summary": "Correct and the expected approach. Sorting each string as the key is clean and easy to defend. The one thing between this and a "
               "clear staff answer is that you did not mention the counting-key variant that removes the log factor.",
    "dimension_scores": {k: {"score": s, "assessed": True, "rationale": r} for k, s, r in [
        ("correctness", 4.0, "All visible and hidden cases pass, including the empty string."),
        ("algorithm_and_complexity", 3.5, "Right structure; the O(n k) counting key was not discussed."),
        ("code_quality", 3.5, "Small, readable, idiomatic use of computeIfAbsent."),
        ("design_and_extensibility", 3.0, "Fine for the problem; no thought about non-lowercase input."),
        ("production_awareness", 3.0, "Allocation per string is fine here; not stated."),
        ("verification", 3.5, "Ran the examples and the empty case before submitting."),
        ("communication", 3.5, "Explanation was short and in the right order.")]},
    "complexity": {"your_time": "O(n k log k)", "your_space": "O(n k)", "optimal_time": "O(n k)", "optimal_space": "O(n k)",
                   "note": "Sorting each key costs k log k; a 26-slot count array makes it O(k)."},
    "strengths": ["Chose a canonical key and said why.", "Handled the empty string without a special case."],
    "issues": [{"severity": "low", "title": "Key allocation per string", "detail": "toCharArray and new String allocate twice per element.",
                "quote": "char[] key = s.toCharArray();", "fix": "Build the key from a 26-int count and join it."}],
    "staff_gaps": [{"area": "Alternatives", "gap": "Did not offer the counting key.", "what_staff_does": "Names both keys and the crossover in k."}],
    "improvements": [{"title": "Counting key", "why": "Removes the log factor.", "code": "int[] c = new int[26];\nfor (char ch : s.toCharArray()) c[ch - 'a']++;\nString key = Arrays.toString(c);"}],
    "say_out_loud": "Two strings are anagrams exactly when their sorted letters match, so I key a hash map by the sorted string.",
    "interviewer_follow_ups": [{"question": "How would you make this O(n k)?", "strong_answer": "Replace the sort with a 26-slot letter count and use it as the key."}],
    "gaps": [{"tag": "algo.alternatives_not_discussed", "description": "Counting-key variant not mentioned.", "severity": "low"}],
    "drill": "Solve it again with the counting key and compare the two out loud.",
    "redo_advice": "No redo needed. Spend five minutes on the counting variant.",
}
cr = db.execute("INSERT INTO code_reviews(attempt_id,run_id,status,code,explanation,result_json,model,requested_model,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
                (aid, rid, "done", SOLUTION, "Sort each word to get a canonical key, then group in a hash map.", json.dumps(REVIEW), "claude-sonnet-5-5", None, NOW - 1900))
db.execute("INSERT INTO code_gaps(review_id,problem_id,tag,description,severity) VALUES(?,?,?,?,?)",
           (cr, pid, "algo.alternatives_not_discussed", "Counting-key variant not mentioned.", "low"))

print("demo data written to", config.DATA_DIR, "| hero session id", HERO, "| group-anagrams attempt", aid, "| review", cr)
