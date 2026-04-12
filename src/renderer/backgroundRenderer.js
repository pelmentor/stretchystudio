import { createProgram } from './program.js';
import { BACKGROUND_VERT, BACKGROUND_FRAG } from './shaders/background.js';

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16) / 255;
  const g = parseInt(h.substring(2, 4), 16) / 255;
  const b = parseInt(h.substring(4, 6), 16) / 255;
  return [r, g, b];
}

export class BackgroundRenderer {
  constructor(gl) {
    this.gl = gl;
    const { program, uniforms } = createProgram(gl, BACKGROUND_VERT, BACKGROUND_FRAG);
    this.program = program;
    this.uniforms = uniforms;
    this.vao = gl.createVertexArray();
  }

  draw(zoom, panX, panY, canvasW, canvasH, isDark = true, canvasArea = null) {
    const { gl } = this;
    gl.useProgram(this.program);

    gl.uniform2f(this.uniforms('u_resolution'), canvasW, canvasH);
    gl.uniform1f(this.uniforms('u_zoom'), zoom);
    gl.uniform2f(this.uniforms('u_pan'), panX, panY);
    gl.uniform1f(this.uniforms('u_gridSize'), 20.0);
    gl.uniform1i(this.uniforms('u_isDark'), isDark ? 1 : 0);

    // Canvas area uniforms
    const hasCanvas = canvasArea != null && canvasArea.width > 0 && canvasArea.height > 0;
    gl.uniform1i(this.uniforms('u_hasCanvas'), hasCanvas ? 1 : 0);

    if (hasCanvas) {
      gl.uniform2f(this.uniforms('u_canvasOrigin'), canvasArea.x ?? 0, canvasArea.y ?? 0);
      gl.uniform2f(this.uniforms('u_canvasSize'), canvasArea.width, canvasArea.height);
      gl.uniform1i(this.uniforms('u_bgEnabled'), canvasArea.bgEnabled ? 1 : 0);
      const [r, g, b] = hexToRgb(canvasArea.bgColor ?? '#ffffff');
      gl.uniform3f(this.uniforms('u_bgColor'), r, g, b);
    }

    gl.bindVertexArray(this.vao);
    // Draw one large triangle covering the screen (3 vertices)
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  }

  destroy() {
    this.gl.deleteProgram(this.program);
    this.gl.deleteVertexArray(this.vao);
  }
}
