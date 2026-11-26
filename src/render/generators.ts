import type { Source } from '../shared/config.ts'

type PatternSource = Extract<Source, { kind: 'pattern' }>
type ShaderSource = Extract<Source, { kind: 'shader' }>
type Draw2D = (width: number, height: number, pad: number, frame: number) => void

function createRng(seed: number) {
  let s = seed > 0 ? seed : 1
  return () => {
    s ^= s << 13
    s ^= s >>> 17
    s ^= s << 5
    return (s >>> 0) / 0x100000000
  }
}

// ── Seeded 2D noise (for canvas mesh / pattern motion) ──────────────────────
function createNoise(seed: number) {
  const rng = createRng(seed)
  const perm: number[] = []
  for (let i = 0; i < 256; i++) perm[i] = i
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    const t = perm[i]!; perm[i] = perm[j]!; perm[j] = t
  }
  for (let i = 0; i < 256; i++) perm[i + 256] = perm[i]!
  function fade(t: number) { return t * t * t * (t * (t * 6 - 15) + 10) }
  function lerp(a: number, b: number, t: number) { return a + (b - a) * t }
  function grad(hash: number, x: number, y: number) {
    const h = hash & 15
    const u = h < 8 ? x : y
    const v = h < 4 ? y : (h === 12 || h === 14) ? x : 0
    return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v)
  }
  return (x: number, y: number) => {
    const X = Math.floor(x) & 255
    const Y = Math.floor(y) & 255
    x -= Math.floor(x)
    y -= Math.floor(y)
    const u = fade(x)
    const v = fade(y)
    const A = perm[X]! + Y
    return lerp(
      lerp(grad(perm[A]!, x, y), grad(perm[A! + 1]!, x - 1, y), u),
      lerp(grad(perm[A! + 256]!, x, y - 1), grad(perm[A! + 257]!, x - 1, y - 1), u),
      v,
    )
  }
}

function mesh(g: CanvasRenderingContext2D, params: Extract<Source, { kind: 'mesh' }>): Draw2D {
  const rng = createRng(params.seed)
  const noise = createNoise(params.seed)
  const dark = rng() < 0.5
  const baseHue = Math.round(rng() * 360)
  const count = Math.round(7 + 9 * params.scale * params.intensity)
  const blobs: { x: number; y: number; r: number; hx: number; hy: number; speed: number; hue: number; sat: number; lit: number }[] = []
  for (let i = 0; i < count; i++) {
    blobs.push({
      x: rng(), y: rng(),
      r: (0.22 + rng() * 0.6) * params.scale,
      hx: rng() * 4 - 2, hy: rng() * 4 - 2,
      speed: 0.05 + rng() * 0.1,
      hue: (baseHue + (rng() < 0.5 ? 30 : 180) + rng() * 60) % 360,
      sat: Math.round(45 + rng() * 50 * params.intensity),
      lit: dark ? Math.round(18 + rng() * 35 * params.intensity) : Math.round(60 + rng() * 25 * params.intensity),
    })
  }
  const alpha = (0.22 + 0.3 * params.intensity).toFixed(3)
  const innerAlpha = (+alpha * 0.35).toFixed(3)
  return (w, h, pad, frame) => {
    const t = frame * 0.028
    g.fillStyle = dark ? '#0a0b0e' : '#f5f7fa'
    g.fillRect(-pad, -pad, w + 2 * pad, h + 2 * pad)
    for (const b of blobs) {
      const phase = t * b.speed
      const cx = (((b.x + noise(b.hx + phase * 0.3, b.hy) * 0.25 + phase * 0.03) % 1 + 1) % 1) * w
      const cy = (((b.y + noise(b.hx, b.hy + phase * 0.3) * 0.25 + phase * 0.012) % 1 + 1) % 1) * h
      const r = b.r * Math.min(w, h) * (0.8 + 0.4 * Math.sin(phase + b.hx))
      const rad = g.createRadialGradient(cx, cy, 0, cx, cy, r)
      rad.addColorStop(0, `hsla(${b.hue},${b.sat}%,${b.lit}%,${alpha})`)
      rad.addColorStop(0.55, `hsla(${b.hue},${Math.round(b.sat * 0.6)}%,${b.lit}%,${innerAlpha})`)
      rad.addColorStop(1, 'hsla(0,0%,0%,0)')
      g.fillStyle = rad
      g.fillRect(-pad, -pad, w + 2 * pad, h + 2 * pad)
    }
  }
}

