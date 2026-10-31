// 画面に出す最後の1枚。ミニチュア風のぼかし → 光のにじみ → トーンマップ → sRGB → 時代の質感、をまとめてかける。
// print = 浮世絵・絵巻（平塗り・版ずれ・紙）、mono = ニュース映画（暖かい銀の白黒・ちらつき・縦傷）、dark = 戦時の暗さ。
export const EraGradeShader = {
  name: 'EraGradeShader',
  uniforms: {
    tDiffuse: { value: null },
    tBloom: { value: null },
    uBloom: { value: 0 },
    uRes: { value: [1, 1] },
    uTime: { value: 0 },
    uPal: { value: [] },
    uTint: { value: 0.3 },
    uPrint: { value: 0 },
    uMono: { value: 0 },
    uDark: { value: 0 },
    uSat: { value: 1 },
    uFlicker: { value: 1 },
    uScratch: { value: [-1, -1, -1, 0] },
    uFrame: { value: 0 },
    uNight: { value: 0 },
    uExposure: { value: 1 },
    // 画面の上下の端でのぼかし（px）・ピントの合う高さ（0=下、1=上）・くっきり見える幅
    uTilt: { value: [2.5, 0.5, 0.2] },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse, tBloom;
    uniform float uBloom;
    uniform vec2 uRes;
    uniform float uTime, uTint, uPrint, uMono, uDark, uSat, uFlicker, uFrame, uNight, uExposure;
    uniform vec3 uPal[5];
    uniform vec3 uTilt;
    uniform vec4 uScratch;
    varying vec2 vUv;

    float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float vnoise(vec2 p) {
      vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
    }
    float fbm(vec2 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * vnoise(p); p *= 2.03; a *= 0.5; } return s; }
    // three.js の NeutralToneMapping と同じ式
    vec3 neutral(vec3 color) {
      const float start = 0.76, desat = 0.15;
      float x = min(color.r, min(color.g, color.b));
      float offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
      color -= offset;
      float peak = max(color.r, max(color.g, color.b));
      if (peak < start) return color;
      float d = 1.0 - start;
      float newPeak = 1.0 - d * d / (peak + d - start);
      color *= newPeak / peak;
      float g = 1.0 - 1.0 / (desat * (peak - newPeak) + 1.0);
      return mix(color, vec3(newPeak), g);
    }
    vec3 toSRGB(vec3 c) {
      c = max(c, vec3(0.0));
      return mix(pow(c, vec3(0.41666)) * 1.055 - vec3(0.055), c * 12.92, vec3(lessThanEqual(c, vec3(0.0031308))));
    }
    vec3 scene(vec2 uv) { return texture2D(tDiffuse, uv).rgb; }
    // ミニチュア風のぼかし：黄金角で12点。画素ごとに回して、点の並びを目立たせない
    vec3 tiltBlur(vec2 uv, float r, vec2 px) {
      float rot = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) * 6.2832;
      vec3 s = scene(uv);
      for (int i = 0; i < 12; i++) {
        float a = float(i) * 2.39996 + rot, d = sqrt((float(i) + 0.5) / 12.0);
        s += scene(uv + vec2(cos(a), sin(a)) * d * r * px);
      }
      return s / 13.0;
    }
    // パレットを暗い→明るいに並べたグラデーションマップ（JS 側で明るさ順に並べ替えて渡す）
    vec3 gradMap(float l) {
      float x = clamp(l, 0.0, 1.0) * 4.0;
      if (x < 1.0) return mix(uPal[0], uPal[1], x);
      if (x < 2.0) return mix(uPal[1], uPal[2], x - 1.0);
      if (x < 3.0) return mix(uPal[2], uPal[3], x - 2.0);
      return mix(uPal[3], uPal[4], x - 3.0);
    }
    void main() {
      vec2 px = 1.0 / uRes;
      // 版ずれ：色の版ごとに 1.5〜2.5px ずらす
      vec2 o1 = px * vec2(2.2, 1.2) * uPrint, o2 = px * vec2(-1.6, 1.8) * uPrint;
      vec3 c = vec3(scene(vUv + o1).r, scene(vUv).g, scene(vUv + o2).b);
      float blur = uTilt.x * smoothstep(uTilt.z, uTilt.z + 0.32, abs(vUv.y - uTilt.y));
      if (blur > 0.6) c = mix(c, tiltBlur(vUv, blur, px), smoothstep(0.6, 2.5, blur));
      if (uBloom > 0.0) c += texture2D(tBloom, vUv).rgb * uBloom;
      c = toSRGB(neutral(c * uExposure));

      float l = luma(c);
      c = mix(vec3(l), c, uSat);
      // 時代パレットへ寄せる（明るさで色を引く）
      c = mix(c, gradMap(l) * (0.82 + 0.36 * l), uTint);

      // 浮世絵：平塗り（明るさを7段に）＋ 紙の地 ＋ 上端の一文字ぼかし
      if (uPrint > 0.001) {
        float lq = floor(luma(c) * 7.0 + 0.5) / 7.0;
        vec3 flatC = c * (lq / max(luma(c), 0.02));
        vec2 pp = vUv * uRes;
        float paper = 0.93 + 0.05 * fbm(pp / 3.5) + 0.03 * vnoise(vec2(pp.x / 1.2, pp.y / 40.0));
        float kasure = 0.96 + 0.06 * fbm(pp / 90.0);
        vec3 pc = flatC * paper * kasure;
        pc = mix(pc, uPal[0] * 0.9, smoothstep(0.80, 1.0, vUv.y) * 0.45);
        c = mix(c, pc, uPrint);
      }

      // 戦時：ローキー（暗く、くすませ、影を冷たく）
      if (uDark > 0.001) {
        float dl = luma(c);
        vec3 dc = pow(c * 0.8, vec3(1.18));
        dc = mix(dc, vec3(dl) * vec3(0.85, 0.88, 0.80), 0.35);
        dc += vec3(0.010, 0.012, 0.004);
        c = mix(c, dc, uDark);
      }

      // ニュース映画：暖かい銀の白黒（乗算 #efe7d6 → スクリーン #17140f）、ちらつき±3.5%、縦傷、粒子
      if (uMono > 0.001) {
        float m = luma(c);
        m = smoothstep(0.02, 0.98, m) * uFlicker;
        vec3 silver = 1.0 - (1.0 - m * vec3(0.937, 0.906, 0.839)) * (1.0 - vec3(0.090, 0.078, 0.059));
        float g = hash(floor(vUv * uRes / 1.5) + uFrame * 7.13) - 0.5;
        silver += g * 0.07;
        for (int i = 0; i < 3; i++) {
          float sx = uScratch[i];
          if (sx >= 0.0) {
            float d = abs(vUv.x - sx) * uRes.x;
            // 途切れ途切れにして、画面の区切り線に見えないようにする
            float a = exp(-d * d / 1.2) * smoothstep(0.3, 0.75, vnoise(vec2(sx * 40.0, vUv.y * 7.0 + uFrame)));
            silver = mix(silver, vec3(0.94, 0.92, 0.86), a * uScratch.w);
          }
        }
        c = mix(c, silver, uMono);
      }

      // 周辺減光（時代が古い・暗いほど強く）
      vec2 q = vUv - 0.5;
      float vig = 1.0 - dot(q, q) * (0.55 + 0.9 * uMono + 1.1 * uDark + 0.35 * uPrint + 1.2 * uNight);
      c *= clamp(vig, 0.0, 1.0);
      // 8bit に落とすときの縞を消す
      c += (hash(gl_FragCoord.xy + fract(uFrame * 0.618) * 17.0) - 0.5) / 255.0;
      gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
    }`,
};
