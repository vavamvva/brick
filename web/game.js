'use strict';

// ── 피그마 프레임(1213:148) 기준 레이아웃 ──────────────────────────
const W = 860, H = 418;
const BAR = { x: 336, y: 299, w: 188, h: 30 };
const BALL_START = { x: 414, y: 165, size: 32 };
// [x, y, w, h] — 피그마 레이어 위치 그대로
const BRICKS = [
  [142,22,64,31],[206,22,64,31],[270,22,64,31],[334,22,64,31],[398,22,64,31],[462,22,64,31],[526,22,64,31],[590,22,64,31],[654,22,64,31],
  [110,53,63,33],[173,53,65,33],[238,53,64,33],[302,53,63,33],[365,53,65,33],[430,53,64,33],[494,53,63,33],[557,53,65,33],[622,53,64,33],[686,53,63,33],
  [143,86,63,30],[206,86,64,30],[270,86,65,30],[335,86,63,30],[398,86,64,30],[462,86,65,30],[527,86,63,30],[590,86,64,30],[654,86,65,30],
  [110,116,64,33],[174,116,64,33],[238,116,64,33],[302,116,64,33],[366,116,64,33],[430,116,64,33],[494,116,64,33],[558,116,64,33],[622,116,64,33],[686,116,64,33],
  [142,149,64,32],[206,149,64,32],[270,149,64,32],[334,149,64,32],[398,149,64,32],[462,149,64,32],[526,149,64,32],[590,149,64,32],[654,149,64,32],
  [110,181,63,33],[173,181,65,33],[238,181,64,33],[302,181,63,33],[365,181,65,33],[430,181,64,33],[494,181,63,33],[557,181,65,33],[622,181,64,33],[686,181,63,33],
];
// 공과 바가 부딪히는 천장·좌우 벽 = 프레임 가장자리
const CEILING = 0;
const WALL_L = 0, WALL_R = W;

// ── 튜닝 값 (60fps 1스텝 기준) ─────────────────────────────────────
const STEP = 1000 / 60;
const BALL_R = 15;          // 충돌 반지름
const BALL_SPEED = 6;       // px / step
const SUBSTEPS = 4;
const GRAVITY_DROP = 0.35;  // 시작 낙하 가속도
const FALL_ACCEL = 0.03;    // 플레이 중 아래로 떨어질 때 가속도
const FALL_MAX = BALL_SPEED * 1.5;
const SPIN = 0.12;          // rad / step (보이기용 회전)
const MAX_BOUNCE = Math.PI / 3;

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
ctx.imageSmoothingEnabled = false;

function loadImage(src) {
  return new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = rej;
    im.src = src;
  });
}

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

let img = {};
let ivy;
let brickLayer, brickCtx, brickSource;
let bricks = [];
let state = 'idle';         // idle → drop → play → over
let ball, barX, pointerX = null;

// ── 가루 파티클 (1px 단위, 제자리에서 밀도가 줄며 사라짐) ──────────
const MAX_P = 80000;
const P = {
  pos: new Uint32Array(MAX_P),   // y * W + x
  life: new Float32Array(MAX_P), // 0이 되면 그 픽셀이 사라짐
  rgb: new Uint32Array(MAX_P), n: 0,
};
const dustLayer = makeCanvas(W, H);
const dustCtx = dustLayer.getContext('2d');
const dustImage = dustCtx.createImageData(W, H);
const dustBuf = new Uint32Array(dustImage.data.buffer);

function crumble(b, hitX, hitY) {
  const data = brickSource.getImageData(b.x, b.y, b.w, b.h).data;
  for (let j = 0; j < b.h; j++) {
    for (let i = 0; i < b.w; i++) {
      const o = (j * b.w + i) * 4;
      if (data[o + 3] === 0 || P.n >= MAX_P) continue;
      const k = P.n++;
      const px = b.x + i, py = b.y + j;
      const dist = Math.hypot(px - hitX, py - hitY);
      P.pos[k] = py * W + px;
      // 픽셀마다 사라지는 시점이 무작위 → 밀도가 빠르게 줄어듦 (맞은 쪽이 살짝 먼저)
      P.life[k] = 1 + Math.random() * 16 + dist * 0.08;
      P.rgb[k] = data[o] | (data[o + 1] << 8) | (data[o + 2] << 16);
    }
  }
}

