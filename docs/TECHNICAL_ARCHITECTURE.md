# Trans Guard AI — Technical Architecture Summary

## The Five-Pillar Multi-Model Fusion Engine

**Document version:** 1.0
**Subject system:** `trans_guard_engine.py` (edge inference engine)
**Status:** Feature-complete

---

## 1. Abstract

Trans Guard AI is a real-time video analytics engine for public transport
environments. Rather than delegating all threat classification to a single
general-purpose neural network, the system implements a **fusion
architecture**: a fast general-purpose object detector supplies a shared
spatial substrate, and five specialised analytical pillars — each with its own
mathematical model — reason over that substrate to produce semantically
distinct incident classes.

The central design thesis is that **a raw per-frame neural inference is an
observation, not an event**. Every pillar therefore interposes a temporal or
geometric confirmation layer between detection and alarm. This converts noisy,
frame-local, probabilistic model output into stable, auditable incident
assertions suitable for operator escalation.

---

## 2. System Topology

The engine is a **multiprocessing pipeline** of four isolated OS processes
communicating through bounded queues. Process isolation is used in preference
to threading because the inference stage is CPU-saturating and would otherwise
contend with I/O stages under the Python Global Interpreter Lock.

| Process | Responsibility |
|---|---|
| `capture` | FFmpeg/RTSP ingest → raw BGR frames |
| `inference` | All five pillars; the sole owner of model and tracker state |
| `publisher` | Annotated frames → MediaMTX RTSP for WebRTC/HLS delivery |
| `telemetry` | Zone/watchlist synchronisation, heartbeat, incident delivery |

### 2.1 Latency-Bounded Queueing

The frame queue is deliberately constrained to a depth of **2**
(`FRAME_QUEUE_SIZE = 2`). This is a load-shedding policy, not a buffering
policy. Under sustained overload a conventional deep queue grows without
bound, and end-to-end detection latency grows with it — the system would
report an incident that occurred many seconds earlier. By capping depth and
having the producer **discard the stale frame in favour of the newest**
(`put_latest`), the engine degrades in *frame rate* rather than in *latency*.
For a security system, analysing the present at reduced temporal resolution is
strictly preferable to analysing the past at full resolution.

### 2.2 Model State Locality

All model handles — the primary detector, the tracker, the pose estimator, the
secondary weapon detector, and the biometric embedding cache — are
instantiated **inside the inference process only**. This is required for
correctness on `spawn`-based platforms (Windows), where each worker re-executes
the module from scratch and native model handles are not inheritable across the
process boundary. It also prevents the I/O-bound workers from paying the
substantial import and memory cost of the deep-learning stack.

### 2.3 Alarm Suppression

A global per-key debounce (`INCIDENT_COOLDOWN_S = 60.0`) governs emission. Each
pillar supplies a **cache key scoped to its own causal entity** — for example
`fall_{track_id}`, `bag_{track_id}`, `violence_{id_a}_{id_b}`. Scoping the key
to the entity rather than to the incident *type* is a deliberate design
decision: a single fall must not suppress the reporting of a second,
simultaneous fall involving a different passenger. Correlated repeat
observations of one event are suppressed; genuinely independent concurrent
events are not.

---

## 3. Shared Perceptual Substrate

A single YOLOv8 forward pass per frame, coupled to a **ByteTrack** multi-object
tracker operating in persistent mode, yields the primitive from which all
pillars derive:

$$
\mathcal{D}_t = \{(k,\; c,\; \mathbf{b}) \mid \mathbf{b} = (x_1, y_1, x_2, y_2)\}
$$

where $k$ is a temporally stable **track identity**, $c$ a class label, and
$\mathbf{b}$ an axis-aligned bounding box at time $t$.

The persistence of $k$ across frames is the architectural keystone. It is what
elevates the system from stateless frame classification to genuine
**behavioural analysis**: without a stable identity one can observe that *a*
bag is present, but not that *this* bag has been motionless and unattended for
forty-five seconds. Pillars 1 and 4 consume geometry alone; Pillars 2, 3 and 5
are fundamentally dependent on identity persistence.