function dots(g: CanvasRenderingContext2D, params: Extract<Source, { kind: 'pattern' }>): Draw2D {
  const rng = createRng(params.seed)
  const dark = rng() < 0.5
  const baseHue = Math.round(rng() * 360)
  const spacing = Math.max(26, 130 * params.scale / (0.35 + params.density))
  const count = Math.round(4 + 6 * params.density)
  const dots: { cx: number; cy: number; r: number; hue: number; sat: number; lit: number; phase: number; speed: number }[] = []
  for (let y = 0; y < count; y++) {
    for (let x = 0; x < count; x++) {
      dots.push({
        cx: x / (count - 1), cy: y / (count - 1),
        r: spacing * 0.16 * params.scale * (0.6 + rng() * 0.7),
        hue: (baseHue + rng() * 80) % 360,
        sat: Math.round(35 + rng() * 55),
        lit: dark ? Math.round(30 + rng() * 35) : Math.round(55 + rng() * 30),
        phase: rng() * Math.PI * 2,
        speed: 0.5 + rng() * 1.2,
      })
    }
  }
  return (w, h, pad, frame) => {
    const t = frame * 0.032
    g.fillStyle = dark ? '#0a0b0d' : '#f6f7f9'
    g.fillRect(-pad, -pad, w + 2 * pad, h + 2 * pad)
    for (const d of dots) {
      const pulse = 0.75 + 0.35 * Math.sin(t * d.speed + d.phase)
      const r = Math.max(1, d.r * pulse)
      const x = d.cx * w + (d.r * 0.3) * Math.sin(t * d.speed * 0.5 + d.phase)
      const y = d.cy * h + (d.r * 0.3) * Math.cos(t * d.speed * 0.7 + d.phase)
      g.beginPath()
      g.arc(x, y, r, 0, Math.PI * 2)
      g.fillStyle = `hsla(${d.hue},${d.sat}%,${d.lit}%,${(0.18 + 0.25 * pulse).toFixed(2)})`
      g.fill()
    }
  }
}

function rain(g: CanvasRenderingContext2D, params: PatternSource): Draw2D {
  const rng = createRng(params.seed)
  const dark = rng() < 0.5
  const hue = Math.round(rng() * 360)
  const count = Math.round(30 + params.density * 150)
  const drops: { x: number; y: number; len: number; speed: number; sat: number; lit: number; alpha: number; width: number }[] = []
  for (let i = 0; i < count; i++) {
    drops.push({
      x: rng(),
      y: rng(),
      len: (0.035 + rng() * 0.075) * (0.7 + params.scale * 0.5),
      speed: (0.25 + rng() * 0.55) * (0.6 + params.scale * 0.5),
      sat: Math.round(30 + rng() * 40),
      lit: dark ? Math.round(55 + rng() * 25) : Math.round(40 + rng() * 25),
      alpha: 0.12 + rng() * 0.28,
      width: 0.8 + rng() * 1.4,
    })
  }
  return (w, h, pad, frame) => {
    const t = frame * 0.016
    g.fillStyle = dark ? '#07080c' : '#f4f6f9'
    g.fillRect(-pad, -pad, w + 2 * pad, h + 2 * pad)
    for (const d of drops) {
      const yy = (((d.y + t * d.speed) % 1) + 1) % 1
      const x = d.x * w
      const y0 = yy * h
      const y1 = y0 - d.len * h
      const grad = g.createLinearGradient(x, y0, x, y1)
      grad.addColorStop(0, `hsla(${hue},${d.sat}%,${d.lit}%,${d.alpha.toFixed(2)})`)
      grad.addColorStop(1, 'hsla(0,0%,0%,0)')
      g.strokeStyle = grad
      g.lineWidth = d.width
      g.beginPath()
      g.moveTo(x, y0)
      g.lineTo(x, y1)
      g.stroke()
    }
  }
}

