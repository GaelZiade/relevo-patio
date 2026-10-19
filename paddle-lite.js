// Minimal PaddleOCR (PP-OCRv4) on onnxruntime: text detection + recognition, no OpenCV.
// Works in the browser (global `ort`) and in Node (pass onnxruntime-node) on plain RGBA pixels.
(function (root) {
  const DET_MAX = 960;          // longest side fed to the detector
  const REC_H = 48;             // recognizer input height
  const MEAN = [0.485, 0.456, 0.406], STD = [0.229, 0.224, 0.225];

  // bilinear resize of an RGBA buffer
  function resize(src, sw, sh, dw, dh) {
    const out = new Uint8ClampedArray(dw * dh * 4);
    const xr = sw / dw, yr = sh / dh;
    for (let y = 0; y < dh; y++) {
      const fy = Math.min(sh - 1, (y + 0.5) * yr - 0.5), y0 = Math.max(0, Math.floor(fy)), y1 = Math.min(sh - 1, y0 + 1), wy = Math.max(0, fy - y0);
      for (let x = 0; x < dw; x++) {
        const fx = Math.min(sw - 1, (x + 0.5) * xr - 0.5), x0 = Math.max(0, Math.floor(fx)), x1 = Math.min(sw - 1, x0 + 1), wx = Math.max(0, fx - x0);
        const a = (y0 * sw + x0) * 4, b = (y0 * sw + x1) * 4, c = (y1 * sw + x0) * 4, d = (y1 * sw + x1) * 4, o = (y * dw + x) * 4;
        for (let k = 0; k < 3; k++) {
          out[o + k] = (src[a + k] * (1 - wx) + src[b + k] * wx) * (1 - wy) + (src[c + k] * (1 - wx) + src[d + k] * wx) * wy;
        }
        out[o + 3] = 255;
      }
    }
    return out;
  }
  function crop(src, sw, x0, y0, x1, y1) {
    const w = x1 - x0, h = y1 - y0, out = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) out.set(src.subarray(((y0 + y) * sw + x0) * 4, ((y0 + y) * sw + x1) * 4), y * w * 4);
    return out;
  }

  // connected regions of the probability map above `thr` -> axis-aligned boxes
  function boxesFrom(prob, W, H, thr = 0.3, boxThr = 0.5) {
    const seen = new Uint8Array(W * H), boxes = [], stack = [];
    for (let i = 0; i < W * H; i++) {
      if (seen[i] || prob[i] <= thr) continue;
      let x0 = W, y0 = H, x1 = 0, y1 = 0, n = 0, sum = 0;
      stack.push(i); seen[i] = 1;
      while (stack.length) {
        const p = stack.pop(), x = p % W, y = (p - x) / W;
        n++; sum += prob[p];
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        for (const q of [p - 1, p + 1, p - W, p + W]) {
          if (q < 0 || q >= W * H || seen[q] || prob[q] <= thr) continue;
          if ((q === p - 1 && x === 0) || (q === p + 1 && x === W - 1)) continue;
          seen[q] = 1; stack.push(q);
        }
      }
      const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
      if (Math.min(bw, bh) < 3 || sum / n < boxThr) continue;
      // DB "unclip": grow the shrunk text kernel back to the full text size
      const d = (bw * bh * 1.5) / (2 * (bw + bh));
      boxes.push({ x0: x0 - d, y0: y0 - d, x1: x1 + 1 + d, y1: y1 + 1 + d, score: sum / n });
    }
    return boxes;
  }

  async function create({ ort, det, rec, dict, allowed = /^[A-Z0-9 ]$/ }) {
    const opts = { executionProviders: ["wasm"], graphOptimizationLevel: "all" };
    const detS = await ort.InferenceSession.create(det, opts);
    const recS = await ort.InferenceSession.create(rec, opts);
    const chars = ["", ...String(dict).split(/\r?\n/).filter((l, i, a) => i < a.length - 1 || l !== ""), " "];
    // only letters and digits may win a CTC step (index 0 = blank)
    const ok = chars.map((c, i) => i === 0 || allowed.test(c));

    async function detectBoxes(rgba, w, h) {
      const s = Math.min(1, DET_MAX / Math.max(w, h));
      const dw = Math.max(32, Math.round((w * s) / 32) * 32), dh = Math.max(32, Math.round((h * s) / 32) * 32);
      const px = resize(rgba, w, h, dw, dh), n = dw * dh, t = new Float32Array(3 * n);
      for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) t[k * n + i] = (px[i * 4 + k] / 255 - MEAN[k]) / STD[k];
      const out = await detS.run({ [detS.inputNames[0]]: new ort.Tensor("float32", t, [1, 3, dh, dw]) });
      const prob = out[detS.outputNames[0]].data;
      const sx = w / dw, sy = h / dh;
      return boxesFrom(prob, dw, dh).map((b) => ({
        x0: Math.max(0, Math.floor(b.x0 * sx)), y0: Math.max(0, Math.floor(b.y0 * sy)),
        x1: Math.min(w, Math.ceil(b.x1 * sx)), y1: Math.min(h, Math.ceil(b.y1 * sy)), score: b.score,
      })).filter((b) => b.x1 - b.x0 >= 4 && b.y1 - b.y0 >= 4);
    }

    async function recognize(rgba, w, h, box) {
      const bw = box.x1 - box.x0, bh = box.y1 - box.y0;
      const part = crop(rgba, w, box.x0, box.y0, box.x1, box.y1);
      const rw = Math.max(16, Math.min(960, Math.round((REC_H * bw) / bh)));
      const px = resize(part, bw, bh, rw, REC_H), n = rw * REC_H, t = new Float32Array(3 * n);
      for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) t[k * n + i] = (px[i * 4 + k] / 255 - 0.5) / 0.5;
      const out = await recS.run({ [recS.inputNames[0]]: new ort.Tensor("float32", t, [1, 3, REC_H, rw]) });
      const o = out[recS.outputNames[0]], [, T, C] = o.dims, p = o.data;
      let text = "", last = 0, confSum = 0, confN = 0;
      for (let ti = 0; ti < T; ti++) {
        let best = 0, bv = -1;
        for (let c = 0; c < C; c++) if (ok[c] && p[ti * C + c] > bv) { bv = p[ti * C + c]; best = c; }
        if (best !== 0 && best !== last) { text += chars[best] || ""; confSum += bv; confN++; }
        last = best;
      }
      return { text, conf: confN ? confSum / confN : 0 };
    }

    // all text lines in the image, largest first
    async function read(rgba, w, h) {
      const boxes = await detectBoxes(rgba, w, h);
      const lines = [];
      for (const b of boxes) {
        const r = await recognize(rgba, w, h, b);
        if (r.text) lines.push({ text: r.text, conf: r.conf, h: b.y1 - b.y0, box: b });
      }
      return lines.sort((a, b) => b.h - a.h);
    }
    return { read, detectBoxes, recognize };
  }

  root.PaddleLite = { create };
  if (typeof module !== "undefined") module.exports = root.PaddleLite;
})(typeof self !== "undefined" ? self : globalThis);
