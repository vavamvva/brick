'use strict';

// 담쟁이덩굴 흔들림 (게임·ivy.html 공용)
//  - 바람: 전체가 한쪽으로 기우는 움직임 + 구간마다 따로 노는 움직임 (파도처럼 옆으로 흐르지 않음)
//  - 반응: 공이 근처를 지나가면 그 부분이 밀렸다가 출렁이며 돌아옴 (스프링 격자)
//  - 모든 이동은 1px 단위, 안티앨리어싱 없음
const IVY = { x: 62, y: 22, w: 763, h: 239 };

const IVY_TUNE = {
  LEAN: 4.0,        // 바람에 전체가 기우는 정도 (px, 덩굴 끝 기준)
  LOCAL: 2.5,       // 구간마다 따로 흔들리는 정도 (px)
  CELL: 48,         // 따로 흔들리는 구간 폭 (px)
  ROOT_EXP: 1.5,    // 클수록 윗부분은 덜, 끝부분만 더 흔들림
  // 공 반응
  GRID: 12,         // 반응 격자 크기 (px)
  REACH: 38,        // 공이 이 거리 안으로 오면 반응 (px)
  PUSH: 0.45,       // 미는 힘
  SPRING: 0.018,    // 제자리로 돌아오려는 힘
  DAMP: 0.06,       // 출렁임 감쇠
  SPREAD: 0.12,     // 옆·아래 격자로 퍼지는 정도
  MAX: 14,          // 최대 밀림 (px)
};