Derived quantities used throughout:

$$
\text{centroid}(\mathbf{b}) = \left( \frac{x_1 + x_2}{2},\ \frac{y_1 + y_2}{2} \right)
\qquad
d(\mathbf{p}, \mathbf{q}) = \sqrt{(p_x - q_x)^2 + (p_y - q_y)^2}
$$

---

## 4. Pillar I — Overcrowd Detection (Spatial Density with Temporal Consensus)

**Incident class:** `OVERCROWD_DETECTED`

### Logic

Let $n_t$ be the cardinality of the `person` set at frame $t$, and $\tau = 10$
the occupancy threshold. A naive predicate $n_t > \tau$ is unusable in
practice: detector recall fluctuates frame-to-frame under partial occlusion, so
a static crowd of twelve oscillates across the threshold and generates a burst
of spurious alarms.

The pillar therefore applies **temporal consensus**. An accumulator $S_t$
tracks consecutive threshold exceedances:

$$
S_t =
\begin{cases}
S_{t-1} + 1, & n_t > \tau \\
0, & \text{otherwise}
\end{cases}
$$

The alarm asserts only when $S_t \ge 15$ (`CROWD_CONSENSUS_FRAMES`) — roughly
0.6 s of continuous evidence at 25 fps. Because any single sub-threshold frame
resets $S_t$ to zero, an alternating detection pattern can never accumulate to
the trigger point.

### Hysteresis and Latching

The detector is a **latching** state machine. Once active it will not re-emit,
and it de-asserts only after 15 consecutive frames *below* threshold
(`CROWD_RELEASE_FRAMES`). This separation of assertion and release thresholds
is classical hysteresis, and it prevents oscillatory alarm/clear cycling for an
occupancy hovering at the boundary. The reported figure is the **peak**
occupancy observed during the episode, which is the operationally meaningful
quantity for capacity management.

---

## 5. Pillar II — Unattended Baggage (Dual-Clock Persistence Analysis)

**Incident class:** `UNATTENDED_BAGGAGE`
**Monitored classes:** `backpack`, `handbag`, `suitcase`

### Logic

Abandonment is a conjunction of two independent conditions sustained over time:
the object must be **stationary**, and it must be **unowned**. The
implementation maintains a separate monotonic clock for each.

**Stationarity clock.** For a tracked bag $k$ a reference centroid
$\mathbf{c}_{\text{ref}}$ is retained. On each observation:

$$
d(\mathbf{c}_t, \mathbf{c}_{\text{ref}}) > \epsilon
\quad\Longrightarrow\quad
\mathbf{c}_{\text{ref}} \leftarrow \mathbf{c}_t,\;\; t_{\text{move}} \leftarrow t
$$

with $\epsilon = 10$ px (`BAGGAGE_STATIONARY_PIXEL_TOL`). Comparing against a
*latched reference* rather than the previous frame is essential: per-frame
differencing would allow slow cumulative drift, and detector jitter of a few
pixels would spuriously reset a genuinely stationary object.

**Ownership clock.** A bag is attended at time $t$ if any person box lies
within a dilated neighbourhood of the bag box — the bag rectangle expanded by
$r = 120$ px (`BAGGAGE_PROXIMITY_RADIUS_PX`) and tested for intersection:

$$
\exists\, p \in P_t : \;\mathbf{b}_p \cap \text{dilate}(\mathbf{b}_k, r) \neq \emptyset
\;\Longrightarrow\; t_{\text{attended}} \leftarrow t
$$

**Conjunctive trigger.** The alarm fires on the *minimum* of the two elapsed
intervals:

$$
\min\left(t - t_{\text{move}},\; t - t_{\text{attended}}\right) > 45\ \text{s}
$$

Taking the minimum enforces that **both** conditions have held continuously for
the full dwell window. This is a meaningful correction over a formulation that
gates on stationarity alone and merely samples ownership at the moment of
firing: under that weaker rule, a passenger walking past a long-abandoned bag
would not reset the countdown, and the alarm would fire immediately upon their
departure. The dual-clock conjunction correctly treats any proximity event as
restarting the abandonment observation.

