const state = {
  sigData: null,
  specData: null,
  fs: 1000,
  sampleCount: 1024,
  fftSize: 1024,
  cursor1: 0,
  cursor2: 256,
  nextCursor: 1,
  doubleCursor: false,
  worker: null,
  timeView: createView(0, 1.024, -1.2, 1.2),
  freqView: createView(0, 500, -90, 10),
  elements: {}
};

window.addEventListener("load", init);

function createView(xMin, xMax, yMin, yMax) {
  return {
    xMin,
    xMax,
    yMin,
    yMax,
    dragging: false,
    dragStart: null,
    startView: null
  };
}

function init() {
  cacheElements();
  state.worker = new Worker("./worker.js");
  state.worker.onmessage = handleWorkerMessage;
  state.worker.onerror = (event) => setMeta(`计算线程错误：${event.message || "unknown"}`);

  resizeCanvas();
  bindEvents();
  genSignal();
}

function cacheElements() {
  const ids = [
    "btnImport", "btnExportImg", "btnExportData", "btnGenSig", "btnResetView",
    "fileInput", "sigType", "freq", "amp", "phase", "fs", "fftSize",
    "winType", "specMode", "singleSide", "winCorrect", "cursorDouble",
    "canvasTime", "canvasFreq", "timeMeta", "freqMeta", "infoSampleRate",
    "infoDataLen", "infoDuration", "statMax", "statMin", "statMean",
    "statRms", "statPkPk", "statStd", "curT1", "curA1", "curT2",
    "curTDiff", "curFreq"
  ];

  for (const id of ids) {
    state.elements[id] = document.getElementById(id);
  }
}

function bindEvents() {
  const el = state.elements;
  el.btnGenSig.addEventListener("click", genSignal);
  el.btnResetView.addEventListener("click", resetView);
  el.btnImport.addEventListener("click", () => el.fileInput.click());
  el.fileInput.addEventListener("change", importFile);
  el.btnExportImg.addEventListener("click", exportCanvasImage);
  el.btnExportData.addEventListener("click", exportCsv);

  el.winType.addEventListener("change", calcFFT);
  el.singleSide.addEventListener("change", () => {
    resetFreqView();
    calcFFT();
  });
  el.winCorrect.addEventListener("change", calcFFT);
  el.specMode.addEventListener("change", () => {
    fitFreqY();
    renderFreq();
  });
  el.cursorDouble.addEventListener("change", (event) => {
    state.doubleCursor = event.target.checked;
    state.nextCursor = 1;
    renderAll();
    updateCursorInfo();
  });

  for (const id of ["sigType", "freq", "amp", "phase", "fs", "fftSize"]) {
    el[id].addEventListener("change", genSignal);
  }

  bindCanvasInteraction(el.canvasTime, "time");
  bindCanvasInteraction(el.canvasFreq, "freq");
  window.addEventListener("resize", resizeCanvas);
}

function resizeCanvas() {
  for (const canvas of [state.elements.canvasTime, state.elements.canvasFreq]) {
    if (!canvas) continue;
    const rect = canvas.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(rect.width * ratio));
    canvas.height = Math.max(1, Math.floor(rect.height * ratio));
    canvas.getContext("2d").setTransform(ratio, 0, 0, ratio, 0, 0);
  }
  renderAll();
}

function handleWorkerMessage(event) {
  const { type, data, message } = event.data;

  if (type === "error") {
    setMeta(`计算失败：${message}`);
    return;
  }

  if (type === "genResult") {
    state.sigData = data;
    state.sampleCount = data.length;
    state.cursor1 = Math.min(state.cursor1, data.length - 1);
    state.cursor2 = Math.min(Math.max(state.cursor2, 0), data.length - 1);
    fitTimeView();
    resetFreqView();
    updateSampleInfo();
    calcTimeStat();
    calcFFT();
    return;
  }

  if (type === "statResult") {
    fillStatPanel(data);
    renderTime();
    updateCursorInfo();
    return;
  }

  if (type === "fftResult") {
    state.specData = data;
    fitFreqY();
    renderFreq();
  }
}