function updateDust() {
  let n = 0;
  for (let k = 0; k < P.n; k++) {
    P.life[k] -= 1;
    if (P.life[k] <= 0) continue;
    if (n !== k) { P.pos[n] = P.pos[k]; P.life[n] = P.life[k]; P.rgb[n] = P.rgb[k]; }
    n++;
  }
  P.n = n;
}

function drawDust() {
  if (P.n === 0) return;
  dustBuf.fill(0);
  for (let k = 0; k < P.n; k++) dustBuf[P.pos[k]] = (P.rgb[k] | 0xff000000) >>> 0;
  dustCtx.putImageData(dustImage, 0, 0);
  ctx.drawImage(dustLayer, 0, 0);
}

// ── 게임 진행 ──────────────────────────────────────────────────────
function resetLevel() {
  brickLayer = makeCanvas(W, H);
  brickCtx = brickLayer.getContext('2d');
  bricks = BRICKS.map(([x, y, w, h]) => {
    brickCtx.drawImage(img.bricks, x, y, w, h, x, y, w, h);
    return { x, y, w, h, alive: true };
  });
  P.n = 0;
  barX = BAR.x;
  ball = {
    x: BALL_START.x + BALL_START.size / 2,
    y: BALL_START.y + BALL_START.size / 2,
    vx: 0, vy: 0, angle: 0,
  };
}

function start() {
  if (state === 'drop' || state === 'play') return;
  if (state === 'over') resetLevel();
  state = 'drop';
}

function end() {
  state = 'over';
}

function moveBar() {
  if (pointerX === null) return;
  // 바도 공과 같은 좌우 벽 안쪽에서만 움직임
  barX = Math.max(WALL_L, Math.min(WALL_R - BAR.w, Math.round(pointerX - BAR.w / 2)));
}

function bounceOffBar() {
  const top = BAR.y;
  if (ball.vy <= 0) return false;
  if (ball.y + BALL_R < top || ball.y - BALL_R > top + BAR.h) return false;
  if (ball.x < barX - BALL_R * 0.6 || ball.x > barX + BAR.w + BALL_R * 0.6) return false;
  const rel = Math.max(-1, Math.min(1, (ball.x - (barX + BAR.w / 2)) / (BAR.w / 2)));
  const a = rel * MAX_BOUNCE;
  ball.vx = BALL_SPEED * Math.sin(a);
  ball.vy = -BALL_SPEED * Math.cos(a);
  ball.y = top - BALL_R;
  return true;
}

function hitBrick() {
  let best = null, bestOverlap = 0, bestAxis = 'y';
  for (const b of bricks) {
    if (!b.alive) continue;
    const cx = Math.max(b.x, Math.min(ball.x, b.x + b.w));
    const cy = Math.max(b.y, Math.min(ball.y, b.y + b.h));
    const dx = ball.x - cx, dy = ball.y - cy;
    if (dx * dx + dy * dy > BALL_R * BALL_R) continue;
    const ox = Math.min(ball.x + BALL_R - b.x, b.x + b.w - (ball.x - BALL_R));
    const oy = Math.min(ball.y + BALL_R - b.y, b.y + b.h - (ball.y - BALL_R));
    const overlap = Math.min(ox, oy);
    if (overlap > bestOverlap) { best = b; bestOverlap = overlap; bestAxis = ox < oy ? 'x' : 'y'; }
  }
  if (!best) return;
  best.alive = false;
  brickCtx.clearRect(best.x, best.y, best.w, best.h);
  const hx = Math.max(best.x, Math.min(ball.x, best.x + best.w));
  const hy = Math.max(best.y, Math.min(ball.y, best.y + best.h));
  crumble(best, hx, hy);
  if (bestAxis === 'x') {
    ball.vx = ball.x < best.x + best.w / 2 ? -Math.abs(ball.vx) : Math.abs(ball.vx);
  } else {
    ball.vy = ball.y < best.y + best.h / 2 ? -Math.abs(ball.vy) : Math.abs(ball.vy);
  }
  if (!bricks.some(b => b.alive)) end();
}

