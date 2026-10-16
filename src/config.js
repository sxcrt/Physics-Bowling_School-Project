// Central place for every game constant. SI units unless stated otherwise.
// Ported 1:1 from config.py (nothing here imports the engine).

export const WINDOW_TITLE = "Hells Balls";
export const WINDOW_SIZE = [1280, 720];
export const WINDOW_BACKGROUND = [12, 14, 44];      // RGB 0-255 deep night-sky clear colour

// --- Physics: gravity and material coefficients ---
export const GRAVITY = 9.81;                       // m/s^2 standard gravity
export const ROLLING_FRICTION = 0.02;              // rolling-resistance coefficient
export const SLIDING_FRICTION = 0.12;              // kinetic friction while skidding
export const GUTTER_FRICTION = 0.15;               // kinetic friction in the gutter
export const RESTITUTION_BALL_PIN = 0.6;           // coefficient of restitution ball -> pin
export const RESTITUTION_PIN_PIN = 0.5;            // coefficient of restitution pin -> pin

// --- Ball dynamics ---
export const BALL_STOP_SPEED = 0.25;               // m/s below this a ball is stopped
export const SLIP_TOLERANCE = 0.01;                // m/s slip below this counts as rolling
export const PHYSICS_SUBSTEP = 1.0 / 240.0;        // collision sub-step
export const PHYSICS_MAX_SUBSTEPS = 12;            // sub-steps per rendered frame

// --- Ball ---
export const BALL_DIAMETER = 0.218;                // m (8.5 in)
export const BALL_RADIUS = BALL_DIAMETER / 2;      // m
export const BALL_MASS = 6.0;                      // kg
export const BALL_INERTIA_TYPE = "solid";          // "solid" | "shell"
export const BALL_COLOR = [34, 78, 200];
export const BALL_ACCENT_COLOR = [150, 238, 255];

// --- Lane geometry (metres) ---
export const LANE_LENGTH = 18.29;                  // foul line -> head pin (60 ft)
export const LANE_WIDTH = 1.0668;                  // 42 in
export const GUTTER_WIDTH = 0.238;                 // per-side channel width
export const APPROACH_LENGTH = 4.57;               // 15 ft behind the foul line
export const PIN_DECK_LENGTH = 0.914;              // 3 ft past the head pin
export const LANE_THICKNESS = 0.10;                // visual slab thickness
export const FOUL_LINE_Z = 0.0;                    // lane origin sits at the foul line
export const TOTAL_WIDTH = LANE_WIDTH + 2 * GUTTER_WIDTH;

// --- Pins (real dimensions) ---
export const PIN_HEIGHT = 0.381;                   // m (15 in)
export const PIN_MASS = 1.5;                       // kg
export const PIN_MAX_DIAMETER = 0.121;             // m widest point (belly)
export const PIN_MAX_RADIUS = PIN_MAX_DIAMETER / 2;
export const PIN_SPACING = 0.305;                  // m centre-to-centre
export const PIN_ROWS = 4;
export const PIN_COUNT = 10;
export const HEAD_PIN_Z = LANE_LENGTH;             // head pin 18.29 m from foul line
export const PIN_DOWN_ANGLE = 65.0;                // deg from vertical; past this a pin is down
export const PIN_CONTACT_HEIGHT = 0.08;            // m above the base, the belly centre
export const PIN_FALL_ANGLE = 85.0;                // deg from vertical; beyond this lies on deck
export const PIN_PLANT_ANGLE = 1.2;                // rad (69 deg); beyond this the base leaves the deck
export const PIN_DECK_SLOP = 0.004;                // m deck contact band
export const PIN_DECK_FRICTION = 0.12;             // kinetic friction pin on deck
export const PIN_KICKBACK_RESTITUTION = 0.45;
export const PIN_SPIN_DAMPING = 0.8;               // 1/s
export const PIN_SPIN_STOP = 0.5;                  // rad/s
export const PIN_STOP_SPEED = 0.05;                // m/s
export const PIN_MAX_TUMBLE_SPIN = 40.0;           // rad/s guard
export const PIN_PIN_CLEARANCE = 0.125;            // m effective pin/pin contact distance

// --- Throw input ---
export const MIN_THROW_SPEED = 2.0;                // m/s
export const MAX_THROW_SPEED = 12.0;               // m/s
export const THROW_SPEED_SCALE = 1.8;
export const LATERAL_SPEED = 2.5;                  // m/s keyboard lateral movement
export const LATERAL_LIMIT = LANE_WIDTH / 2 - BALL_RADIUS;   // keep the ball on the lane

