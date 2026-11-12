// Flash guard. Always on; there is no switch. Works in milliseconds of real time, not frames.
//
// What it does: the picture is cut into regions of CELL x CELL pixels. For each region, and for the
// whole screen, it watches the mean linear-light red, green, blue and luminance of what the game
// wants to show. The shown picture moves towards the game's picture by a blend whose strength is
// limited per region:
//   - calm input: the region mean may move at most FAST per ms (a full black-to-white change takes
//     about 1/FAST ms, a soft fade instead of a cut);
//   - input that has recently gone both up and down (flicker, strobe, a flash and its return): the
//     region mean may move at most SLOW per ms until the input has been steady for about a second.
// (Since 2026-11-10 "back and forth" means two reversals within 300 ms: one box opening and closing is not a strobe.)
// So a single change arrives as a short fade, and repeated changes are averaged into a steady
// picture. Limits (by design): a pattern finer than a region whose regional mean stays the same is
// not damped, and ordinary movement that keeps a region's mean steady is passed unchanged.
//
// Pure arithmetic on pixel arrays: the same file runs in the page and in the test (guard.test.ts).

export const CELL = 40; // region size in pixels
export const FAST = 1 / 20; // per ms: largest change of a region mean while the input is calm
export const SLOW = 0.05 / 1000; // per ms: largest change while the input is going back and forth
export const TAU = 1200; // ms: how long past input movement is remembered
export const CAP = 0.1; // remembered movement per direction never exceeds this
export const LIMIT = [0.16, 0.16, 0.16, 0.05]; // red, green, blue, luminance: both-ways movement that counts as flicker
export const MAX_DT = 50; // ms: a longer gap between frames counts as this (never a jump after a pause)
export const FLIPS = 0.5; // a region flickers while this much of a quick reversal is still remembered (about 0.8 s after the last one)
export const EDGE = 70; // ms: a change that took longer than this to arrive is a fade, not a flash edge
export const HOLD = 350; // ms: a flickering region is held this long after its last sharp change
export const QUICK = 300; // ms: two reversals closer than this are a strobe; a door fading out and in, or a box opening and closing, is not
export const STEP = 0.04; // a change of a region mean smaller than this in one picture is movement or text, not a flash
const W_LUM = [0.2126, 0.7152, 0.0722];

