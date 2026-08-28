"""Rasengan - Python/modernGL recreation of https://github.com/ZLWHappy/Rasengan

Ports the original OpenSceneGraph demo to pure Python:
  * Shaders/cube.vert + cube.geom + cube.frag  -> spiral chakra strips
    (points on a sphere shell, each expanded by a geometry shader into a long
     thin ribbon that orbits the sphere center around its tangent axis,
     with the sin() radial pulse kept from the original)
  * main5.cpp createBillboardImage/createSunLight -> additive glow billboards
  * HDR bloom post-processing for the bright anime look
  * adds a procedural low-poly open palm so the rasengan spins above a hand

Modes:
  python rasengan.py                 webcam mode: rasengan follows YOUR hand
                                     (MediaPipe hand tracking, orb hovers
                                     above your open palm, sized to it)
  python rasengan.py --classic       classic mode: procedural 3D demo hand
  python rasengan.py --shot out.png  headless render of classic mode
  python rasengan.py --cam N         pick camera index (default 0)

Controls (window):
  left-drag orbit | wheel zoom / orb size | D toggle skeleton (webcam) | ESC quit
"""
import math
import os
import sys
import time

import numpy as np
import moderngl
import glfw

TAU = math.tau

WINDOW_W, WINDOW_H = 1280, 800
WEBCAM_W, WEBCAM_H = 1280, 720
FOVY = math.radians(45.0)

ORB_R = 0.30

LAYERS = [
    dict(radius=1.00, step=0.032, quad=0.0100, speed=5.2, seg_angle=0.16,
         radial_amp=0.92, wave_freq=2.6, wave_trail=0.36, intensity=1.0,
         segments=18, tex="outer"),
    dict(radius=0.34, step=0.015, quad=0.0065, speed=9.0, seg_angle=0.11,
         radial_amp=0.97, wave_freq=3.4, wave_trail=0.46, intensity=2.00,
         segments=18, tex="inner"),
    dict(radius=1.06, step=0.052, quad=0.0040, speed=7.0, seg_angle=0.30,
         radial_amp=1.15, wave_freq=2.0, wave_trail=0.55, intensity=0.35,
         segments=10, tex="outer"),
]

GLOWS = [
    dict(f=0.80, color=(0.92, 0.99, 1.00), strength=4.50, power=2.2),
    dict(f=1.15, color=(0.30, 0.75, 1.00), strength=0.65, power=2.2),
    dict(f=2.20, color=(0.05, 0.35, 0.90), strength=0.30, power=2.0),
]

BOB_AMP = 0.03
BOB_FREQ = 1.9
HAND_TILT = math.radians(0.0)
PALM_CENTER = np.array([0.0, -0.80, 0.03])
PALM_NORMAL = np.array([0.0, 1.0, 0.0])


def norm(v):
    v = np.asarray(v, dtype=np.float64)
    n = np.linalg.norm(v)
    return v / n if n > 0 else v


def cross(a, b):
    return np.cross(a, b)


def cm(m):
    """row-major math matrix -> contiguous column-major float32 bytes for GLSL"""
    return np.ascontiguousarray(np.array(m, dtype=np.float64).T, dtype=np.float32).tobytes()


def mat_identity():
    return np.eye(4)


def mat_perspective(fovy, aspect, near, far):
    f = 1.0 / math.tan(fovy / 2.0)
    m = np.zeros((4, 4))
    m[0, 0] = f / aspect
    m[1, 1] = f
    m[2, 2] = (far + near) / (near - far)
    m[2, 3] = 2.0 * far * near / (near - far)
    m[3, 2] = -1.0
    return m


def mat_ortho(l, r, b, t, near=-1.0, far=1.0):
    m = np.eye(4)
    m[0, 0] = 2.0 / (r - l)
    m[1, 1] = 2.0 / (t - b)
    m[2, 2] = -2.0 / (far - near)
    m[0, 3] = -(r + l) / (r - l)
    m[1, 3] = -(t + b) / (t - b)
    m[2, 3] = -(far + near) / (far - near)
    return m


def mat_lookat(eye, target, up=(0.0, 1.0, 0.0)):
    z = norm(np.asarray(eye) - np.asarray(target))
    x = norm(cross(up, z))
    y = cross(z, x)
    m = np.eye(4)
    m[0, :3] = x
    m[1, :3] = y
    m[2, :3] = z
    m[0, 3] = -np.dot(x, eye)
    m[1, 3] = -np.dot(y, eye)
    m[2, 3] = -np.dot(z, eye)
    return m


def mat_roty(a):
    c, s = math.cos(a), math.sin(a)
    m = np.eye(4)
    m[0, 0] = c
    m[0, 2] = s
    m[2, 0] = -s
    m[2, 2] = c
    return m


def mat_rotx(a):
    c, s = math.cos(a), math.sin(a)
    m = np.eye(4)
    m[1, 1] = c
    m[1, 2] = -s
    m[2, 1] = s
    m[2, 2] = c
    return m


def transform_point(m, p):
    p = np.append(np.asarray(p, dtype=np.float64), 1.0)
    return (m @ p)[:3]


STRIP_VERTEX = """#version 330
in vec3 in_quad;
in vec3 in_center;
in vec3 in_axis;
in float in_phase;
out vec3 g_center;
out vec3 g_axis;
out float g_phase;
void main() {
    g_center = in_center;
    g_axis = in_axis;
    g_phase = in_phase;
    gl_Position = vec4(in_quad, 1.0);
}
"""