// Aiming.
export const AIM_ARROW_Z = 4.572;                  // m down the lane the aim line crosses
export const MAX_AIM_ANGLE = 2.0;                  // degrees of yaw either side of straight
export const MOUSE_AIM_RANGE = LANE_WIDTH / 2 - BALL_RADIUS;   // m the aim sweeps either side

// Release behaviour.
export const MIN_DRAG_DISTANCE = 0.04;             // screen heights the forward stroke must cover
export const RELEASE_DIRECTION_GAIN = 0.6;
export const MAX_RELEASE_YAW = 2.0;                // degrees
export const MAX_LAUNCH_ANGLE = MAX_AIM_ANGLE + MAX_RELEASE_YAW;   // deg hard clamp

// Bounded, seeded release noise (off by default).
export const RELEASE_NOISE_YAW = 0.0;
export const RELEASE_NOISE_SPEED = 0.0;
export const RELEASE_NOISE_SPIN = 0.0;
export const RELEASE_NOISE_SEED = null;

// Pointer tracking fallback (kept for parity; browser mouse is always reliable).
export const POINTER_OS_FALLBACK = true;

// Hook spin.
export const MAX_SPIN = 5.0;                       // rad/s clamp
export const SPIN_SCALE = 3.4;
export const SPIN_SIGN = -1.0;

// --- Camera ---
export const CAMERA_FOV = 60;                      // horizontal fov
export const CAMERA_HEIGHT = 1.65;                 // m
export const CAMERA_BEHIND = 4.60;                 // m
export const CAMERA_LOOK_AHEAD = 12.0;             // m
export const CAMERA_LOOK_HEIGHT = -0.80;           // m
export const CAMERA_DOLLY = 0.25;
export const CAMERA_DOLLY_HEIGHT = 0.03;
export const CAMERA_LOOK_SIDE = 0.20;
export const CAMERA_FOLLOW_SPEED = 6.0;
export const CAMERA_DECK_SPEED = 7.5;
export const CAMERA_DECK_HEIGHT = 2.05;
export const CAMERA_DECK_DISTANCE = 6.6;
export const CAMERA_DECK_LOOK_HEIGHT = 0.28;
export const PIN_CAMERA_TRIGGER_Z = 16.5;

// --- Game flow ---
export const SETTLE_DELAY = 1.5;                   // seconds before a roll is counted
export const SETTLE_MAX_TIME = 3.0;                // seconds of pin-only settling cap
export const RESULT_DELAY = 1.8;                   // seconds to show result before reset

// --- Webcam tracking ---
export const TRACKING_CAMERA_INDEX = 0;
export const TRACKING_CAMERA_WIDTH = 640;
export const TRACKING_CAMERA_HEIGHT = 480;
export const TRACKING_VISIBILITY_THRESHOLD = 0.5;
export const TRACKING_CONFIDENCE_THRESHOLD = 0.5;
export const TRACKING_MIN_KEY_LANDMARKS = 6;
export const TRACKING_MAX_READ_FAILURES = 30;
export const TRACKING_MIN_DETECTION_CONFIDENCE = 0.5;
export const TRACKING_MIN_PRESENCE_CONFIDENCE = 0.5;
export const TRACKING_MIN_TRACKING_CONFIDENCE = 0.5;
export const TRACKING_MODEL_FILENAME = "pose_landmarker_lite.task";
export const TRACKING_MEDIAPIPE_CDN = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";
// Browser-only watchdogs. The Python service counts failed frame reads
// (TRACKING_MAX_READ_FAILURES); a browser camera instead either opens and
// never delivers frames or stops delivering them mid-session, so the webcam
// service reports those as explicit errors after these grace periods.
export const TRACKING_FRAME_TIMEOUT = 10.0;        // s to wait for the first camera frame
export const TRACKING_STALL_TIMEOUT = 5.0;         // s without a new frame before reporting a stall
export const TRACKING_ENGINE_TIMEOUT = 30.0;       // s to load the pose engine (worker or CDN)
// Pose inference runs in a module worker so it can never stall the render
// loop (the browser counterpart of tracking/service.py's worker thread); set
// false to force the main-thread engine. The service falls back automatically
// when workers are unavailable or the worker engine fails to start.
export const TRACKING_USE_WORKER = true;