function contour(g: CanvasRenderingContext2D, params: PatternSource): Draw2D {
  const noise = createNoise(params.seed)
  const rng = createRng(params.seed + 1013)
  const dark = rng() < 0.5
  const hue = Math.round(rng() * 360)
  const layers = Math.round(16 + params.density * 46)
  const freq = 0.0016 / params.scale
  const amp = 0.055 * params.scale
  return (w, h, pad, frame) => {
    const t = frame * 0.032
    g.fillStyle = dark ? '#0a0b0e' : '#f6f7fa'
    g.fillRect(-pad, -pad, w + 2 * pad, h + 2 * pad)
    const samples = Math.max(60, Math.floor(w / 8))
    for (let i = 0; i <= layers; i++) {
      const base = i / layers
      const shift = t * 0.05
      g.beginPath()
      for (let s = 0; s <= samples; s++) {
        const fx = s / samples
        const n = noise(fx * 60 * freq * 400, i * 0.22 + shift)
        const y = (base + (n - 0.5) * amp) * h
        if (s === 0) g.moveTo(0, y)
        else g.lineTo(fx * w, y)
      }
      const lit = dark ? 20 + (i / layers) * 22 : 62 - (i / layers) * 18
      g.strokeStyle = `hsla(${(hue + i * 2) % 360},30%,${lit}%,${(0.25 + 0.2 * (i / layers)).toFixed(2)})`
      g.lineWidth = 1
      g.stroke()
    }
  }
}

function meta(g: CanvasRenderingContext2D, params: PatternSource): Draw2D {
  const rng = createRng(params.seed)
  const dark = rng() < 0.5
  const baseHue = Math.round(rng() * 360)
  const count = Math.round(5 + params.density * 11)
  const blobs: { x: number; y: number; r: number; ax: number; ay: number; speed: number; phase: number; hue: number }[] = []
  for (let i = 0; i < count; i++) {
    blobs.push({
      x: 0.15 + rng() * 0.7, y: 0.15 + rng() * 0.7,
      r: (0.09 + rng() * 0.14) * params.scale,
      ax: 0.08 + rng() * 0.22, ay: 0.08 + rng() * 0.22,
      speed: 0.15 + rng() * 0.3,
      phase: rng() * Math.PI * 2,
      hue: (baseHue + rng() * 70) % 360,
    })
  }
  return (w, h, pad, frame) => {
    const t = frame * 0.03
    g.fillStyle = dark ? '#08090d' : '#f5f6f9'
    g.fillRect(-pad, -pad, w + 2 * pad, h + 2 * pad)
    g.globalCompositeOperation = dark ? 'lighter' : 'multiply'
    for (const b of blobs) {
      const cx = (b.x + Math.sin(t * b.speed + b.phase) * b.ax) * w
      const cy = (b.y + Math.cos(t * b.speed * 0.83 + b.phase * 1.7) * b.ay) * h
      const r = b.r * Math.min(w, h) * (0.9 + 0.2 * Math.sin(t * b.speed + b.phase))
      const rad = g.createRadialGradient(cx, cy, 0, cx, cy, r)
      if (dark) {
        rad.addColorStop(0, `hsla(${b.hue},65%,58%,0.55)`)
        rad.addColorStop(0.7, `hsla(${b.hue},60%,45%,0.18)`)
        rad.addColorStop(1, 'hsla(0,0%,0%,0)')
      } else {
        rad.addColorStop(0, `hsla(${b.hue},55%,70%,0.5)`)
        rad.addColorStop(0.7, `hsla(${b.hue},50%,80%,0.2)`)
        rad.addColorStop(1, 'hsla(0,0%,100%,0)')
      }
      g.fillStyle = rad
      g.beginPath()
      g.arc(cx, cy, r, 0, Math.PI * 2)
      g.fill()
    }
    g.globalCompositeOperation = 'source-over'
  }
}

