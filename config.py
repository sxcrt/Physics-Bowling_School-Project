"""Central place for every game constant. SI units unless stated otherwise.

Nothing in this module imports the game engine, so it can be shared freely
between the physics, input and scene layers without creating coupling.
"""

# ---------------------------------------------------------------------------
# Window / application
# ---------------------------------------------------------------------------
WINDOW_TITLE = "Hells Balls"
WINDOW_SIZE = (1280, 720)
WINDOW_BACKGROUND = (12, 14, 44)      # RGB 0-255, deep night-sky clear colour

# ---------------------------------------------------------------------------
# Physics: gravity and material coefficients
#
# Every constant below is either a measured value (with the source noted) or
# an approximation tuned for the game. The simulation implements standard
# equations; that alone does not make it accurate, so the limitations of
# each constant are documented where it is used.
# ---------------------------------------------------------------------------
GRAVITY = 9.81                        # m/s^2, standard gravity (measured)
# Rolling resistance of a bowling ball on an oiled lane. Rolling resistance
# is small: measured ball-motion data (USBC SuperCATS) shows roughly
# 1-2 m/s of velocity loss over 18.29 m, i.e. a ~0.05-0.1 m/s^2 deceleration,
# or mu_r ~ 0.005-0.01. The value below is the conservative upper end for a
# lane with less oil (a dry lane would be much higher). Approximate.
ROLLING_FRICTION = 0.02               # rolling-resistance coefficient (dimensionless)
# Kinetic friction while the ball's contact point is slipping. Historic
# measurements on a dry varnished wood lane give mu ~ 0.18 (The Motion of a
# Ball on a Bowling Alley, Ohio State, 1948); an oiled lane is lower. Used
# only for the brief skid right after release and for gutter contact.
SLIDING_FRICTION = 0.12               # kinetic friction while skidding (dimensionless)
# Gutter channel is unlubricated, so the ball scrubs to a stop quickly.
GUTTER_FRICTION = 0.15                # kinetic friction in the gutter (dimensionless)
# Ball-to-pin coefficient of restitution. USBC instrumented ball-pin tests
# report e ~ 0.6-0.77 for phenolic pins struck around 6 mph (2.7 m/s); 0.6 is
# the conservative end for a hard reactive ball. Approximate.
RESTITUTION_BALL_PIN = 0.6            # coefficient of restitution, ball -> pin
# Pin-to-pin coefficient of restitution. Not measured here; a wooden pin on
# wooden pin is fairly inelastic, so a lower value than the ball-pin pair is
# used. Approximate.
RESTITUTION_PIN_PIN = 0.5             # coefficient of restitution, pin -> pin

# ---------------------------------------------------------------------------
# Ball dynamics
# ---------------------------------------------------------------------------
# Below this speed the ball is considered stopped (m/s).
BALL_STOP_SPEED = 0.25
# Slip below this speed counts as rolling without slipping (m/s).
SLIP_TOLERANCE = 0.01
# Collision detection is resolved in sub-steps of at most this length, so a
# fast throw registers the same contacts at 30 fps and at 240 fps.
PHYSICS_SUBSTEP = 1.0 / 240.0
# Physics sub-steps a single rendered frame may run (0.05 s of simulation at
# PHYSICS_SUBSTEP). A longer frame drops the backlog instead of spiralling.
PHYSICS_MAX_SUBSTEPS = 12
# Air drag was left as 0 in earlier milestones; it is now derived in
# docs/PHYSICS.md and shown to be < 0.05 m/s^2 at bowling speeds, so it is
# deliberately omitted from the ball equations (documented limitation).


# ---------------------------------------------------------------------------
# Ball
# ---------------------------------------------------------------------------
BALL_DIAMETER = 0.218                  # m (8.5 in)
BALL_RADIUS = BALL_DIAMETER / 2        # m
BALL_MASS = 6.0                        # kg
# Moment of inertia about the centre:
#   solid sphere -> I = (2/5) M R^2
#   hollow shell -> I = (2/3) M R^2
BALL_INERTIA_TYPE = "solid"           # "solid" | "shell"
BALL_COLOR = (34, 78, 200)            # base RGB 0-255 (deep energy blue)
BALL_ACCENT_COLOR = (150, 238, 255)   # crackle RGB 0-255 (electric cyan)