const toLinear = new Float32Array(256);
for (let i = 0; i < 256; i++) { const c = i / 255; toLinear[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }
const toByte = new Uint8Array(4097);
for (let i = 0; i <= 4096; i++) { const l = i / 4096; toByte[i] = Math.round(255 * (l <= 0.0031308 ? l * 12.92 : 1.055 * l ** (1 / 2.4) - 0.055)); }

/** A guard for pictures of width x height. Starts from black, so the first picture fades in. */
export function createGuard(width, height) {
  const cols = Math.ceil(width / CELL), rows = Math.ceil(height / CELL), n = cols * rows;
  const shown = new Float32Array(width * height * 3); // what is on screen, linear light
  // per region (index n = whole screen), 4 measures each: target mean, shown mean, last target, input travel up / down
  const target = new Float32Array((n + 1) * 4), mean = new Float32Array((n + 1) * 4), last = new Float32Array((n + 1) * 4);
  const up = new Float32Array((n + 1) * 4), down = new Float32Array((n + 1) * 4);
  const alpha = new Float32Array(n + 1), count = new Float32Array(n);
  const flips = new Float32Array((n + 1) * 4), dir = new Int8Array((n + 1) * 4), moveMs = new Float64Array((n + 1) * 4).fill(-1e9), runMs = new Float64Array((n + 1) * 4).fill(-1e9); // remembered quick reversals; last direction; when it last moved; when this direction began
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) count[Math.floor(y / CELL) * cols + Math.floor(x / CELL)]++;
  let lastMs = -1;

  /** Feed one picture (RGBA bytes) at time nowMs; writes the guarded picture to `output` (RGBA bytes). */
  function step(input, nowMs, output) {
    const dt = lastMs < 0 ? 16 : Math.min(MAX_DT, Math.max(0, nowMs - lastMs));
    lastMs = nowMs;
    // 1. what the game wants: mean linear red, green, blue per region
    target.fill(0);
    for (let y = 0, p = 0; y < height; y++) {
      const row = Math.floor(y / CELL) * cols;
      for (let x = 0; x < width; x++, p += 4) {
        const c = (row + Math.floor(x / CELL)) * 4;
        target[c] += toLinear[input[p]]; target[c + 1] += toLinear[input[p + 1]]; target[c + 2] += toLinear[input[p + 2]];
      }
    }
    for (let c = 0; c < n; c++) {
      for (let k = 0; k < 3; k++) { target[n * 4 + k] += target[c * 4 + k] / (width * height); target[c * 4 + k] /= count[c]; }
      target[c * 4 + 3] = W_LUM[0] * target[c * 4] + W_LUM[1] * target[c * 4 + 1] + W_LUM[2] * target[c * 4 + 2];
    }
    target[n * 4 + 3] = W_LUM[0] * target[n * 4] + W_LUM[1] * target[n * 4 + 1] + W_LUM[2] * target[n * 4 + 2];
    // 2. per region: how far may the shown mean move this time
    const decay = Math.exp(-dt / TAU);
    let damped = 0;
    for (let c = 0; c <= n; c++) {
      let a = 1;
      for (let k = 0; k < 4; k++) {
        const i = c * 4 + k, moved = target[i] - last[i];
        last[i] = target[i];
        up[i] = Math.min(CAP, up[i] * decay + (moved > 0 ? moved : 0));
        down[i] = Math.min(CAP, down[i] * decay + (moved < 0 ? -moved : 0));
        flips[i] *= decay;
        const way = moved > STEP ? 1 : moved < -STEP ? -1 : 0;
        if (way && way !== dir[i]) { // a turn counts when it follows a sharp edge closely; a fade is a long run, not an edge
          if (dir[i] && nowMs - moveMs[i] < QUICK && moveMs[i] - runMs[i] < EDGE) flips[i] += 1;
          runMs[i] = nowMs; dir[i] = way;
        }
        if (way) moveMs[i] = nowMs;
        const flicker = Math.min(up[i], down[i]) >= LIMIT[k] && flips[i] >= FLIPS && nowMs - moveMs[i] < HOLD; // let go soon after the last sharp change, so a hit blink does not freeze that part of the screen for a second
        const want = Math.abs(target[i] - mean[i]), may = (flicker ? SLOW : FAST) * dt;
        if (want > may) a = Math.min(a, may / want);
      }
      alpha[c] = a;
    }
    for (let c = 0; c < n; c++) {
      const a = (alpha[c] = Math.min(alpha[c], alpha[n])); // the whole-screen limit applies to every region
      if (a < 1) damped++;
      for (let k = 0; k < 4; k++) mean[c * 4 + k] += a * (target[c * 4 + k] - mean[c * 4 + k]);
    }
    mean.fill(0, n * 4);
    for (let c = 0; c < n; c++) for (let k = 0; k < 4; k++) mean[n * 4 + k] += mean[c * 4 + k] * count[c] / (width * height);
    // 3. blend every pixel towards the game's picture by its region's strength
    for (let y = 0, p = 0, q = 0; y < height; y++) {
      const row = Math.floor(y / CELL) * cols;
      for (let x = 0; x < width; x++, p += 4, q += 3) {
        const a = alpha[row + Math.floor(x / CELL)];
        for (let k = 0; k < 3; k++) {
          const v = (shown[q + k] += a * (toLinear[input[p + k]] - shown[q + k]));
          output[p + k] = toByte[(v * 4096 + 0.5) | 0];
        }
        output[p + 3] = 255;
      }
    }
    return { damped, regions: n }; // how many regions were held back this time
  }
  return { step, width, height };
}