function waves(g: CanvasRenderingContext2D, params: PatternSource): Draw2D {
  const rng = createRng(params.seed)
  const dark = rng() < 0.5
  const hue = Math.round(rng() * 360)
  const layers = Math.round(5 + params.density * 8)
  const waves: { yBase: number; amp: number; freq: number; phase: number; speed: number; hue: number; sat: number; lit: number; alpha: number }[] = []
  for (let i = 0; i < layers; i++) {
    waves.push({
      yBase: 0.25 + (i / layers) * 0.55,
      amp: (25 + rng() * 45) * params.scale,
      freq: (0.006 + rng() * 0.01) / params.scale,
      phase: rng() * Math.PI * 2,
      speed: (0.3 + rng() * 0.7) * (rng() < 0.5 ? 1 : -1),
      hue: (hue + i * 12) % 360,
      sat: Math.round(40 + rng() * 45),
      lit: dark ? Math.round(14 + (i / layers) * 32) : Math.round(72 - (i / layers) * 28),
      alpha: 0.22 + rng() * 0.32,
    })
  }
  return (w, h, pad, frame) => {
    const t = frame * 0.032
    g.fillStyle = dark ? '#07080a' : '#f8f9fb'
    g.fillRect(-pad, -pad, w + 2 * pad, h + 2 * pad)
    for (const wave of waves) {
      g.beginPath()
      g.moveTo(0, h)
      for (let x = 0; x <= w; x += Math.max(6, Math.floor(w / 180))) {
        const y = h * wave.yBase
          + Math.sin(x * wave.freq + wave.phase + t * wave.speed) * wave.amp
          + Math.sin(x * wave.freq * 2.1 + wave.phase * 1.3 - t * wave.speed * 1.5) * wave.amp * 0.5
        g.lineTo(x, y)
      }
      g.lineTo(w, h)
      g.closePath()
      g.fillStyle = `hsla(${wave.hue},${wave.sat}%,${wave.lit}%,${wave.alpha.toFixed(2)})`
      g.fill()
    }
  }
}

function poly(g: CanvasRenderingContext2D, params: PatternSource): Draw2D {
  const rng = createRng(params.seed)
  const dark = rng() < 0.5
  const hue = Math.round(rng() * 360)
  const cols = Math.max(6, Math.round((10 + params.density * 20) / params.scale))
  const rows = Math.max(6, Math.round(cols * 0.65))
  const points: { x: number; y: number; dx: number; dy: number; speed: number }[][] = []
  for (let y = 0; y <= rows; y++) {
    const row: { x: number; y: number; dx: number; dy: number; speed: number }[] = []
    for (let x = 0; x <= cols; x++) {
      row.push({
        x: x / cols, y: y / rows,
        dx: (rng() - 0.5) * 0.02, dy: (rng() - 0.5) * 0.02,
        speed: 0.3 + rng() * 0.5,
      })
    }
    points.push(row)
  }
  const cells: { y: number; x: number; hue: number; sat: number; lit: number; phase: number }[] = []
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      cells.push({ y, x, hue: (hue + rng() * 60) % 360, sat: Math.round(35 + rng() * 40), lit: dark ? Math.round(12 + rng() * 35) : Math.round(65 - rng() * 10), phase: rng() * Math.PI * 2 })
    }
  }
  const px: { x: number; y: number }[][] = points.map(row => row.map(() => ({ x: 0, y: 0 })))
  return (w, h, pad, frame) => {
    const t = frame * 0.03
    g.fillStyle = dark ? '#08090c' : '#f5f6f8'
    g.fillRect(-pad, -pad, w + 2 * pad, h + 2 * pad)
    for (let y = 0; y <= rows; y++) {
      const row = points[y]!
      const out = px[y]!
      for (let x = 0; x <= cols; x++) {
        const p = row[x]!
        out[x]!.x = (p.x + Math.sin(t * p.speed + p.dx * 100) * p.dx) * w
        out[x]!.y = (p.y + Math.cos(t * p.speed + p.dy * 100) * p.dy) * h
      }
    }
    for (const cell of cells) {
      const p1 = px[cell.y]![cell.x]!, p2 = px[cell.y]![cell.x + 1]!, p3 = px[cell.y + 1]![cell.x]!, p4 = px[cell.y + 1]![cell.x + 1]!
      const cx = (p1.x + p2.x + p3.x) / 3 / w
      const lit = Math.max(0, Math.min(100, cell.lit + Math.sin(t * 0.6 + cell.phase) * 6))
      g.beginPath(); g.moveTo(p1.x, p1.y); g.lineTo(p2.x, p2.y); g.lineTo(p3.x, p3.y); g.closePath()
      g.fillStyle = `hsla(${cell.hue + cx * 40},${cell.sat}%,${lit}%,0.92)`
      g.fill()
      g.beginPath(); g.moveTo(p2.x, p2.y); g.lineTo(p4.x, p4.y); g.lineTo(p3.x, p3.y); g.closePath()
      g.fillStyle = `hsla(${(cell.hue + cx * 40 + 12) % 360},${cell.sat}%,${Math.max(0, lit - 4)}%,0.92)`
      g.fill()
    }
  }
}