# ---------------------------------------------------------------------------
# Lane geometry (metres)
# ---------------------------------------------------------------------------
LANE_LENGTH = 18.29                    # foul line -> head pin (60 ft)
LANE_WIDTH = 1.0668                    # 42 in
GUTTER_WIDTH = 0.238                   # per-side channel width
APPROACH_LENGTH = 4.57                 # 15 ft behind the foul line
PIN_DECK_LENGTH = 0.914                # 3 ft past the head pin
LANE_THICKNESS = 0.10                  # visual slab thickness
FOUL_LINE_Z = 0.0                      # lane origin sits at the foul line

TOTAL_WIDTH = LANE_WIDTH + 2 * GUTTER_WIDTH

# ---------------------------------------------------------------------------
# Pins (real dimensions)
#
# USBC specification pin: 15 in (0.381 m) tall, ~3.5 lb (1.53-1.64 kg),
# 4.766 in (0.121 m) belly diameter, 12 in (0.305 m) centre-to-centre at the
# rack (equilateral triangle). The geometry below is the specified value.
# ---------------------------------------------------------------------------
PIN_HEIGHT = 0.381                     # m (15 in)
PIN_MASS = 1.5                         # kg (USBC spec is 1.53-1.64 kg)
PIN_MAX_DIAMETER = 0.121               # m, widest point (belly)
PIN_MAX_RADIUS = PIN_MAX_DIAMETER / 2  # m
PIN_SPACING = 0.305                    # m, centre-to-centre (equilateral triangle)
PIN_ROWS = 4                           # triangle rack: 1 + 2 + 3 + 4 pins
PIN_COUNT = 10                         # pins in a full rack
HEAD_PIN_Z = LANE_LENGTH               # head pin is 18.29 m from the foul line (centre of pin deck)
PIN_DOWN_ANGLE = 65.0                  # degrees from vertical; past this a pin counts as down
# Below the belly radius (0.06 m) the contact point of a real pin widens to
# the belly; clamp so a collision never happens below the deck.
PIN_CONTACT_HEIGHT = 0.08              # m above the base, the belly centre
# The pin is a rigid rod with a single topple axis; these control how it falls
# and how it settles. All are approximations (see docs/PHYSICS.md).
PIN_FALL_ANGLE = 85.0                  # deg from vertical; beyond this the pin lies on the deck
PIN_PLANT_ANGLE = 1.2                  # rad (69 deg); beyond this the base leaves the deck
PIN_DECK_SLOP = 0.004                  # m; deck contact band for friction / settling
PIN_DECK_FRICTION = 0.12               # kinetic friction of a pin on the deck (approximate)
# A pin deck is closed by a steel kickback at each lane edge: a pin sliding
# into it is thrown back towards the rack, which is a large part of real pin
# carry. Approximate restitution (the plate is stiff, but the pin deforms).
PIN_KICKBACK_RESTITUTION = 0.45
PIN_SPIN_DAMPING = 0.8                 # 1/s, decay of spin about the pin's long axis
PIN_SPIN_STOP = 0.5                    # rad/s below which a fallen pin's spin has stopped
PIN_STOP_SPEED = 0.05                  # m/s below which a sliding pin is considered settled
PIN_MAX_TUMBLE_SPIN = 40.0             # rad/s guard on the topple rate (approximate)
PIN_PIN_CLEARANCE = 0.125              # m, effective pin/pin contact distance (approximate)

# ---------------------------------------------------------------------------
# Throw input
# ---------------------------------------------------------------------------
MIN_THROW_SPEED = 2.0                  # m/s, below this a release is ignored
MAX_THROW_SPEED = 12.0                 # m/s
# Maps forward drag speed (screen-heights/second) to m/s. Tune to taste: a
# normal, comfortable drag should land around 6-9 m/s.
THROW_SPEED_SCALE = 1.8
LATERAL_SPEED = 2.5                    # m/s, keyboard lateral movement
LATERAL_LIMIT = LANE_WIDTH / 2 - BALL_RADIUS   # keep the ball on the lane

