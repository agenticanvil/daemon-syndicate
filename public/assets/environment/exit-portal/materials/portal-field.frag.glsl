uniform float uTime;
uniform vec3 uColorA;
uniform vec3 uColorB;
varying vec2 vUv;

float band(float value, float width) {
  return smoothstep(width, 0.0, abs(value));
}

void main() {
  vec2 uv = vUv;
  float flow = sin((uv.y * 18.0) - (uTime * 2.6) + sin(uv.x * 9.0 + uTime) * 0.8);
  float scan = band(fract((uv.y + uTime * 0.16) * 9.0) - 0.5, 0.16);
  float edge = smoothstep(0.5, 0.15, abs(uv.x - 0.5));
  float core = smoothstep(0.0, 0.48, edge);
  float shimmer = 0.5 + 0.5 * sin((uv.x * 26.0) + (uv.y * 7.0) + (uTime * 3.4));
  float alpha = (0.22 + 0.2 * flow + 0.24 * scan + 0.16 * shimmer) * core;
  vec3 color = mix(uColorB, uColorA, 0.55 + 0.45 * scan) + uColorA * pow(edge, 3.0) * 0.8;
  gl_FragColor = vec4(color, clamp(alpha, 0.12, 0.78));
}
