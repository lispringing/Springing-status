const windowCache = new Map();
const twiddleCache = new Map();

self.onmessage = (event) => {
  const { type, data } = event.data;

  try {
    if (type === "genSignal") {
      const signal = genSignal(data);
      self.postMessage({ type: "genResult", data: signal }, [signal.buffer]);
      return;
    }

    if (type === "statTime") {
      self.postMessage({ type: "statResult", data: calcTimeStat(data.sig) });
      return;
    }

    if (type === "calcFFT") {
      self.postMessage({ type: "fftResult", data: calcFullFFT(data) });
      return;
    }
  } catch (error) {
    self.postMessage({ type: "error", message: error.message || String(error) });
  }
};

function genSignal(opt) {
  const fs = positiveNumber(opt.fs, 1000);
  const count = Math.max(2, Math.floor(positiveNumber(opt.N, 1024)));
  const freq = Number(opt.freq) || 0;
  const amp = Number(opt.amp) || 0;
  const phase = Number(opt.phase) || 0;
  const signal = new Float64Array(count);

  for (let n = 0; n < count; n++) {
    const t = n / fs;
    const cycle = freq * t + phase / (2 * Math.PI);
    const angle = 2 * Math.PI * cycle;

    switch (opt.type) {
      case "square":
        signal[n] = amp * (Math.sin(angle) >= 0 ? 1 : -1);
        break;
      case "triangle":
        signal[n] = amp * (4 * Math.abs(cycle - Math.floor(cycle + 0.75) + 0.25) - 1);
        break;
      case "sawtooth":
        signal[n] = amp * (2 * (cycle - Math.floor(cycle + 0.5)));
        break;
      case "noise":
        signal[n] = amp * gaussianNoise();
        break;
      case "sine":
      default:
        signal[n] = amp * Math.sin(angle);
        break;
    }
  }

  return signal;
}

function gaussianNoise() {
  const u1 = Math.max(Math.random(), Number.EPSILON);
  const u2 = Math.random();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

function getWindow(type, length) {
  const key = `${type}-${length}`;
  if (windowCache.has(key)) return windowCache.get(key);

  const win = new Float64Array(length);
  const end = Math.max(1, length - 1);

  for (let n = 0; n < length; n++) {
    const x = 2 * Math.PI * n / end;
    switch (type) {
      case "hann":
        win[n] = 0.5 * (1 - Math.cos(x));
        break;
      case "hamming":
        win[n] = 0.54 - 0.46 * Math.cos(x);
        break;
      case "blackman":
        win[n] = 0.42 - 0.5 * Math.cos(x) + 0.08 * Math.cos(2 * x);
        break;
      case "rect":
      default:
        win[n] = 1;
        break;
    }
  }

  windowCache.set(key, win);
  return win;
}

function calcFullFFT(opt) {
  const source = opt.sig || [];
  const fs = positiveNumber(opt.fs, 1000);
  const requested = Math.floor(positiveNumber(opt.fftSize, source.length || 1024));
  const fftSize = clampPowerOfTwo(requested);
  const windowed = new Float64Array(fftSize);
  const win = getWindow(opt.winType, fftSize);
  let winSum = 0;

  for (let i = 0; i < fftSize; i++) {
    const sample = i < source.length ? source[i] : 0;
    windowed[i] = sample * win[i];
    winSum += win[i];
  }

  const correction = opt.winCorrect && winSum > 0 ? fftSize / winSum : 1;
  const { real, imag } = calcFFT(windowed);
  const maxBin = opt.singleSide ? Math.floor(fftSize / 2) + 1 : fftSize;
  const spectrum = new Array(maxBin);

  for (let k = 0; k < maxBin; k++) {
    const magRaw = Math.hypot(real[k], imag[k]) / fftSize;
    const sideGain = opt.singleSide && k > 0 && k < fftSize / 2 ? 2 : 1;
    const mag = magRaw * correction * sideGain;
    spectrum[k] = {
      freq: k * fs / fftSize,
      mag,
      phase: Math.atan2(imag[k], real[k]),
      db: 20 * Math.log10(Math.max(mag, 1e-12))
    };
  }

  return {
    fftSize,
    sampleRate: fs,
    points: spectrum
  };
}

function calcFFT(input) {
  const n = input.length;
  const real = new Float64Array(input);
  const imag = new Float64Array(n);

  let j = 0;
  for (let i = 0; i < n; i++) {
    if (i < j) {
      const tr = real[i];
      real[i] = real[j];
      real[j] = tr;
      const ti = imag[i];
      imag[i] = imag[j];
      imag[j] = ti;
    }

    let bit = n >> 1;
    while (j & bit) {
      j ^= bit;
      bit >>= 1;
    }
    j ^= bit;
  }

  const twiddle = getTwiddle(n);
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1;
    const step = n / size;
    for (let start = 0; start < n; start += size) {
      for (let offset = 0; offset < half; offset++) {
        const even = start + offset;
        const odd = even + half;
        const tw = offset * step;
        const tr = real[odd] * twiddle.r[tw] - imag[odd] * twiddle.i[tw];
        const ti = real[odd] * twiddle.i[tw] + imag[odd] * twiddle.r[tw];

        real[odd] = real[even] - tr;
        imag[odd] = imag[even] - ti;
        real[even] += tr;
        imag[even] += ti;
      }
    }
  }

  return { real, imag };
}

function getTwiddle(n) {
  if (twiddleCache.has(n)) return twiddleCache.get(n);

  const r = new Float64Array(n / 2);
  const i = new Float64Array(n / 2);
  for (let k = 0; k < n / 2; k++) {
    const angle = -2 * Math.PI * k / n;
    r[k] = Math.cos(angle);
    i[k] = Math.sin(angle);
  }

  const twiddle = { r, i };
  twiddleCache.set(n, twiddle);
  return twiddle;
}

function calcTimeStat(sig) {
  if (!sig || !sig.length) {
    return { max: 0, min: 0, mean: 0, rms: 0, pkpk: 0, std: 0 };
  }

  let max = -Infinity;
  let min = Infinity;
  let sum = 0;
  let sumSq = 0;

  for (const value of sig) {
    if (value > max) max = value;
    if (value < min) min = value;
    sum += value;
    sumSq += value * value;
  }

  const mean = sum / sig.length;
  const rms = Math.sqrt(sumSq / sig.length);
  const variance = Math.max(0, sumSq / sig.length - mean * mean);

  return {
    max,
    min,
    mean,
    rms,
    pkpk: max - min,
    std: Math.sqrt(variance)
  };
}

function clampPowerOfTwo(value) {
  const min = 2;
  const max = 1 << 20;
  const safe = Math.min(max, Math.max(min, value || 1024));
  return 2 ** Math.round(Math.log2(safe));
}

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}