# Aiming. The shot is aimed by sending the ball at a point beside the lane
# centre at the targeting arrows (4.572 m past the foul line, where the seven
# arrows sit), which is how a bowler actually lines a shot up. The pointer
# sweeps its full width across the lane to pick that point, so the player has
# fine control everywhere on the screen; the yaw the aim can ask for is capped
# because over the 18.29 m to the head pin a 2 deg error already moves the ball
# 0.64 m across the lane, wider than the lane is from its centre to the gutter.
AIM_ARROW_Z = 4.572                    # m down the lane the aim line crosses
MAX_AIM_ANGLE = 2.0                    # degrees of yaw either side of straight
MOUSE_AIM_RANGE = LANE_WIDTH / 2 - BALL_RADIUS   # m the aim sweeps either side

# Release behaviour (input/mouse_input.py, input/webcam_input.py).
# The drag's forward stroke sets the speed; the *direction* of that stroke adds
# a release-direction yaw on top of the frozen aim, and its sideways speed sets
# the hook spin. A release needs both a fast enough stroke and a long enough
# forward drag, so a twitch cannot launch the ball.
MIN_DRAG_DISTANCE = 0.04               # screen heights the forward stroke must cover
RELEASE_DIRECTION_GAIN = 0.6           # fraction of the drag angle that becomes yaw
MAX_RELEASE_YAW = 2.0                  # degrees of extra yaw from the release
MAX_LAUNCH_ANGLE = MAX_AIM_ANGLE + MAX_RELEASE_YAW   # deg, hard clamp on the yaw

# Bounded, seeded release noise standing in for the imperfection of a human
# release. It perturbs the *launch conditions* only (never the pin count), by a
# fraction of the ranges above, and it is 0.0 by default: variation comes from
# the player's own drag. A test can set a seed to make a noisy release
# reproducible (see input.mouse_input.ReleaseNoise).
RELEASE_NOISE_YAW = 0.0                # degrees, +/- on the launch angle
RELEASE_NOISE_SPEED = 0.0              # m/s, +/- on the release speed
RELEASE_NOISE_SPIN = 0.0               # rad/s, +/- on the hook spin
RELEASE_NOISE_SEED = None              # None = a per-session seed

# Pointer tracking. Panda3D can report "no pointer" (0, 0) when the window has
# not received pointer events - the pointer is then the centre of the screen and
# every click lands there, which is what made the menu buttons look dead. When
# that happens the operating-system cursor is used as a fallback (Windows only).
POINTER_OS_FALLBACK = True

# Hook spin ("axis rotation"): the spin component along the line of travel.
# It makes the ball slip sideways at release, and friction against that slip
# bends the path (see docs/PHYSICS.md). Calibrated against the simulation:
# ~1 rad/s of hook spin moves the ball about 0.2 m sideways over a full lane,
# ~5 rad/s about 0.5 m and puts a centre-line shot in the gutter.
MAX_SPIN = 5.0                         # rad/s clamp on the release hook spin
SPIN_SCALE = 3.4                       # maps lateral drag speed (1/s) -> rad/s
SPIN_SIGN = -1.0                       # +drag speed -> hook to that side (see mouse_input)


# ---------------------------------------------------------------------------
# Camera
#
# Rig values are tuned so that at CAMERA_FOV and 16:9 the pins sit in the
# upper third, the ball in the lower third and the lane fills the frame - the
# one-point perspective of the reference art. CAMERA_LOOK_HEIGHT is the height
# of the point 12 m down the lane that the ready camera aims at, which is what
# fixes the pitch.
# ---------------------------------------------------------------------------
CAMERA_FOV = 60                       # horizontal fov (Ursina's camera.fov is horizontal)
CAMERA_HEIGHT = 1.65                  # m above the lane at the foul line
CAMERA_BEHIND = 4.60                  # m behind the foul line
CAMERA_LOOK_AHEAD = 12.0              # m down the lane the ready camera aims at
CAMERA_LOOK_HEIGHT = -0.80            # m; together with the height, ~11.6 deg down
CAMERA_DOLLY = 0.25                   # fraction of the ball's travel the camera follows
CAMERA_DOLLY_HEIGHT = 0.03            # m risen per metre the ball travels
CAMERA_LOOK_SIDE = 0.20               # fraction of the ball's lateral offset the camera aims along
CAMERA_FOLLOW_SPEED = 6.0             # lerp smoothing while rolling (1/s)
CAMERA_DECK_SPEED = 7.5               # lerp smoothing when pushing in on the deck (1/s)
CAMERA_DECK_HEIGHT = 2.05             # m above the lane for the pin-deck view
CAMERA_DECK_DISTANCE = 6.6            # m in front of the head pin
CAMERA_DECK_LOOK_HEIGHT = 0.28        # m the deck view aims at
PIN_CAMERA_TRIGGER_Z = 16.5           # when the ball passes this, push in on the pins