function step() {
  moveBar();
  if (state === 'drop') {
    // 설정된 위치에서 바 위로 떨어짐 (벽돌과는 충돌하지 않음)
    ball.vy += GRAVITY_DROP;
    ball.y += ball.vy;
    ball.angle += SPIN;
    if (bounceOffBar()) state = 'play';
    else if (ball.y - BALL_R > H) end();
  } else if (state === 'play') {
    ball.angle += SPIN;
    // 떨어질 때만 살짝 가속 (바에 맞으면 기본 속도로 돌아감)
    if (ball.vy > 0) ball.vy = Math.min(ball.vy + FALL_ACCEL, FALL_MAX);
    for (let i = 0; i < SUBSTEPS && state === 'play'; i++) {
      ball.x += ball.vx / SUBSTEPS;
      ball.y += ball.vy / SUBSTEPS;
      if (ball.x - BALL_R < WALL_L) { ball.x = WALL_L + BALL_R; ball.vx = Math.abs(ball.vx); }
      if (ball.x + BALL_R > WALL_R) { ball.x = WALL_R - BALL_R; ball.vx = -Math.abs(ball.vx); }
      if (ball.y - BALL_R < CEILING) { ball.y = CEILING + BALL_R; ball.vy = Math.abs(ball.vy); }
      bounceOffBar();
      hitBrick();
      if (ball.y - BALL_R > H) end();
    }
  }
  // 공이 덩굴 근처를 지나가면 반응 (화면 안에 있을 때만)
  ivy.update(state === 'drop' || state === 'play' ? ball : null);
  updateDust();
}

function render(t) {
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, W, H);
  ctx.drawImage(brickLayer, 0, 0);
  drawDust();
  ctx.drawImage(img.bar, barX, BAR.y);
  if (ball.y - BALL_R <= H) {
    ctx.save();
    ctx.translate(Math.round(ball.x), Math.round(ball.y));
    ctx.rotate(ball.angle);
    ctx.drawImage(img.ball, -BALL_START.size / 2, -BALL_START.size / 2);
    ctx.restore();
  }
  ctx.drawImage(ivy.render(t), IVY.x, IVY.y);
}

let last = 0, acc = 0;
function frame(t) {
  if (!last) last = t;
  acc = Math.min(acc + (t - last), STEP * 5);
  last = t;
  while (acc >= STEP) { step(); acc -= STEP; }
  render(t);
  requestAnimationFrame(frame);
}

function toCanvasX(e) {
  const r = canvas.getBoundingClientRect();
  return (e.clientX - r.left) * (W / r.width);
}

// 마우스: 움직이면 바가 따라옴 / 터치: 화면 어디든 누르고 끌면 바가 따라옴. 누르면 시작.
window.addEventListener('pointermove', e => { pointerX = toCanvasX(e); });
window.addEventListener('pointerdown', e => {
  pointerX = toCanvasX(e);
  // 터치는 시작 직후 바가 손가락 위치로 튀지 않도록 시작 탭에서는 위치를 쓰지 않음
  if ((state === 'idle' || state === 'over') && e.pointerType !== 'mouse') pointerX = null;
  start();
});
// 모바일에서 스크롤·확대·길게 누르기 메뉴 방지
for (const type of ['touchstart', 'touchmove', 'gesturestart', 'contextmenu']) {
  document.addEventListener(type, e => e.preventDefault(), { passive: false });
}

Promise.all(['bricks', 'bar', 'ball', 'ivy'].map(n => loadImage((window.ASSETS && ASSETS[n]) || `assets/${n}.png`).then(im => { img[n] = im; })))
  .then(() => {
    ivy = createIvy(img.ivy);
    const c = makeCanvas(W, H);
    brickSource = c.getContext('2d', { willReadFrequently: true });
    brickSource.drawImage(img.bricks, 0, 0);
    resetLevel();
    requestAnimationFrame(frame);
  });

// 디버그/검증용
window.__game = { get state() { return state; }, get ball() { return ball; }, get bricksLeft() { return bricks.filter(b => b.alive).length; }, get dust() { return P.n; }, get ivyPush() { return ivy.maxOffset(); } };
