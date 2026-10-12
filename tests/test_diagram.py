"""Excalidraw scene -> grader text. Run: .venv/bin/python -m unittest discover tests"""
import unittest

from app import diagram as D


def box(i, x, y, w=120, h=60, t="rectangle", **kw):
    return {"id": i, "type": t, "x": x, "y": y, "width": w, "height": h, **kw}


def text(i, s, x, y, **kw):
    return {"id": i, "type": "text", "x": x, "y": y, "width": 60, "height": 20, "text": s, **kw}


def arrow(i, x, y, dx, dy=0, a=None, b=None, **kw):
    e = {"id": i, "type": "arrow", "x": x, "y": y, "width": abs(dx), "height": abs(dy), "points": [[0, 0], [dx, dy]],
         "startArrowhead": None, "endArrowhead": "arrow", **kw}
    if a:
        e["startBinding"] = {"elementId": a}
    if b:
        e["endBinding"] = {"elementId": b}
    return e


def scene(*els):
    return {"format": "excalidraw", "elements": list(els)}


class Render(unittest.TestCase):
    def test_bound_labels_and_arrows(self):
        d = scene(
            box("c", 0, 0), text("ct", "Client", 30, 20, containerId="c"),
            box("s", 300, 0), text("st", "API", 330, 20, containerId="s"),
            box("db", 600, 0, t="ellipse"), text("dt", "Postgres", 620, 20, containerId="db"),
            arrow("a1", 120, 30, 180, a="c", b="s"), text("a1t", "HTTPS", 200, 10, containerId="a1"),
            arrow("a2", 420, 30, 180, a="s", b="db", strokeStyle="dashed"),
        )
        out = D.render_text(d)
        self.assertIn("3 shapes, 2 connections", out)
        self.assertIn("- Client -> API: HTTPS", out)
        self.assertIn("- API -> Postgres [dashed]", out)
        self.assertIn("Postgres [circle]", out)
        self.assertIn("1 of 2 connections have no label", out)

    def test_unbound_arrow_resolved_by_geometry_and_loose_label(self):
        d = scene(
            box("a", 0, 0), text("at", "Web", 40, 20),  # loose text inside the shape
            box("b", 300, 0), text("bt", "Queue", 340, 20),
            arrow("x", 122, 30, 176), text("xl", "enqueue", 170, 0),  # unbound arrow, loose text on top of it
        )
        out = D.render_text(d)
        self.assertIn("- Web -> Queue: enqueue", out)
        self.assertNotIn("loose end", out)

    def test_loose_end_and_reversed_head(self):
        d = scene(
            box("a", 0, 0), text("at", "A", 40, 20, containerId="a"),
            arrow("x", 120, 30, 200),  # ends in empty space
            box("b", 500, 0), text("bt", "B", 540, 20, containerId="b"),
            arrow("y", 500, 130, -380, a="b", b="a", startArrowhead="arrow", endArrowhead=None),
        )
        out = D.render_text(d)
        self.assertIn("A -> (loose end)", out)
        self.assertIn("- A -> B", out)  # head at the start means flow runs from the end to the start
        self.assertIn("not attached to any shape", out)

    def test_boundary_and_nesting(self):
        d = scene(
            box("vpc", -20, -20, 600, 300), text("vt", "VPC", 0, -10),
            box("s", 40, 60), text("st", "Service", 70, 80, containerId="s"),
            box("db", 300, 60), text("dt", "DB", 340, 80, containerId="db"),
            box("out", 800, 60), text("ot", "Stripe", 830, 80, containerId="out"),
        )
        out = D.render_text(d)
        self.assertIn("3 shapes, 0 connections, 1 boundaries", out)
        self.assertIn("- VPC: Service, DB", out)
        self.assertIn("- Service [box] (inside: VPC)", out)
        self.assertNotIn("Stripe [box] (inside", out)

    def test_unbound_arrow_inside_boundary_is_not_attached_to_it(self):
        d = scene(box("vpc", -20, -20, 600, 300), text("vt", "VPC", 0, -10), box("s", 40, 60), text("st", "Svc", 70, 80, containerId="s"),
                  arrow("x", 100, 200, 200))
        out = D.render_text(d)
        self.assertNotIn("VPC -> VPC", out)
        self.assertIn("(loose end) -> (loose end)", out)

    def test_frame_name_and_freehand_and_annotation(self):
        d = scene({"id": "f", "type": "frame", "x": 0, "y": 0, "width": 500, "height": 300, "name": "Region A"},
                  box("s", 20, 40, frameId="f"), text("st", "S", 50, 60, containerId="s"),
                  text("n", "assume 10M DAU", 700, 500), {"id": "p", "type": "freedraw", "x": 0, "y": 0, "points": [[0, 0], [5, 5]]})
        out = D.render_text(d)
        self.assertIn("- Region A: S", out)
        self.assertIn("- assume 10M DAU", out)
        self.assertIn("1 freehand", out)

    def test_duplicate_names_and_empty(self):
        d = scene(box("a", 0, 0), text("at", "Cache", 10, 10, containerId="a"), box("b", 300, 0), text("bt", "Cache", 310, 10, containerId="b"))
        out = D.render_text(d)
        self.assertIn("Cache #2", out)
        self.assertEqual(D.render_text(scene()), "(no diagram drawn)")
        self.assertEqual(D.render_text(None), "(no diagram drawn)")
        self.assertTrue(D.is_empty(scene({"id": "x", "type": "rectangle", "isDeleted": True})))


class Normalize(unittest.TestCase):
    def test_filters(self):
        raw = scene(box("a", 0, 0), box("a", 5, 5), {"id": "i", "type": "image"}, {"id": "d", "type": "rectangle", "isDeleted": True}, "junk")
        out = D.normalize(raw)
        self.assertEqual([e["id"] for e in out["elements"]], ["a"])
        self.assertEqual(D.normalize(None), D.empty_diagram())
        self.assertEqual(D.normalize({"elements": "x"}), D.empty_diagram())

    def test_cap(self):
        out = D.normalize(scene(*[box(f"b{i}", i, 0) for i in range(D.MAX_ELEMENTS + 50)]))
        self.assertEqual(len(out["elements"]), D.MAX_ELEMENTS)

    def test_legacy_still_works(self):
        legacy = {"nodes": [{"id": "a", "type": "component", "position": {"x": 0, "y": 0}, "data": {"kind": "service", "label": "API", "notes": ""}},
                            {"id": "b", "type": "component", "position": {"x": 200, "y": 0}, "data": {"kind": "database", "label": "DB", "notes": ""}}],
                  "edges": [{"id": "e", "source": "a", "target": "b", "data": {"label": "SQL", "mode": "sync"}}]}
        n = D.normalize(legacy)
        self.assertIn("nodes", n)
        self.assertFalse(D.is_empty(n))
        self.assertIn("API -> DB [sync]: SQL", D.render_text(n))


if __name__ == "__main__":
    unittest.main()