# ---------------------------------------------------------------------------
# Game flow
# ---------------------------------------------------------------------------
# The deck is stepped (pins only) after the ball stops until every pin has
# come to rest, so a pin that is still toppling is counted from its final
# pose instead of being frozen and re-stood. SETTLE_DELAY is the minimum the
# count waits; SETTLE_MAX_TIME is the cap on the pin-only simulation.
SETTLE_DELAY = 1.5                     # seconds before a roll is counted
SETTLE_MAX_TIME = 3.0                  # seconds of pin-only settling before counting anyway
RESULT_DELAY = 1.8                     # seconds to show the knockdown result before reset

# ---------------------------------------------------------------------------
# Webcam tracking (milestone 4 foundation)
#
# These constants are shared by the standalone tracking package. The game
# itself never imports tracking, so changing them cannot affect gameplay.
# ---------------------------------------------------------------------------
TRACKING_CAMERA_INDEX = 0              # default webcam device index
TRACKING_CAMERA_WIDTH = 640            # requested capture resolution
TRACKING_CAMERA_HEIGHT = 480
TRACKING_VISIBILITY_THRESHOLD = 0.5    # per-joint visibility to count as "seen"
TRACKING_CONFIDENCE_THRESHOLD = 0.5    # mean visibility of the 10 key joints
TRACKING_MIN_KEY_LANDMARKS = 6         # of 10 key joints required to be visible
TRACKING_MAX_READ_FAILURES = 30        # consecutive dropped frames before giving up
TRACKING_MIN_DETECTION_CONFIDENCE = 0.5
TRACKING_MIN_PRESENCE_CONFIDENCE = 0.5
TRACKING_MIN_TRACKING_CONFIDENCE = 0.5
TRACKING_MODEL_FILENAME = "pose_landmarker_lite.task"
TRACKING_MODEL_URL = (
    "https://storage.googleapis.com/mediapipe-models/pose_landmarker/"
    "pose_landmarker_lite/float16/latest/pose_landmarker_lite.task"
)
TRACKING_MODEL_DOWNLOAD_TIMEOUT = 60   # seconds, first-run model download

# ---------------------------------------------------------------------------
# Webcam input integration (milestone 5)
# ---------------------------------------------------------------------------
WEBCAM_MIRROR = True                   # show/aim the feed as a mirror (selfie view)
WEBCAM_PANEL_WIDTH = 0.30              # in-game feed panel width (UI units)
WEBCAM_PANEL_MARGIN = 0.03             # gap from the window corner
WEBCAM_PANEL_BOTTOM = 0.095            # gap from the bottom edge (clears the HUD bar)
WEBCAM_PANEL_FEED_WIDTH = 320          # px the feed is resized to for display
WEBCAM_LATERAL_SMOOTHING = 0.25        # per-frame smoothing of the aimed lateral position
WEBCAM_AIM_SCALE = 1.0                 # body offset from centre -> lateral position scale

