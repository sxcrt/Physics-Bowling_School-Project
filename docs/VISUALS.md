# Hells Balls visuals

This document records how the milestone 7 visual overhaul was built, what it
follows from the reference image, and - importantly - what could **not** be
reproduced. Everything here is generated in code: the game ships no image
files, and every texture is painted at startup with Pillow (see
`scene/textures.py`).

## 1. What the reference image shows

The reference is a flat neon night-city bowling scene ("HELLS BALLS"):

| Element | What the reference does |
| --- | --- |
| Art direction | Flat vector illustration: deep navy night, saturated pink/cyan neon, no surface gradients |
| Lane | Bright warm maple, 39 longitudinal boards converging to the vanishing point, dark chevrons mid-lane, a dashed cyan centreline and a bright pink neon border |
| Lane surround | Near-black gutters, hot-pink neon rails with a glow, cyan tubes just outside, dark indigo ground |
| Pins | Regulation silhouette, bright white body with a red neck band, standing in the classic triangle in front of a dark band with a pink neon bar |
| Ball | Glowing blue "energy" sphere with a cyan electric crackle |
| City | Flat indigo buildings full of lit pink/cyan windows, neon bars and two big sign panels (a bowling pin, a ringed planet), a skybridge with a cable, a cratered moon and stars |
| Camera | One-point perspective down the lane, pins at the vanishing point and the sky above them |
| HUD | Not in the reference; the game keeps its own (aiming guide, power meter, scorecard) |

