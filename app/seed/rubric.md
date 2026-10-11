# Rubric

**Scale:** 1 = below senior, 2 = senior, 3 = staff, 4 = senior staff+. Half points are allowed.

`level_signal` from score: < 1.75 → `below_senior`, < 2.75 → `senior`, < 3.75 → `staff`, otherwise `senior_staff_plus`.

## Section anchors

### scope
- 1: Jumps to the design; few requirements; no non-functional requirements or scope boundaries.
- 2: Lists functional requirements and generic non-functional ones ("scalable, highly available"); scope is implicit; doesn't say what's hard.
- 3: Prioritized functional requirements; quantified non-functional requirements; consistency per operation; explicit out-of-scope; names the hard problems; states assumptions.
- 4: All of 3, plus success metrics and business impact; surfaces non-obvious constraints (abuse, compliance, multi-tenancy, cost); scopes strategically to spend time where the signal is.

### estimates
- 1: None, or wrong by orders of magnitude.
- 2: Mechanical QPS/storage math that is never used afterward.
- 3: Right magnitude, peak vs average, read/write ratio; explicitly derives decisions ("50k writes/s, so a single primary won't hold; partition by X").
- 4: Also identifies the binding constraint (hot keys, fan-out, egress cost), how sensitive the design is to the assumptions, and rough cost.

### api_data
- 1: Vague endpoints; ad hoc schema; storage chosen by brand.
- 2: Reasonable APIs and tables; generic storage justification ("NoSQL scales").
- 3: Idempotency keys, pagination and versioning where relevant; entities driven by access patterns; deliberate partition keys and indexes; consistency per entity.
- 4: Also schema evolution, data placement and residency, retention/TTL, PII handling, and contracts between services/teams.

### hld
- 1: Incoherent, or missing key components; no data flow.
- 2: Standard boxes (LB, service, cache, DB, queue) laid out plausibly, some unjustified.
- 3: Simplest design that meets the requirements; read and write paths walked end to end; every component justified; deliberate sync/async boundaries.
- 4: Also service and team boundaries, where to start simple and evolve, and calls out complexity that isn't warranted.

### deep_dives
- 1: No real deep dive, or a restatement of the high-level design.
- 2: Textbook depth on a standard topic (caching, sharding).
- 3: Self-selects the crux; explains mechanisms with numbers; compares 2+ alternatives and decides with reasons.
- 4: Goes to failure semantics and edge cases (ordering, exactly-once effects, clocks, rebalancing, thundering herds); cites how real systems solved it; second-order effects.

### reliability_ops
- 1: Absent, or "add replicas".
- 2: Generic redundancy, retries and monitoring.
- 3: Concrete failure modes and blast radius; idempotency, timeouts, backpressure, graceful degradation; SLOs and alerts; deploy/migration plan; security basics.
- 4: Also multi-region/DR with RPO/RTO, the cost of reliability, capacity planning, operational ownership, and a threat model including abuse.

### tradeoffs_evolution
- 1: No summary; unaware of tradeoffs.
- 2: Generic tradeoff talk (e.g. CAP) not tied to this design.
- 3: Key decisions and what each gave up; what breaks at 10x and the evolution path; open risks.
- 4: Ties tradeoffs to business priorities; sequencing/roadmap; build vs buy; team and org implications; reversible vs irreversible decisions.

## Holistic dimensions (keys fixed, each scored 1-4)
- `problem_framing`
- `estimation`
- `data_modeling`
- `architecture`
- `technical_depth`
- `scalability_reliability`
- `operational_maturity`
- `tradeoff_reasoning`
- `communication_drive` (structure, signposting, driving the conversation, consistency across sections)
- `time_management` (graded from the actual time used vs budget per section, provided in the payload)
