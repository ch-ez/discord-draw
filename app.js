(() => {
  'use strict';
  const C = AnseiCore,
    $ = (id) => document.getElementById(id);
  const canvas = $('canvas'),
    ctx = canvas.getContext('2d');
  const defaults = [
    '#edf1e6',
    '#b9c3ad',
    '#5f7456',
    '#26382d',
    '#d3f594',
    '#92d979',
    '#39ad72',
    '#2b7662',
    '#ffc778',
    '#ffad74',
    '#ed705e',
    '#923f48',
    '#f68aaf',
    '#d96a9f',
    '#a680ca',
    '#68548c',
    '#96c9ed',
    '#60a7ce',
    '#3471a1',
    '#23344e',
    '#ffffff',
    '#9da4a2',
    '#535e59',
    '#141716',
  ];
  let state = { width: 16, height: 16, pixels: Array(256).fill(null) },
    color = '#f68aaf',
    palette = [...defaults],
    tool = 'brush',
    undo = [],
    redo = [],
    drawing = false,
    last = null,
    hover = null,
    keyboard = [0, 0],
    keyboardActive = false,
    exported = null,
    toastTimer;
  function toast(text) {
    $('toast').textContent = text;
    $('toast').classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => $('toast').classList.remove('visible'), 3000);
  }
  function snapshot() {
    return {
      width: state.width,
      height: state.height,
      pixels: [...state.pixels],
      ...(state.imageSource ? { imageSource: state.imageSource } : {}),
    };
  }
  function remember() {
    undo.push(snapshot());
    if (undo.length > 80) undo.shift();
    redo = [];
    updateHistory();
  }
  function updateHistory() {
    $('undo').disabled = !undo.length;
    $('redo').disabled = !redo.length;
  }
  function restore(next) {
    state = next;
    hover = null;
    keyboard = [0, 0];
    syncSize();
    refresh();
  }
  function history(direction) {
    finishStroke();
    const source = direction === 'undo' ? undo : redo,
      target = direction === 'undo' ? redo : undo;
    if (!source.length) return;
    target.push(snapshot());
    restore(source.pop());
    updateHistory();
  }
  function syncSize() {
    $('width').value = state.width;
    $('height').value = state.height;
    $('canvas-size').textContent = state.width + ' × ' + state.height;
    canvas.parentElement.style.width =
      Math.min(state.width * 24, 440, (440 * state.width) / state.height) +
      'px';
    $('resize-note').textContent = state.imageSource
      ? 'Original image attached: increasing both dimensions adds detail from the source.'
      : 'Resizing keeps existing pixels. Import an original image to gain detail at higher resolutions.';
  }
  function setColor(value) {
    if (!C.validHex(value)) return;
    color = value.toLowerCase();
    $('color').value = color;
    $('hex').value = color.toUpperCase();
    C.rgb(color).forEach((n, i) => ($(['red', 'green', 'blue'][i]).value = n));
    renderPalette();
  }
  function renderPalette() {
    const fragment = document.createDocumentFragment();
    palette.forEach((c) => {
      const button = document.createElement('button');
      button.className = 'swatch' + (c === color ? ' selected' : '');
      button.style.backgroundColor = c;
      button.title = c.toUpperCase();
      button.setAttribute('aria-label', 'Use ' + c.toUpperCase());
      button.setAttribute('aria-pressed', String(c === color));
      button.addEventListener('click', () => setColor(c));
      fragment.appendChild(button);
    });
    $('palette').replaceChildren(fragment);
  }
  function setTool(value) {
    tool = value;
    document.querySelectorAll('[data-tool]').forEach((b) => {
      const active = b.dataset.tool === tool;
      b.classList.toggle('active', active);
      b.setAttribute('aria-pressed', String(active));
    });
    updateCoordinates();
  }
  function updateCoordinates() {
    const label = {
      brush: 'Brush',
      eraser: 'Eraser',
      fill: 'Fill',
      picker: 'Pick',
    }[tool];
    $('coordinates').textContent = hover
      ? `X ${hover[0] + 1} · Y ${hover[1] + 1} · ${label}`
      : `${state.width} × ${state.height} pixels · ${label}`;
  }
  function draw() {
    const cell = 24;
    canvas.width = state.width * cell;
    canvas.height = state.height * cell;
    for (let y = 0; y < state.height; y++)
      for (let x = 0; x < state.width; x++) {
        ctx.fillStyle = (x + y) % 2 ? '#252e25' : '#202820';
        ctx.fillRect(x * cell, y * cell, cell, cell);
        const c = state.pixels[y * state.width + x];
        if (c) {
          ctx.fillStyle = c;
          ctx.fillRect(x * cell, y * cell, cell, cell);
        }
      }
    if ($('grid').checked) {
      ctx.strokeStyle = '#10170f55';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = 0; x <= state.width; x++) {
        ctx.moveTo(x * cell + 0.5, 0);
        ctx.lineTo(x * cell + 0.5, canvas.height);
      }
      for (let y = 0; y <= state.height; y++) {
        ctx.moveTo(0, y * cell + 0.5);
        ctx.lineTo(canvas.width, y * cell + 0.5);
      }
      ctx.stroke();
    }
    const cursor = keyboardActive ? keyboard : hover;
    if (cursor) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(
        cursor[0] * cell + 1,
        cursor[1] * cell + 1,
        cell - 2,
        cell - 2,
      );
      if ($('mirror').checked) {
        ctx.strokeStyle = '#ffffff66';
        ctx.strokeRect(
          (state.width - 1 - cursor[0]) * cell + 1,
          cursor[1] * cell + 1,
          cell - 2,
          cell - 2,
        );
      }
    }
  }
  function renderOutput() {
    const tolerance = Number($('color-tolerance').value);
    $('tolerance-value').textContent = tolerance
      ? tolerance + ' / 255'
      : 'Exact';
    const hybrid = $('hybrid-colors').checked,
      indexedTolerance = Number($('indexed-tolerance').value);
    $('indexed-settings').hidden = !hybrid;
    $('indexed-value').textContent = indexedTolerance
      ? indexedTolerance + ' / 255'
      : 'Exact matches';
    exported = C.generate(state.pixels, state.width, state.height, {
      tolerance,
      hybrid,
      indexedTolerance,
    });
    const preview = C.importAnsi(exported.full),
      surface = $('art-preview'),
      paint = surface.getContext('2d');
    const pixelSize = 8;
    surface.width = preview.width * pixelSize;
    surface.height = preview.height * pixelSize;
    paint.fillStyle = '#2b2d31';
    paint.fillRect(0, 0, surface.width, surface.height);
    preview.pixels.forEach((value, i) => {
      if (value) {
        paint.fillStyle = value;
        paint.fillRect(
          (i % preview.width) * pixelSize,
          Math.floor(i / preview.width) * pixelSize,
          pixelSize,
          pixelSize,
        );
      }
    });
    const limit = Number($('limit').value),
      count = exported.full.length,
      over = count > limit;
    $('char-count').textContent =
      count.toLocaleString() + ' / ' + limit.toLocaleString() + ' characters';
    $('progress').style.width = Math.min(100, (count / limit) * 100) + '%';
    $('progress').classList.toggle('over', over);
    $('limit-note').hidden = !over;
    $('limit-note').textContent =
      'Over the limit by ' +
      (count - limit).toLocaleString() +
      '. Reduce the canvas size or use fewer color changes. Copy keeps the entire art in one message.';
  }
  function refresh() {
    draw();
    renderOutput();
    updateHistory();
    updateCoordinates();
  }
  function point(event) {
    const rect = canvas.getBoundingClientRect();
    const x = Math.floor(
        ((event.clientX - rect.left) / rect.width) * state.width,
      ),
      y = Math.floor(((event.clientY - rect.top) / rect.height) * state.height);
    return x >= 0 && y >= 0 && x < state.width && y < state.height
      ? [x, y]
      : null;
  }
  function paint(x, y) {
    const c = tool === 'eraser' ? null : color;
    state.pixels[y * state.width + x] = c;
    if ($('mirror').checked)
      state.pixels[y * state.width + state.width - 1 - x] = c;
  }
  function useTool(p) {
    const [x, y] = p;
    if (tool === 'picker') {
      const c = state.pixels[y * state.width + x];
      if (c) setColor(c);
      return;
    }
    if (tool === 'fill') {
      C.flood(state.pixels, state.width, state.height, x, y, color);
      if ($('mirror').checked)
        C.flood(
          state.pixels,
          state.width,
          state.height,
          state.width - 1 - x,
          y,
          color,
        );
    } else paint(x, y);
  }
  function finishStroke() {
    if (!drawing) return;
    drawing = false;
    last = null;
    refresh();
  }
  canvas.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    const p = point(event);
    if (!p) return;
    event.preventDefault();
    canvas.focus({ preventScroll: true });
    keyboardActive = false;
    if (tool !== 'picker') remember();
    useTool(p);
    hover = p;
    if (tool === 'brush' || tool === 'eraser') {
      drawing = true;
      last = p;
      canvas.setPointerCapture(event.pointerId);
    }
    refresh();
  });
  canvas.addEventListener('pointermove', (event) => {
    const p = point(event);
    hover = p;
    keyboardActive = false;
    if (p && drawing) {
      if (last) C.line(...last, ...p, paint);
      else paint(...p);
      last = p;
      renderOutput();
    } else if (!p) last = null;
    draw();
    updateCoordinates();
  });
  canvas.addEventListener('pointerup', finishStroke);
  canvas.addEventListener('pointercancel', finishStroke);
  canvas.addEventListener('lostpointercapture', finishStroke);
  canvas.addEventListener('pointerleave', () => {
    hover = null;
    draw();
    updateCoordinates();
  });
  canvas.addEventListener('keydown', (event) => {
    if (
      ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' '].includes(
        event.key,
      )
    ) {
      event.preventDefault();
      keyboardActive = true;
      if (event.key === 'ArrowLeft') keyboard[0] = Math.max(0, keyboard[0] - 1);
      if (event.key === 'ArrowRight')
        keyboard[0] = Math.min(state.width - 1, keyboard[0] + 1);
      if (event.key === 'ArrowUp') keyboard[1] = Math.max(0, keyboard[1] - 1);
      if (event.key === 'ArrowDown')
        keyboard[1] = Math.min(state.height - 1, keyboard[1] + 1);
      if (event.key === ' ') {
        if (tool !== 'picker') remember();
        useTool(keyboard);
        refresh();
      }
      hover = keyboard;
      draw();
      updateCoordinates();
    }
  });
  canvas.addEventListener('blur', () => {
    keyboardActive = false;
    draw();
  });
  document
    .querySelectorAll('[data-tool]')
    .forEach((button) =>
      button.addEventListener('click', () => setTool(button.dataset.tool)),
    );
  $('color').addEventListener('input', (e) => setColor(e.target.value));
  $('hex').addEventListener('change', (e) => {
    let c = e.target.value.trim();
    if (!c.startsWith('#')) c = '#' + c;
    if (/^#[0-9a-f]{3}$/i.test(c))
      c = '#' + [...c.slice(1)].map((n) => n + n).join('');
    if (C.validHex(c)) setColor(c);
    else {
      $('hex').value = color.toUpperCase();
      toast('Use a hex color like #F68AAF.');
    }
  });
  ['red', 'green', 'blue'].forEach((id) =>
    $(id).addEventListener('change', () => {
      const values = ['red', 'green', 'blue'].map((k) => Number($(k).value));
      if (values.every(Number.isFinite)) setColor(C.hex(values));
    }),
  );
  $('add-color').addEventListener('click', () => {
    if (palette.includes(color))
      return toast('That color is already in your palette.');
    if (palette.length >= 48)
      return toast('Your palette has reached 48 colors.');
    palette.push(color);
    renderPalette();
  });
  $('undo').addEventListener('click', () => history('undo'));
  $('redo').addEventListener('click', () => history('redo'));
  function applySize() {
    const w = Number($('width').value),
      h = Number($('height').value);
    if (
      !Number.isInteger(w) ||
      !Number.isInteger(h) ||
      w < 1 ||
      w > 48 ||
      h < 1 ||
      h > 48
    ) {
      syncSize();
      return toast('Choose whole dimensions from 1 to 48.');
    }
    if (w === state.width && h === state.height) return;
    finishStroke();
    remember();
    if (state.imageSource) {
      const source = state.imageSource;
      const previous = renderOriginal(source, state.width, state.height),
        next = renderOriginal(source, w, h);
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const oldX = Math.min(
            state.width - 1,
            Math.floor((x * state.width) / w),
          );
          const oldY = Math.min(
              state.height - 1,
              Math.floor((y * state.height) / h),
            ),
            i = oldY * state.width + oldX;
          if (state.pixels[i] !== previous[i])
            next[y * w + x] = state.pixels[i];
        }
      restore({ width: w, height: h, pixels: next, imageSource: source });
    } else
      restore({
        width: w,
        height: h,
        pixels: C.resize(state.pixels, state.width, state.height, w, h),
      });
    toast('Canvas resized. You can undo.');
  }
  ['width', 'height'].forEach((id) => {
    $(id).addEventListener('change', applySize);
    $(id).addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        applySize();
      }
    });
  });
  $('clear').addEventListener('click', () => {
    finishStroke();
    remember();
    state.pixels.fill(null);
    delete state.imageSource;
    refresh();
    toast('Canvas cleared. You can undo.');
  });
  $('grid').addEventListener('change', draw);
  $('mirror').addEventListener('change', draw);
  $('limit').addEventListener('change', renderOutput);
  $('color-tolerance').addEventListener('input', renderOutput);
  $('hybrid-colors').addEventListener('change', renderOutput);
  $('indexed-tolerance').addEventListener('input', renderOutput);
  $('auto-optimize').addEventListener('click', async () => {
    finishStroke();
    const source = snapshot(),
      before = JSON.stringify(source),
      limit = Number($('limit').value);
    const button = $('auto-optimize'),
      status = $('optimize-status');
    button.disabled = true;
    button.textContent = 'Optimizing…';
    status.hidden = false;
    status.textContent = 'Finding a smaller message…';
    try {
      const best = await C.autoOptimize(
        source.pixels,
        source.width,
        source.height,
        limit,
        () => new Promise((resolve) => setTimeout(resolve, 0)),
      );
      if (
        JSON.stringify(state) !== before ||
        Number($('limit').value) !== limit
      ) {
        status.textContent =
          'Canvas or limit changed. Click Auto optimize again.';
        return;
      }
      $('color-tolerance').value = best.options.tolerance;
      $('hybrid-colors').checked = best.options.hybrid;
      $('indexed-tolerance').value = best.options.indexedTolerance;
      renderOutput();
      status.textContent = best.fits
        ? best.error === 0
          ? 'Fits with exact colors.'
          : 'Fits with similar colors merged. Check the preview.'
        : 'Best result still exceeds the limit. Try a smaller canvas.';
    } catch {
      status.textContent = 'Could not optimize this image. Try again.';
    } finally {
      button.disabled = false;
      button.textContent = 'Auto optimize';
    }
  });
  async function copy(text) {
    try {
      if (navigator.clipboard?.writeText)
        await navigator.clipboard.writeText(text);
      else throw new Error();
      return true;
    } catch {
      const field = document.createElement('textarea');
      field.value = text;
      field.style.position = 'fixed';
      field.style.left = '-10000px';
      document.body.appendChild(field);
      field.select();
      const success = document.execCommand('copy');
      field.remove();
      if (!success)
        toast('Clipboard unavailable. Allow clipboard access and try again.');
      return success;
    }
  }
  $('copy').addEventListener('click', async () => {
    if (await copy(exported.full)) toast('ANSI copied.');
  });
  $('import-ansi').addEventListener('click', () => {
    try {
      const next = C.importAnsi($('ansi-import').value);
      finishStroke();
      remember();
      restore(next);
      $('import-error').hidden = true;
      $('ansi-import').value = '';
      $('import-panel').open = false;
      toast('ANSI imported. You can undo.');
    } catch (error) {
      $('import-error').textContent = error.message;
      $('import-error').hidden = false;
    }
  });
  function download(data, name, type) {
    const url = URL.createObjectURL(new Blob([data], { type }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const imageDialog = $('image-import-dialog');
  const importStatus = (text) => {
    const target = imageDialog.open
      ? $('image-import-status')
      : $('direct-import-status');
    target.textContent = text;
    target.hidden = !text;
  };
  let importingImage = false,
    stagedImage = null,
    placement = null,
    placementMode = 'fit',
    placementAnchor = null;
  const placementCanvas = $('placement-preview');
  function syncPlacement() {
    for (const key of ['cw', 'ch', 'w', 'h', 'x', 'y'])
      $('place-' + key).value = placement[key];
    drawPlacement();
  }
  function renderOriginal(source, width, height) {
    let p;
    if (source.mode === 'fit' || source.mode === 'fill') {
      const scale = (source.mode === 'fill' ? Math.max : Math.min)(
        width / source.image.width,
        height / source.image.height,
      );
      const w = Math.max(
        1,
        Math.min(192, Math.round(source.image.width * scale)),
      );
      const h = Math.max(
        1,
        Math.min(192, Math.round(source.image.height * scale)),
      );
      p = {
        w,
        h,
        x: Math.floor((width - w) / 2),
        y: Math.floor((height - h) / 2),
      };
    } else
      p = C.rescalePlacement(source.placement, width, height, source.locked);
    if (!source.raster) {
      const original = document.createElement('canvas');
      original.width = source.image.naturalWidth;
      original.height = source.image.naturalHeight;
      const c = original.getContext('2d');
      c.drawImage(source.image, 0, 0);
      source.raster = c.getImageData(0, 0, original.width, original.height);
    }
    return C.sampleImage(source.raster, width, height, p);
  }

  function placementBitmap() {
    const out = document.createElement('canvas');
    out.width = placement.cw;
    out.height = placement.ch;
    const c = out.getContext('2d');
    c.imageSmoothingEnabled = false;
    c.drawImage(
      stagedImage,
      placement.x,
      placement.y,
      placement.w,
      placement.h,
    );
    return out;
  }
  function drawPlacement() {
    if (!stagedImage) return;
    const size = 8;
    placementCanvas.width = placement.cw * size;
    placementCanvas.height = placement.ch * size;
    placementCanvas.style.width =
      Math.min(320, (260 * placement.cw) / placement.ch) + 'px';
    const c = placementCanvas.getContext('2d');
    for (let y = 0; y < placement.ch; y++)
      for (let x = 0; x < placement.cw; x++) {
        c.fillStyle = (x + y) % 2 ? '#303b32' : '#202820';
        c.fillRect(x * size, y * size, size, size);
      }
    c.imageSmoothingEnabled = false;
    c.drawImage(
      placementBitmap(),
      0,
      0,
      placementCanvas.width,
      placementCanvas.height,
    );
  }
  function fitPlacement(fill = false) {
    placementMode = fill ? 'fill' : 'fit';
    placementAnchor = null;
    const ratio = (fill ? Math.max : Math.min)(
      placement.cw / stagedImage.width,
      placement.ch / stagedImage.height,
    );
    placement.w = Math.max(
      1,
      Math.min(192, Math.round(stagedImage.width * ratio)),
    );
    placement.h = Math.max(
      1,
      Math.min(192, Math.round(stagedImage.height * ratio)),
    );
    centerPlacement();
  }
  function centerPlacement() {
    placement.x = Math.floor((placement.cw - placement.w) / 2);
    placement.y = Math.floor((placement.ch - placement.h) / 2);
    syncPlacement();
  }
  let resolutionAnchor = null;
  for (const key of ['cw', 'ch', 'w', 'h', 'x', 'y']) {
    const input = $('place-' + key),
      isResolution = key === 'cw' || key === 'ch';
    input.addEventListener('focus', () => {
      if (isResolution)
        resolutionAnchor = { cw: placement.cw, ch: placement.ch };
    });
    function updatePlacement(commit = false) {
      if (!placement) return;
      const value = Number(input.value);
      if (
        input.value === '' ||
        !Number.isInteger(value) ||
        value < Number(input.min) ||
        value > Number(input.max)
      ) {
        if (commit) syncPlacement();
        return;
      }
      if (isResolution) {
        const anchor = resolutionAnchor || placement;
        const size = C.importResolution(
          anchor.cw,
          anchor.ch,
          key,
          value,
          $('place-resolution-link').checked,
        );
        Object.assign(placement, size);
        if (placementMode !== 'custom') fitPlacement(placementMode === 'fill');
        else {
          placement = C.rescalePlacement(
            placementAnchor,
            size.cw,
            size.ch,
            $('place-lock').checked,
          );
          syncPlacement();
        }
      } else {
        placement[key] = value;
        if ($('place-lock').checked && (key === 'w' || key === 'h')) {
          const other = key === 'w' ? 'h' : 'w',
            ratio =
              key === 'w'
                ? stagedImage.height / stagedImage.width
                : stagedImage.width / stagedImage.height;
          placement[other] = Math.max(
            1,
            Math.min(192, Math.round(value * ratio)),
          );
        }
        rememberPlacement();
        syncPlacement();
      }
    }
    input.addEventListener('input', () => updatePlacement());
    input.addEventListener('change', () => updatePlacement(true));
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        updatePlacement(true);
        input.blur();
      }
    });
  }
  function rememberPlacement() {
    placementMode = 'custom';
    placementAnchor = { ...placement };
  }
  $('place-fit').addEventListener('click', () => fitPlacement());
  $('place-fill').addEventListener('click', () => fitPlacement(true));
  $('place-center').addEventListener('click', () => {
    centerPlacement();
    if (placementMode === 'custom') rememberPlacement();
  });
  $('place-replace').addEventListener('click', () => $('image-file').click());
  let placementDrag = null;
  placementCanvas.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || !placement) return;
    event.preventDefault();
    placementCanvas.focus();
    const rect = placementCanvas.getBoundingClientRect();
    placementDrag = {
      clientX: event.clientX,
      clientY: event.clientY,
      x: placement.x,
      y: placement.y,
      sx: placement.cw / rect.width,
      sy: placement.ch / rect.height,
    };
    placementCanvas.setPointerCapture(event.pointerId);
  });
  placementCanvas.addEventListener('pointermove', (event) => {
    if (!placementDrag) return;
    placement.x = Math.max(
      -192,
      Math.min(
        192,
        placementDrag.x +
          Math.round(
            (event.clientX - placementDrag.clientX) * placementDrag.sx,
          ),
      ),
    );
    placement.y = Math.max(
      -192,
      Math.min(
        192,
        placementDrag.y +
          Math.round(
            (event.clientY - placementDrag.clientY) * placementDrag.sy,
          ),
      ),
    );
    rememberPlacement();
    syncPlacement();
  });
  for (const event of ['pointerup', 'pointercancel', 'lostpointercapture'])
    placementCanvas.addEventListener(event, () => {
      placementDrag = null;
    });
  placementCanvas.addEventListener('keydown', (event) => {
    const delta = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    }[event.key];
    if (!delta) return;
    event.preventDefault();
    placement.x = Math.max(-192, Math.min(192, placement.x + delta[0]));
    placement.y = Math.max(-192, Math.min(192, placement.y + delta[1]));
    rememberPlacement();
    syncPlacement();
  });
  $('place-apply').addEventListener('click', () => {
    if (!stagedImage || importingImage) return;
    const imageSource = {
      image: stagedImage,
      placement: { ...placement },
      mode: placementMode,
      locked: $('place-lock').checked,
    };
    const pixels = renderOriginal(imageSource, placement.cw, placement.ch);
    finishStroke();
    remember();
    restore({ width: placement.cw, height: placement.ch, pixels, imageSource });
    imageDialog.close();
    toast('Image placed. You can undo.');
  });
  async function importImage(file) {
    if (!file || importingImage) return;
    const remote = typeof file === 'string';
    if (!remote && file.type && !file.type.startsWith('image/'))
      return importStatus('Choose an image file.');
    if (!remote && file.size > 20000000)
      return importStatus('Choose an image smaller than 20 MB.');
    importingImage = true;
    $('place-apply').disabled = true;
    $('place-replace').disabled = true;
    $('image-drop-zone').disabled = true;
    $('close-image-import').disabled = true;
    importStatus('Importing image…');
    let url, timeout;
    try {
      if (remote) {
        importStatus('Loading image from the web…');
        const controller = new AbortController();
        timeout = setTimeout(() => controller.abort(), 15000);
        const response = await fetch(file, {
          mode: 'cors',
          credentials: 'omit',
          signal: controller.signal,
          referrerPolicy: 'no-referrer',
        });
        if (!response.ok) throw new Error('Image request failed.');
        if (Number(response.headers.get('content-length')) > 20000000)
          throw new Error('too-large');
        const chunks = [];
        let size = 0;
        const reader = response.body.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > 20000000) {
            await reader.cancel();
            throw new Error('too-large');
          }
          chunks.push(value);
        }
        file = new Blob(chunks, {
          type: response.headers.get('content-type') || '',
        });
        clearTimeout(timeout);
      }
      url = URL.createObjectURL(file);
      const image = new Image();
      image.src = url;
      await image.decode();
      stagedImage = image;
      placement = { cw: state.width, ch: state.height, w: 1, h: 1, x: 0, y: 0 };
      $('image-setup').hidden = false;
      $('image-drop-zone').hidden = true;
      $('place-lock').checked = true;
      $('place-resolution-link').checked = true;
      resolutionAnchor = null;
      fitPlacement();
      importStatus('');
      if (!imageDialog.open) imageDialog.showModal();
    } catch (error) {
      importStatus(
        error.message === 'too-large'
          ? 'Choose an image smaller than 20 MB.'
          : remote
            ? 'This website did not provide an accessible image. Right-click the image in Google, save it to your device, then drop the saved file here or click to choose it.'
            : 'Could not read that image. Try a PNG, JPEG, GIF or WebP.',
      );
    } finally {
      clearTimeout(timeout);
      if (url) URL.revokeObjectURL(url);
      importingImage = false;
      $('place-apply').disabled = false;
      $('place-replace').disabled = false;
      $('image-drop-zone').disabled = false;
      $('close-image-import').disabled = false;
    }
  }
  $('import-image').addEventListener('click', () => {
    importStatus('');
    imageDialog.showModal();
  });
  $('close-image-import').addEventListener('click', () => imageDialog.close());
  imageDialog.addEventListener('cancel', (event) => {
    if (importingImage) event.preventDefault();
  });
  imageDialog.addEventListener('close', () => {
    clearDrop();
    $('image-file').value = '';
    stagedImage = null;
    placement = null;
    placementDrag = null;
    $('image-setup').hidden = true;
    $('image-drop-zone').hidden = false;
  });
  $('image-drop-zone').addEventListener('click', () => $('image-file').click());
  $('image-file').addEventListener('change', (event) => {
    const file = event.target.files[0];
    event.target.value = '';
    void importImage(file);
  });
  const dropZones = [imageDialog, $('canvas-drop-zone')],
    dragDepth = new Map();
  const hasImageDrag = (event) =>
    Array.from(event.dataTransfer?.types || []).some((type) =>
      ['Files', 'text/html', 'text/uri-list', 'text/plain'].includes(type),
    );
  const clearDrop = () => {
    dragDepth.clear();
    dropZones.forEach((zone) => zone.classList.remove('drag-over'));
  };
  for (const dropZone of dropZones) {
    dropZone.addEventListener('dragenter', (event) => {
      if (!hasImageDrag(event)) return;
      event.preventDefault();
      dragDepth.set(dropZone, (dragDepth.get(dropZone) || 0) + 1);
      dropZone.classList.add('drag-over');
    });
    dropZone.addEventListener('dragover', (event) => {
      if (!hasImageDrag(event)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
    });
    dropZone.addEventListener('dragleave', () => {
      const depth = Math.max(0, (dragDepth.get(dropZone) || 0) - 1);
      dragDepth.set(dropZone, depth);
      if (!depth) dropZone.classList.remove('drag-over');
    });
    dropZone.addEventListener('drop', handleImageDrop);
  }
  function handleImageDrop(event) {
    if (!hasImageDrag(event)) return;
    event.preventDefault();
    clearDrop();
    const files = Array.from(event.dataTransfer.files);
    if (files.length > 1) return importStatus('Drop one image at a time.');
    if (files.length === 1) {
      void importImage(files[0]);
      return;
    }
    const html = event.dataTransfer.getData('text/html');
    const image = html
      ? new DOMParser().parseFromString(html, 'text/html').querySelector('img')
      : null;
    const candidates = [
      image?.getAttribute('src'),
      image?.getAttribute('data-src'),
      ...event.dataTransfer
        .getData('text/uri-list')
        .split(/\r?\n/)
        .filter((line) => !line.startsWith('#')),
      event.dataTransfer.getData('text/plain'),
    ];
    const source = candidates.map(C.imageSource).find(Boolean);
    if (!source)
      return importStatus(
        'Drop an image or a direct image link, or click to choose a saved file.',
      );
    void importImage(source);
  }
  document.addEventListener('dragover', (event) => {
    if (!hasImageDrag(event)) return;
    event.preventDefault();
    if (!dropZones.some((zone) => zone.contains(event.target)))
      event.dataTransfer.dropEffect = 'none';
  });
  document.addEventListener('drop', (event) => {
    if (hasImageDrag(event)) event.preventDefault();
    clearDrop();
  });
  document.addEventListener('dragend', clearDrop);
  window.addEventListener('blur', clearDrop);
  $('export-png').addEventListener('click', () => {
    const out = document.createElement('canvas');
    out.width = state.width * 16;
    out.height = state.height * 16;
    const c = out.getContext('2d');
    state.pixels.forEach((color, i) => {
      if (color) {
        c.fillStyle = color;
        c.fillRect(
          (i % state.width) * 16,
          Math.floor(i / state.width) * 16,
          16,
          16,
        );
      }
    });
    out.toBlob((blob) => {
      if (blob) download(blob, 'ansei-art.png', 'image/png');
    });
  });
  function sample(name, record = true) {
    if (record) {
      finishStroke();
      remember();
    }
    state = { width: 16, height: 16, pixels: Array(256).fill(null) };
    if (name === 'mushroom') {
      const rows = [
          '................',
          '................',
          '......rrrr......',
          '....rrpppprr....',
          '...rppwwppppr...',
          '..rpppwwppwwpr..',
          '..rpppppppwwpr..',
          '.rppwwppppppppr.',
          '.rppwwppwwppppr.',
          '.rrrrrrrrrrrrrr.',
          '....sccccccs....',
          '.....scbccs.....',
          '.....sccccs.....',
          '....ssccccss....',
          '...gggggggggg...',
          '..gg.gggggg.gg..',
        ],
        colors = {
          r: '#a34662',
          p: '#f68aaf',
          w: '#ffead2',
          s: '#c7ab7b',
          c: '#ffe5af',
          b: '#b18f69',
          g: '#92d979',
        };
      rows.forEach((row, y) =>
        [...row].forEach((key, x) => {
          state.pixels[y * 16 + x] = colors[key] || null;
        }),
      );
    }
    if (name === 'heart') {
      for (let y = 2; y < 14; y++)
        for (let x = 1; x < 15; x++) {
          const nx = (x - 7.5) / 6,
            ny = (7 - y) / 6;
          const a = nx * nx + ny * ny - 1;
          if (a * a * a - nx * nx * ny * ny * ny <= 0)
            state.pixels[y * 16 + x] =
              y < 6 ? '#ffadbd' : y < 10 ? '#f36a91' : '#bf456d';
        }
    }
    if (name === 'sunset') {
      for (let y = 0; y < 16; y++)
        for (let x = 0; x < 16; x++) {
          let c =
            y < 5
              ? '#293e62'
              : y < 8
                ? '#78517e'
                : y < 11
                  ? '#d0738e'
                  : '#eea178';
          if ((x - 7.5) ** 2 + (y - 7) ** 2 < 18) c = '#ffd78b';
          if (y >= 11) c = (x + y) % 4 === 0 ? '#7bb6bd' : '#36586d';
          if (y > 12 && x > 4 && x < 11 && y % 2 === 1) c = '#edb78b';
          state.pixels[y * 16 + x] = c;
        }
    }
    hover = null;
    keyboard = [0, 0];
    syncSize();
    refresh();
  }
  ['mushroom', 'heart', 'sunset'].forEach((name) =>
    $('sample-' + name).addEventListener('click', () => sample(name)),
  );
  document.addEventListener('keydown', (event) => {
    if (imageDialog.open) return;
    if (/INPUT|TEXTAREA|SELECT/.test(event.target.tagName)) return;
    const key = event.key.toLowerCase();
    if ((event.ctrlKey || event.metaKey) && key === 'z') {
      event.preventDefault();
      history(event.shiftKey ? 'redo' : 'undo');
    } else if ((event.ctrlKey || event.metaKey) && key === 'y') {
      event.preventDefault();
      history('redo');
    } else if (
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey &&
      { b: 'brush', e: 'eraser', f: 'fill', i: 'picker' }[key]
    )
      setTool({ b: 'brush', e: 'eraser', f: 'fill', i: 'picker' }[key]);
  });
  setColor(color);
  syncSize();
  refresh();
})();