function shaderFragment(preset: ShaderSource['preset']): string {
  const common = `
    precision mediump float;
    uniform vec2 u_resolution;
    uniform vec2 u_padding;
    uniform float u_time;
    uniform float u_scale;
    uniform float u_seed;

    vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
    vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
    vec4 permute(vec4 x) { return mod289(((x*34.0)+1.0)*x); }
    vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
    vec3 hueRotate(vec3 rgb, float angle) {
      float c = cos(angle), s = sin(angle);
      mat3 m = mat3(
        0.299 + 0.701*c + 0.168*s, 0.587 - 0.587*c + 0.330*s, 0.114 - 0.114*c - 0.497*s,
        0.299 - 0.299*c - 0.328*s, 0.587 + 0.413*c + 0.035*s, 0.114 - 0.114*c + 0.292*s,
        0.299 - 0.300*c + 1.250*s, 0.587 - 0.588*c - 1.050*s, 0.114 + 0.886*c - 0.203*s
      );
      return rgb * m;
    }
    float snoise(vec3 v) {
      const vec2 C = vec2(1.0/6.0, 1.0/3.0);
      const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
      vec3 i = floor(v + dot(v, C.yyy));
      vec3 x0 = v - i + dot(i, C.xxx);
      vec3 g = step(x0.yzx, x0.xyz);
      vec3 l = 1.0 - g;
      vec3 i1 = min(g.xyz, l.zxy);
      vec3 i2 = max(g.xyz, l.zxy);
      vec3 x1 = x0 - i1 + C.xxx;
      vec3 x2 = x0 - i2 + C.yyy;
      vec3 x3 = x0 - D.yyy;
      i = mod289(i);
      vec4 p = permute(permute(permute(
        i.z + vec4(0.0, i1.z, i2.z, 1.0))
        + i.y + vec4(0.0, i1.y, i2.y, 1.0))
        + i.x + vec4(0.0, i1.x, i2.x, 1.0));
      float n_ = 0.142857142857;
      vec3 ns = n_ * D.wyz - D.xzx;
      vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
      vec4 x_ = floor(j * ns.z);
      vec4 y_ = floor(j - 7.0 * x_);
      vec4 x = x_ * ns.x + ns.yyyy;
      vec4 y = y_ * ns.x + ns.yyyy;
      vec4 h = 1.0 - abs(x) - abs(y);
      vec4 b0 = vec4(x.xy, y.xy);
      vec4 b1 = vec4(x.zw, y.zw);
      vec4 s0 = floor(b0)*2.0 + 1.0;
      vec4 s1 = floor(b1)*2.0 + 1.0;
      vec4 sh = -step(h, vec4(0.0));
      vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy;
      vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;
      vec3 p0 = vec3(a0.xy, h.x);
      vec3 p1 = vec3(a0.zw, h.y);
      vec3 p2 = vec3(a1.xy, h.z);
      vec3 p3 = vec3(a1.zw, h.w);
      vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
      p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
      vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
      m = m * m;
      return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
    }
    float fbm(vec3 p) {
      float v = 0.0, a = 0.5;
      for (int i = 0; i < 5; i++) {
        v += a * snoise(p);
        p *= 2.0; a *= 0.5;
      }
      return v;
    }
  `
  if (preset === 'aurora') {
    return common + `
      void main() {
        vec2 uv = (gl_FragCoord.xy - u_padding) / u_resolution;
        float t = u_time;
        float n1 = fbm(vec3(uv * 2.5 * u_scale, t));
        float n2 = fbm(vec3(uv * 4.0 * u_scale + 7.0, t * 1.4));
        float n3 = fbm(vec3(uv * 1.2 * u_scale - 3.0, t * 0.7));
        float bands = smoothstep(0.15, 0.85, 0.5 + 0.5 * sin((uv.y + n3 * 0.08) * 8.0 + n1 * 1.5));
        vec3 c1 = vec3(0.03, 0.08, 0.14);
        vec3 c2 = vec3(0.05, 0.28, 0.32);
        vec3 c3 = vec3(0.18, 0.62, 0.42);
        vec3 c4 = vec3(0.55, 0.22, 0.52);
        vec3 c5 = vec3(0.85, 0.35, 0.25);
        vec3 col = mix(c1, c2, bands);
        col = mix(col, c3, smoothstep(0.25, 0.75, n1));
        col = mix(col, c4, smoothstep(0.45, 0.85, n2) * 0.75);
        col = mix(col, c5, smoothstep(0.7, 0.95, n2 + n1 * 0.3) * 0.45);
        col = hueRotate(col, u_seed * 6.28318530718);
        gl_FragColor = vec4(col, 1.0);
      }
    `
  }
  if (preset === 'nebula') {
    return common + `
      void main() {
        vec2 uv = (gl_FragCoord.xy - u_padding) / u_resolution;
        float t = u_time * 0.8;
        float n = fbm(vec3(uv * 2.2 * u_scale, t));
        float n2 = fbm(vec3(uv * 5.0 * u_scale - 4.0, t * 0.65));
        float n3 = fbm(vec3(uv * 0.9 * u_scale + 2.0, t * 0.4));
        vec3 c1 = vec3(0.02, 0.02, 0.08);
        vec3 c2 = vec3(0.12, 0.04, 0.22);
        vec3 c3 = vec3(0.32, 0.10, 0.35);
        vec3 c4 = vec3(0.10, 0.18, 0.42);
        vec3 c5 = vec3(0.55, 0.30, 0.55);
        vec3 col = mix(c1, c2, smoothstep(-0.5, 0.6, n));
        col = mix(col, c3, smoothstep(0.15, 0.8, n2) * 0.75);
        col = mix(col, c4, smoothstep(0.35, 0.85, n + n3 * 0.3) * 0.55);
        col = mix(col, c5, smoothstep(0.6, 0.95, n2) * 0.35);
        col = hueRotate(col, u_seed * 6.28318530718);
        gl_FragColor = vec4(col, 1.0);
      }
    `
  }
  if (preset === 'starfield') {
    return common + `
      float hash21(vec2 p) {
        p = fract(p * vec2(234.34, 435.345));
        p += dot(p, p + 34.23);
        return fract(p.x * p.y);
      }
      vec3 starLayer(vec2 uv, float t, float density) {
        vec3 col = vec3(0.0);
        vec2 grid = uv * density;
        vec2 cell = floor(grid);
        vec2 f = fract(grid) - 0.5;
        float h = hash21(cell);
        if (h > 0.8) {
          vec2 offs = (vec2(hash21(cell + 1.3), hash21(cell + 2.7)) - 0.5) * 0.7;
          float d = length(f - offs);
          float tw = 0.35 + 0.65 * sin(t * (1.0 + h * 2.5) + h * 40.0);
          col += vec3(0.85, 0.92, 1.0) * (1.0 - smoothstep(0.0, 0.07, d)) * max(0.0, tw);
        }
        return col;
      }
      void main() {
        vec2 uv = (gl_FragCoord.xy - u_padding) / u_resolution;
        vec2 p = ((gl_FragCoord.xy - u_padding) - 0.5 * u_resolution) / u_resolution.y;
        p += vec2(u_seed * 17.0, u_seed * 11.0);
        float t = u_time * 0.5;
        vec3 col = mix(vec3(0.012, 0.014, 0.035), vec3(0.035, 0.035, 0.08), uv.y);
        // Faint drifting nebula veil behind the stars.
        float n = fbm(vec3(p * 2.2 * u_scale, t * 0.05));
        col += vec3(0.05, 0.045, 0.11) * smoothstep(0.05, 0.85, n);
        vec3 stars = vec3(0.0);
        stars += starLayer(p + vec2(t * 0.006, 0.0), t, 13.0 * u_scale);
        stars += starLayer(p * 1.8 + vec2(t * 0.013, 3.0), t * 1.25, 27.0 * u_scale);
        stars += starLayer(p * 3.1 + vec2(t * 0.021, 7.0), t * 0.85, 46.0 * u_scale);
        col += stars;
        col = hueRotate(col, u_seed * 6.28318530718);
        gl_FragColor = vec4(col, 1.0);
      }
    `
  }
  // noise
  return common + `
    void main() {
      vec2 uv = (gl_FragCoord.xy - u_padding) / u_resolution;
      float t = u_time;
      float n = fbm(vec3(uv * 3.5 * u_scale, t));
      float n2 = fbm(vec3(uv * 9.0 * u_scale + 15.0, t * 1.6));
      float n3 = fbm(vec3(uv * 1.5 * u_scale - 5.0, t * 0.5));
      vec3 c1 = vec3(0.06, 0.06, 0.08);
      vec3 c2 = vec3(0.16, 0.18, 0.22);
      vec3 c3 = vec3(0.30, 0.32, 0.36);
      vec3 c4 = vec3(0.46, 0.48, 0.52);
      vec3 col = mix(c1, c2, 0.5 + 0.5 * n + n3 * 0.15);
      col = mix(col, c3, smoothstep(0.3, 0.8, n2) * 0.45);
      col = mix(col, c4, smoothstep(0.6, 0.95, n2) * 0.25);
      col = hueRotate(col, u_seed * 6.28318530718);
      gl_FragColor = vec4(col, 1.0);
    }
  `
}