// --- Webcam input integration ---
export const WEBCAM_MIRROR = true;
export const WEBCAM_PANEL_WIDTH = 0.30;
export const WEBCAM_PANEL_MARGIN = 0.03;
export const WEBCAM_PANEL_BOTTOM = 0.095;
export const WEBCAM_PANEL_FEED_WIDTH = 320;
export const WEBCAM_LATERAL_SMOOTHING = 0.25;
export const WEBCAM_AIM_SCALE = 1.0;

// --- Swing recognition ---
export const SWING_VELOCITY_SMOOTHING = 0.45;
export const SWING_LANDMARK_SMOOTHING = 0.5;
export const SWING_WRIST_VISIBILITY = 0.3;
export const SWING_MIN_CONFIDENCE = 0.5;
export const SWING_MAX_JUMP = 0.35;
export const SWING_MAX_SPEED = 9.0;
export const SWING_MAX_TORSO_JUMP = 0.20;
export const SWING_MAX_FRAME_GAP = 0.4;
export const SWING_LOST_GRACE_FRAMES = 12;
export const SWING_READY_HOLD = 0.25;
export const SWING_READY_GRACE_TIME = 0.40;
export const SWING_READY_MAX_SPEED = 0.55;
export const SWING_READY_BELOW_SHOULDER = 0.35;
export const SWING_BACK_DOWN_SPEED = 0.30;
export const SWING_BACK_MIN_DEPTH = 0.04;
export const SWING_BACK_MIN_TIME = 0.05;
export const SWING_BACK_TIMEOUT = 1.8;
export const SWING_FORWARD_UP_SPEED = 0.30;
export const SWING_DIRECT_THROW_SPEED = 0.50;
export const SWING_FORWARD_MIN_TIME = 0.05;
export const SWING_FORWARD_TIMEOUT = 1.2;
export const SWING_RELEASE_UP_SPEED = 0.40;
export const SWING_RELEASE_FRACTION = 0.25;
export const SWING_RELEASE_MIN_RISE = 0.10;
export const SWING_RELEASE_MIN_FRAMES = 3;
export const SWING_RELEASE_MIN_SPEED = 0.60;
export const SWING_FOLLOW_TIME = 0.6;
export const SWING_SPEED_SCALE = 4.5;
export const SWING_SPIN_SCALE = 1.4;
export const SWING_RELEASE_DIR_SCALE = 12.0;
export const SWING_AIM_SCALE = 1.2;
export const SWING_NOTICE_TIME = 2.5;
export const SWING_MIN_TORSO_HEIGHT = 0.05;
export const SWING_PREFERRED_ARM = 'auto';
export const SWING_LOG_ENABLED = false;            // no filesystem in the browser
export const SWING_LOG_VERBOSE = false;
export const SWING_LOG_EVERY_FRAMES = 15;
export const WEBCAM_SHOW_TELEMETRY = false;        // player HUD shows status + phase, not detector telemetry

// --- Deliberate-swing validation (browser) ---
// DEPRECATED by the temporal classifier (src/input/classifier.js). The old
// phase machine in src/input/swing.js is now only the low-level motion sensor
// and the Python parity reference; the classifier owns the release decision.
// These constants remain so the legacy parity tooling and its tests can still
// be run, but the shipping input no longer uses them.
export const SWING_VALIDATE_ENABLED = true;
export const SWING_VALIDATE_WINDOW = 0.9;          // s of motion history examined per release
export const SWING_VALIDATE_CRITICAL_TIME = 0.35;  // s before the release that must be fully valid
export const SWING_VALIDATE_MIN_CRITICAL_FRAMES = 5;
export const SWING_VALIDATE_MIN_VALID_RATIO = 0.8; // valid frames required in the window
export const SWING_VALIDATE_MAX_INVALID_RUN = 1;   // consecutive unreliable frames allowed in the window
export const SWING_VALIDATE_UP_SPEED = 0.30;       // 1/s; a frame counts as "rising" above this
export const SWING_VALIDATE_MIN_UP_FRAMES = 3;     // sustained upward frames the stroke needs
export const SWING_VALIDATE_RECENT_UP_TIME = 0.25; // s; the last rising frame must be this recent
export const SWING_VALIDATE_MIN_PEAK = 0.75;       // 1/s; throwing hand peak upward speed
export const SWING_VALIDATE_MIN_RISE = 0.35;       // torso heights the hand must rise
export const SWING_VALIDATE_MIN_BACKSWING = 0.15;  // torso heights of downward travel before the rise
export const SWING_VALIDATE_DIRECT_PEAK = 1.8;     // 1/s; direct strokes need this when no backswing was seen
export const SWING_VALIDATE_DIRECT_RISE = 1.0;     // torso heights; ...and this much rise
export const SWING_VALIDATE_DOMINANCE = 1.7;       // throwing arm must dominate the other arm's upward motion
export const SWING_VALIDATE_OTHER_UP_ABS = 0.45;   // 1/s; absolute cap on the other arm's upward speed
export const SWING_VALIDATE_OTHER_RISE_ABS = 0.35; // torso heights; absolute cap on the other arm's rise
export const SWING_VALIDATE_MAX_STALE_FRAMES = 3;  // repeated camera frames before the swing state is reset
export const SWING_VALIDATE_LOG_BLOCKED = true;    // console.debug one line per blocked release (dev aid)