function createIvy(image) {
  const T = IVY_TUNE;
  const w = IVY.w, h = IVY.h;

  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const cc = c.getContext('2d');
  cc.drawImage(image, 0, 0);
  const src = new Uint32Array(cc.getImageData(0, 0, w, h).data.buffer);

  const out = document.createElement('canvas');
  out.width = w; out.height = h;
  const outCtx = out.getContext('2d');
  const outImage = outCtx.createImageData(w, h);
  const outBuf = new Uint32Array(outImage.data.buffer);

  const rowW = new Float32Array(h);   // 바람 영향 (위는 고정)
  const rowF = new Float32Array(h);   // 공 반응 영향 (맨 윗부분만 고정)
  for (let y = 0; y < h; y++) {
    rowW[y] = Math.pow(y / (h - 1), T.ROOT_EXP);
    rowF[y] = Math.min(1, y / 30);
  }

  // 바람 구간: 구간마다 고유한 주기·위상 (x에 비례하지 않아 물결처럼 흐르지 않음)
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const cells = [];
  for (let i = 0; i <= Math.ceil(w / T.CELL) + 1; i++) {
    cells.push({ f: 0.7 + rand() * 0.7, p: rand() * Math.PI * 2, a: 0.6 + rand() * 0.4,
                 f2: 1.6 + rand() * 0.9, p2: rand() * Math.PI * 2 });
  }
  const colV = new Float32Array(w);

  // 반응 격자
  const gw = Math.ceil(w / T.GRID) + 1, gh = Math.ceil(h / T.GRID) + 1;
  const off = new Float32Array(gw * gh), vel = new Float32Array(gw * gh);
  const has = new Uint8Array(gw * gh);           // 덩굴이 있는 칸만 공에 반응
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (src[y * w + x] >>> 24) has[Math.floor(y / T.GRID) * gw + Math.floor(x / T.GRID)] = 1;
    }
  }
  const tmp = new Float32Array(gw * gh);
  const field = new Float32Array(w);

  // 60fps 1스텝마다 호출. ball: {x, y, vx, vy} (프레임 좌표) 또는 null
  function update(ball) {
    if (ball) {
      const bx = ball.x - IVY.x, by = ball.y - IVY.y;
      const r = T.REACH;
      const gx0 = Math.max(0, Math.floor((bx - r) / T.GRID)), gx1 = Math.min(gw - 1, Math.ceil((bx + r) / T.GRID));
      const gy0 = Math.max(0, Math.floor((by - r) / T.GRID)), gy1 = Math.min(gh - 1, Math.ceil((by + r) / T.GRID));
      for (let gy = gy0; gy <= gy1; gy++) {
        for (let gx = gx0; gx <= gx1; gx++) {
          const i = gy * gw + gx;
          if (!has[i]) continue;
          const cx = gx * T.GRID + T.GRID / 2 + off[i], cy = gy * T.GRID + T.GRID / 2;
          const d = Math.hypot(cx - bx, cy - by);
          if (d >= r) continue;
          const f = (1 - d / r) * (1 - d / r);
          // 공에서 멀어지는 쪽 + 공이 지나가는 방향으로 끌려감
          const away = cx >= bx ? 1 : -1;
          vel[i] += f * T.PUSH * (away + ball.vx * 0.15);
        }
      }
    }
    // 스프링 + 주변 칸으로 퍼짐
    for (let gy = 0; gy < gh; gy++) {
      for (let gx = 0; gx < gw; gx++) {
        const i = gy * gw + gx;
        let n = 0, s = 0;
        if (gx > 0) { s += off[i - 1]; n++; }
        if (gx < gw - 1) { s += off[i + 1]; n++; }
        if (gy > 0) { s += off[i - gw]; n++; }
        if (gy < gh - 1) { s += off[i + gw]; n++; }
        tmp[i] = T.SPREAD * (s / n - off[i]);
      }
    }
    for (let i = 0; i < off.length; i++) {
      vel[i] += -T.SPRING * off[i] - T.DAMP * vel[i] + tmp[i];
      off[i] = Math.max(-T.MAX, Math.min(T.MAX, off[i] + vel[i]));
    }
  }

  function render(t) {
    const s = t / 1000;
    const gust = 0.65 + 0.35 * Math.sin(s * 0.23 + 0.5) * Math.sin(s * 0.37);
    const lean = T.LEAN * gust * (0.7 * Math.sin(s * 0.8) + 0.3 * Math.sin(s * 1.31 + 1.2));
    const v = cells.map(c => T.LOCAL * gust * c.a * (0.75 * Math.sin(s * c.f + c.p) + 0.25 * Math.sin(s * c.f2 + c.p2)));
    for (let x = 0; x < w; x++) {
      const i = Math.floor(x / T.CELL), f = (x % T.CELL) / T.CELL;
      const sf = f * f * (3 - 2 * f);
      colV[x] = lean + v[i] + (v[i + 1] - v[i]) * sf;
    }

    outBuf.fill(0);
    for (let y = 0; y < h; y++) {
      // 이 줄의 반응 격자 값 (세로 보간)
      const gyf = y / T.GRID - 0.5;
      const gy = Math.max(0, Math.min(gh - 2, Math.floor(gyf)));
      const ty = Math.max(0, Math.min(1, gyf - gy));
      const a0 = gy * gw, a1 = a0 + gw;
      for (let x = 0; x < w; x++) {
        const gxf = x / T.GRID - 0.5;
        const gx = Math.max(0, Math.min(gw - 2, Math.floor(gxf)));
        const tx = Math.max(0, Math.min(1, gxf - gx));
        const top = off[a0 + gx] + (off[a0 + gx + 1] - off[a0 + gx]) * tx;
        const bot = off[a1 + gx] + (off[a1 + gx + 1] - off[a1 + gx]) * tx;
        field[x] = top + (bot - top) * ty;
      }
      const ry = rowW[y], rf = rowF[y], row = y * w;
      for (let x = 0; x < w; x++) {
        const sx = x - Math.round(ry * colV[x] + rf * field[x]);   // 1px 단위로만 이동
        if (sx >= 0 && sx < w) outBuf[row + x] = src[row + sx];
      }
    }
    outCtx.putImageData(outImage, 0, 0);
    return out;
  }

  return { update, render, maxOffset: () => off.reduce((m, o) => Math.max(m, Math.abs(o)), 0) };
}
