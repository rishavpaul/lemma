"""One-off: move the `## Q: ...` sections that "Add to article" appended to article bodies into article comments.

    LEMMA_HOME=/some/dir .venv/bin/python scripts/split_article_comments.py          # dry run, prints what would move
    .venv/bin/python scripts/split_article_comments.py --apply                          # backs up coach.db, then moves them

Everything from the first `## Q:` heading to the end of a body is treated as appended content, split at each further
`## Q:` heading. Quit the app first. Comments keep the article's updated_at as their date; the model is unknown."""
import re
import shutil
import sys
import time

sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parent.parent))
from app import config, db  # noqa: E402

HEAD = re.compile(r"^## Q: ?(.*)$", re.M)


def split(body: str) -> tuple[str, list[tuple[str, str]]]:
    marks = list(HEAD.finditer(body))
    if not marks:
        return body, []
    out = []
    for i, m in enumerate(marks):
        end = marks[i + 1].start() if i + 1 < len(marks) else len(body)
        q, _, ans = body[m.start(1):end].strip().partition("\n\n")  # "## Q: {question}\n\n{answer}"
        out.append((q.strip(), ans.strip()))
    return body[:marks[0].start()].rstrip() + "\n", out


def main() -> None:
    apply = "--apply" in sys.argv
    if apply:
        backup = config.DB_PATH.with_name(f"coach.db.bak-{int(time.time())}")
        db.connect().execute("PRAGMA wal_checkpoint(TRUNCATE)")
        shutil.copy2(config.DB_PATH, backup)
        print(f"backup: {backup}")
    if apply:
        db.migrate()  # creates article_comments if the app hasn't run the new version yet
    moved = 0
    for a in db.rows("SELECT id,title,body,updated_at FROM articles ORDER BY id"):
        new_body, qs = split(a["body"])
        if not qs:
            continue
        print(f"[{a['id']}] {a['title']}: {len(qs)} section(s), body {len(a['body'])} -> {len(new_body)} chars")
        for q, ans in qs:
            print(f"    Q: {q[:80]}  ({len(ans)} chars)")
        if apply:
            conn = db.connect()
            for q, ans in qs:
                conn.execute("INSERT INTO article_comments(article_id,question,body,model,created_at) VALUES(?,?,?,?,?)",
                             (a["id"], q or None, ans or "(empty)", None, a["updated_at"]))
            conn.execute("UPDATE articles SET body=? WHERE id=?", (new_body, a["id"]))  # updated_at is left as it was
            conn.commit()
        moved += len(qs)
    print(f"{'moved' if apply else 'would move'} {moved} section(s)")


if __name__ == "__main__":
    main()
