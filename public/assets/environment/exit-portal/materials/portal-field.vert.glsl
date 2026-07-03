varying vec2 vUv;

void main() {
  vUv = uv;
  vec3 transformed = position;
  transformed.z += sin((uv.y * 10.0) + (uv.x * 4.0)) * 0.018;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(transformed, 1.0);
}