Tracks unobserved for more than 5 s are evicted to bound memory.

---

## 6. Pillar III — Fall Detection (Skeletal Geometry)

**Incident class:** `FALL_DETECTED`

### Logic

Fall detection uses a **two-factor conjunctive predicate**, combining a coarse
geometric cue with a fine skeletal one. Either alone is inadequate: bounding-box
aspect ratio alone misfires on bending, crouching and camera foreshortening,
while landmark noise alone is unreliable under occlusion.

**Factor 1 — Postural aspect ratio.** An upright human occupies a portrait
bounding box. The body is considered horizontal when:

$$
\frac{w}{h} > 1.0 \qquad w = x_2 - x_1,\;\; h = y_2 - y_1
$$

**Factor 2 — Cranio-pelvic inversion.** From the MediaPipe landmark set, with
image $y$ increasing downward, the head must have descended to or below pelvic
height:

$$
y_{\text{nose}} \;\ge\; \frac{y_{\text{LEFT\_HIP}} + y_{\text{RIGHT\_HIP}}}{2}
$$

evaluated only when all three landmarks exceed a visibility confidence of 0.5.
This factor is what discriminates a fall from a deep crouch or a bend at the
waist, in which the torso may present a wide box while the skull remains
superior to the pelvis.

### Per-Identity Streak Isolation

Confirmation requires the conjunction to hold for 5 consecutive frames
(`FALL_CONFIRM_FRAMES`). Critically, the streak counter is **keyed by track
identity**, $S^{(k)}$, rather than maintained as a single scene-global counter.

This is a substantive correctness property in crowded scenes. Under a global
counter, a fallen passenger's accumulating evidence is destroyed the instant any
*other* upright pedestrian is evaluated — precisely the multi-occupant
situation in which a fall is most likely and most urgent. Per-identity streaks
guarantee that each subject's evidence accumulates independently. Streaks for
departed tracks are garbage-collected each frame.

### Computational Strategy

Pose estimation is executed on **cropped person regions**, not the full frame.
The legacy MediaPipe Pose solution returns a single skeleton per invocation;
running it frame-globally would therefore analyse at most one occupant
regardless of scene population. Cropping yields one skeleton per subject, and
landmark coordinates are affine-mapped back into frame space. To bound cost,
crops are ranked by bounding-box area and the largest **4** are processed
(`POSE_MAX_PERSONS_PER_FRAME`) — an area prior that favours near-field subjects,
for whom landmark estimates are most reliable.

A graceful-degradation path exists: where the pose backend is unavailable, the
pillar falls back to the aspect-ratio factor alone under the identical 5-frame
confirmation requirement.

---

## 7. Pillar IV — Weapon Detection (Cascaded Region-of-Interest Inference)

**Incident class:** `CRIME_WEAPON_DETECTED`

### Logic

General-purpose detectors trained on COCO perform poorly on small, low-contrast,
frequently-occluded objects such as handguns and blades. This pillar introduces
a **secondary detector** with weights fine-tuned specifically for weapon
classes, arranged in a **cascade** with the primary model.

The secondary network is not evaluated on the full frame. It is invoked
exclusively on the **person crops** emitted by the primary detector. The
justification is both computational and statistical:

- **Computational** — inference cost scales with pixel area; person regions are
  a small fraction of the frame, and background regions cannot contain a
  *carried* weapon.
- **Statistical** — restricting the evaluated domain proportionally reduces the
  absolute false-positive count, since specialised weapon models are prone to
  spurious activation on background clutter of similar low-level appearance.

Crops are dilated by 8 % (`WEAPON_CROP_PADDING`) so that a weapon protruding
beyond the person silhouette is not truncated, and at most 6 crops are
evaluated per frame (`WEAPON_MAX_CROPS_PER_FRAME`).