function genSignal() {
  const el = state.elements;
  const fs = readPositive(el.fs, 1000);
  const count = Math.max(2, Math.floor(readPositive(el.fftSize, 1024)));

  state.fs = fs;
  state.sampleCount = count;
  state.fftSize = count;
  state.worker.postMessage({
    type: "genSignal",
    data: {
      type: el.sigType.value,
      fs,
      N: count,
      freq: Number(el.freq.value) || 0,
      amp: Number(el.amp.value) || 0,
      phase: Number(el.phase.value) || 0
    }
  });
}

function calcTimeStat() {
  if (!state.sigData) return;
  state.worker.postMessage({ type: "statTime", data: { sig: state.sigData } });
}

function calcFFT() {
  if (!state.sigData) return;
  const el = state.elements;
  state.fftSize = Math.max(2, Math.floor(readPositive(el.fftSize, state.sampleCount)));
  state.worker.postMessage({
    type: "calcFFT",
    data: {
      sig: state.sigData,
      fs: state.fs,
      fftSize: state.fftSize,
      winType: el.winType.value,
      singleSide: el.singleSide.checked,
      winCorrect: el.winCorrect.checked
    }
  });
}

function fillStatPanel(stat) {
  const el = state.elements;
  el.statMax.textContent = formatNumber(stat.max);
  el.statMin.textContent = formatNumber(stat.min);
  el.statMean.textContent = formatNumber(stat.mean);
  el.statRms.textContent = formatNumber(stat.rms);
  el.statPkPk.textContent = formatNumber(stat.pkpk);
  el.statStd.textContent = formatNumber(stat.std);
}

function updateSampleInfo() {
  const el = state.elements;
  const duration = state.sampleCount / state.fs;
  el.infoSampleRate.textContent = `${formatNumber(state.fs, 0)} Hz`;
  el.infoDataLen.textContent = `${state.sampleCount} 点`;
  el.infoDuration.textContent = `${formatNumber(duration, 6)} s`;
  el.timeMeta.textContent = `${state.sampleCount} 点 / ${formatNumber(duration, 4)} s`;
}

function setMeta(text) {
  state.elements.timeMeta.textContent = text;
  state.elements.freqMeta.textContent = text;
}

function renderAll() {
  renderTime();
  renderFreq();
}

function renderTime() {
  const canvas = state.elements.canvasTime;
  if (!canvas) return;

  const ctx = canvas.getContext("2d");
  const size = canvasSize(canvas);
  const plot = plotRect(size);
  const view = state.timeView;
  clearCanvas(ctx, size);
  drawGrid(ctx, plot, view, "s", "V");

  const sig = state.sigData;
  if (!sig || !sig.length) {
    drawEmpty(ctx, size, "等待信号数据");
    return;
  }

  ctx.save();
  ctx.beginPath();
  ctx.rect(plot.x, plot.y, plot.w, plot.h);
  ctx.clip();
  ctx.strokeStyle = "#55d39a";
  ctx.lineWidth = 1.4;
  ctx.beginPath();

  const startIndex = Math.max(0, Math.floor(view.xMin * state.fs));
  const endIndex = Math.min(sig.length - 1, Math.ceil(view.xMax * state.fs));
  const visibleSamples = Math.max(0, endIndex - startIndex + 1);
  let hasPoint = false;

  if (visibleSamples > plot.w * 2) {
    for (let col = 0; col <= plot.w; col++) {
      const t0 = view.xMin + col / plot.w * (view.xMax - view.xMin);
      const t1 = view.xMin + (col + 1) / plot.w * (view.xMax - view.xMin);
      const i0 = Math.max(0, Math.floor(t0 * state.fs));
      const i1 = Math.min(sig.length - 1, Math.max(i0, Math.ceil(t1 * state.fs)));
      let min = Infinity;
      let max = -Infinity;

      for (let i = i0; i <= i1; i++) {
        const value = sig[i];
        if (value < min) min = value;
        if (value > max) max = value;
      }

      if (Number.isFinite(min) && Number.isFinite(max)) {
        const x = plot.x + col;
        ctx.moveTo(x, mapY(max, view, plot));
        ctx.lineTo(x, mapY(min, view, plot));
        hasPoint = true;
      }
    }
  } else {
    for (let i = startIndex; i <= endIndex; i++) {
      const x = mapX(i / state.fs, view, plot);
      const y = mapY(sig[i], view, plot);
      if (!hasPoint) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
      hasPoint = true;
    }
  }

  if (hasPoint) ctx.stroke();
  ctx.restore();
  drawCursors(ctx, plot, view, "time");
}

