# Coding rubric

**Scale:** 1 = below senior, 2 = senior, 3 = staff, 4 = senior staff+. Half points are allowed.

`level_signal` from score: < 1.75 → `below_senior`, < 2.75 → `senior`, < 3.75 → `staff`, otherwise `senior_staff_plus`.

Hire signal: `strong_no` below 1.5, `lean_no` below 2.5, `lean_hire` below 3.25, `strong_hire` from 3.25.

## Dimensions

### correctness
- 1: Fails visible examples, or passes only the trivial path; edge cases (empty, single element, duplicates, limits) not considered.
- 2: Passes the examples and most edges; a few hidden-case failures, or correct only after debugging with the judge.
- 3: Correct on all cases first or second run; the edges are visibly handled in the code (guards, sentinels), not by luck; overflow, aliasing and mutation of inputs considered.
- 4: Correct, and the code states or enforces its invariants (comments on the loop invariant, asserts, early validation); no hidden assumptions about input.

### algorithm_and_complexity
- 1: Brute force where an optimal one is expected, or the wrong pattern; times out on the stress case.
- 2: Reaches a working solution but not the optimal one, or the optimal one without being able to justify it.
- 3: The expected optimal approach, chosen for a stated reason; time and space are stated correctly; mentions the next-best alternative and why not.
- 4: Also knows the lower bound or why it cannot be beaten, the variants (streaming, huge input, parallel), and the point where the approach breaks.

### code_quality
- 1: One long method, unclear names, copy-paste, magic numbers; hard to follow.
- 2: Readable and conventional Java, some duplication or unclear naming, helpers only where forced.
- 3: Small named helpers, intention-revealing names, no needless state, idiomatic collections and generics, easy to read top-down under time pressure.
- 4: The structure makes the next change obvious; the code reads like the explanation; nothing to cut.

### design_and_extensibility
- 1: Fields and logic tangled; adding a requirement means rewriting.
- 2: Reasonable class but concerns mixed (storage, rules, formatting); each new requirement touches many places.
- 3: Clear responsibilities, state hidden behind methods, the follow-up requirement fits by adding a method or a strategy rather than rewriting; considers interfaces where behaviour varies.
- 4: Extension points chosen deliberately and kept small; explains what would change at 10x scale; avoids both rigidity and over-engineering.
(For single-function problems this is judged on how the solution is decomposed and how it would absorb the follow-up from the problem note.)

### production_awareness
- 1: No validation, no thought about failure, memory growth or concurrent callers.
- 2: Basic validation; failure modes noticed only when asked.
- 3: Validates inputs and states what is returned on bad input; names memory bounds (what grows without limit), thread safety, idempotency and observability where the problem touches them, even when not implemented.
- 4: Chooses the right guarantee for each (atomicity, ordering, eviction, back-pressure), shows how it would be tested and monitored, and names the operational cost.

### verification
- 1: No sign of testing thought; relies on the judge.
- 2: Walks through the example; misses structural edge cases.
- 3: Names the cases that matter (empty, one, max, duplicates, adversarial) and why each; can describe a property or brute-force check.
- 4: Proposes property-based or differential testing, finds the invariant to assert, and sizes tests to the risk.

### communication
Judge only the written explanation of the approach if one was given; otherwise `assessed: false`.
- 1: Restates the code line by line.
- 2: Describes the algorithm and complexity correctly but not why it was chosen.
- 3: Leads with the insight, states complexity and tradeoffs, and names what was left out and why.
- 4: Frames the problem, the options and the decision in a few sentences a peer could act on; anticipates the follow-up.

## Weights

Correctness and algorithm decide whether the solution is acceptable. A correct but non-optimal solution cannot score above 2.5 overall. A failing solution cannot score above 2.0. Using the full solution caps the overall score at 2.0; using hints caps it at 3.0. Staff (3.0 and above) requires 3+ in correctness, algorithm_and_complexity and at least two of the remaining dimensions.
