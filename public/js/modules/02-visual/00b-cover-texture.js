function makeDotTexture() {
  var cv = document.createElement('canvas'); cv.width = cv.height = 64;
  var ctx = cv.getContext('2d');
  var g = ctx.createRadialGradient(32, 32, 0, 32, 32, 31);
  g.addColorStop(0.00, 'rgba(255,255,255,0.96)');
  g.addColorStop(0.42, 'rgba(255,255,255,0.78)');
  g.addColorStop(0.72, 'rgba(255,255,255,0.22)');
  g.addColorStop(1.00, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  var tex = new THREE.CanvasTexture(cv);
  tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter;
  return tex;
}
var dotTexture = makeDotTexture();

// ============================================================
//  主粒子系统
//   - 5 个 preset, 每个预设走完全不同的 pos 计算
//   - 共享: 封面色采样, 鼠标交互, 粒子大小限制
// ============================================================