function renderFreq() {
  const canvas = state.elements.canvasFreq;
  if (!canvas) return;

  const ctx = canvas.getContext("2d");
  const size = canvasSize(canvas);
  const plot = plotRect(size);
  const view = state.freqView;
  clearCanvas(ctx, size);
  drawGrid(ctx, plot, view, "Hz", freqUnit());

  const spec = state.specData?.points;
  if (!spec || !spec.length) {
    drawEmpty(ctx, size, "等待频谱数据");
    return;
  }

  const mode = state.elements.specMode.value;
  ctx.save();
  ctx.beginPath();
  ctx.rect(plot.x, plot.y, plot.w, plot.h);
  ctx.clip();
  ctx.strokeStyle = mode === "phase" ? "#c979d8" : "#f2b84b";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  let started = false;

  for (const point of spec) {
    if (point.freq < view.xMin || point.freq > view.xMax) continue;
    const yValue = spectrumValue(point, mode);
    const x = mapX(point.freq, view, plot);
    const y = mapY(yValue, view, plot);
    if (!started) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
    started = true;
  }

  if (started) ctx.stroke();
  ctx.restore();
  drawCursors(ctx, plot, view, "freq");

  const maxFreq = state.specData.points[state.specData.points.length - 1]?.freq || 0;
  state.elements.freqMeta.textContent = `${state.specData.fftSize} 点 FFT / 0-${formatNumber(maxFreq, 1)} Hz`;
}

function drawGrid(ctx, plot, view, xUnit, yUnit) {
  ctx.save();
  ctx.strokeStyle = "rgba(140, 159, 176, 0.25)";
  ctx.fillStyle = "rgba(222, 230, 236, 0.78)";
  ctx.lineWidth = 1;
  ctx.font = "12px Segoe UI, Arial, sans-serif";
  ctx.textBaseline = "middle";

  const xTicks = niceTicks(view.xMin, view.xMax, 6);
  const yTicks = niceTicks(view.yMin, view.yMax, 5);

  for (const tick of xTicks) {
    const x = mapX(tick, view, plot);
    ctx.beginPath();
    ctx.moveTo(x, plot.y);
    ctx.lineTo(x, plot.y + plot.h);
    ctx.stroke();
    ctx.textAlign = "center";
    ctx.fillText(formatTick(tick), x, plot.y + plot.h + 20);
  }

  for (const tick of yTicks) {
    const y = mapY(tick, view, plot);
    ctx.beginPath();
    ctx.moveTo(plot.x, y);
    ctx.lineTo(plot.x + plot.w, y);
    ctx.stroke();
    ctx.textAlign = "right";
    ctx.fillText(formatTick(tick), plot.x - 8, y);
  }

  ctx.fillStyle = "rgba(222, 230, 236, 0.9)";
  ctx.textAlign = "right";
  ctx.fillText(xUnit, plot.x + plot.w, plot.y + plot.h + 34);
  ctx.textAlign = "left";
  ctx.fillText(yUnit, plot.x + 2, plot.y - 8);
  ctx.restore();
}

function drawCursors(ctx, plot, view, type) {
  if (!state.sigData) return;

  const values = [state.cursor1];
  if (state.doubleCursor) values.push(state.cursor2);

  ctx.save();
  ctx.setLineDash([5, 4]);
  ctx.lineWidth = 1;

  values.forEach((index, cursorIndex) => {
    const xValue = type === "time" ? index / state.fs : index * state.fs / state.sampleCount;
    if (xValue < view.xMin || xValue > view.xMax) return;
    const x = mapX(xValue, view, plot);
    ctx.strokeStyle = cursorIndex === 0 ? "#f05d5e" : "#7aa7ff";
    ctx.beginPath();
    ctx.moveTo(x, plot.y);
    ctx.lineTo(x, plot.y + plot.h);
    ctx.stroke();
  });

  ctx.restore();
}