// --- Temporal swing classifier (browser decision layer, ported to
// input/classifier.py) ---
// src/input/classifier.js recognizes the *sequence* of a bowling action:
// tracking -> ready -> backswing -> forward -> release -> follow-through ->
// re-arm. All distances are torso heights and all speeds torso heights per
// second, so camera distance and player size cancel; elapsed time comes from
// the measured camera frame interval. The values below were tuned against the
// labeled evaluation set in tools/webcam_eval.mjs (synthetic positives and
// negatives plus the recorded real-human jumping-jacks and waving traces);
// see docs/WEBCAM_SWING.md for the measured trade-off.
export const CLASSIFIER_PREFERRED_ARM = 'auto';      // 'auto' | 'left' | 'right'
export const CLASSIFIER_NOTICE_TIME = 2.5;           // s a rejection/notice stays in the HUD
export const CLASSIFIER_MAX_FRAME_GAP = 0.35;        // s; longer camera gaps are untrusted
export const CLASSIFIER_HISTORY_TIME = 1.2;          // s of per-frame history kept for diagnostics
export const CLASSIFIER_POSITION_SMOOTHING = 0.55;   // EMA weight of the newest hand sample
export const CLASSIFIER_VELOCITY_SMOOTHING = 0.45;   // EMA weight of the newest velocity sample
export const CLASSIFIER_MIN_CONFIDENCE = 0.5;        // pose confidence floor
export const CLASSIFIER_TORSO_VISIBILITY = 0.3;      // min visibility for torso/elbow joints
export const CLASSIFIER_WRIST_VISIBILITY = 0.3;      // min visibility for the wrist/hand sample
export const CLASSIFIER_MIN_TORSO_HEIGHT = 0.06;     // sanity floor for shoulder->hip distance
export const CLASSIFIER_MAX_TORSO_JUMP = 0.18;       // image units; larger one-frame body jumps are untrusted
export const CLASSIFIER_MAX_HAND_JUMP = 1.30;        // torso units; larger one-frame hand jumps are glitches
export const CLASSIFIER_MAX_HAND_SPEED = 30.0;       // torso units/s; faster samples are glitches
export const CLASSIFIER_MAX_INVALID_RUN = 5;         // untrusted frames before a stroke aborts
export const CLASSIFIER_STROKE_MAX_INVALID_RUN = 2;  // untrusted frames mid-stroke before it aborts
export const CLASSIFIER_TRACK_MIN_FRAMES = 4;        // valid frames needed before the ready pose counts
export const CLASSIFIER_READY_HOLD = 0.30;           // s the ready pose must be held to arm
export const CLASSIFIER_READY_GRACE = 0.60;          // s the ready pose may wobble before disarming
export const CLASSIFIER_READY_HAND_BELOW = -0.25;    // ready: hands at least this far below the shoulders
export const CLASSIFIER_READY_MAX_HAND_SPEED = 0.60; // torso units/s; above this the pose is not "still"
export const CLASSIFIER_READY_MAX_BODY_SPEED = 0.35; // torso units/s; body stillness for the ready pose
export const CLASSIFIER_BACK_START_SPEED = 0.40;     // torso units/s downward that starts a backswing
export const CLASSIFIER_BACK_BAND_MARGIN = 0.20;     // torso units the hand may sit above the ready band
export const CLASSIFIER_SYMMETRY_START_RATIO = 0.80; // two-arm descent this similar never starts a stroke
export const CLASSIFIER_SYMMETRY_FRAMES = 3;         // symmetric frames before the player is told
export const CLASSIFIER_ELBOW_SPEED_SCALE = 0.65;    // elbow speed as a fraction of hand speed (occlusion)
export const CLASSIFIER_BACK_MIN_DEPTH = 0.10;       // torso heights the hand must travel down/back
export const CLASSIFIER_BACK_SETTLE_TIME = 0.35;     // s the hand must have been low before a wind-up counts
export const CLASSIFIER_ELBOW_BAND_MARGIN = 0.55;    // torso units; elbow "low" band for occluded starts
export const CLASSIFIER_BACK_MIN_TIME = 0.06;        // s the backswing must last
export const CLASSIFIER_BACK_REVERSAL_SPEED = 0.35;  // torso units/s upward that ends the backswing
export const CLASSIFIER_BACK_TIMEOUT = 1.50;         // s without a forward swing -> abort
export const CLASSIFIER_FORWARD_UP_SPEED = 0.35;     // torso units/s that counts as a rising frame
export const CLASSIFIER_FORWARD_MIN_TIME = 0.08;     // s before a release can be registered
export const CLASSIFIER_FORWARD_MIN_RISING_RUN = 3;  // consecutive rising frames a delivery needs
export const CLASSIFIER_FORWARD_MIN_RISE = 0.50;     // torso heights the hand must rise above its low point
export const CLASSIFIER_FORWARD_MIN_PEAK = 1.00;     // torso units/s; peak upward hand speed
export const CLASSIFIER_RELEASE_HAND_HEIGHT = -0.10; // torso heights; the "crossed" release height
export const CLASSIFIER_RELEASE_UP_SPEED = 0.40;     // torso units/s; speed required when crossing
export const CLASSIFIER_DOMINANCE_RATIO = 0.60;      // other-arm motion allowed relative to the throwing arm
export const CLASSIFIER_DOMINANCE_MAX_RATIO = 1.20;  // absolute reject when the other arm dominates
export const CLASSIFIER_OTHER_ARM_ABS = 0.60;        // torso units/s; below this the other arm is "quiet"
export const CLASSIFIER_MAX_BODY_LIFT = 0.60;        // torso heights the shoulder may travel mid-stroke
export const CLASSIFIER_MAX_TORSO_CHANGE = 0.50;     // relative torso-size change allowed mid-stroke
export const CLASSIFIER_MAX_TORSO_TURN = 45.0;       // degrees the shoulder line may rotate mid-stroke
export const CLASSIFIER_MAX_REVERSALS = 3;           // direction changes allowed in the forward stroke
export const CLASSIFIER_HAND_LOSS_GRACE = 0.25;      // s the throwing hand may vanish before aborting
export const CLASSIFIER_FORWARD_TIMEOUT = 1.10;      // s without a release -> abort
export const CLASSIFIER_RELEASE_FLASH = 0.12;        // s the release state is shown before follow-through
export const CLASSIFIER_FOLLOW_TIME = 0.45;          // s of follow-through before re-arming

