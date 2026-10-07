import { useEffect, useRef } from 'react'

/**
 * AtmosphereLayer — the WebGL pass that makes a flat room plate read as a lit
 * 3D space.
 *
 * WHY THIS EXISTS
 * ---------------
 * The room art is pre-rendered, so the geometry is frozen. What sells "3D" in
 * donghua is not geometry anyway — it is the *air* in the room: volumetric
 * shafts of light, motes drifting through them at different depths, a glow
 * that blooms around bright sources, and a grade that shifts with the mood of
 * the scene. Those are per-frame lighting phenomena, and baking them into a
 * PNG would freeze them. So they run live, on top of the plate.
 *
 * It is one fullscreen fragment shader — no Three.js, no scene graph. That
 * keeps the whole feature around 6 kB of JS instead of the ~250 kB a real 3D
 * runtime would cost, which matters because the plate is already doing the
 * heavy visual lifting.
 *
 * It is also *reactive*: `state` comes from the Fase 2 burn tracker, so the
 * office literally changes temperature as spending climbs. Normal is a calm
 * cyan daylight; tripped floods the room with cold emergency blue. The
 * governance layer and the art direction are the same thing here, which is
 * the whole pitch of the product.
 */

export type AtmosphereState = 'normal' | 'warm' | 'hot' | 'critical' | 'tripped'

type Props = {
  /** Burn state — drives the colour grade and ray intensity. */
  state?: AtmosphereState
  /** Night plates want cooler, dimmer air than day plates. */
  phase?: 'day' | 'night'
  /** 0 disables rays entirely (indoor rooms with no windows). */
  rayStrength?: number
  /** Dust density multiplier. */
  moteDensity?: number
}

/**
 * Grade targets per burn state: [keyR,keyG,keyB, rayGain, moteGain, pulseHz].
 * Chosen so the progression reads as heat: daylight cyan → amber → orange →
 * red → the cold blue of a fire-suppression dump.
 */
const GRADE: Record<AtmosphereState, [number, number, number, number, number, number]> = {
  normal:   [0.42, 0.78, 1.00, 0.85, 1.00, 0.00],
  warm:     [1.00, 0.76, 0.38, 1.05, 1.15, 0.35],
  hot:      [1.00, 0.52, 0.20, 1.35, 1.45, 0.80],
  critical: [1.00, 0.26, 0.20, 1.70, 1.85, 1.60],
  tripped:  [0.45, 0.70, 1.00, 0.60, 2.40, 0.50],
}

const VERT = `#version 300 es
in vec2 p;
out vec2 uv;
void main(){ uv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }`