Detections are accepted above a confidence of 0.45 and must persist for 3
consecutive frames per identity (`WEAPON_CONFIRM_FRAMES`) — a shorter window
than the fall pillar, reflecting the higher cost of a missed detection relative
to a false one in this threat class. Weapon coordinates are translated from
crop-local to frame-global space by adding the crop origin, so that overlays
and stored evidence remain spatially accurate.

Class admission is performed by **keyword matching** against the loaded model's
label vocabulary (`gun`, `pistol`, `handgun`, `revolver`, `rifle`, `knife`,
`blade`, `bat`, `firearm`, `weapon`), which decouples the engine from any single
weights file's class indexing convention.

**Degradation contract.** If the weights file is absent the pillar logs a
warning, marks itself unavailable, and the remaining four pillars proceed
unaffected. The engine treats a missing specialised model as a reduction in
capability, never as a fatal condition.

---

## 8. Pillar V — Violence Detection (Spatiotemporal Kinematic Heuristics)

**Incident class:** `CRIME_VIOLENCE_DETECTED`

### Logic

Violence is inferred without a dedicated action-recognition network, from the
conjunction of a **proximity condition** and a **kinematic condition**. This
avoids the latency and memory cost of a 3D convolutional or transformer-based
video classifier, which is prohibitive on edge hardware.

**Stage 1 — Pairwise IoU gating.** For each unordered pair of tracked persons:

$$
\text{IoU}(\mathbf{b}_i, \mathbf{b}_j) = \frac{|\mathbf{b}_i \cap \mathbf{b}_j|}{|\mathbf{b}_i \cup \mathbf{b}_j|}
$$

Pairs below $\text{IoU} = 0.15$ (`VIOLENCE_IOU_THRESHOLD`) are rejected without
further computation. Physical altercation requires spatial interpenetration of
the participants' silhouettes; this gate discards the overwhelming majority of
pair combinations at negligible cost.

**Stage 2 — Wrist velocity.** For gated pairs, the instantaneous speed of each
wrist landmark is computed by finite difference against the previous
observation:

$$
v_w = \frac{\Delta d}{\Delta t} = \frac{d(\mathbf{w}_t, \mathbf{w}_{t-1})}{t - t_{-1}}
$$

The per-subject score is $\max(v_{\text{left}}, v_{\text{right}})$, and the pair
score is the maximum across both participants — an asymmetric-aggression model,
correctly recognising that a one-sided assault involves a violently moving
aggressor and a comparatively static victim. Landmarks below 0.5 visibility are
excluded. Velocity is computed in **wall-clock time**, not per frame, so the
threshold of 320 px/s (`VIOLENCE_WRIST_SPEED_PX_S`) remains physically
meaningful under the variable frame rate produced by the load-shedding queue.

Note that the pose data consumed here is the *same* landmark set already
computed for Pillar III. The skeletal extraction is performed once per frame and
shared, so Pillar V adds no additional neural inference cost.

### Decay-Based Confirmation

The pair accumulator does not hard-reset on a sub-threshold frame. It
**decays**:

$$
S^{(i,j)} \leftarrow
\begin{cases}
S^{(i,j)} + 1, & v_{\max} \ge 320 \\
\max(0,\; S^{(i,j)} - 0.5), & \text{otherwise}
\end{cases}
$$

with assertion at $S^{(i,j)} \ge 6$ (`VIOLENCE_CONFIRM_FRAMES`).

Asymmetric decay is the appropriate integrator for this signal class. Physical
altercations are intrinsically **intermittent** — strikes are punctuated by
grappling, recoil and momentary separation. A hard reset (as used for the
monotonic postural signal in Pillar III) would discard accumulated evidence at
every pause, rendering sustained violence undetectable. Decaying at half the
accumulation rate preserves evidence across brief interruptions while still
ensuring that isolated spurious velocity spikes dissipate without triggering.

Pair state is evicted after 3 s without observation (`VIOLENCE_PAIR_TTL_S`).

---

## 9. Pillar VI — Biometric Watchlist (Deep Metric Learning)

**Incident class:** `WATCHLIST_MATCH`

### Logic

