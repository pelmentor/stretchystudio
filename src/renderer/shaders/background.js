export const BACKGROUND_VERT = `#version 300 es
precision highp float;

// Full-screen triangle trick
void main() {
  float x = -1.0 + float((gl_VertexID & 1) << 2);
  float y = -1.0 + float((gl_VertexID & 2) << 1);
  gl_Position = vec4(x, y, 0.0, 1.0);
}
`;

export const BACKGROUND_FRAG = `#version 300 es
precision highp float;

uniform vec2  u_resolution;
uniform float u_zoom;
uniform vec2  u_pan;
uniform float u_gridSize;
uniform bool  u_isDark;
uniform bool  u_hasCanvas;
uniform vec2  u_canvasOrigin;
uniform vec2  u_canvasSize;
uniform bool  u_bgEnabled;
uniform vec3  u_bgColor;

out vec4 out_color;

void main() {
  // Convert screen pixels (gl_FragCoord) → project world space
  float worldX = (gl_FragCoord.x - u_pan.x) / u_zoom;
  float worldY = (u_resolution.y - gl_FragCoord.y - u_pan.y) / u_zoom;

  // Outer checkerboard logic
  vec2 grid = floor(vec2(worldX, worldY) / u_gridSize);
  float check = mod(grid.x + grid.y, 2.0);

  vec3 outerC1, outerC2;

  if (u_isDark) {
    // Dark mode colors (#1a1a1a and slightly lighter #222)
    outerC1 = vec3(0.102, 0.102, 0.102);
    outerC2 = vec3(0.133, 0.133, 0.133);
  } else {
    // Light mode colors (#f2f2f2 and #ffffff)
    outerC1 = vec3(0.95, 0.95, 0.95);
    outerC2 = vec3(1.0, 1.0, 1.0);
  }

  vec3 outerColor = mix(outerC1, outerC2, check);

  // If no canvas, just return outer checkerboard
  if (!u_hasCanvas) {
    out_color = vec4(outerColor, 1.0);
    return;
  }

  // Canvas rect bounds
  float cx0 = u_canvasOrigin.x;
  float cy0 = u_canvasOrigin.y;
  float cx1 = cx0 + u_canvasSize.x;
  float cy1 = cy0 + u_canvasSize.y;

  // Test if fragment is inside canvas
  bool inCanvas = (worldX >= cx0 && worldX < cx1 && worldY >= cy0 && worldY < cy1);

  // Drop-shadow / border (soft glow just outside canvas)
  float dx = max(cx0 - worldX, worldX - cx1);
  float dy = max(cy0 - worldY, worldY - cy1);
  float outsideDist = length(vec2(max(dx, 0.0), max(dy, 0.0)));
  float shadowRadius = clamp(6.0 / u_zoom, 0.5, 40.0);
  float shadowAlpha = (1.0 - clamp(outsideDist / shadowRadius, 0.0, 1.0));
  shadowAlpha *= shadowAlpha;  // quadratic falloff
  shadowAlpha *= 0.35;

  // Canvas interior with outline border only
  if (inCanvas) {
    if (u_bgEnabled) {
      // Solid background color
      out_color = vec4(u_bgColor, 1.0);
    } else {
      // Check distance to canvas edges for border outline
      float edgeDistX = min(worldX - cx0, cx1 - worldX);
      float edgeDistY = min(worldY - cy0, cy1 - worldY);
      float edgeDist = min(edgeDistX, edgeDistY);

      // Border width in world pixels (scales with zoom)
      float borderWidth = 1.5 / u_zoom;
      float borderAlpha = 1.0 - clamp(edgeDist / borderWidth, 0.0, 1.0);

      // Border color based on theme
      vec3 borderColor;
      if (u_isDark) {
        // Dark theme: slightly lighter gray
        borderColor = vec3(0.3, 0.3, 0.3);
      } else {
        // Light theme: dark gray
        borderColor = vec3(0.4, 0.4, 0.4);
      }

      // Blend border color over the normal checkerboard
      vec3 interiorColor = mix(outerC1, outerC2, check);
      vec3 blendedColor = mix(interiorColor, borderColor, borderAlpha);
      out_color = vec4(blendedColor, 1.0);
    }
  } else {
    // Outside canvas: blend shadow/border over outer checkerboard
    vec3 shadowColor = u_isDark ? vec3(0.0) : vec3(0.0);
    vec3 blended = mix(outerColor, shadowColor, shadowAlpha);
    out_color = vec4(blended, 1.0);
  }
}
`;