STRIP_GEOMETRY = """#version 330
layout(triangles) in;
layout(triangle_strip, max_vertices={max_verts}) out;

in vec3 g_center[];
in vec3 g_axis[];
in float g_phase[];

uniform mat4 u_mvp;
uniform float u_time;
uniform float u_speed;
uniform float u_seg_angle;
uniform float u_radial_amp;
uniform float u_wave_freq;
uniform float u_wave_trail;
uniform float u_quad;
uniform vec3 u_orb_center;
uniform float u_orb_scale;
out vec2 g_uv;

mat3 rotAround(vec3 k, float ang) {{
    float c = cos(ang), s = sin(ang);
    float ic = 1.0 - c;
    return mat3(
        k.x*k.x*ic + c,      k.y*k.x*ic + k.z*s,  k.z*k.x*ic - k.y*s,
        k.x*k.y*ic - k.z*s,  k.y*k.y*ic + c,      k.z*k.y*ic + k.x*s,
        k.x*k.z*ic + k.y*s,  k.y*k.z*ic - k.x*s,  k.z*k.z*ic + c
    );
}}

void main() {{
    vec3 c = g_center[0];
    vec3 ax = g_axis[0];
    int N = {segments};
    float phi0 = u_time * u_speed + g_phase[0];
    vec3 P0 = vec3(0.0);
    vec3 P1 = vec3(u_quad, u_quad, 0.0);
    for (int i = 0; i < N; ++i) {{
        float fi = float(i);
        float pulse = sin(u_time * u_wave_freq - fi * u_wave_trail + g_phase[0] * 7.31);
        float s = clamp(1.0 - u_radial_amp * pulse, 0.02, 1.7);
        mat3 R = rotAround(ax, phi0 - fi * u_seg_angle);
        float u = fi / float(N - 1);
        vec3 p0 = u_orb_center + R * ((c + P0) * s) * u_orb_scale;
        vec3 p1 = u_orb_center + R * ((c + P1) * s) * u_orb_scale;
        gl_Position = u_mvp * vec4(p0, 1.0);
        g_uv = vec2(u, 0.0);
        EmitVertex();
        gl_Position = u_mvp * vec4(p1, 1.0);
        g_uv = vec2(u, 1.0);
        EmitVertex();
    }}
    EndPrimitive();
}}
"""

STRIP_FRAGMENT = """#version 330
in vec2 g_uv;
uniform sampler2D u_tex;
uniform float u_intensity;
uniform float u_fade;
out vec4 f_color;
void main() {
    vec3 c = texture(u_tex, g_uv).rgb;
    f_color = vec4(c * u_intensity * u_fade, 1.0);
}
"""

GLOW_VERTEX = """#version 330
in vec2 in_p;
uniform mat4 u_vp;
uniform vec3 u_center;
uniform vec3 u_right;
uniform vec3 u_up;
uniform float u_size;
out vec2 v_uv;
void main() {
    v_uv = in_p;
    vec3 w = u_center + (u_right * in_p.x + u_up * in_p.y) * u_size;
    gl_Position = u_vp * vec4(w, 1.0);
}
"""

GLOW_FRAGMENT = """#version 330
in vec2 v_uv;
uniform vec3 u_color;
uniform float u_strength;
uniform float u_power;
out vec4 f_color;
void main() {
    float d = length(v_uv);
    float a = pow(clamp(1.0 - d, 0.0, 1.0), u_power);
    f_color = vec4(u_color * a * u_strength, 1.0);
}
"""

HAND_VERTEX = """#version 330
in vec3 in_pos;
in vec3 in_normal;
uniform mat4 u_mvp;
uniform mat4 u_model;
out vec3 v_n;
out vec3 v_w;
void main() {
    vec4 w = u_model * vec4(in_pos, 1.0);
    v_w = w.xyz;
    v_n = mat3(u_model) * in_normal;
    gl_Position = u_mvp * w;
}
"""

HAND_FRAGMENT = """#version 330
in vec3 v_n;
in vec3 v_w;
uniform vec3 u_cam;
uniform vec3 u_key_dir;
uniform vec3 u_fill_dir;
uniform vec3 u_energy_pos;
out vec4 f_color;
const vec3 BASE = vec3(0.105, 0.120, 0.155);
const vec3 RIM = vec3(0.25, 0.70, 1.00);
const vec3 ENERGY_COL = vec3(0.30, 0.75, 1.00);
void main() {
    vec3 N = normalize(v_n);
    vec3 V = normalize(u_cam - v_w);
    float dk = max(dot(N, normalize(u_key_dir)), 0.0);
    float df = max(dot(N, normalize(u_fill_dir)), 0.0) * 0.35;
    vec3 col = BASE * (0.20 + 0.95 * dk + df);
    vec3 L = v_w - u_energy_pos;
    float d = length(L);
    L /= d;
    float att = 1.0 / (1.0 + 5.0 * d * d);
    col += ENERGY_COL * max(dot(N, -L), 0.0) * att * 3.0;
    float rim = pow(1.0 - max(dot(N, V), 0.0), 3.0);
    col += RIM * rim * 0.55;
    f_color = vec4(max(col, 0.0), 1.0);
}
"""

FS_VERTEX = """#version 330
in vec2 in_p;
out vec2 v_uv;
void main() {
    v_uv = in_p * 0.5 + 0.5;
    gl_Position = vec4(in_p, 0.0, 1.0);
}
"""

BRIGHT_FRAGMENT = """#version 330
in vec2 v_uv;
uniform sampler2D u_tex;
uniform float u_threshold;
out vec4 f_color;
void main() {
    vec3 c = texture(u_tex, v_uv).rgb;
    float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    float w = smoothstep(u_threshold, u_threshold + 0.40, l);
    f_color = vec4(c * w, 1.0);
}
"""

BLUR_FRAGMENT = """#version 330
in vec2 v_uv;
uniform sampler2D u_tex;
uniform vec2 u_dir;
out vec4 f_color;
void main() {
    vec4 c = texture(u_tex, v_uv) * 0.227027;
    vec2 o1 = u_dir * 1.3846153846;
    vec2 o2 = u_dir * 3.2307692308;
    c += (texture(u_tex, v_uv + o1) + texture(u_tex, v_uv - o1)) * 0.3162162162;
    c += (texture(u_tex, v_uv + o2) + texture(u_tex, v_uv - o2)) * 0.0702702703;
    f_color = c;
}
"""