# ---------------------------------------------------------------------------
# Swing recognition (milestone 5; arm-relative release detection)
#
# Speed thresholds are in normalized image units per second ("image heights /
# s"); y grows downward in image space, so a backswing has positive hand
# velocity and a forward swing has negative hand velocity. Motion is measured
# relative to the shoulders, so leaning, stepping or drifting across the
# camera does not read as an arm swing. Displacements (depth, rise, the
# release plane and the ready band) are fractions of the player's own torso
# height, which keeps the thresholds usable at different camera distances and
# player sizes. These are starting heuristics, not calibrated measurements -
# tune them here.
# ---------------------------------------------------------------------------
SWING_VELOCITY_SMOOTHING = 0.45        # EMA weight of the newest velocity sample
SWING_LANDMARK_SMOOTHING = 0.5         # EMA weight of the newest hand-position sample
SWING_WRIST_VISIBILITY = 0.3           # min wrist/hand visibility for swing logic
SWING_MIN_CONFIDENCE = 0.5             # frames below this mean confidence are ignored
SWING_MAX_JUMP = 0.35                  # image units; larger one-frame hand/elbow jumps are rejected
SWING_MAX_SPEED = 9.0                  # image heights/s; faster samples are tracking glitches
SWING_MAX_TORSO_JUMP = 0.20            # image units; larger one-frame torso jumps are rejected
SWING_MAX_FRAME_GAP = 0.4              # s; longer camera gaps suspend recognition
SWING_LOST_GRACE_FRAMES = 12           # unreliable frames before aborting/suspending
SWING_READY_HOLD = 0.25                # s the ready pose must be held
SWING_READY_GRACE_TIME = 0.40          # s a ready pose may wobble before resetting
SWING_READY_MAX_SPEED = 0.55           # max hand speed while in the ready pose
SWING_READY_BELOW_SHOULDER = 0.35      # ready: visible hand below shoulder + this * torso
SWING_BACK_DOWN_SPEED = 0.30           # downward hand speed that starts a backswing
SWING_BACK_MIN_DEPTH = 0.04            # backswing depth required (torso heights)
SWING_BACK_MIN_TIME = 0.05             # s the backswing must last
SWING_BACK_TIMEOUT = 1.8               # s without a forward swing -> abort
SWING_FORWARD_UP_SPEED = 0.30          # smoothed upward speed that counts as "swinging"
SWING_DIRECT_THROW_SPEED = 0.50        # upward speed that starts a forward swing from ready
SWING_FORWARD_MIN_TIME = 0.05          # s before a release can be registered
SWING_FORWARD_TIMEOUT = 1.2            # s without a release -> abort
SWING_RELEASE_UP_SPEED = 0.40          # raw upward speed for a plane-crossing release
SWING_RELEASE_FRACTION = 0.25          # release plane below the shoulders (torso fraction)
SWING_RELEASE_MIN_RISE = 0.10          # hand must rise this far (torso heights) for a release
SWING_RELEASE_MIN_FRAMES = 3           # frames with real upward motion before a release
SWING_RELEASE_MIN_SPEED = 0.60         # peak upward speed required for a release (1/s)
SWING_FOLLOW_TIME = 0.6                # s after release before waiting for ready again
SWING_SPEED_SCALE = 4.5                # detected up speed (1/s) -> ball speed (m/s)
SWING_SPIN_SCALE = 1.4                 # lateral hand speed (1/s) -> hook spin (rad/s)
SWING_RELEASE_DIR_SCALE = 12.0         # lateral hand speed (1/s) -> release yaw (deg)
SWING_AIM_SCALE = 1.2                  # lateral hand offset (torso heights) -> aim yaw (deg)
SWING_NOTICE_TIME = 2.5                # s an abort/notice message stays visible
SWING_MIN_TORSO_HEIGHT = 0.05          # sanity floor for shoulder->hip distance
SWING_PREFERRED_ARM = 'auto'           # 'auto' | 'left' | 'right' (C key cycles at runtime)
SWING_LOG_ENABLED = True               # write swing events to webcam_swing.log
SWING_LOG_FILENAME = 'webcam_swing.log'
SWING_LOG_VERBOSE = False              # per-frame telemetry in the swing log (testing aid)
SWING_LOG_EVERY_FRAMES = 15            # processed frames between verbose telemetry lines
WEBCAM_SHOW_TELEMETRY = True           # small live detector readout in webcam mode