On initialisation the telemetry process retrieves watchlist target imagery from
the MongoDB backend over authenticated HTTP. Each target is reduced to a
**128-dimensional facial embedding** via a deep metric learning model (dlib
ResNet, exposed through `face_recognition`) and the resulting vectors are held
in process memory. Re-synchronisation occurs on a 300 s interval
(`WATCHLIST_SYNC_SECONDS`).

Identification is a nearest-neighbour query under Euclidean distance:

$$
\hat{n} = \arg\min_{n} \; \lVert \mathbf{e}_{\text{probe}} - \mathbf{e}_n \rVert_2
\qquad
\text{accept iff } \lVert \cdot \rVert_2 \le 0.5
$$

The 0.5 tolerance (`FACE_MATCH_TOLERANCE`) is the conventional operating point
for this embedding space, balancing false accept against false reject.

Metric learning is the correct formulation here because the recognition problem
is **open-set**: the watchlist is mutable at runtime, and a closed-set
classifier would require retraining on every roster change. Comparing
embeddings in a learned metric space permits enrolment of a new identity from a
single photograph with no model modification.

### Optimisations

- **Spatial restriction.** Face search is confined to the upper third of each
  person bounding box, exploiting the primary detector's output to eliminate
  full-frame face scanning.
- **Identity memoisation.** Results are cached against track identity, so a
  given subject incurs the embedding cost once rather than once per frame.
  Negative results are cached as `UNKNOWN` with equal weight — without this,
  the expensive path would re-execute continuously for every non-matching
  passenger.
- **Cache coherence.** Cached identities are evicted when their track
  terminates, preventing a recycled tracker identity from inheriting a stale
  biometric assertion.

---

## 10. Auxiliary Capability — Zone Intrusion via Footpoint Anchoring

**Incident class:** `ZONE_INTRUSION`

Restricted zones are authored in the operator dashboard as normalised polygons,
$(x, y) \in [0,1]^2$, resolution-independent and scaled to pixel space at
evaluation time. Containment is evaluated by **ray casting** (even–odd rule),
which is valid for arbitrary simple polygons including concave geometries.

The critical modelling decision is the choice of test point. The engine anchors
on the **footpoint** — the bottom-centre of the person bounding box:

$$
\mathbf{f} = \left( \frac{x_1 + x_2}{2},\ y_2 \right)
$$

Under perspective projection this is the closest available approximation to the
subject's ground-plane contact point. Testing the box *centroid* instead would
locate the subject at torso height, causing a person standing adjacent to a
boundary to register as inside it whenever their upper body overhangs the line —
a systematic false-positive mode along every zone edge. Footpoint anchoring
aligns the test with the physical semantics of "standing within an area."

---

## 11. Design Principles in Summary

| Principle | Manifestation |
|---|---|
| **Observation ≠ event** | Every pillar imposes temporal confirmation before assertion |
| **Confirmation matched to signal physics** | Hard reset for monotonic postural signals; asymmetric decay for intermittent kinematic signals |
| **Identity-scoped state** | Streaks, caches and clocks keyed per track, never scene-global |
| **Conjunctive predicates** | Falls and abandonment each require two independent factors to hold |
| **Cascaded inference** | Expensive specialised models restricted to regions proposed by cheap general models |
| **Shared computation** | One pose extraction serves both fall and violence analysis |
| **Graceful degradation** | Absent optional models disable their pillar; they never halt the engine |
| **Latency over completeness** | Bounded queues shed stale frames rather than accumulate delay |

---

## 12. Incident Taxonomy

| Incident | Pillar | Severity | Confirmation Criterion |
|---|---|---|---|
| `OVERCROWD_DETECTED` | I | HIGH | 15 consecutive frames above occupancy threshold |
| `UNATTENDED_BAGGAGE` | II | HIGH | 45 s conjunctive stationary-and-unowned dwell |
| `FALL_DETECTED` | III | CRITICAL | 5 consecutive frames, per identity |
| `CRIME_WEAPON_DETECTED` | IV | CRITICAL | 3 consecutive frames, per identity |
| `CRIME_VIOLENCE_DETECTED` | V | CRITICAL | Decay-weighted accumulator ≥ 6 |
| `WATCHLIST_MATCH` | VI | CRITICAL | Embedding distance ≤ 0.5 |
| `ZONE_INTRUSION` | Aux | REVIEW | Footpoint within polygon |