COMPOSITE_FRAGMENT = """#version 330
in vec2 v_uv;
uniform sampler2D u_scene;
uniform sampler2D u_add;
uniform sampler2D u_bloom;
uniform float u_bloom_strength;
uniform float u_exposure;
uniform float u_flip;
out vec4 f_color;
void main() {
    vec2 uv = vec2(v_uv.x, mix(v_uv.y, 1.0 - v_uv.y, u_flip));
    vec3 c = texture(u_scene, uv).rgb;
    c += texture(u_add, v_uv).rgb;
    c += texture(u_bloom, v_uv).rgb * u_bloom_strength;
    c = vec3(1.0) - exp(-c * u_exposure);
    c = pow(max(c, vec3(0.0)), vec3(1.0 / 1.9));
    f_color = vec4(c, 1.0);
}
"""


def make_chakra_texture(kind, seed=7):
    rng = np.random.default_rng(seed)
    w, h = 512, 64
    u = np.linspace(0.0, 1.0, w)[None, :]
    v = np.linspace(0.0, 1.0, h)[:, None]
    noise = np.zeros((h, w))
    octaves = ((3, 0.38), (7, 0.26), (13, 0.19), (29, 0.12), (53, 0.07), (97, 0.035))
    for freq, amp in octaves:
        ph = rng.uniform(0, TAU)
        vs = rng.uniform(-1.0, 1.0) * 2.5
        noise += amp * np.sin(TAU * (freq * u + ph) + v * vs)
    ridge = (1.0 - np.abs(noise)) ** 3
    streak = 0.35 + 0.65 * ridge
    env = (1.0 - u) ** 1.6
    head = np.exp(-(u / 0.06) ** 2)
    if kind == "inner":
        base_lo = np.array([0.30, 0.72, 1.00])
        env = (1.0 - u) ** 1.2
        head = np.exp(-(u / 0.09) ** 2) * 1.1
    else:
        base_lo = np.array([18.0, 150.0, 219.0]) / 255.0
    base_hi = np.array([0.85, 0.97, 1.00])
    img = base_lo[None, None, :] * (env * streak)[..., None]
    img += base_hi[None, None, :] * head[..., None]
    for _ in range(18 if kind == "inner" else 10):
        cu = rng.uniform(0.05, 0.95)
        cv = rng.uniform(0.0, 1.0)
        su = 0.010 + rng.uniform(0, 0.012)
        sv = 0.06 + rng.uniform(0, 0.10)
        blob = np.exp(-(((u - cu) / su) ** 2 + ((v - cv) / sv) ** 2))[..., None]
        img += blob * 0.8
    img = np.clip(img, 0.0, 1.0)
    return (img * 255).astype(np.uint8)


def sphere_shell(radius, step):
    xs = np.arange(-radius, radius, step)
    x, y = np.meshgrid(xs, xs, indexing="ij")
    mask = x * x + y * y <= radius * radius
    z = np.sqrt(np.maximum(radius * radius - x * x - y * y, 0.0))
    top = np.stack([x[mask], y[mask], z[mask]], axis=1)
    bot = np.stack([x[mask], y[mask], -z[mask]], axis=1)
    return np.concatenate([top, bot], axis=0)


def build_instance_buffer(layer):
    pts = sphere_shell(layer["radius"], layer["step"])
    n = len(pts)
    rng = np.random.default_rng(int(pts.shape[0]) + 123)
    rnd = rng.normal(size=pts.shape)
    rnd /= np.linalg.norm(rnd, axis=1, keepdims=True)
    axes = np.cross(rnd, pts)
    axes /= np.linalg.norm(axes, axis=1, keepdims=True)
    phase = rng.uniform(0.0, TAU, size=n)
    return (
        pts.astype(np.float32),
        axes.astype(np.float32),
        phase.astype(np.float32),
        n,
    )


def lathe_capsule(a, b, r0, r1, rows=22, segs=20, caplen=0.16):
    a = np.asarray(a, dtype=np.float64)
    b = np.asarray(b, dtype=np.float64)
    axis = b - a
    length = np.linalg.norm(axis)
    if length < 1e-9:
        return np.zeros((0, 3)), np.zeros((0, 3), dtype=np.int32)
    axis /= length
    helper = np.array([1.0, 0.0, 0.0])
    if abs(np.dot(helper, axis)) > 0.9:
        helper = np.array([0.0, 0.0, 1.0])
    n1 = norm(cross(axis, helper))
    n2 = cross(axis, n1)
    verts = []
    for i in range(rows):
        u = i / (rows - 1)
        d = min(u, 1.0 - u)
        if d < caplen:
            k = d / caplen
            prof = math.sqrt(max(0.0, 1.0 - (1.0 - k) ** 2))
        else:
            prof = 1.0
        r = (r0 + (r1 - r0) * u) * prof
        center = a + (b - a) * u
        for j in range(segs):
            ang = TAU * j / segs
            verts.append(center + (n1 * math.cos(ang) + n2 * math.sin(ang)) * r)
    verts = np.array(verts)
    tris = []
    for i in range(rows - 1):
        for j in range(segs):
            j2 = (j + 1) % segs
            v0 = i * segs + j
            v1 = i * segs + j2
            v2 = (i + 1) * segs + j
            v3 = (i + 1) * segs + j2
            tris.append((v0, v2, v1))
            tris.append((v1, v2, v3))
    return verts, np.array(tris, dtype=np.int32)