# ---------------------------------------------------------------------------
# Temporal swing classifier (input/classifier.py; mirrored in src/config.js)
# ---------------------------------------------------------------------------
# The legacy phase machine above is a sensitive *motion* sensor: it recognizes
# movement, not intent, and the recorded jumping-jacks trace releases through
# it in both builds. input/classifier.py is the shipping decision layer and
# recognizes the whole movement sequence:
#   tracking -> ready -> backswing -> forward -> release -> follow-through ->
#   re-arm
# Distances are torso heights and speeds are torso heights per second, so
# camera distance and player size cancel; elapsed time comes from the measured
# camera frame interval. Values were tuned against labeled synthetic positives
# and negatives plus the recorded real-human jumping-jacks and waving traces;
# see docs/WEBCAM_SWING.md and tools/webcam_eval.py.
CLASSIFIER_PREFERRED_ARM = 'auto'      # 'auto' | 'left' | 'right'
CLASSIFIER_NOTICE_TIME = 2.5           # s a rejection/notice stays in the HUD
CLASSIFIER_MAX_FRAME_GAP = 0.35        # s; longer camera gaps are untrusted
CLASSIFIER_HISTORY_TIME = 1.2          # s of per-frame history kept for diagnostics
CLASSIFIER_POSITION_SMOOTHING = 0.55   # EMA weight of the newest hand sample
CLASSIFIER_VELOCITY_SMOOTHING = 0.45   # EMA weight of the newest velocity sample
CLASSIFIER_MIN_CONFIDENCE = 0.5        # pose confidence floor
CLASSIFIER_TORSO_VISIBILITY = 0.3      # min visibility for torso/elbow joints
CLASSIFIER_WRIST_VISIBILITY = 0.3      # min visibility for the wrist/hand sample
CLASSIFIER_MIN_TORSO_HEIGHT = 0.06     # sanity floor for shoulder->hip distance
CLASSIFIER_MIN_SHOULDER_WIDTH = 0.05   # image units; shoulder-width fallback floor
CLASSIFIER_SHOULDER_TORSO_RATIO = 1.30  # torso height ≈ 1.3 × shoulder width (scale fallback)
CLASSIFIER_TORSO_REF_HOLD = 2.0        # s a last-good torso height may be reused when hips drop out
CLASSIFIER_MAX_TORSO_JUMP = 0.18       # image units; larger one-frame body jumps are untrusted
CLASSIFIER_MAX_HAND_JUMP = 1.30        # torso units; larger one-frame hand jumps are glitches
CLASSIFIER_MAX_HAND_SPEED = 30.0       # torso units/s; faster samples are glitches
CLASSIFIER_MAX_INVALID_RUN = 5         # untrusted frames before a stroke aborts
CLASSIFIER_STROKE_MAX_INVALID_RUN = 5  # untrusted frames mid-stroke before it aborts
CLASSIFIER_STROKE_MAX_JUMPS = 1        # hand-jump resyncs per stroke before it aborts
CLASSIFIER_TRACK_MIN_FRAMES = 4        # valid frames needed before the ready pose counts
CLASSIFIER_READY_HOLD = 0.25           # s the ready pose must be held to arm
CLASSIFIER_READY_GRACE = 1.00          # s the ready pose may wobble before disarming
CLASSIFIER_READY_HAND_BELOW = -0.20    # ready: hands at least this far below the shoulders
CLASSIFIER_READY_MAX_HAND_SPEED = 0.85  # torso units/s; above this the pose is not "still"
CLASSIFIER_READY_MAX_BODY_SPEED = 0.45  # torso units/s; body stillness for the ready pose
CLASSIFIER_BACK_START_SPEED = 0.25     # torso units/s downward that starts a backswing
CLASSIFIER_BACK_BAND_MARGIN = 0.25     # torso units the hand may sit above the ready band
CLASSIFIER_SYMMETRY_START_RATIO = 0.80  # two-arm descent this similar never starts a stroke
CLASSIFIER_SYMMETRY_FRAMES = 3         # symmetric frames before the player is told
CLASSIFIER_ELBOW_SPEED_SCALE = 0.65    # elbow speed as a fraction of hand speed (occlusion)
CLASSIFIER_BACK_MIN_DEPTH = 0.05       # torso heights the hand must travel down/back
CLASSIFIER_BACK_SETTLE_TIME = 0.20     # s the hand must have been low before a wind-up counts
CLASSIFIER_ELBOW_BAND_MARGIN = 0.55    # torso units; elbow "low" band for occluded starts
CLASSIFIER_BACK_MIN_TIME = 0.04        # s the backswing must last
CLASSIFIER_BACK_REVERSAL_SPEED = 0.25  # torso units/s upward that ends the backswing
CLASSIFIER_BACK_TIMEOUT = 1.20         # s without a forward swing -> abort
CLASSIFIER_FORWARD_UP_SPEED = 0.30     # torso units/s that counts as a rising frame
CLASSIFIER_FORWARD_MIN_TIME = 0.06     # s before a release can be registered
CLASSIFIER_FORWARD_MIN_RISING_RUN = 3  # consecutive rising frames a delivery needs
CLASSIFIER_FORWARD_MIN_RISE = 0.45     # torso heights the hand must rise above its low point
CLASSIFIER_FORWARD_MIN_PEAK = 0.90     # torso units/s; peak upward hand speed
CLASSIFIER_RELEASE_HAND_HEIGHT = -0.15  # torso heights; the "crossed" release height
CLASSIFIER_RELEASE_UP_SPEED = 0.35     # torso units/s; speed required when crossing
CLASSIFIER_DIRECT_START_SPEED = 0.30   # torso units/s upward that starts a direct delivery
CLASSIFIER_DIRECT_MIN_RISE = 0.55      # torso heights a no-wind-up delivery must rise
CLASSIFIER_DIRECT_MIN_PEAK = 1.10      # torso units/s; peak speed a no-wind-up delivery needs
CLASSIFIER_DOMINANCE_RATIO = 0.60      # other-arm motion allowed relative to the throwing arm
CLASSIFIER_DOMINANCE_MAX_RATIO = 1.20  # absolute reject when the other arm dominates
CLASSIFIER_OTHER_ARM_ABS = 0.60        # torso units/s; below this the other arm is "quiet"
CLASSIFIER_MAX_BODY_LIFT = 0.60        # torso heights the shoulder may travel mid-stroke
CLASSIFIER_MAX_TORSO_CHANGE = 0.50     # relative torso-size change allowed mid-stroke
CLASSIFIER_MAX_TORSO_TURN = 45.0       # degrees the shoulder line may rotate mid-stroke
CLASSIFIER_MAX_REVERSALS = 3           # direction changes allowed in the forward stroke
CLASSIFIER_HAND_LOSS_GRACE = 0.35      # s the throwing hand may vanish before aborting
CLASSIFIER_FORWARD_TIMEOUT = 1.10      # s without a release -> abort
CLASSIFIER_RELEASE_FLASH = 0.12        # s the release state is shown before follow-through
CLASSIFIER_FOLLOW_TIME = 0.45          # s of follow-through before re-arming