All incidents are transmitted with a JPEG evidence frame, camera identity, UTC
timestamp and pillar-specific structured metadata.

---

## 13. Verification

The temporal and geometric logic of the pillars is covered by an automated
suite of **22 unit tests** (`tests/test_fusion_detectors.py`), executable
without model weights or GPU hardware:

```
python -m unittest discover -s tests
```

Coverage is deliberately concentrated on the **adversarial negative cases** that
distinguish this architecture from a naive implementation:

- flickering occupancy must not raise a crowd alarm;
- a horizontal bounding box with the head still above the hips is not a fall;
- one subject standing must not reset another subject's fall streak;
- spatial overlap without wrist velocity is not violence;
- wrist velocity without spatial overlap is not violence;
- non-weapon classes from the secondary model must not escalate;
- terminated tracks must be purged from all pillar state.

### Validation Status

These tests establish **logical correctness** — that each pillar's decision
procedure behaves as specified on controlled synthetic geometry and on
integration paths exercised with stubbed model backends. They do not establish
**detection accuracy**. The numerical thresholds documented throughout
(occupancy limits, dwell intervals, velocity and IoU thresholds, confirmation
window lengths) are principled initial values; calibration against annotated
footage from the target deployment environment remains outstanding and is
recommended as the next phase of work.

---

## Appendix A — Configuration Parameters

| Constant | Value | Pillar |
|---|---|---|
| `CROWD_PERSON_THRESHOLD` | 10 | I |
| `CROWD_CONSENSUS_FRAMES` | 15 | I |
| `CROWD_RELEASE_FRAMES` | 15 | I |
| `BAGGAGE_STATIONARY_SECONDS` | 45.0 | II |
| `BAGGAGE_STATIONARY_PIXEL_TOL` | 10.0 | II |
| `BAGGAGE_PROXIMITY_RADIUS_PX` | 120.0 | II |
| `FALL_ASPECT_RATIO` | 1.0 | III |
| `FALL_CONFIRM_FRAMES` | 5 | III |
| `FALL_VISIBILITY_THRESHOLD` | 0.5 | III, V |
| `POSE_MAX_PERSONS_PER_FRAME` | 4 | III, V |
| `WEAPON_CONF_THRESHOLD` | 0.45 | IV |
| `WEAPON_CONFIRM_FRAMES` | 3 | IV |
| `WEAPON_CROP_PADDING` | 0.08 | IV |
| `WEAPON_MAX_CROPS_PER_FRAME` | 6 | IV |
| `VIOLENCE_IOU_THRESHOLD` | 0.15 | V |
| `VIOLENCE_WRIST_SPEED_PX_S` | 320.0 | V |
| `VIOLENCE_CONFIRM_FRAMES` | 6 | V |
| `VIOLENCE_PAIR_TTL_S` | 3.0 | V |
| `FACE_MATCH_TOLERANCE` | 0.5 | VI |
| `INCIDENT_COOLDOWN_S` | 60.0 | All |

## Appendix B — Dependency Constraints

| Package | Constraint | Rationale |
|---|---|---|
| `numpy` | `>=1.24,<2.0` | MediaPipe 0.10.x and dlib wheels are built against the NumPy 1.x ABI |
| `ultralytics` | `>=8.1,<9.0` | Supplies YOLOv8 and the ByteTrack implementation |
| `lapx` | `>=0.5.5` | Hungarian assignment required by ByteTrack |
| `mediapipe` | `>=0.10.9,<=0.10.21` | **Hard constraint.** The legacy `mp.solutions` Pose API was removed in 0.10.30; the engine imports `mediapipe.python.solutions.pose`, which does not exist on later releases |
| `face_recognition` / `dlib` | `>=1.3.0` / `>=19.24` | 128-D embedding extraction; requires CMake and a C++ toolchain on Linux/macOS |