def ellipsoid(semi, center, rows=18, segs=24):
    semi = np.asarray(semi, dtype=np.float64)
    center = np.asarray(center, dtype=np.float64)
    verts = []
    for i in range(rows):
        th = math.pi * i / (rows - 1)
        for j in range(segs):
            ph = TAU * j / segs
            d = np.array([
                math.sin(th) * math.cos(ph),
                math.cos(th),
                math.sin(th) * math.sin(ph),
            ])
            verts.append(center + semi * d)
    verts = np.array(verts)
    tris = []
    for i in range(rows - 1):
        for j in range(segs):
            j2 = (j + 1) % segs
            v0 = i * segs + j
            v1 = i * segs + j2
            v2 = (i + 1) * segs + j
            v3 = (i + 1) * segs + j2
            if i > 0:
                tris.append((v0, v2, v1))
            if i < rows - 2:
                tris.append((v1, v2, v3))
    return verts, np.array(tris, dtype=np.int32)


def merge_meshes(parts):
    all_v = []
    all_i = []
    offset = 0
    for v, idx in parts:
        all_v.append(v)
        all_i.append(idx + offset)
        offset += len(v)
    verts = np.concatenate(all_v)
    tris = np.concatenate(all_i)
    normals = np.zeros_like(verts)
    p0 = verts[tris[:, 0]]
    p1 = verts[tris[:, 1]]
    p2 = verts[tris[:, 2]]
    fn = np.cross(p1 - p0, p2 - p0)
    for k in range(3):
        np.add.at(normals, tris[:, k], fn)
    lens = np.linalg.norm(normals, axis=1, keepdims=True)
    lens[lens == 0] = 1.0
    normals /= lens
    return (
        verts.astype(np.float32),
        normals.astype(np.float32),
        tris.astype(np.int32),
    )


def build_hand_mesh():
    parts = []
    parts.append(ellipsoid((0.36, 0.11, 0.32), (0.0, -0.80, 0.02)))
    parts.append(lathe_capsule((0.06, -1.34, -0.02), (0.03, -0.98, -0.06), 0.165, 0.140))
    for x in (-0.225, -0.075, 0.075, 0.225):
        parts.append(lathe_capsule((x, -0.83, -0.24), (x * 1.16, -0.74, -0.62), 0.082, 0.058))
    parts.append(lathe_capsule((0.27, -0.84, 0.10), (0.56, -0.64, -0.28), 0.095, 0.062))
    return merge_meshes(parts)


_MODEL_URL = (
    "https://storage.googleapis.com/mediapipe-models/"
    "hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task"
)
_MODEL_NAME = "hand_landmarker.task"

# Hand landmark connections for skeleton drawing (same as the old mp.solutions set)
_HAND_CONNECTIONS = [
    (0, 1), (1, 2), (2, 3), (3, 4),        # thumb
    (0, 5), (5, 6), (6, 7), (7, 8),        # index
    (0, 9), (9, 10), (10, 11), (11, 12),   # middle  (extra 0→9 kept for wrist fan)
    (0, 13), (13, 14), (14, 15), (15, 16), # ring
    (0, 17), (17, 18), (18, 19), (19, 20), # pinky
    (5, 9), (9, 13), (13, 17),             # palm cross-links
]


def _ensure_model():
    """Download hand_landmarker.task next to the script if it doesn't exist."""
    script_dir = os.path.dirname(os.path.abspath(__file__))
    path = os.path.join(script_dir, _MODEL_NAME)
    if os.path.isfile(path):
        return path
    print(f"Downloading {_MODEL_NAME} …")
    import urllib.request
    urllib.request.urlretrieve(_MODEL_URL, path)
    print(f"Saved {_MODEL_NAME} ({os.path.getsize(path)} bytes)")
    return path


class HandTracker:
    def __init__(self):
        os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "2")
        os.environ.setdefault("GLOG_minloglevel", "2")
        import mediapipe as mp
        from mediapipe.tasks.python import BaseOptions
        from mediapipe.tasks.python.vision import (
            HandLandmarker,
            HandLandmarkerOptions,
            RunningMode,
        )

        model_path = _ensure_model()
        options = HandLandmarkerOptions(
            base_options=BaseOptions(model_asset_path=model_path),
            running_mode=RunningMode.IMAGE,
            num_hands=1,
            min_hand_detection_confidence=0.5,
            min_tracking_confidence=0.5,
        )
        self._mp = mp
        self._landmarker = HandLandmarker.create_from_options(options)

    def process(self, rgb):
        """Process an RGB numpy frame, return result (new Tasks API format)."""
        mp_image = self._mp.Image(
            image_format=self._mp.ImageFormat.SRGB, data=rgb
        )
        return self._landmarker.detect(mp_image)

    @staticmethod
    def palm_of(res):
        """Extract (palm_center_ndc, palm_size) from a HandLandmarkerResult."""
        if res is None or not res.hand_landmarks:
            return None
        lm = res.hand_landmarks[0]      # list of NormalizedLandmark
        wrist = np.array([lm[0].x, lm[0].y])
        mids = [np.array([lm[i].x, lm[i].y]) for i in (5, 9, 17)]
        palm = (wrist + mids[0] + mids[1] + mids[2]) / 4.0
        size = float(np.linalg.norm(mids[1] - wrist))
        return palm, size

    @staticmethod
    def draw_skeleton(frame, res):
        """Draw hand skeleton on a BGR frame using cv2 (replaces mp.solutions.drawing_utils)."""
        import cv2
        if res is None or not res.hand_landmarks:
            return
        h, w = frame.shape[:2]
        lm = res.hand_landmarks[0]
        pts = [(int(l.x * w), int(l.y * h)) for l in lm]
        for a, b in _HAND_CONNECTIONS:
            cv2.line(frame, pts[a], pts[b], (0, 255, 128), 2, cv2.LINE_AA)
        for p in pts:
            cv2.circle(frame, p, 4, (255, 255, 255), -1, cv2.LINE_AA)
            cv2.circle(frame, p, 4, (0, 200, 100), 1, cv2.LINE_AA)

    def close(self):
        self._landmarker.close()