Two things the reference is **not**: it is not geometrically consistent with a
60 ft lane (the pins sit far too close for the lane's apparent length), and it
shows no scorecard/HUD panel style. Both are noted as limitations below.

## 2. How the game follows it

### Lane and lane surround (`scene/lane.py`, `scene/textures.py`)

* `wood_texture()` paints 39 boards across the lane with per-board tone
  variation, fine grain strokes, dark seams, a few knots and a glossy sheen
  down the middle - the reference's most distinctive feature.
* The sheen and the board contrast are baked into the texture, so they cost
  nothing per frame. Textures are built once and cached, and the lane textures
  use anisotropic filtering because the lane is viewed at a grazing angle
  (without it, mip selection blurs the boards into a flat colour).
* The seven targeting chevrons (15 ft past the foul line), a row of approach
  dots and a dashed cyan guide line down the middle, matching the reference's
  dark markings and its neon centreline.
* Gutters are near-black channels with a hot-pink neon rail, a cyan tube just
  outside it and dark indigo aprons - the reference's lane border.

### Pin deck and pin backdrop

* A brighter wood deck, a dark pit apron, and a low dark band behind the pins
  carrying a pink neon bar and the glow that sits behind them in the reference.
* The painted skyline rises behind that band (see below), so nothing occludes
  the city from the lane's one-point perspective.

### The neon city (`scene/lane.py`, `scene/textures.py`)

* Flat indigo building masses on both sides, faced with generated facade
  panels (`facade_texture()`): a dark wall, a grid of lit pink/cyan windows
  and a neon roof trim. A pink tube at street level, a cyan strip above it and
  vertical neon bars between the buildings carry the reference's colour.
* One large painted skyline (`city_skyline_texture()`) stands behind the pin
  deck: a gradient sky, stars, a cratered moon, three depth layers of
  buildings with lit windows and neon bars, a skybridge with a cable, and two
  big sign panels (a bowling pin and a ringed planet).
* Everything here is deliberately flat and unlit. The depth comes from the
  drawing's perspective, not from lights, which is what makes the view read as
  an illustration rather than as a 3D set.

### Pins (`scene/pin_mesh.py`)
See the module docstring and `docs/PHYSICS.md`: one continuous lathe mesh of
the regulation silhouette, with a generated white/red skin.

### Ball (`scene/ball.py`, `scene/textures.py`)

A generated deep-blue skin with a cyan crackle and a vertical brightness
gradient, drawn unlit so it reads as a glowing energy ball like the reference.
A soft radial "contact shadow" disc travels under it. The crackle makes the
roll readable: the filaments wheel around as the ball travels, and a hook is
visible twice over - in the ball's own spin and in the fading trail that
records the path it really took (`game/play.py::_update_trail`).

### The character (`avatar/character.py`, `scene/geometry.py`)

An original low-poly bowler, built from procedural parts so it stays in the
same hand-made, faceted style as the city: a tapered torso with shoulder caps
and a collar, jointed arms and legs (thigh/knee/shin, sleeve/elbow/hand),
shoes with a sole and a heel, and a head with a jaw, hair, ears, eyes, brows,
a nose and a mouth. The shapes come from `scene/geometry.py`:
`tapered_box` (a beveled prism, optionally built downward from a joint),
`low_poly_sphere` (a coarse faceted ball) and `cone`. Every part is 4-10
segment coarse, which is where the retro "rendered on older hardware" feel
comes from - the character is read as a person at a glance without a single
imported model or texture.

### Shading (`scene/shaders.py`)

Ursina 8.3 renders entities with an *unlit* shader by default, which leaves
every surface flat, and its shadow-mapped lit shader supports a single light
whose 1024 map is far too coarse over an 18 m lane. `soft_lighting_shader` is
a small local shader instead: one warm key direction (from above and slightly
behind the bowler), a cool fill, and a shading floor, evaluated per pixel from
the world normal. Flat surfaces stay even, round bodies read as round, and the
key/fill colours live in `config`.

## 4. The interface design system (`ui/theme.py`)

The menus, the mode picker, the HUD and the Physics Lab share one system so the
game reads as a product rather than as a set of screens. Every colour and every
size lives in that one module - nothing is placed by eye and no screen invents
a colour.

| Element | Design | Source in the reference |
| --- | --- | --- |
| Palette | `theme.COLORS`: panel `#14102E`, card `#1C1745`, selected card `#251F5A`, hairline `#3A3270`, pink `#FF3D8B`, deep pink `#C2185B`, cyan `#3EC9E8`, amber `#FFB547`, coral `#FF5C6C` (QUIT only), purple `#A78BFA`, green `#4ADE80`, text `#FFFFFF`, secondary text `#CFCBEA`. No grey, brown or dull green anywhere - the older widgets draw from `PALETTE`, whose keys now resolve to these tokens | the hall's neon and spot lighting |
| Sizes | `theme.SIZES`, written in **reference pixels** at 1280x720: PLAY/START 380x72 r14, the secondary row 220x56 r12 with 24px gaps, key caps 22px r6 (13px text), QUIT 120x44, cards 250x110 r14 with 20px gaps, panels r16 with a 3px cyan rule and 24px padding, BACK/START 200x56 | the chunky, high-contrast interface shapes |
| Scaling | `theme.px()` maps reference pixels to UI units (the UI is one unit tall) and `theme.screen_pos()` maps a top-left-origin point onto the UI, so 1920x1080 and 1024x600 get the same composition; `theme.ui_scale()` pulls the layout in slightly on windows narrower than 16:9 so nothing can clip | one poster, every screen size |
| Type | the two screens draw every label with `theme.TextSprite`, which renders a label with Pillow at an exact pixel size (bold, letter spacing and a neon halo included) and crops it to its ink, so the quad's centre *is* the optical centre. `theme.TYPE` (hero 1.70 ... tiny 0.722 = 13px) is the floor for the older screens: nothing in the UI is smaller than 13px at 1280x720 | the arcade-poster typography's wide range, tamed to a system |
| Buttons | `theme.ArcadeButton`: `primary` (pink #FF3D8B -> #C2185B gradient, 14px radius, a soft pink glow and an ENTER key cap), `secondary` (card fill, 2px cyan border, 12px radius) and `ghost` (transparent with a 2px accent border). `theme.MenuButton` (the older screens) is the same quiet plate | the reference's chunky interface shapes |
| Mode cards | `theme.ModeCard`: a 48px rounded icon tile (accent at 25%) with a drawn vector icon (pin, ?, sigma, two people, robot, three people, stopwatch), an 18px bold title and a 14px two-line description | the reference's ball-centric presentation, reworked so seven options stay readable |
| Panels | `theme.Panel`: `#14102E` at 92% with a 3px cyan rule on top, 16px corners and 24px padding, over `theme.Wash` (a dark overlay that keeps the lane out of the text); the mode's rules are `theme.Chip` pills (amber text on amber at 20%) laid out by `theme.ChipFlow` | the hall's neon trim |
| States | hover brightens 10% and scales 1.03, pressed scales 0.97, keyboard focus is a 2px white outline (3px offset) or - on cards - a dashed outline, disabled is 40% opacity, and every transition is 140ms ease-out | arcade feedback |
| Input control | `theme.SegmentedControl`: the active option is a cyan fill with dark text, the inactive ones are transparent with white text | an arcade's illuminated mode switch |

The typography is deliberately small in the number of distinct sizes: the
earlier build used a different scale for almost every label (0.5, 0.52, 0.6,
0.62, 0.66, 0.68, 0.72, 0.74, 0.78, 0.82, 0.86, 0.9, 0.92, 0.95, 1.0, 1.1,
1.15, 1.2, 1.25, 1.35, 1.5), which is why the interface read as a debug
dashboard. Text that does not fit is now *wrapped* (`ui/layout.wrap_text`) or
fitted to its plate rather than shrunk below the 13px floor.

**Layer order.** Ursina's UI camera draws *smaller* z in front, so the system
uses named layers (`BACKDROP_Z`, `PANEL_Z`, `CARD_Z`, `CONTENT_Z`, `BUTTON_Z`,
`OVERLAY_Z`): a panel always sits behind its own text, and overlays use a
negative z so they cover the play HUD. Getting this wrong is what produced the
first broken Physics-Lab build (panels painting over their own labels).

**Text sizing.** A non-uniform parent scale squashes child text (Ursina renders
text through the parent's matrix), so widgets keep their own scale at
`(1, 1, 1)` and size their children explicitly. `TextSprite` labels are ink-
cropped textures, which is what makes "centred" mean centred in both axes.

**Input states.** Every widget (button, card, stepper, toggle, slider, text
entry) answers one rule: `theme.widget_active` - enabled *and* visible - and a
hidden control can never consume a click. Each state is visible: hover lifts
the fill and brightens the border, selection turns the card into the accent
border with a glow and a check badge, and a disabled control dims to 40%.

## 5. The animation system (milestone 8)

The neon-alley motion layer lives in `motion/` and is documented in full -
including the tuning table and the trigger hook-up - in
[`docs/ANIMATION.md`](ANIMATION.md). In short:

* one shared easing set (the standard and overshoot cubic-beziers), one tween
  utility and **one config object** (`motion.MOTION`) for every timing and
  intensity;
* the HUD keeps owning its layout; the animations are applied on top as
  offsets, scale multipliers and alphas, so nothing resizes or re-flows while
  it animates;
* every effect is pooled (particles, flashes, result cards, trail markers) and
  the particle budget degrades automatically on a slow machine;
* a **reduce motion** setting disables shake, flashes and pulses while keeping
  entrances, crossfades and count-ups.

What changed visually on the existing screens:

| Element | Motion |
| --- | --- |
| Scorecard | frames drop in 40 ms apart; the active frame breathes a cyan glow at 1.05 scale; scores pop with an amber flash; `X` / `/` stamp in from 2.0 with a -8° settle; the tenth frame pulses larger and a gold shimmer sweeps the total |
| Top-right block | the cumulative total counts up (500 ms); the ten-pin triangle is the pin readout (knocked pins dim and shrink; a reset pops them back, back row first) |
| Status line | crossfades with an 8 px upward drift, pulses on "Ready to throw", and fades out entirely while the ball rolls |
| Input feedback | the bottom bar, the instruction sentence and the key-cap chips are gone - the HUD is wordless (score, rack, scorecard) and the controls live in How to Play; a power meter follows the drag cyan -> amber -> magenta and flashes white on release |
| Result moments | STRIKE / SPARE / GUTTER / n PINS DOWN! / TURKEY cards that slam in with a shockwave ring, a layered outline + halo, an optional combo sub-line (DOUBLE!, FOUR-BAGGER!, ...), a breathing hold and a float-out; edge flashes, camera shake, particles and a wave across the HUD's pin triangle; the media escalates with consecutive strikes |
| 3D scene | neon tubes breathe out of phase and spike on a strike; the red glow behind the pins surges on impact; the ball leaves a fading trail with dust puffs and a shockwave ring expands across the deck when it lands on the pins; the camera pushes in (FOV 60 -> 54) and shakes by an amount scaled with the hit; the sweeper lowers and the pins drop back in; the aim guide is a marching dashed line |
| Pinfalls | every pin that falls is announced on screen with a punchy "+1 PIN!" pop (a multi-pin drop grows to "+3 PINS!") over the deck area, with a capped camera thud; the rack's pin icons dim as they always did |
| Game end | the panel expands, the score counts up, the confetti shower falls in front of the results, and the award the match earned - PERFECT GAME! (gold, extra beats), NEW PERSONAL BEST!, or YOU WIN! - pops in under the total with its own colour |
| Screens | pause dims the background and scales the panel in from 0.95 (the panel is just the title and buttons now - the "simulation is frozen" paragraph was filler); `H` slides the physics panel in from the right; frame changes sweep a band of light across the screen; the game end expands the results panel and counts the final score up with confetti |
| Removed clutter | the duplicated controls list, the "INPUT" caption, the always-on "Throw the ball to record physics data" placeholder box, and the second ball that used to hover beside the bowler at rest (the character now only holds a ball while it is about to throw); the wordless-HUD pass then removed the mode title, the player caption, the `SCORE` / `TOTAL PINS`, `SESSION` and `FRAME x/y BALL x` labels, the "pins knocked" line and the entire bottom bar (hint sentence, input badge and key-cap chips) |

## 6. What could not be reproduced

* **The branded signage and characters.** The reference's "HELL BALLS" name,
  logos, skulls, flames, plants and mascots are copyrighted set dressing. The
  city keeps the *layout* (signage over the lane, neon signs on the buildings,
  the pin and planet panels, a moon) with original geometry and its own
  generated textures.
* **Geometric consistency with the reference's lane.** The reference draws a
  short, stylised lane. This game keeps the real 18.29 m (60 ft) lane, so the
  pins are much smaller on screen at the foul line than in the reference.
* **The reference's flat camera height.** The reference puts the camera close
  to the lane with a narrow field of view. This game uses a 60° horizontal FOV
  and a camera ~1.65 m up and 4.6 m behind the foul line, which keeps both the
  ball and the pins readable while rolling; it is the same one-point
  perspective, not the same focal length.
* **Real-time shadows.** Not used: a single shadow map over an 18 m lane is
  too coarse to be readable. Contact shading is faked under the ball instead.
* **A real background blur behind the pause menu.** Panda's `CommonFilters`
  refuses to attach to this window setup ("Could not find appropriate
  DisplayRegion to filter"), so the pause dims the background and darkens the
  rim instead - see the limitations in `docs/ANIMATION.md`.
* **A reference HUD/scorecard style.** The reference shows no scorecard, so
  the HUD follows the alley's palette (near-opaque dark panels - firm enough
  that the lane's own approach dots cannot read as UI smudges through the top
  bar - with neon hairlines, amber scores and cyan/magenta accents)
  while keeping the information the game needs. This is an interpretation, not
  a copy.

## 6. Verification

`docs/PHYSICS.md` covers the simulation. Visual work was checked by rendering
the real game offscreen and inspecting screenshots at 1280x720 and 1024x768
(ready, rolling, settling, result, second-ball, webcam mode); the pin mesh was
additionally checked in isolation from the generated profile data. No claim of
pixel-perfect accuracy against the reference is made - see section 3.