export const MESSAGE_DURATION = 4.0;               // s
export const MAX_NAME_LENGTH = 12;

// --- Generated colours (RGB 0-255) ---
export const FLOOR_COLOR = [24, 22, 62];
export const APPROACH_COLOR = [172, 116, 68];
export const LANE_COLOR = [204, 144, 86];
export const LANE_PLANK_DARK = [126, 76, 36];
export const GUTTER_COLOR = [14, 12, 34];
export const GUTTER_LIP_COLOR = [255, 62, 138];
export const PIN_DECK_COLOR = [208, 150, 90];
export const FOUL_LINE_COLOR = [255, 62, 138];
export const PIN_COLOR = [245, 245, 248];
export const PIN_STRIPE_COLOR = [200, 40, 40];

export const WALL_COLOR = [22, 20, 56];
export const WALL_LOWER_COLOR = [34, 30, 82];
export const WALL_TRIM_COLOR = [255, 84, 130];
export const POSTER_COLOR = [44, 48, 128];
export const BACKDROP_COLOR = [14, 12, 36];
export const BACKDROP_GLOW_COLOR = [255, 60, 130];
export const CEILING_COLOR = [18, 16, 34];
export const KEY_LIGHT_COLOR = [255, 240, 214];
export const FILL_LIGHT_COLOR = [150, 158, 200];
export const SHADE_FLOOR = 0.52;
export const SHADE_GAIN = 0.60;