function drawEmpty(ctx, size, text) {
  ctx.save();
  ctx.fillStyle = "rgba(222, 230, 236, 0.7)";
  ctx.font = "14px Microsoft YaHei, Segoe UI, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, size.w / 2, size.h / 2);
  ctx.restore();
}

function bindCanvasInteraction(canvas, type) {
  const view = type === "time" ? state.timeView : state.freqView;

  canvas.addEventListener("pointerdown", (event) => {
    canvas.setPointerCapture(event.pointerId);
    const pointer = pointerInCanvas(event, canvas);
    const plot = plotRect(canvasSize(canvas));
    view.dragging = true;
    view.dragStart = pointer;
    view.startView = { xMin: view.xMin, xMax: view.xMax, yMin: view.yMin, yMax: view.yMax };

    if (insidePlot(pointer, plot)) {
      updateCursorFromPoint(pointer.x, type, plot, view, event.shiftKey);
    }
  });

  canvas.addEventListener("pointermove", (event) => {
    const pointer = pointerInCanvas(event, canvas);
    const plot = plotRect(canvasSize(canvas));

    if (view.dragging && view.dragStart && view.startView) {
      const dx = pointer.x - view.dragStart.x;
      const dy = pointer.y - view.dragStart.y;
      const xSpan = view.startView.xMax - view.startView.xMin;
      const ySpan = view.startView.yMax - view.startView.yMin;
      view.xMin = view.startView.xMin - dx / plot.w * xSpan;
      view.xMax = view.startView.xMax - dx / plot.w * xSpan;
      view.yMin = view.startView.yMin + dy / plot.h * ySpan;
      view.yMax = view.startView.yMax + dy / plot.h * ySpan;
      clampView(type);
      renderAll();
    }
  });

  canvas.addEventListener("pointerup", (event) => {
    canvas.releasePointerCapture(event.pointerId);
    view.dragging = false;
  });

  canvas.addEventListener("pointercancel", () => {
    view.dragging = false;
  });

  canvas.addEventListener("wheel", (event) => {
    event.preventDefault();
    const pointer = pointerInCanvas(event, canvas);
    const plot = plotRect(canvasSize(canvas));
    if (!insidePlot(pointer, plot)) return;

    const zoom = event.deltaY > 0 ? 1.15 : 0.87;
    const xCenter = unmapX(pointer.x, view, plot);
    const yCenter = unmapY(pointer.y, view, plot);

    if (event.shiftKey) zoomAxis(view, "y", yCenter, zoom);
    else zoomAxis(view, "x", xCenter, zoom);

    clampView(type);
    renderAll();
  }, { passive: false });
}

function updateCursorFromPoint(px, type, plot, view, useSecondCursor) {
  if (!state.sigData) return;

  const xValue = unmapX(px, view, plot);
  let index = type === "time"
    ? Math.round(xValue * state.fs)
    : Math.round(xValue / state.fs * state.sampleCount);

  index = Math.min(state.sampleCount - 1, Math.max(0, index));

  if (state.doubleCursor && (useSecondCursor || state.nextCursor === 2)) {
    state.cursor2 = index;
    state.nextCursor = 1;
  } else {
    state.cursor1 = index;
    state.nextCursor = state.doubleCursor ? 2 : 1;
  }

  renderAll();
  updateCursorInfo();
}

function updateCursorInfo() {
  const el = state.elements;
  const sig = state.sigData;
  if (!sig || !sig.length) return;

  const i1 = Math.min(sig.length - 1, Math.max(0, state.cursor1));
  const i2 = Math.min(sig.length - 1, Math.max(0, state.cursor2));
  const t1 = i1 / state.fs;
  const t2 = i2 / state.fs;
  const diff = Math.abs(t1 - t2);

  el.curT1.textContent = `${formatNumber(t1, 6)} s`;
  el.curA1.textContent = formatNumber(sig[i1]);
  el.curT2.textContent = state.doubleCursor ? `${formatNumber(t2, 6)} s` : "-";
  el.curTDiff.textContent = state.doubleCursor ? `${formatNumber(diff, 6)} s` : "-";
  el.curFreq.textContent = diff > 0 && state.doubleCursor ? `${formatNumber(1 / diff, 3)} Hz` : "-";
}

