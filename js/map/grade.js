// 画面に出す最後の1枚。ミニチュア風のぼかし → 光のにじみ → トーンマップ → sRGB → 周辺減光、をまとめてかける。
// 時代ごとの色味やフィルムの質感はかけない（地図はどの時代も同じ見た目）。
export const GradeShader = {
  name: 'GradeShader',
  uniforms: {
    tDiffuse: { value: null },
    tBloom: { value: null },
    uBloom: { value: 0 },
    uRes: { value: [1, 1] },
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
    uniform float uBloom, uNight, uExposure;
    uniform vec2 uRes;
    uniform vec3 uTilt;
    varying vec2 vUv;

    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
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
    void main() {
      vec2 px = 1.0 / uRes;
      vec3 c = scene(vUv);
      float blur = uTilt.x * smoothstep(uTilt.z, uTilt.z + 0.32, abs(vUv.y - uTilt.y));
      if (blur > 0.6) c = mix(c, tiltBlur(vUv, blur, px), smoothstep(0.6, 2.5, blur));
      if (uBloom > 0.0) c += texture2D(tBloom, vUv).rgb * uBloom;
      c = toSRGB(neutral(c * uExposure));

      // 周辺減光（夜の場面は強く）
      vec2 q = vUv - 0.5;
      c *= clamp(1.0 - dot(q, q) * (0.55 + 1.2 * uNight), 0.0, 1.0);
      // 8bit に落とすときの縞を消す
      c += (hash(gl_FragCoord.xy) - 0.5) / 255.0;
      gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
    }`,
};
