---
name: ue-blueprint-deep-audit
description: >-
  Audits Unreal Engine Blueprint graphs for logic bugs and silent misconfigurations.
  Verifies pin defaults (including Array_Set Index, GetArrayItem dimension literals), literal
  constants on data pins, variable default values, broken exec chains, cast targets, and
  mismatches between slot indices and Select/Branch wiring. Use when the user asks to check
  Blueprints for bugs, verify BP_Enemy1 or other BPs, audit EventGraph or functions, or mentions
  array index, Slot Owners, overlap, reset, or ue-mcp / T3D export.
disable-model-invocation: true
---

# UE Blueprint Deep Audit

When the user asks to **check / audit / debug** a Blueprint (or suspects a BP bug), treat it as a **deep inspection**, not a high-level skim. Assume mistakes hide in **numeric literals, default pin values, and disconnected pins**.

## Scope of inspection

Cover all of the following unless the user narrows the graph or event:

1. **Execution flow**
   - Every `then` / `execute` / Branch true-false that should fire must have a successor where intended.
   - No dead-end `then` on critical path (e.g. `SetWorldRotation` with empty `then` when more work should follow).
   - Custom events and function calls: confirm **all** entry points that should reset or assign slots actually run.

2. **Data pins — literals and defaults (mandatory)**
   - **`Array_Set` / Set Array Elem**: read **`Index`** — confirm it is **0 / 1 / 2** (or correct loop index), never two nodes both hardcoded to the same index unless intentional.
   - **`Get` (array element)**: **`Dimension 1`** or index pin — must match the intended slot (0 vs 1 vs 2).
   - **`Select`** (on roots/colliders): **`Index`** must match the same slot convention as `Slot Owners` / `Active Ball`.
   - **Branches (`IfThenElse`)**: **`Condition`** must be wired; if unwired, note that default `true` can force wrong branch.
   - **Cast nodes**: `Object` wired from the correct **`OtherActor`** (or equivalent); Cast Failed path behavior if relevant.

3. **Variables**
   - **Default values** in Details for booleans, floats, vectors used as “origin” reset targets.
   - **Arrays** (`Slot Owners`, `Active Ball`, etc.): length initialization on **BeginPlay** vs max slots used at runtime.
   - **Naming**: no duplicate semantics (e.g. two different “index” concepts confused in one chain).

4. **Overlap / lifecycle**
   - **BeginOverlap** vs **EndOverlap**: clearing the **same index** that was assigned on enter (`Array_Set` to `None` with correct **Index**).
   - Cast filter (e.g. LightBall vs Character): ensure the right actor type drives the right branch so non-target actors do not corrupt flags.

5. **Reset / restore**
   - Reset functions: **target component** pins match the slot; location/rotation/extent use **per-slot stored defaults**, not accidental `0,0,0` unless that is truly the design.

## How to gather evidence (when tools allow)

- Prefer **exported graph text (T3D)** or **graph summary** over guessing from memory.
- When reading T3D or pin dumps, explicitly list:
  - Node name / class
  - **`DefaultValue=`** on pins (especially `Index`, dimensions, bools)
  - **`LinkedTo=`** empty vs populated for `Condition`, `execute`, `then`

If the bridge or export fails, state that limitation and still give a **checklist** the user can run manually in-editor (search all `Set Array Elem`, sort by Index, etc.).

## Output format

1. **Findings** — ordered by severity (broken exec / wrong index / unwired Condition / wrong cast).
2. **Evidence** — pin name + literal or “unwired”.
3. **Fix** — one sentence per item: what to rewire or what value to set.
4. **Residual risk** — what could not be verified without PIE or without export.

## Anti-patterns to call out by name

- Two **`Array_Set`** nodes both **`Index = 0`** for different slots.
- **`GetArrayItem`** index **`1`** while comment says “slot 0”.
- **`IfThenElse`** with **`Condition`** defaulting to true and no wire.
- **EndOverlap** clearing only index **0** while slots **1** and **2** are used.
- **`ResetOneShadowCollider`** `then` chain incomplete after rotation or extent.

## Language

- Match the user’s language (e.g. 繁體中文) when they write in that language.
- Keep findings concise; use tables only when they improve clarity over prose.