function fitTimeView() {
  if (!state.sigData || !state.sigData.length) return;

  let min = Infinity;
  let max = -Infinity;
  for (const value of state.sigData) {
    if (value < min) min = value;
    if (value > max) max = value;
  }

  if (min === max) {
    min -= 1;
    max += 1;
  }

  const pad = (max - min) * 0.12 || 1;
  state.timeView = createView(0, state.sampleCount / state.fs, min - pad, max + pad);
}

function resetFreqView() {
  const maxX = state.elements.singleSide.checked ? state.fs / 2 : state.fs;
  state.freqView.xMin = 0;
  state.freqView.xMax = maxX;
}

function fitFreqY() {
  const spec = state.specData?.points;
  if (!spec || !spec.length) return;

  const mode = state.elements.specMode.value;
  if (mode === "phase") {
    state.freqView.yMin = -Math.PI;
    state.freqView.yMax = Math.PI;
    return;
  }

  let min = Infinity;
  let max = -Infinity;
  for (const point of spec) {
    if (point.freq < state.freqView.xMin || point.freq > state.freqView.xMax) continue;
    const value = spectrumValue(point, mode);
    if (value < min) min = value;
    if (value > max) max = value;
  }

  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    min = mode === "db" ? -120 : 0;
    max = mode === "db" ? 0 : 1;
  }

  if (mode === "db") {
    state.freqView.yMin = Math.max(-160, Math.floor((max - 90) / 10) * 10);
    state.freqView.yMax = Math.ceil((max + 10) / 10) * 10;
  } else {
    const pad = (max - min) * 0.1 || 1;
    state.freqView.yMin = Math.max(0, min - pad);
    state.freqView.yMax = max + pad;
  }
}

function resetView() {
  fitTimeView();
  resetFreqView();
  fitFreqY();
  renderAll();
}

function importFile(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = () => {
    const values = String(reader.result)
      .split(/[\s,;]+/)
      .map(Number)
      .filter(Number.isFinite);

    if (!values.length) {
      setMeta("文件中没有可用数字");
      return;
    }

    state.sigData = new Float64Array(values);
    state.sampleCount = state.sigData.length;
    state.fs = readPositive(state.elements.fs, 1000);
    state.cursor1 = 0;
    state.cursor2 = Math.min(state.sampleCount - 1, Math.floor(state.sampleCount / 4));
    fitTimeView();
    resetFreqView();
    updateSampleInfo();
    calcTimeStat();
    calcFFT();
  };
  reader.readAsText(file);
  event.target.value = "";
}

function exportCanvasImage() {
  const source = state.elements.canvasTime;
  const link = document.createElement("a");
  link.download = "signal_waveform.png";
  link.href = source.toDataURL("image/png");
  link.click();
}

function exportCsv() {
  if (!state.sigData) return;

  const lines = ["time,amplitude"];
  for (let i = 0; i < state.sigData.length; i++) {
    lines.push(`${(i / state.fs).toFixed(9)},${state.sigData[i].toFixed(9)}`);
  }

  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "signal_data.csv";
  link.click();
  URL.revokeObjectURL(link.href);
}

function clearCanvas(ctx, size) {
  ctx.clearRect(0, 0, size.w, size.h);
  ctx.fillStyle = "#10151b";
  ctx.fillRect(0, 0, size.w, size.h);
}

function canvasSize(canvas) {
  return {
    w: canvas.clientWidth || 1,
    h: canvas.clientHeight || 1
  };
}

function plotRect(size) {
  const left = 56;
  const right = 16;
  const top = 20;
  const bottom = 42;
  return {
    x: left,
    y: top,
    w: Math.max(20, size.w - left - right),
    h: Math.max(20, size.h - top - bottom)
  };
}