const FRAG = `#version 300 es
precision highp float;
in vec2 uv;
out vec4 outColor;

uniform float uTime;
uniform vec2  uRes;
uniform vec3  uKey;        // grade colour
uniform float uRayGain;
uniform float uMoteGain;
uniform float uPulseHz;
uniform float uNight;      // 0 day, 1 night
uniform float uMotion;     // 0 when the user asked for reduced motion

// Cheap hash/noise. Value noise is enough here: the motes are sub-pixel dots
// and the rays are soft, so nothing benefits from gradient noise.
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1,0)), f.x),
             mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), f.x), f.y);
}
float fbm(vec2 p){
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++){ v += a * noise(p); p *= 2.02; a *= 0.5; }
  return v;
}

// God rays: soft parallel shafts raked from the upper left, matching the
// direction the room plates were lit from. Mismatching this is the fastest
// way to make a composite look fake, so the angle is fixed, not random.
float godRays(vec2 uvp, float t){
  vec2 dir = normalize(vec2(0.55, 1.0));
  float along = dot(uvp, dir);
  float across = dot(uvp, vec2(-dir.y, dir.x));
  // Drift only across the shafts: light that slides along its own axis looks
  // like a scrolling texture rather than air.
  float bands = fbm(vec2(across * 7.0, along * 1.6 - t * 0.05));
  bands = smoothstep(0.42, 0.95, bands);
  // Fade out of the lower right, where the window light would not reach.
  float falloff = smoothstep(1.25, -0.15, along);
  return bands * falloff;
}

// Motes live on three parallax planes. The depth difference is what reads as
// volume — a single plane looks like dirt on the lens.
float motes(vec2 uvp, float t, float density){
  float acc = 0.0;
  for (int layer = 0; layer < 3; layer++){
    float fl = float(layer);
    float scale = 26.0 + fl * 34.0;
    float speed = 0.012 + fl * 0.016;
    float size  = 0.055 - fl * 0.013;
    vec2 q = uvp * scale;
    q.y -= t * speed * scale * 0.35;           // slow rise
    q.x += sin(t * 0.25 + fl * 2.1) * 1.2;     // gentle sway
    vec2 cell = floor(q);
    vec2 f = fract(q) - 0.5;
    float r = hash(cell + fl * 37.0);
    if (r < 0.80) continue;                     // keep most cells empty
    vec2 jitter = vec2(hash(cell + 11.0), hash(cell + 23.0)) - 0.5;
    float d = length(f - jitter * 0.6);
    float dot_ = smoothstep(size, 0.0, d);
    // Nearer layers are brighter and softer, far ones are faint and crisp.
    acc += dot_ * (0.35 + 0.35 * (2.0 - fl));
  }
  return acc * density;
}

void main(){
  // Work in aspect-corrected space so rays are not stretched on wide screens.
  vec2 uvp = uv;
  uvp.x *= uRes.x / max(uRes.y, 1.0);
  float t = uTime * uMotion;

  float rays = godRays(uvp, t) * uRayGain * mix(1.0, 0.45, uNight);
  float dust = motes(uvp, t, uMoteGain) * mix(1.0, 1.35, uNight);

  // A slow breathing pulse at high burn states. Not a flash: an evidence
  // surface that strobes is unusable, and anyone sensitive to motion has
  // already been handed uMotion = 0.
  float pulse = uPulseHz > 0.0 ? 0.5 + 0.5 * sin(t * uPulseHz * 2.0) : 0.0;
  float pulseMix = pulse * 0.16 * step(0.01, uPulseHz) * uMotion;

  vec3 col = uKey * (rays * 0.42 + dust * 0.85);
  col += uKey * pulseMix * 0.5;

  // Vignette: darkens the frame edge so the eye is pulled to the floor, and
  // fakes the lens falloff that a real rendered shot would have.
  vec2 vd = uv - 0.5;
  float vig = smoothstep(0.86, 0.22, length(vd) * 1.32);
  float vignette = (1.0 - vig) * mix(0.30, 0.46, uNight);

  // Additive for the light, multiply-ish for the vignette, carried in alpha so
  // the room plate underneath stays untouched where there is no atmosphere.
  float a = clamp(rays * 0.30 * uRayGain + dust * 0.9 + pulseMix + vignette, 0.0, 0.92);
  vec3 outRgb = mix(vec3(0.016, 0.027, 0.047), col, clamp(rays + dust + pulseMix, 0.0, 1.0));
  outColor = vec4(outRgb, a);
}`

function compile(gl: WebGL2RenderingContext, type: number, src: string) {
  const sh = gl.createShader(type)!
  gl.shaderSource(sh, src)
  gl.compileShader(sh)
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh)
    gl.deleteShader(sh)
    throw new Error(`shader: ${log}`)
  }
  return sh
}

