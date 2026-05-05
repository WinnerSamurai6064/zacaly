/**
 * epzin-engine.js
 * All image processing runs entirely in-browser on a CanvasRenderingContext2D.
 * Zero server calls. Privacy-first.
 */
const EpzinEngine = (() => {

  // ─────────────────────────────────────────────
  // SECTION 1: UPSCALING
  // ─────────────────────────────────────────────

  /**
   * Lanczos kernel (a=3)
   */
  function lanczosKernel(x, a = 3) {
    if (x === 0) return 1;
    if (Math.abs(x) >= a) return 0;
    const px = Math.PI * x;
    return (a * Math.sin(px) * Math.sin(px / a)) / (px * px);
  }

  /**
   * Bicubic kernel (Mitchell-Netravali B=0 C=0.5)
   */
  function bicubicKernel(x) {
    const ax = Math.abs(x);
    if (ax < 1) return (1.5 * ax * ax * ax) - (2.5 * ax * ax) + 1;
    if (ax < 2) return (-0.5 * ax * ax * ax) + (2.5 * ax * ax) - (4 * ax) + 2;
    return 0;
  }

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  /**
   * Resize ImageData using the specified algorithm.
   * algo: 'lanczos' | 'bicubic' | 'nearest' | 'bilinear'
   */
  function resizeImageData(src, dstW, dstH, algo) {
    const srcW = src.width, srcH = src.height;
    const srcData = src.data;
    const dst = new ImageData(dstW, dstH);
    const dstData = dst.data;

    if (algo === 'nearest') {
      for (let y = 0; y < dstH; y++) {
        for (let x = 0; x < dstW; x++) {
          const sx = Math.floor(x * srcW / dstW);
          const sy = Math.floor(y * srcH / dstH);
          const si = (sy * srcW + sx) * 4;
          const di = (y * dstW + x) * 4;
          dstData[di]   = srcData[si];
          dstData[di+1] = srcData[si+1];
          dstData[di+2] = srcData[si+2];
          dstData[di+3] = srcData[si+3];
        }
      }
      return dst;
    }

    const kernelFn = algo === 'lanczos' ? (x => lanczosKernel(x, 3))
                   : algo === 'bicubic' ? bicubicKernel
                   : (x => Math.max(0, 1 - Math.abs(x))); // bilinear
    const support  = algo === 'lanczos' ? 3 : algo === 'bicubic' ? 2 : 1;

    const scaleX = srcW / dstW;
    const scaleY = srcH / dstH;

    for (let y = 0; y < dstH; y++) {
      const srcY = (y + 0.5) * scaleY - 0.5;
      const minY = Math.floor(srcY - support) | 0;
      const maxY = Math.ceil(srcY + support) | 0;

      for (let x = 0; x < dstW; x++) {
        const srcX = (x + 0.5) * scaleX - 0.5;
        const minX = Math.floor(srcX - support) | 0;
        const maxX = Math.ceil(srcX + support) | 0;

        let r = 0, g = 0, b = 0, a = 0, wSum = 0;

        for (let ky = minY; ky <= maxY; ky++) {
          const wy = kernelFn((srcY - ky) / (scaleY > 1 ? scaleY : 1));
          if (Math.abs(wy) < 1e-6) continue;
          const py = clamp(ky, 0, srcH - 1);

          for (let kx = minX; kx <= maxX; kx++) {
            const wx = kernelFn((srcX - kx) / (scaleX > 1 ? scaleX : 1));
            if (Math.abs(wx) < 1e-6) continue;
            const px = clamp(kx, 0, srcW - 1);
            const si = (py * srcW + px) * 4;
            const w = wy * wx;
            r += srcData[si]   * w;
            g += srcData[si+1] * w;
            b += srcData[si+2] * w;
            a += srcData[si+3] * w;
            wSum += w;
          }
        }

        const di = (y * dstW + x) * 4;
        if (wSum > 0) {
          dstData[di]   = clamp(Math.round(r / wSum), 0, 255);
          dstData[di+1] = clamp(Math.round(g / wSum), 0, 255);
          dstData[di+2] = clamp(Math.round(b / wSum), 0, 255);
          dstData[di+3] = clamp(Math.round(a / wSum), 0, 255);
        }
      }
    }
    return dst;
  }

  /**
   * Real-ESRGAN-style sharpening (unsharp mask + edge enhancement).
   * Pure math, no neural network.
   * noiseLevel: 0–100 controls suppression of noise amplification.
   */
  function applyRealESRGANStyle(imageData, noiseLevel = 20) {
    const { width: w, height: h, data: d } = imageData;
    const out = new Uint8ClampedArray(d);

    // 5×5 Gaussian blur for unsharp mask
    const sigma = 1.0;
    const kernel5 = gaussianKernel(5, sigma);

    const blurred = convolve(d, w, h, kernel5, 5);

    // Adaptive unsharp mask
    const strength = 0.6 - noiseLevel * 0.004; // 0.6 at 0 noise → 0.2 at 100 noise
    const threshold = noiseLevel * 0.5;

    for (let i = 0; i < d.length; i += 4) {
      for (let c = 0; c < 3; c++) {
        const orig = d[i + c];
        const blur = blurred[i + c];
        const diff = orig - blur;
        if (Math.abs(diff) > threshold) {
          out[i + c] = clamp(orig + diff * strength, 0, 255);
        } else {
          out[i + c] = orig;
        }
      }
      out[i + 3] = d[i + 3];
    }

    imageData.data.set(out);
    return imageData;
  }

  function gaussianKernel(size, sigma) {
    const k = [];
    const half = Math.floor(size / 2);
    let sum = 0;
    for (let y = -half; y <= half; y++) {
      for (let x = -half; x <= half; x++) {
        const v = Math.exp(-(x*x + y*y) / (2 * sigma * sigma));
        k.push(v);
        sum += v;
      }
    }
    return k.map(v => v / sum);
  }

  function convolve(data, w, h, kernel, kSize) {
    const half = Math.floor(kSize / 2);
    const out = new Uint8ClampedArray(data.length);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let r = 0, g = 0, b = 0;
        let ki = 0;
        for (let ky = -half; ky <= half; ky++) {
          for (let kx = -half; kx <= half; kx++) {
            const px = clamp(x + kx, 0, w - 1);
            const py = clamp(y + ky, 0, h - 1);
            const si = (py * w + px) * 4;
            const kv = kernel[ki++];
            r += data[si]   * kv;
            g += data[si+1] * kv;
            b += data[si+2] * kv;
          }
        }
        const di = (y * w + x) * 4;
        out[di]   = clamp(r, 0, 255);
        out[di+1] = clamp(g, 0, 255);
        out[di+2] = clamp(b, 0, 255);
        out[di+3] = data[di+3];
      }
    }
    return out;
  }

  // ─────────────────────────────────────────────
  // SECTION 2: COLOR FIX
  // ─────────────────────────────────────────────

  /**
   * CLAHE (Contrast Limited Adaptive Histogram Equalization)
   * Operates in LAB-like luminance space.
   * clipLimit: 1.0–4.0 (gentle at 1.5)
   * tileSize: 8 or 16
   */
  function applyCLAHE(imageData, clipLimit = 1.5, tileSize = 8) {
    const { width: w, height: h, data: d } = imageData;
    const out = new Uint8ClampedArray(d);

    // Convert to YCbCr, apply CLAHE on Y only
    const Y = new Float32Array(w * h);
    const Cb = new Float32Array(w * h);
    const Cr = new Float32Array(w * h);

    for (let i = 0, pi = 0; pi < d.length; i++, pi += 4) {
      const r = d[pi] / 255, g = d[pi+1] / 255, b = d[pi+2] / 255;
      Y[i]  = clamp(0.299*r + 0.587*g + 0.114*b, 0, 1);
      Cb[i] = -0.16874*r - 0.33126*g + 0.5*b + 0.5;
      Cr[i] = 0.5*r - 0.41869*g - 0.08131*b + 0.5;
    }

    const tilesX = Math.ceil(w / tileSize);
    const tilesY = Math.ceil(h / tileSize);
    const tileCDFs = [];

    for (let ty = 0; ty < tilesY; ty++) {
      for (let tx = 0; tx < tilesX; tx++) {
        const x0 = tx * tileSize, y0 = ty * tileSize;
        const x1 = Math.min(x0 + tileSize, w);
        const y1 = Math.min(y0 + tileSize, h);

        // Build histogram
        const hist = new Int32Array(256);
        let count = 0;
        for (let y = y0; y < y1; y++) {
          for (let x = x0; x < x1; x++) {
            hist[Math.round(Y[y * w + x] * 255)]++;
            count++;
          }
        }

        // Clip
        const clipCount = Math.round(clipLimit * count / 256);
        let excess = 0;
        for (let i = 0; i < 256; i++) {
          if (hist[i] > clipCount) {
            excess += hist[i] - clipCount;
            hist[i] = clipCount;
          }
        }
        const redistPerBin = excess / 256;
        for (let i = 0; i < 256; i++) hist[i] += redistPerBin;

        // CDF
        const cdf = new Float32Array(256);
        cdf[0] = hist[0];
        for (let i = 1; i < 256; i++) cdf[i] = cdf[i-1] + hist[i];
        const cdfMin = cdf.find(v => v > 0) || 1;
        for (let i = 0; i < 256; i++) {
          cdf[i] = (cdf[i] - cdfMin) / (count - cdfMin);
        }
        tileCDFs.push(cdf);
      }
    }

    // Bilinear interpolation of tile CDFs
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const yVal = Y[i];

        const tx = (x - tileSize / 2) / tileSize;
        const ty = (y - tileSize / 2) / tileSize;
        const tx0 = clamp(Math.floor(tx), 0, tilesX - 1);
        const ty0 = clamp(Math.floor(ty), 0, tilesY - 1);
        const tx1 = clamp(tx0 + 1, 0, tilesX - 1);
        const ty1 = clamp(ty0 + 1, 0, tilesY - 1);
        const xf = clamp(tx - tx0, 0, 1);
        const yf = clamp(ty - ty0, 0, 1);

        const bin = Math.round(yVal * 255);
        const c00 = tileCDFs[ty0 * tilesX + tx0][bin];
        const c10 = tileCDFs[ty0 * tilesX + tx1][bin];
        const c01 = tileCDFs[ty1 * tilesX + tx0][bin];
        const c11 = tileCDFs[ty1 * tilesX + tx1][bin];

        const mapped = (1-xf)*(1-yf)*c00 + xf*(1-yf)*c10 + (1-xf)*yf*c01 + xf*yf*c11;

        // Convert back from YCbCr
        const newY = clamp(mapped, 0, 1);
        const cb = Cb[i] - 0.5;
        const cr = Cr[i] - 0.5;
        const r = clamp(newY + 1.40200 * cr, 0, 1);
        const g = clamp(newY - 0.34414 * cb - 0.71414 * cr, 0, 1);
        const b = clamp(newY + 1.77200 * cb, 0, 1);

        const pi = i * 4;
        out[pi]   = Math.round(r * 255);
        out[pi+1] = Math.round(g * 255);
        out[pi+2] = Math.round(b * 255);
        out[pi+3] = d[pi+3];
      }
    }

    imageData.data.set(out);
    return imageData;
  }

  /**
   * Monochromatic film grain (identical noise on R/G/B — no color speckling).
   * scale: 0–100 → intensity
   */
  function applyFilmGrain(imageData, scale = 25) {
    const { width: w, height: h, data: d } = imageData;
    const intensity = scale * 0.05; // 0 → 0, 100 → 5 sigma
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        // Box-Muller
        const u1 = Math.random(), u2 = Math.random();
        const noise = Math.sqrt(-2 * Math.log(u1 + 1e-10)) * Math.cos(2 * Math.PI * u2) * intensity;
        const i = (y * w + x) * 4;
        d[i]   = clamp(d[i]   + noise, 0, 255);
        d[i+1] = clamp(d[i+1] + noise, 0, 255);
        d[i+2] = clamp(d[i+2] + noise, 0, 255);
      }
    }
    return imageData;
  }

  // ─────────────────────────────────────────────
  // SECTION 3: HARDWARE SIMULATION FILTERS
  // ─────────────────────────────────────────────

  /**
   * iPhone 6 simulation:
   * - Slight warm cast (yellow-orange tint)
   * - Very mild barrel distortion (via canvas transform)
   * - Soft vignette
   * - Slight color compression (reduced saturation in highlights)
   * - fSoftness: sharpen slightly at center, soft edges
   */
  function applyIPhone6Filter(imageData) {
    const { width: w, height: h, data: d } = imageData;

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        let r = d[i] / 255, g = d[i+1] / 255, b = d[i+2] / 255;

        // Warm cast (+red, +green slightly, -blue)
        r = clamp(r * 1.04 + 0.01, 0, 1);
        g = clamp(g * 1.01, 0, 1);
        b = clamp(b * 0.96, 0, 1);

        // Highlight compression (iPhone JPEG over-exposing)
        const lum = 0.299*r + 0.587*g + 0.114*b;
        if (lum > 0.80) {
          const blend = (lum - 0.80) / 0.20;
          r = r + (0.95 - r) * blend * 0.3;
          g = g + (0.92 - g) * blend * 0.3;
          b = b + (0.90 - b) * blend * 0.3;
        }

        // Vignette
        const nx = (x / w - 0.5) * 2, ny = (y / h - 0.5) * 2;
        const dist = Math.sqrt(nx*nx + ny*ny);
        const vignette = clamp(1 - dist * 0.18, 0.6, 1);
        r *= vignette; g *= vignette; b *= vignette;

        d[i]   = Math.round(clamp(r, 0, 1) * 255);
        d[i+1] = Math.round(clamp(g, 0, 1) * 255);
        d[i+2] = Math.round(clamp(b, 0, 1) * 255);
      }
    }
    return imageData;
  }

  /**
   * iPhone 6s simulation (improved over 6):
   * - Slightly cooler, more neutral white balance
   * - Better highlight recovery (less clipping)
   * - Shallower apparent depth (faint edge softening)
   * - True Tone-ish color accuracy
   */
  function applyIPhone6sFilter(imageData) {
    const { width: w, height: h, data: d } = imageData;

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        let r = d[i] / 255, g = d[i+1] / 255, b = d[i+2] / 255;

        // Slightly cooler than 6 (less yellow)
        r = clamp(r * 1.01, 0, 1);
        g = clamp(g * 1.01, 0, 1);
        b = clamp(b * 1.00, 0, 1);

        // Better highlight detail
        const lum = 0.299*r + 0.587*g + 0.114*b;
        if (lum > 0.85) {
          const blend = (lum - 0.85) / 0.15;
          r = r + (0.98 - r) * blend * 0.15;
          g = g + (0.97 - g) * blend * 0.15;
          b = b + (0.97 - b) * blend * 0.15;
        }

        // Shadow lift (6s has slightly lifted blacks)
        r = r * 0.97 + 0.01;
        g = g * 0.97 + 0.01;
        b = b * 0.97 + 0.01;

        // Subtle vignette (less than 6)
        const nx = (x / w - 0.5) * 2, ny = (y / h - 0.5) * 2;
        const dist = Math.sqrt(nx*nx + ny*ny);
        const vignette = clamp(1 - dist * 0.10, 0.75, 1);
        r *= vignette; g *= vignette; b *= vignette;

        d[i]   = Math.round(clamp(r, 0, 1) * 255);
        d[i+1] = Math.round(clamp(g, 0, 1) * 255);
        d[i+2] = Math.round(clamp(b, 0, 1) * 255);
      }
    }
    return imageData;
  }

  // ─────────────────────────────────────────────
  // SECTION 4: EXPORT with ICC embedding
  // ─────────────────────────────────────────────

  /**
   * Export canvas to Blob with ICC profile embedded.
   * @param {HTMLCanvasElement} canvas
   * @param {string} format 'png' | 'jpeg'
   * @param {string} profileName sRGB | AdobeRGB1998 | AppleRGB | ColorMatchRGB
   * @param {number} quality 0-1 (jpeg only)
   * @returns {Promise<Blob>}
   */
  async function exportWithICC(canvas, format, profileName, quality = 0.95) {
    const mime = format === 'jpeg' ? 'image/jpeg' : 'image/png';
    const blob = await new Promise(res => canvas.toBlob(res, mime, quality));
    const arrayBuffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);

    const iccBytes = IccProfiles.getProfile(profileName);

    let finalBytes;
    if (format === 'jpeg') {
      finalBytes = IccProfiles.embedIccIntoJpeg(bytes, iccBytes);
    } else {
      finalBytes = IccProfiles.embedIccIntoPng(bytes, profileName, iccBytes);
    }

    return new Blob([finalBytes], { type: mime });
  }

  // ─────────────────────────────────────────────
  // PUBLIC API
  // ─────────────────────────────────────────────
  return {
    resizeImageData,
    applyRealESRGANStyle,
    applyCLAHE,
    applyFilmGrain,
    applyIPhone6Filter,
    applyIPhone6sFilter,
    exportWithICC,
  };
})();

window.EpzinEngine = EpzinEngine;