export type GeneratorSource = Extract<Source, { kind: 'mesh' | 'shader' | 'pattern' }>
export function canvasGenerator(ctx: CanvasRenderingContext2D, source: Exclude<GeneratorSource, { kind: 'shader' }>): Draw2D {
  return source.kind === 'mesh' ? mesh(ctx, source) : ({ dots, waves, poly, rain, contour, meta })[source.preset](ctx, source)
}
export function fallbackGradient(seed: number) {
  const hue = Math.floor(createRng(seed)() * 360)
  return `linear-gradient(135deg, hsl(${hue} 55% 20%), hsl(${(hue + 80) % 360} 58% 42%), hsl(${(hue + 145) % 360} 48% 23%))`
}
export function shaderGenerator(canvas: HTMLCanvasElement, source: Extract<Source, { kind: 'shader' }>, lost: () => void) {
  let gl: WebGLRenderingContext | null
  try { gl = canvas.getContext('webgl', { alpha: false, antialias: false }) }
  catch { return undefined }
  if (!gl) return undefined
  const shaders: WebGLShader[] = []
  let program: WebGLProgram | null = null
  let buffer: WebGLBuffer | null = null
  const dispose = () => {
    canvas.removeEventListener('webglcontextlost', lost)
    gl.useProgram(null)
    gl.bindBuffer(gl.ARRAY_BUFFER, null)
    if (buffer) gl.deleteBuffer(buffer)
    if (program) gl.deleteProgram(program)
    for (const shader of shaders) gl.deleteShader(shader)
    if (!gl.isContextLost()) gl.getExtension('WEBGL_lose_context')?.loseContext()
  }
  function compile(type: number, text: string) {
    const shader = gl!.createShader(type)
    if (!shader) throw new Error('WebGL shader allocation failed')
    shaders.push(shader)
    gl!.shaderSource(shader, text)
    gl!.compileShader(shader)
    if (!gl!.getShaderParameter(shader, gl!.COMPILE_STATUS)) throw new Error('WebGL compilation failed')
    return shader
  }
  try {
    const vertex = compile(gl.VERTEX_SHADER, 'attribute vec2 pos; void main(){ gl_Position = vec4(pos, 0.0, 1.0); }')
    const fragment = compile(gl.FRAGMENT_SHADER, shaderFragment(source.preset))
    program = gl.createProgram()
    if (!program) throw new Error('WebGL program allocation failed')
    gl.attachShader(program, vertex)
    gl.attachShader(program, fragment)
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('WebGL link failed')
    buffer = gl.createBuffer()
    const position = gl.getAttribLocation(program, 'pos')
    if (!buffer || position < 0) throw new Error('WebGL vertex setup failed')
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    gl.enableVertexAttribArray(position)
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0)
    gl.useProgram(program)
    const resolution = gl.getUniformLocation(program, 'u_resolution')
    const padding = gl.getUniformLocation(program, 'u_padding')
    const time = gl.getUniformLocation(program, 'u_time')
    gl.uniform1f(gl.getUniformLocation(program, 'u_scale'), source.scale)
    gl.uniform1f(gl.getUniformLocation(program, 'u_seed'), source.seed / 2147483647)
    if (gl.getError() !== gl.NO_ERROR) throw new Error('WebGL setup failed')
    canvas.addEventListener('webglcontextlost', lost)
    return {
      dispose,
      draw(width: number, height: number, pad: number, frame: number) {
        if (gl.isContextLost()) return false
        const scaleX = canvas.width / (width + 2 * pad), scaleY = canvas.height / (height + 2 * pad)
        gl.viewport(0, 0, canvas.width, canvas.height)
        gl.uniform2f(resolution, width * scaleX, height * scaleY)
        gl.uniform2f(padding, pad * scaleX, pad * scaleY)
        gl.uniform1f(time, frame * 0.32 * source.speed)
        gl.drawArrays(gl.TRIANGLES, 0, 3)
        return !gl.isContextLost()
      },
    }
  } catch {
    dispose()
    return undefined
  }
}
