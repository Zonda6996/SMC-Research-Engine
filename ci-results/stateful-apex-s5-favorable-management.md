# Stateful Apex S5 — favorable-excursion management diagnostic

- Decision: **NO_CANDIDATE**; candidate: **none**.
- Development only: 15 series / 6 symbols. S1 OOS, ONDO/VIRTUAL, S4 holdout, Vendor Shapes: **0 uses**.
- Mechanism: frozen Inner touch on a completed bar → BE effective from next bar; no entry/target change, no grid.

## Attribution

- Baseline favorable-then-stop: **325**; saved: **325** (1.0000); winner clipped: **175**.
- Activated: **603/2638**; activation breadth 6 symbols / 15 series.
- Path feasibility: no same-bar activation; activation-bar baseline exits precede activation; later BE/target collision is BE-first.

## Economics and uncertainty

- Gross delta: mean **-0.0149R**, total **-39.3284R**, CI95 **[-0.0596, 0.0316]**.
- Net delta @5 bps/side: mean **-0.0149R**, total **-39.3526R**, CI95 **[-0.0597, 0.0316]**.
- Positive breadth: symbols **2/6**, series **6/15**.

## Conservative screens

- FAIL: netDeltaPositiveCi
- FAIL: grossDeltaPositiveCi
- FAIL: breadth
- PASS: attribution
- PASS: pathFeasibility
- PASS: integrity

At least one preregistered screen failed; no mechanism is selected for freeze.

Artifacts: `ci-results/stateful-apex-s5-favorable-management.json`; design: `ci-results/stateful-apex-s5-favorable-management-preregistration.md`.