class RasenganApp:
    def __init__(self, shot_path=None, shot_time=1.15, webcam=False, cam_index=0):
        self.shot_path = shot_path
        self.shot_time = shot_time
        self.webcam = webcam and shot_path is None
        self.cam_index = cam_index
        self.layers = []
        self.glow_pulse_seed = 0.0
        self.show_skeleton = False
        self.size_mul = 1.0
        self.cam_flip = True
        self.cap = None
        self.tracker = None
        self.cam_tex = None
        self.last_frame = None
        self.mp_res = None
        self.last_track_t = -1.0
        self.hand_pos = None
        self.hand_size = None
        self.hand_seen = -1e9
        self.fade = 0.0
        self._init_window()
        if self.webcam:
            self.webcam = self._init_camera()
            if not self.webcam:
                print("webcam/hand-tracking unavailable, falling back to classic mode")
        self._init_gl()

    def _init_window(self):
        if not glfw.init():
            raise RuntimeError("glfw.init() failed")
        w, h = (WEBCAM_W, WEBCAM_H) if self.webcam else (WINDOW_W, WINDOW_H)
        samples_try = (0,) if self.shot_path else (0, 4)
        self.window = None
        for s in samples_try:
            glfw.window_hint(glfw.SAMPLES, s)
            glfw.window_hint(glfw.CONTEXT_VERSION_MAJOR, 3)
            glfw.window_hint(glfw.CONTEXT_VERSION_MINOR, 3)
            glfw.window_hint(glfw.VISIBLE, bool(not self.shot_path))
            glfw.window_hint(glfw.RESIZABLE, True)
            win = glfw.create_window(w, h, "Rasengan", None, None)
            if win:
                self.window = win
                break
        if not self.window:
            glfw.terminate()
            raise RuntimeError("could not create GLFW window")
        glfw.make_context_current(self.window)
        glfw.set_framebuffer_size_callback(self.window, self._on_resize)
        glfw.set_mouse_button_callback(self.window, self._on_mouse_button)
        glfw.set_cursor_pos_callback(self.window, self._on_cursor)
        glfw.set_scroll_callback(self.window, self._on_scroll)
        glfw.set_key_callback(self.window, self._on_key)
        self.ctx = moderngl.create_context()
        self.ctxinfo = self.ctx.info.get("GL_RENDERER", "?")
        print("renderer:", self.ctxinfo)

    def _init_camera(self):
        try:
            import cv2
        except ImportError:
            return False
        self.cv2 = cv2
        cap = None
        try:
            cap = cv2.VideoCapture(self.cam_index, cv2.CAP_DSHOW)
            if not cap.isOpened():
                cap.release()
                cap = cv2.VideoCapture(self.cam_index)
        except Exception:
            cap = None
        if cap is None or not cap.isOpened():
            return False
        cap.set(cv2.CAP_PROP_FRAME_WIDTH, WEBCAM_W)
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, WEBCAM_H)
        self.cap = cap
        try:
            self.tracker = HandTracker()
        except Exception:
            self.cap.release()
            self.cap = None
            return False
        return True

    def _on_resize(self, win, w, h):
        self.width, self.height = max(w, 1), max(h, 1)
        self.ctx.viewport = (0, 0, self.width, self.height)
        if getattr(self, "ready", False):
            self._init_targets()

    def _on_mouse_button(self, win, button, action, mods):
        if button == glfw.MOUSE_BUTTON_LEFT:
            self.dragging = action == glfw.PRESS
            self.last_mx, _ = glfw.get_cursor_pos(win)
            _, self.last_my = glfw.get_cursor_pos(win)
            self.last_interact = time.perf_counter()

    def _on_cursor(self, win, mx, my):
        if getattr(self, "dragging", False) and not self.webcam:
            dx = mx - self.last_mx
            dy = my - self.last_my
            self.last_mx, self.last_my = mx, my
            self.yaw -= dx * 0.005
            self.pitch += dy * 0.005
            self.pitch = min(max(self.pitch, -0.25), 1.35)
            self.last_interact = time.perf_counter()

    def _on_scroll(self, win, ox, oy):
        if self.webcam:
            self.size_mul = min(max(self.size_mul * math.exp(oy * 0.12), 0.4), 2.5)
        else:
            self.dist *= math.exp(-oy * 0.08)
            self.dist = min(max(self.dist, 1.8), 9.0)
        self.last_interact = time.perf_counter()

    def _on_key(self, win, key, scancode, action, mods):
        if key == glfw.KEY_ESCAPE and action == glfw.PRESS:
            glfw.set_window_should_close(win, True)
        if self.webcam and key == glfw.KEY_D and action == glfw.PRESS:
            self.show_skeleton = not self.show_skeleton
        if self.webcam and key == glfw.KEY_F and action == glfw.PRESS:
            self.cam_flip = not self.cam_flip

    def _init_gl(self):
        self.ctx.enable(moderngl.DEPTH_TEST)
        self.prog_strip = {}
        self.vao_strip = {}
        self.tex_chakra = {}
        proxy = self.ctx.buffer(np.zeros((3, 3), dtype=np.float32).tobytes())
        self.inst_counts = []
        for i, layer in enumerate(LAYERS):
            segs = layer["segments"]
            prog = self.ctx.program(
                vertex_shader=STRIP_VERTEX,
                geometry_shader=STRIP_GEOMETRY.format(
                    max_verts=segs * 2, segments=segs
                ),
                fragment_shader=STRIP_FRAGMENT,
            )
            centers, axes, phases, count = build_instance_buffer(layer)
            buf_c = self.ctx.buffer(centers.tobytes())
            buf_a = self.ctx.buffer(axes.tobytes())
            buf_p = self.ctx.buffer(phases.tobytes())
            vao = self.ctx.vertex_array(
                prog,
                [
                    (proxy, "3f", "in_quad"),
                    (buf_c, "3f/i", "in_center"),
                    (buf_a, "3f/i", "in_axis"),
                    (buf_p, "1f/i", "in_phase"),
                ],
            )
            self.prog_strip[i] = prog
            self.vao_strip[i] = vao
            self.inst_counts.append(count)
            img = make_chakra_texture(layer["tex"])
            tex = self.ctx.texture(img.shape[1::-1], 3, img.tobytes())
            tex.filter = (moderngl.LINEAR, moderngl.LINEAR)
            tex.repeat_x = False
            tex.repeat_y = False
            self.tex_chakra[i] = tex

        self.prog_glow = self.ctx.program(
            vertex_shader=GLOW_VERTEX, fragment_shader=GLOW_FRAGMENT
        )
        quad = np.array([-1, -1, 1, -1, -1, 1, 1, 1], dtype=np.float32)
        self.vbo_glow = self.ctx.buffer(quad.tobytes())
        self.vao_glow = self.ctx.vertex_array(
            self.prog_glow, [(self.vbo_glow, "2f", "in_p")]
        )

        self.prog_hand = self.ctx.program(
            vertex_shader=HAND_VERTEX, fragment_shader=HAND_FRAGMENT
        )
        hv, hn, hi = build_hand_mesh()
        self.hand_count = len(hi)
        self.vbo_hand = self.ctx.buffer(hv.tobytes())
        self.vbo_hand_n = self.ctx.buffer(hn.tobytes())
        self.ibo_hand = self.ctx.buffer(hi.tobytes())
        self.vao_hand = self.ctx.vertex_array(
            self.prog_hand,
            [(self.vbo_hand, "3f", "in_pos"), (self.vbo_hand_n, "3f", "in_normal")],
            index_buffer=self.ibo_hand,
        )

        self.vbo_fs = self.ctx.buffer(quad.tobytes())
        self.prog_bright = self.ctx.program(
            vertex_shader=FS_VERTEX, fragment_shader=BRIGHT_FRAGMENT
        )
        self.prog_blur = self.ctx.program(
            vertex_shader=FS_VERTEX, fragment_shader=BLUR_FRAGMENT
        )
        self.prog_comp = self.ctx.program(
            vertex_shader=FS_VERTEX, fragment_shader=COMPOSITE_FRAGMENT
        )
        self.vao_bright = self.ctx.vertex_array(
            self.prog_bright, [(self.vbo_fs, "2f", "in_p")]
        )
        self.vao_blur = self.ctx.vertex_array(
            self.prog_blur, [(self.vbo_fs, "2f", "in_p")]
        )
        self.vao_comp = self.ctx.vertex_array(
            self.prog_comp, [(self.vbo_fs, "2f", "in_p")]
        )
        self.tex_black = self.ctx.texture((1, 1), 4, np.zeros(4, dtype=np.uint8).tobytes())
        self.tex_black.filter = (moderngl.LINEAR, moderngl.LINEAR)

        self.width, self.height = self.ctx.screen.size
        self.yaw = 0.6
        self.pitch = 0.32
        self.dist = 3.3
        self.target = np.array([0.0, -0.45, -0.08])
        self.auto_spin = 0.45
        self.dragging = False
        self.last_interact = 0.0

        self.float_ok = "GL_ARB_color_buffer_float" in self.ctx.extensions
        self._init_targets()
        self.ready = True

    def _init_targets(self):
        for name in (
            "tex_scene", "fbo_scene", "depth_rb",
            "tex_energy", "fbo_energy",
            "tex_blur_a", "fbo_blur_a", "tex_blur_b", "fbo_blur_b",
        ):
            obj = getattr(self, name, None)
            if obj is not None:
                obj.release()
        dtype = "f2" if self.float_ok else "f1"
        w, h = self.width, self.height
        bw, bh = max(w // 2, 1), max(h // 2, 1)
        self.bloom_size = (bw, bh)

        self.tex_scene = self.ctx.texture((w, h), 4, dtype=dtype)
        self.tex_scene.filter = (moderngl.LINEAR, moderngl.LINEAR)
        self.depth_rb = self.ctx.depth_renderbuffer((w, h))
        self.fbo_scene = self.ctx.framebuffer(
            color_attachments=[self.tex_scene], depth_attachment=self.depth_rb
        )
        self.fbo_scene.viewport = (0, 0, w, h)

        self.tex_energy = self.ctx.texture((w, h), 4, dtype=dtype)
        self.tex_energy.filter = (moderngl.LINEAR, moderngl.LINEAR)
        self.fbo_energy = self.ctx.framebuffer(color_attachments=[self.tex_energy])
        self.fbo_energy.viewport = (0, 0, w, h)

        self.tex_blur_a = self.ctx.texture((bw, bh), 4, dtype=dtype)
        self.tex_blur_a.filter = (moderngl.LINEAR, moderngl.LINEAR)
        self.fbo_blur_a = self.ctx.framebuffer(color_attachments=[self.tex_blur_a])
        self.fbo_blur_a.viewport = (0, 0, bw, bh)
        self.tex_blur_b = self.ctx.texture((bw, bh), 4, dtype=dtype)
        self.tex_blur_b.filter = (moderngl.LINEAR, moderngl.LINEAR)
        self.fbo_blur_b = self.ctx.framebuffer(color_attachments=[self.tex_blur_b])
        self.fbo_blur_b.viewport = (0, 0, bw, bh)

    def _fs_pass(self, prog, vao, fbo, **uniforms):
        self.ctx.disable(moderngl.BLEND)
        self.ctx.disable(moderngl.DEPTH_TEST)
        self.ctx.depth_mask = True
        for name, val in uniforms.items():
            if isinstance(val, tuple) and len(val) == 2 and isinstance(val[0], moderngl.Texture):
                tex, unit = val
                tex.use(unit)
                prog[name].value = unit
            elif isinstance(val, (int, float)):
                prog[name].value = float(val)
            elif isinstance(val, np.ndarray) and val.shape == (2,):
                prog[name].value = tuple(val)
        fbo.use()
        vao.render(moderngl.TRIANGLE_STRIP)

    def _bloom(self, src_tex, threshold):
        bw, bh = self.bloom_size
        self._fs_pass(
            self.prog_bright, self.vao_bright, self.fbo_blur_a,
            u_tex=(src_tex, 0), u_threshold=threshold,
        )
        radius = 1.0
        for _ in range(2):
            self._fs_pass(
                self.prog_blur, self.vao_blur, self.fbo_blur_b,
                u_tex=(self.tex_blur_a, 0), u_dir=np.array([radius / bw, 0.0]),
            )
            self._fs_pass(
                self.prog_blur, self.vao_blur, self.fbo_blur_a,
                u_tex=(self.tex_blur_b, 0), u_dir=np.array([0.0, radius / bh]),
            )
            radius *= 2.0
        return self.tex_blur_a

    def _composite(self, scene_tex, add_tex, bloom_tex, strength, exposure, flip=0.0):
        self.ctx.disable(moderngl.DEPTH_TEST)
        self.ctx.disable(moderngl.BLEND)
        self._fs_pass(
            self.prog_comp, self.vao_comp, self.ctx.screen,
            u_scene=(scene_tex, 0),
            u_add=(add_tex, 1),
            u_bloom=(bloom_tex, 2),
            u_bloom_strength=strength,
            u_exposure=exposure,
            u_flip=flip,
        )

    def _camera(self):
        cp = math.cos(self.pitch)
        eye = self.target + self.dist * np.array([
            cp * math.sin(self.yaw),
            math.sin(self.pitch),
            cp * math.cos(self.yaw),
        ])
        view = mat_lookat(eye, self.target)
        proj = mat_perspective(FOVY, self.width / self.height, 0.05, 50.0)
        vp = proj @ view
        x = norm(cross((0, 1, 0), norm(eye - self.target)))
        y = cross(norm(eye - self.target), x)
        return vp, eye, x, y

    def _draw_strips(self, mvp, center, scale, fade, t):
        for i, layer in enumerate(LAYERS):
            prog = self.prog_strip[i]
            prog["u_mvp"].write(cm(mvp))
            prog["u_time"].value = t
            prog["u_speed"].value = layer["speed"]
            prog["u_seg_angle"].value = layer["seg_angle"]
            prog["u_radial_amp"].value = layer["radial_amp"]
            prog["u_wave_freq"].value = layer["wave_freq"]
            prog["u_wave_trail"].value = layer["wave_trail"]
            prog["u_quad"].value = layer["quad"]
            prog["u_intensity"].value = layer["intensity"]
            prog["u_orb_center"].value = tuple(center)
            prog["u_orb_scale"].value = scale
            prog["u_fade"].value = fade
            self.tex_chakra[i].use(0)
            prog["u_tex"].value = 0
            self.vao_strip[i].render(moderngl.TRIANGLES, instances=self.inst_counts[i])

    def _draw_glows(self, vp, center, right, up, orb_r, fade, t):
        pulse = 1.0 + 0.05 * math.sin(t * 3.0)
        for g in GLOWS:
            prog = self.prog_glow
            prog["u_vp"].write(cm(vp))
            prog["u_center"].value = tuple(center)
            prog["u_right"].value = tuple(right)
            prog["u_up"].value = tuple(up)
            prog["u_size"].value = g["f"] * orb_r * pulse
            prog["u_color"].value = tuple(g["color"])
            prog["u_strength"].value = g["strength"] * fade
            prog["u_power"].value = g["power"]
            self.vao_glow.render(moderngl.TRIANGLE_STRIP)

    def _render_classic(self, t, dt):
        idle = time.perf_counter() - self.last_interact
        if not self.dragging and idle > 1.5:
            self.yaw += dt * self.auto_spin

        vp, eye, cam_x, cam_y = self._camera()
        spin = mat_roty(self.yaw * 0.35)
        tilt = mat_rotx(HAND_TILT)
        model = spin @ tilt
        palm_pos = transform_point(tilt, PALM_CENTER)
        palm_nrm = tilt[:3, :3] @ PALM_NORMAL
        finger_dir = tilt[:3, :3] @ np.array([0.0, 0.0, -1.0])
        bob = BOB_AMP * math.sin(t * BOB_FREQ)
        energy_local = (palm_pos + palm_nrm * (ORB_R + 0.14 + bob)
                        + finger_dir * 0.12)
        energy_world = transform_point(spin, energy_local)

        self.fbo_scene.use()
        self.ctx.clear(0.012, 0.016, 0.028, 1.0)
        self.ctx.enable(moderngl.DEPTH_TEST)
        self.ctx.depth_mask = True
        self.ctx.disable(moderngl.BLEND)

        prog = self.prog_hand
        prog["u_mvp"].write(cm(vp @ model))
        prog["u_model"].write(cm(model))
        prog["u_cam"].value = tuple(eye)
        prog["u_key_dir"].value = tuple(norm((0.45, 0.85, 0.5)))
        prog["u_fill_dir"].value = tuple(norm((-0.6, 0.15, -0.7)))
        prog["u_energy_pos"].value = tuple(energy_world)
        self.vao_hand.render(moderngl.TRIANGLES)

        self.ctx.enable(moderngl.BLEND)
        self.ctx.blend_func = moderngl.ONE, moderngl.ONE
        self.ctx.blend_equation = moderngl.FUNC_ADD
        self.ctx.disable(moderngl.CULL_FACE)
        self.ctx.depth_mask = False

        self._draw_strips(vp @ spin, energy_local, ORB_R, 1.0, t)
        self._draw_glows(vp, energy_world, cam_x, cam_y, ORB_R, 1.0, t)

        bloom = self._bloom(self.tex_scene, 0.50)
        self._composite(self.tex_scene, self.tex_black, bloom, 1.20, 1.35)

    def _grab_camera(self, t):
        ret, frame = self.cap.read()
        if ret and frame is not None:
            self.last_frame = frame
        if self.last_frame is None:
            return None
        frame = self.cv2.flip(self.last_frame, 1)
        if t - self.last_track_t > 1.0 / 24.0:
            rgb = self.cv2.cvtColor(frame, self.cv2.COLOR_BGR2RGB)
            self.mp_res = self.tracker.process(rgb)
            self.last_track_t = t
        if self.show_skeleton and self.mp_res:
            HandTracker.draw_skeleton(frame, self.mp_res)
        rgb = self.cv2.cvtColor(frame, self.cv2.COLOR_BGR2RGB)
        fh, fw = rgb.shape[:2]
        if self.cam_tex is None or self.cam_tex.size != (fw, fh):
            if self.cam_tex is not None:
                self.cam_tex.release()
            self.cam_tex = self.ctx.texture((fw, fh), 3, rgb.tobytes())
            self.cam_tex.filter = (moderngl.LINEAR, moderngl.LINEAR)
        else:
            self.cam_tex.write(rgb.tobytes())
        return self.cam_tex

    def _render_webcam(self, t, dt):
        cam_tex = self._grab_camera(t)
        W, H = self.width, self.height

        target = HandTracker.palm_of(self.mp_res)
        if target is not None:
            palm, size = target
            pos = np.array([palm[0] * W, palm[1] * H])
            size_pix = size * H
            if self.hand_pos is None:
                self.hand_pos = pos
                self.hand_size = size_pix
            else:
                ap = 1.0 - math.exp(-dt * 14.0)
                asz = 1.0 - math.exp(-dt * 10.0)
                self.hand_pos = self.hand_pos * (1 - ap) + pos * ap
                self.hand_size = self.hand_size * (1 - asz) + size_pix * asz
            self.hand_seen = t
        fade_target = 1.0 if t - self.hand_seen < 0.25 else 0.0
        self.fade += (fade_target - self.fade) * (1.0 - math.exp(-dt * 7.0))
        if self.hand_pos is None:
            self.hand_pos = np.array([W * 0.5, H * 0.42])
            self.hand_size = H * 0.16

        orb_r = max(self.hand_size * 0.52 * self.size_mul, 2.0)
        center = np.array([
            self.hand_pos[0],
            self.hand_pos[1] - self.hand_size * 0.18 + orb_r * 0.06 * math.sin(t * 2.3),
            0.0,
        ])

        self.fbo_energy.use()
        self.ctx.clear(0.0, 0.0, 0.0, 0.0)
        self.ctx.disable(moderngl.DEPTH_TEST)
        self.ctx.enable(moderngl.BLEND)
        self.ctx.blend_func = moderngl.ONE, moderngl.ONE
        self.ctx.blend_equation = moderngl.FUNC_ADD

        ortho = mat_ortho(0.0, W, H, 0.0)
        self._draw_strips(ortho, center, orb_r * self.fade, self.fade, t)
        self._draw_glows(ortho, center, (1.0, 0.0, 0.0), (0.0, 1.0, 0.0),
                         orb_r * self.fade, self.fade, t)

        bloom = self._bloom(self.tex_energy, 0.30)
        self._composite(cam_tex if cam_tex is not None else self.tex_black,
                        self.tex_energy, bloom, 0.90, 1.15,
                        flip=1.0 if self.cam_flip else 0.0)

    def render_frame(self, t, dt):
        if self.webcam:
            self._render_webcam(t, dt)
        else:
            self._render_classic(t, dt)

    def run(self):
        prev = time.perf_counter()
        t = 0.0
        fps_accum = 0.0
        fps_frames = 0
        mode = "hand tracking" if self.webcam else "classic"
        while not glfw.window_should_close(self.window):
            now = time.perf_counter()
            dt = min(now - prev, 0.05)
            prev = now
            t += dt
            self.render_frame(t, dt)
            glfw.swap_buffers(self.window)
            glfw.poll_events()
            fps_accum += dt
            fps_frames += 1
            if fps_accum >= 0.5:
                glfw.set_window_title(
                    self.window,
                    f"Rasengan  |  {mode}  |  {fps_frames / fps_accum:5.1f} fps",
                )
                fps_accum = 0.0
                fps_frames = 0
        self._cleanup()

    def run_shot(self):
        self.auto_spin = 0.0
        self.yaw = 0.60
        self.pitch = 0.32
        dt = 1.0 / 60.0
        t = 0.0
        while t < self.shot_time:
            self.render_frame(t, dt)
            t += dt
        data = self.ctx.screen.read(components=3)
        glfw.terminate()
        from PIL import Image

        img = Image.frombytes("RGB", (self.width, self.height), data)
        img = img.transpose(Image.FLIP_TOP_BOTTOM)
        img.save(self.shot_path)
        print("saved", self.shot_path)

    def _cleanup(self):
        if self.cap is not None:
            self.cap.release()
        if self.tracker is not None:
            self.tracker.close()
        glfw.terminate()


def main():
    args = sys.argv[1:]
    shot = None
    if "--shot" in args:
        shot = args[args.index("--shot") + 1]
    classic = "--classic" in args
    cam_index = 0
    if "--cam" in args:
        cam_index = int(args[args.index("--cam") + 1])
    webcam = not shot and not classic
    app = RasenganApp(shot_path=shot, webcam=webcam, cam_index=cam_index)
    if shot:
        app.run_shot()
    else:
        app.run()


if __name__ == "__main__":
    main()