MESSAGE_DURATION = 4.0                 # s transient in-game messages stay visible

# Player names in the local modes are typed on one line, so they are capped.
MAX_NAME_LENGTH = 12

# ---------------------------------------------------------------------------
# Generated colours (RGB 0-255)
#
# IMPORTANT: Ursina 8.3.0's color.rgb() expects 0-1 FLOATS. These tuples are
# 0-255, so they MUST be passed through color.rgb32() (which divides by 255).
#
# Palette follows the art: a warm neon-lit lane between near-black gutters,
# a hot-pink neon rail and cyan tubes, flat indigo/violet buildings with lit
# windows, and a deep navy night sky.
# ---------------------------------------------------------------------------
FLOOR_COLOR = (24, 22, 62)            # dark indigo ground around the lane
APPROACH_COLOR = (172, 116, 68)       # warm wood approach
LANE_COLOR = (204, 144, 86)           # bright maple lane
LANE_PLANK_DARK = (126, 76, 36)       # plank seams / grain
GUTTER_COLOR = (14, 12, 34)           # near-black channel
GUTTER_LIP_COLOR = (255, 62, 138)     # hot-pink neon lane edge
PIN_DECK_COLOR = (208, 150, 90)       # deck wood (same family as the lane)
FOUL_LINE_COLOR = (255, 62, 138)      # pink foul line
PIN_COLOR = (245, 245, 248)           # pin body (white)
PIN_STRIPE_COLOR = (200, 40, 40)      # pin neck stripe (red)

# Environment and lighting
WALL_COLOR = (22, 20, 56)             # building faces (flat indigo)
WALL_LOWER_COLOR = (34, 30, 82)       # lower storey (violet)
WALL_TRIM_COLOR = (255, 84, 130)      # hot-pink neon trim
POSTER_COLOR = (44, 48, 128)          # blue display panels
BACKDROP_COLOR = (14, 12, 36)         # dark band behind the pin deck
BACKDROP_GLOW_COLOR = (255, 60, 130)  # pink glow above the pins
CEILING_COLOR = (18, 16, 34)          # (kept for compatibility; open sky now)
KEY_LIGHT_COLOR = (255, 240, 214)     # warm key light
FILL_LIGHT_COLOR = (150, 158, 200)    # cool fill light
# Surface shading (see scene/shaders.py): one warm key direction plus a cool
# fill, evaluated per pixel from the world normal.
SHADE_FLOOR = 0.52                    # brightness of a surface facing away from the key
SHADE_GAIN = 0.60                     # extra brightness at full key incidence