export const AtmosphereLayer: React.FC<Props> = ({
  state = 'normal',
  phase = 'day',
  rayStrength = 1,
  moteDensity = 1,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  // Live values read inside the render loop, so changing burn state does not
  // tear down and rebuild the GL context.
  const paramsRef = useRef({ state, phase, rayStrength, moteDensity })
  paramsRef.current = { state, phase, rayStrength, moteDensity }

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const gl = canvas.getContext('webgl2', {
      alpha: true,
      premultipliedAlpha: false,
      antialias: false,
      depth: false,
      powerPreference: 'low-power',
    })
    // No WebGL2 (older Safari, locked-down browsers, some embedded webviews):
    // render nothing rather than a broken black box. The room still looks fine
    // without its air; that is the point of layering it separately.
    if (!gl) return

    let program: WebGLProgram | null = null
    try {
      const vs = compile(gl, gl.VERTEX_SHADER, VERT)
      const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG)
      program = gl.createProgram()!
      gl.attachShader(program, vs)
      gl.attachShader(program, fs)
      gl.linkProgram(program)
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        throw new Error(gl.getProgramInfoLog(program) || 'link failed')
      }
      gl.deleteShader(vs)
      gl.deleteShader(fs)
    } catch (err) {
      console.warn('[atmosphere] disabled:', (err as Error).message)
      return
    }

    const buf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    const loc = gl.getAttribLocation(program, 'p')
    gl.enableVertexAttribArray(loc)
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)

    const U = {
      time: gl.getUniformLocation(program, 'uTime'),
      res: gl.getUniformLocation(program, 'uRes'),
      key: gl.getUniformLocation(program, 'uKey'),
      ray: gl.getUniformLocation(program, 'uRayGain'),
      mote: gl.getUniformLocation(program, 'uMoteGain'),
      pulse: gl.getUniformLocation(program, 'uPulseHz'),
      night: gl.getUniformLocation(program, 'uNight'),
      motion: gl.getUniformLocation(program, 'uMotion'),
    }

    gl.useProgram(program)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)

    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    let motion = reduce?.matches ? 0 : 1
    const onReduce = (e: MediaQueryListEvent) => { motion = e.matches ? 0 : 1 }
    reduce?.addEventListener?.('change', onReduce)

    // Cap the backing store: this is a soft atmospheric layer, so rendering it
    // at full retina resolution buys nothing visible and costs real battery.
    const DPR_CAP = 1.5
    let raf = 0
    let lost = false

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, DPR_CAP)
      const w = Math.max(1, Math.floor(canvas.clientWidth * dpr))
      const h = Math.max(1, Math.floor(canvas.clientHeight * dpr))
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w
        canvas.height = h
        gl.viewport(0, 0, w, h)
      }
    }

    const onLost = (e: Event) => { e.preventDefault(); lost = true; cancelAnimationFrame(raf) }
    const onRestored = () => { lost = false; raf = requestAnimationFrame(frame) }
    canvas.addEventListener('webglcontextlost', onLost)
    canvas.addEventListener('webglcontextrestored', onRestored)

    // Smoothed grade: snapping between burn states would read as a glitch,
    // whereas easing reads as the room heating up.
    const cur = [...GRADE.normal] as number[]
    let last = performance.now()

    const frame = (now: number) => {
      if (lost) return
      const dt = Math.min((now - last) / 1000, 0.1)
      last = now
      resize()

      const p = paramsRef.current
      const target = GRADE[p.state] ?? GRADE.normal
      const k = 1 - Math.pow(0.0015, dt) // ~frame-rate independent easing
      for (let i = 0; i < 6; i++) cur[i] += (target[i] - cur[i]) * k

      gl.uniform1f(U.time, now / 1000)
      gl.uniform2f(U.res, canvas.width, canvas.height)
      gl.uniform3f(U.key, cur[0], cur[1], cur[2])
      gl.uniform1f(U.ray, cur[3] * p.rayStrength)
      gl.uniform1f(U.mote, cur[4] * p.moteDensity)
      gl.uniform1f(U.pulse, cur[5])
      gl.uniform1f(U.night, p.phase === 'night' ? 1 : 0)
      gl.uniform1f(U.motion, motion)

      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
      raf = requestAnimationFrame(frame)
    }

    // Stop burning GPU on a tab nobody is looking at.
    const onVis = () => {
      if (document.hidden) cancelAnimationFrame(raf)
      else { last = performance.now(); raf = requestAnimationFrame(frame) }
    }
    document.addEventListener('visibilitychange', onVis)

    raf = requestAnimationFrame(frame)

    return () => {
      cancelAnimationFrame(raf)
      document.removeEventListener('visibilitychange', onVis)
      reduce?.removeEventListener?.('change', onReduce)
      canvas.removeEventListener('webglcontextlost', onLost)
      canvas.removeEventListener('webglcontextrestored', onRestored)
      gl.deleteBuffer(buf)
      if (program) gl.deleteProgram(program)
      gl.getExtension('WEBGL_lose_context')?.loseContext()
    }
  }, [])

  return <canvas ref={canvasRef} className="atmosphere-layer" aria-hidden />
}

export default AtmosphereLayer
