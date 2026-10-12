# Gridiron Engine: low-poly American football visual and physics engine

The visual and physics layer for a CPU-vs-CPU football sim. **It has no rules and no play-calling.** Your coach/sim layer drives players through commands and reacts to events. `src/demo/DemoSim.js` is a small reference driver; you can delete it.

## Run
Any static server works (ES modules + import map, Three.js is bundled in `vendor/`, no build step):
```
python3 -m http.server 8000   →  http://localhost:8000/
```
* `?nosim` starts the engine with no demo driver (an empty field for your sim).
* `?classic` uses the previous code-built players instead of the character-system players (`src/engine/characters/`, see `docs/character_system/` and `analysis/M1_REPORT.md`). Option: `new FootballEngine(el, { playerModel: 'classic' })`.
* **Character creator:** `tools/creator/`: sliders for height, weight, position, body proportions, face shape, hair, beard, skin, uniform colours, helmet on/off and poses; exports the saved-appearance JSON.
* Character tools: `tools/compare/` (Meshy vs procedural), `tools/poses/` (poses, lineups, `helmet=1`, `faces=1`), `tools/portraits/` (player cards).
* `lineup.html` previews generated players: the six test bodies, same-size seed variation, or a custom player with sliders. It runs the real animator (`pose=run|sprint|3pt|block|…`, `uniform=home|away|alt`, `cam=front|side|back|3q`).
* Keys: `1-4` camera modes, `Space` pause, `[` `]` slow-mo.

## Layout
```
src/engine/
  Engine.js       FootballEngine: renderer, fixed-step loop, events, catch/loose-ball resolution, CameraDirector
  Player.js       per-player body + brain (intents) + command API
  Physics.js      collisions, momentum impulses, hit reactions, wrap-ups/grips, trips, fumbles
  Animator.js     procedural, physics-driven animation (no canned clips)
  Body.js         height/weight/archetype/seed → body proportions (deterministic)
  PlayerModel.js  boxy player built in code from a body + uniform, numbers/names, bakeRig()
  Uniforms.js     home / away / alt uniform colour sets per team
  names.js        placeholder surnames
  Ball.js         ballistic flight, led passes w/ accuracy error, snaps, prolate bounces
  Field.js        canvas-drawn field (numbers, hashes, logo, end zones), goalposts
  Stadium.js      two-tier bowl, ~25k GPU-animated fans, benches with baked players
  HUD.js          broadcast scorebug matching the reference
  constants.js    units (1 unit = 1 yard), position rating profiles, skin tones
```

## Coordinates
Units are yards. X runs along the field (goal lines at ±50, end lines at ±60). Z runs across it (sidelines at ±26.67, +Z is the camera side). Facing is in radians, with `atan2(dx, dz)`. Home attacks +X.

## Driving players (your sim → engine)
```js
const e = new FootballEngine(el, { teams: { home: {...}, away: {...} } });
const qb = e.addPlayer({ team:'home', position:'QB', number:7, name:'Jordan',
                         seed:17429, heightIn:76, weightLb:225,     // body from the sim (rolled from position if omitted)
                         uniform:'home',                            // 'home' | 'away' | 'alt' (default team.uniform || 'home')
                         ratings:{ accuracy:.9, arm:.8 } });
qb.teleport(x, z, facing);         qb.stance('qb', facing)    // '3pt' | 'center' | '2pt' | 'wr' | 'lb' | 'qb'
p.moveTo(x, z, {speed, face})      p.runRoute([[x,z],...], {settle})
p.block({target, protect, drive:[dx,dz], zone:[x,z], radius})   // pass pro or run block (auto-picks rushers)
p.rush(target)  p.pursue(target)   p.cover(wr, {dir, cushion})  p.zone(x, z, {dir})
p.carry({dir, lane, losX})         p.playBall()  p.recover()  p.celebrate()  p.idle()  p.dive(dir)
qb.throwTo(playerOrPoint, {speed, loft, error})                 qb.handoffTo(rb)
e.snap(center, qb)  /  e.snapUnderCenter(qb)   e.whistle(reason)   e.ball.placeAt(x, z)
```
Each intent only produces a **desired velocity and facing**. Physics decides what actually happens.

## Events (engine → your sim)
`snap, throw, catch {player, intercepted, contested}, deflection, incomplete, handoff, fumble, recover,
contact, hit {impulse}, brokenTackle, fall, down {carrier, spot, tacklers}, outOfBounds, goalLine {side, entering}, whistle`

By default (`autoDeadBall: true`), the engine whistles a play dead on a knee-down, out of bounds, or an incomplete pass. Touchdowns, scoring and downs are left to your sim. Set `autoDeadBall:false` to own all of it.

## What is physics-driven
* **Bodies**: mass discs with strength-limited steering. Blocking is a push battle the contact solver resolves (mass × strength), plus rush-move logic for pass rushers.
* **Hits**: every collision produces the impulse `j = −(1+e)·vₙ / (1/mA + 1/mB)`. The impulse kicks a per-player **balance pendulum** (inverted pendulum + recovery spring scaled by the `balance` rating). Past about 33° the player topples in the direction he was actually knocked: face-first, backward or sideways. Smaller hits make him stagger and step under his lean.
* **Tackles**: contact from a tackler creates a **grip**. That couples the two players' velocities, weakens the carrier's recovery and drags him down. Carriers can rip free (strength × balance vs tackle). Dives are real lunges that fall through the carrier, and gang tackles pile up naturally.
* **Catches**: ballistic flight with led passes and accuracy error. Hands reach for the ball by IK. Catch, tip or miss is resolved from hands rating, reach, ball speed and nearby defenders. Tipped balls stay live and can be caught again or intercepted.
* **Loose balls** bounce like a prolate spheroid, so the direction is unpredictable. Big hits can cause fumbles (`security` rating), and anyone can scoop the ball.
* **Trips**: upright players running over bodies on the ground can stumble or fall.
* **Animation** is generated from physical state: stride-locked run cycles, lean into acceleration, shuffle/backpedal, stances, throw, block, brace, falls, and getting up.

## Player bodies
Players are generated, not loaded. `Body.resolveBody({ seed, position, heightIn, weightLb, archetype, overrides })` turns the sim's height/weight into 16 normalised proportions (1.0 = the 6'1", 225 lb reference):
* **Height** lengthens legs more than the torso; the helmet barely changes size.
* **Weight** is not a uniform scale: each region (shoulders, chest, waist, belly, hips, arms, legs) responds to mass with its own rate.
* **Archetypes** (`compact`, `lean_athletic`, `balanced_athletic`, `strong_athletic`, `power`, `massive`) bias regions and supply typical sizes; the position picks one by default.
* **Seed** adds correlated variation (top-heavy vs leg-heavy, thick vs lean core, long legs vs long torso), so same-size players still look different.
* The resolved body is a plain object on `player.body`. Pass it back as `body` to rebuild the same player exactly.

Mass comes from weight (override with `ratings.mass`); the collision radius grows with weight.

## Uniforms
Each team can define `uniforms: { home, away, alt }` with any region colours (`jersey, trim, number, numberOutline, pants, pantStripe, socks, sockBand, helmet, helmetStripe, mask, gloves, cleats, cleatTrim`). Missing colours are derived from `primary` / `secondary`. `team.uniform` sets what the team wears; `addPlayer({ uniform })` overrides per player. Numbers (front and back) and the name on the back are drawn per player.