function mapX(value, view, plot) {
  return plot.x + (value - view.xMin) / (view.xMax - view.xMin) * plot.w;
}

function mapY(value, view, plot) {
  return plot.y + plot.h - (value - view.yMin) / (view.yMax - view.yMin) * plot.h;
}

function unmapX(px, view, plot) {
  return view.xMin + (px - plot.x) / plot.w * (view.xMax - view.xMin);
}

function unmapY(py, view, plot) {
  return view.yMin + (plot.y + plot.h - py) / plot.h * (view.yMax - view.yMin);
}

function insidePlot(pointer, plot) {
  return pointer.x >= plot.x && pointer.x <= plot.x + plot.w && pointer.y >= plot.y && pointer.y <= plot.y + plot.h;
}

function pointerInCanvas(event, canvas) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top
  };
}

function zoomAxis(view, axis, center, zoom) {
  const minKey = axis === "x" ? "xMin" : "yMin";
  const maxKey = axis === "x" ? "xMax" : "yMax";
  view[minKey] = center - (center - view[minKey]) * zoom;
  view[maxKey] = center + (view[maxKey] - center) * zoom;
}

function clampView(type) {
  const view = type === "time" ? state.timeView : state.freqView;
  const maxX = type === "time"
    ? Math.max(1 / state.fs, state.sampleCount / state.fs)
    : (state.elements.singleSide.checked ? state.fs / 2 : state.fs);
  const minSpan = type === "time" ? Math.max(2 / state.fs, maxX / 100000) : Math.max(state.fs / state.fftSize, maxX / 100000);
  let span = view.xMax - view.xMin;

  if (span < minSpan) {
    const center = (view.xMin + view.xMax) / 2;
    view.xMin = center - minSpan / 2;
    view.xMax = center + minSpan / 2;
    span = minSpan;
  }

  if (span >= maxX) {
    view.xMin = 0;
    view.xMax = maxX;
  } else {
    if (view.xMin < 0) {
      view.xMax -= view.xMin;
      view.xMin = 0;
    }
    if (view.xMax > maxX) {
      const overflow = view.xMax - maxX;
      view.xMin -= overflow;
      view.xMax = maxX;
    }
  }

  if (view.yMax - view.yMin < 1e-12) {
    view.yMin -= 1;
    view.yMax += 1;
  }
}

function niceTicks(min, max, target) {
  const span = Math.max(Number.EPSILON, max - min);
  const raw = span / Math.max(1, target);
  const power = 10 ** Math.floor(Math.log10(raw));
  const fraction = raw / power;
  const niceFraction = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
  const step = niceFraction * power;
  const ticks = [];
  const start = Math.ceil(min / step) * step;

  for (let value = start; value <= max + step * 0.5; value += step) {
    ticks.push(Math.abs(value) < step * 1e-9 ? 0 : value);
  }

  return ticks;
}

function spectrumValue(point, mode) {
  if (mode === "phase") return point.phase;
  if (mode === "db") return point.db;
  return point.mag;
}

function freqUnit() {
  const mode = state.elements.specMode.value;
  if (mode === "phase") return "rad";
  if (mode === "db") return "dB";
  return "V";
}

function readPositive(input, fallback) {
  const value = Number(input.value);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function formatNumber(value, digits = 4) {
  if (!Number.isFinite(value)) return "-";
  if (Math.abs(value) >= 10000 || (Math.abs(value) > 0 && Math.abs(value) < 0.001)) {
    return value.toExponential(3);
  }
  if (digits === 0) return value.toFixed(0);
  return value.toFixed(digits).replace(/\.?0+$/, "");
}

function formatTick(value) {
  const abs = Math.abs(value);
  if (abs >= 10000 || (abs > 0 && abs < 0.001)) return value.toExponential(1);
  if (abs >= 100) return value.toFixed(0);
  if (abs >= 10) return value.toFixed(1).replace(/\.0$/, "");
  return value.toFixed(3).replace(/\.?0+$/, "");
}
