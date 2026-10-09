const AnseiCore = (() => {
  const ESC = '\x1b',
    RESET = ESC + '[0m';
  const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const hex = (values) =>
    '#' +
    values
      .map((n) =>
        Math.max(0, Math.min(255, Math.round(n)))
          .toString(16)
          .padStart(2, '0'),
      )
      .join('');
  const validHex = (value) => /^#[0-9a-f]{6}$/i.test(value);
  const fence = (text) => '```ansi\n' + text + '\n```';
  const rgbCode = (color, foreground) =>
    color
      ? (foreground ? '38' : '48') + ';2;' + rgb(color).join(';')
      : foreground
        ? '39'
        : '49';
  const indexedPalette = [];
  const levels = [0, 95, 135, 175, 215, 255];
  for (let r = 0; r < 6; r++)
    for (let g = 0; g < 6; g++)
      for (let b = 0; b < 6; b++)
        indexedPalette.push({
          index: 16 + 36 * r + 6 * g + b,
          values: [levels[r], levels[g], levels[b]],
          color: hex([levels[r], levels[g], levels[b]]),
        });
  for (let i = 0; i < 24; i++)
    indexedPalette.push({
      index: 232 + i,
      values: [8 + 10 * i, 8 + 10 * i, 8 + 10 * i],
      color: hex([8 + 10 * i, 8 + 10 * i, 8 + 10 * i]),
    });
  function indexedMatch(color, tolerance) {
    const values = rgb(color);
    let best = null,
      distance = Infinity;
    for (const entry of indexedPalette) {
      const delta = values.map((v, i) => Math.abs(v - entry.values[i]));
      const d = delta.reduce((sum, v) => sum + v * v, 0);
      if (Math.max(...delta) <= tolerance && d < distance) {
        best = entry;
        distance = d;
      }
    }
    return best;
  }
  function baseline(pixels, width, height, encode = rgbCode) {
    let fg = null,
      bg = null;
    const lines = [];
    const set = (channel, color) => {
      const current = channel === 'fg' ? fg : bg;
      if (current === color) return '';
      if (channel === 'fg') fg = color;
      else bg = color;
      return ESC + '[' + encode(color, channel === 'fg') + 'm';
    };
    for (let y = 0; y < height; y += 2) {
      let line = '';
      for (let x = 0; x < width; x++) {
        const top = pixels[y * width + x]?.toLowerCase() || null;
        const bottom =
          y + 1 < height
            ? pixels[(y + 1) * width + x]?.toLowerCase() || null
            : null;
        if (top === bottom) line += set('bg', top) + ' ';
        else if (top === null)
          line += set('fg', bottom) + set('bg', null) + '▄';
        else line += set('fg', top) + set('bg', bottom) + '▀';
      }
      lines.push(line);
    }
    for (let i = 0; i < lines.length; i++)
      lines[i] = lines[i].replace(
        /\x1b\[([\d;]+)m\x1b\[([\d;]+)m/g,
        ESC + '[$1;$2m',
      );
    const raw = lines.join('\n') + RESET;
    return { lines, raw, full: fence(raw) };
  }
  function quantize(pixels, tolerance = 0) {
    tolerance = Math.max(0, Math.min(64, Number(tolerance) || 0));
    const normalized = pixels.map((color) => color?.toLowerCase() || null);
    if (!tolerance) return normalized;
    const counts = new Map();
    for (const color of normalized)
      if (color) counts.set(color, (counts.get(color) || 0) + 1);
    const palette = [],
      mapping = new Map();
    for (const [color] of [...counts].sort((a, b) => b[1] - a[1])) {
      const values = rgb(color);
      let best = null,
        distance = Infinity;
      for (const entry of palette) {
        const delta = values.map((v, i) => Math.abs(v - entry.values[i]));
        const d = delta.reduce((sum, v) => sum + v * v, 0);
        if (Math.max(...delta) <= tolerance && d < distance) {
          best = entry.color;
          distance = d;
        }
      }
      if (best === null) {
        best = color;
        palette.push({ color, values });
      }
      mapping.set(color, best);
    }
    return normalized.map((color) => (color ? mapping.get(color) : null));
  }
  function generate(
    pixels,
    width,
    height,
    { tolerance = 0, hybrid = false, indexedTolerance = 8 } = {},
  ) {
    let colors = quantize(pixels, tolerance);
    const indices = new Map(),
      mapping = new Map();
    indexedTolerance = Math.max(0, Math.min(32, Number(indexedTolerance) || 0));
    if (hybrid) {
      for (const color of new Set(colors)) {
        if (!color) continue;
        const match = indexedMatch(color, indexedTolerance);
        if (
          match &&
          ('38;5;' + match.index).length < rgbCode(color, true).length
        ) {
          mapping.set(color, match.color);
          indices.set(match.color, match.index);
        }
      }
      colors = colors.map((color) => mapping.get(color) || color);
    }
    let fg = null,
      bg = null;
    const lines = [];
    const code = (color, foreground) =>
      indices.has(color)
        ? (foreground ? '38' : '48') + ';5;' + indices.get(color)
        : rgbCode(color, foreground);
    for (let y = 0; y < height; y += 2) {
      let line = '';
      for (let x = 0; x < width; x++) {
        const top = colors[y * width + x],
          bottom = y + 1 < height ? colors[(y + 1) * width + x] : null;
        let candidates;
        if (top === bottom)
          candidates =
            top === null
              ? [{ text: ' ', fg, bg: null }]
              : [
                  { text: ' ', fg, bg: top },
                  { text: '█', fg: top, bg },
                ];
        else if (top === null)
          candidates = [{ text: '▄', fg: bottom, bg: null }];
        else if (bottom === null)
          candidates = [{ text: '▀', fg: top, bg: null }];
        else
          candidates = [
            { text: '▀', fg: top, bg: bottom },
            { text: '▄', fg: bottom, bg: top },
          ];
        let best;
        for (const candidate of candidates) {
          const updates = [];
          if (candidate.fg !== fg) updates.push(code(candidate.fg, true));
          if (candidate.bg !== bg) updates.push(code(candidate.bg, false));
          const output =
            (updates.length ? ESC + '[' + updates.join(';') + 'm' : '') +
            candidate.text;
          if (!best || output.length < best.output.length)
            best = { ...candidate, output };
        }
        fg = best.fg;
        bg = best.bg;
        line += best.output;
      }
      lines.push(line);
    }
    const raw = lines.join('\n') + RESET;
    const optimized = { lines, raw, full: fence(raw) };
    const previous = baseline(colors, width, height, code);
    return optimized.full.length <= previous.full.length ? optimized : previous;
  }
  async function autoOptimize(
    pixels,
    width,
    height,
    limit = 2000,
    pause = () => Promise.resolve(),
  ) {
    let best = null;
    const original = pixels.map((color) => (color ? rgb(color) : null));
    for (const tolerance of [0, 4, 8, 12, 16, 24, 32, 48, 64]) {
      for (const hybrid of [false, true]) {
        const options = {
          tolerance,
          hybrid,
          indexedTolerance: hybrid ? Math.min(16, tolerance) : 0,
        };
        const result = generate(pixels, width, height, options);
        const decoded = importAnsi(result.full).pixels;
        let error = 0;
        original.forEach((color, i) => {
          if (color) {
            const actual = rgb(decoded[i]);
            error += color.reduce((sum, v, c) => sum + (v - actual[c]) ** 2, 0);
          }
        });
        const candidate = {
          options,
          length: result.full.length,
          error,
          fits: result.full.length <= limit,
        };
        if (
          !best ||
          (candidate.fits && !best.fits) ||
          (candidate.fits === best.fits &&
            (candidate.fits
              ? candidate.error < best.error ||
                (candidate.error === best.error &&
                  candidate.length < best.length)
              : candidate.length < best.length ||
                (candidate.length === best.length &&
                  candidate.error < best.error)))
        )
          best = candidate;
        await pause();
      }
      if (best.fits && best.error === 0) break;
    }
    return best;
  }
  function importAnsi(input) {
    if (typeof input !== 'string' || !input.trim())
      throw new Error('Paste ANSI art first.');
    if (input.length > 200000) throw new Error('ANSI text is too large.');
    let text = input.replace(/\r\n?/g, '\n');
    if (text.trimStart().startsWith('```')) {
      const match = text.match(/^\s*```(?:ansi)?\n([\s\S]*?)\n```\s*$/i);
      if (!match) throw new Error('Paste one complete ANSI code block.');
      text = match[1];
    }
    text = text.replace(/\\u001b|\\x1b|␛|ESC(?=\[)/gi, ESC);
    const palette = [
      '#000000',
      '#800000',
      '#008000',
      '#808000',
      '#000080',
      '#800080',
      '#008080',
      '#c0c0c0',
      '#808080',
      '#ff0000',
      '#00ff00',
      '#ffff00',
      '#0000ff',
      '#ff00ff',
      '#00ffff',
      '#ffffff',
    ];
    const levels = [0, 95, 135, 175, 215, 255];
    for (const r of levels)
      for (const g of levels)
        for (const b of levels) palette.push(hex([r, g, b]));
    for (let i = 0; i < 24; i++)
      palette.push(hex([8 + 10 * i, 8 + 10 * i, 8 + 10 * i]));
    let fg = null,
      bg = null,
      rows = [[]];
    for (let pos = 0; pos < text.length; ) {
      if (text[pos] === ESC) {
        const match = text.slice(pos).match(/^\x1b\[([\d;]*)m/);
        if (!match)
          throw new Error(
            'Only ANSI color sequences and block art are supported.',
          );
        const codes = match[1].split(';').map(Number);
        for (let i = 0; i < codes.length; i++) {
          const code = codes[i];
          if (code === 0) {
            fg = null;
            bg = null;
          } else if (code === 39) fg = null;
          else if (code === 49) bg = null;
          else if ((code >= 30 && code <= 37) || (code >= 90 && code <= 97))
            fg = palette[code >= 90 ? code - 90 + 8 : code - 30];
          else if ((code >= 40 && code <= 47) || (code >= 100 && code <= 107))
            bg = palette[code >= 100 ? code - 100 + 8 : code - 40];
          else if (code === 38 || code === 48) {
            let color;
            if (codes[i + 1] === 2) {
              const values = codes.slice(i + 2, i + 5);
              if (values.length !== 3 || values.some((v) => v < 0 || v > 255))
                throw new Error('Invalid RGB color.');
              color = hex(values);
              i += 4;
            } else if (
              codes[i + 1] === 5 &&
              codes[i + 2] >= 0 &&
              codes[i + 2] <= 255
            ) {
              color = palette[codes[i + 2]];
              i += 2;
            } else throw new Error('Invalid ANSI color sequence.');
            if (code === 38) fg = color;
            else bg = color;
          } else
            throw new Error(
              'Text styles are not supported. Paste ANSI pixel art with color codes only.',
            );
        }
        pos += match[0].length;
        continue;
      }
      const char = text[pos++];
      if (char === '\n') {
        rows.push([]);
        if (rows.length > 25)
          throw new Error('Imported art must fit within 48 × 48 pixels.');
        continue;
      }
      if (![' ', '▀', '▄', '█'].includes(char))
        throw new Error('Use ANSI block art (▀, ▄, █ and spaces).');
      rows
        .at(-1)
        .push(
          char === '▀'
            ? [fg, bg]
            : char === '▄'
              ? [bg, fg]
              : char === '█'
                ? [fg, fg]
                : [bg, bg],
        );
      if (rows.at(-1).length > 48)
        throw new Error('Imported art must fit within 48 × 48 pixels.');
    }
    if (rows.length > 1 && !rows.at(-1).length) rows.pop();
    const width = Math.max(...rows.map((row) => row.length)),
      height = rows.length * 2;
    if (!width) throw new Error('No block art found.');
    if (height > 48)
      throw new Error('Imported art must fit within 48 × 48 pixels.');
    const pixels = Array(width * height).fill(null);
    rows.forEach((row, y) =>
      row.forEach(([top, bottom], x) => {
        pixels[y * 2 * width + x] = top;
        pixels[(y * 2 + 1) * width + x] = bottom;
      }),
    );
    return { width, height, pixels };
  }
  function flood(pixels, width, height, x, y, color) {
    const old = pixels[y * width + x];
    if (old === color) return;
    const stack = [[x, y]];
    while (stack.length) {
      const [cx, cy] = stack.pop();
      if (
        cx < 0 ||
        cy < 0 ||
        cx >= width ||
        cy >= height ||
        pixels[cy * width + cx] !== old
      )
        continue;
      pixels[cy * width + cx] = color;
      stack.push([cx - 1, cy], [cx + 1, cy], [cx, cy - 1], [cx, cy + 1]);
    }
  }
  function line(x0, y0, x1, y1, paint) {
    const dx = Math.abs(x1 - x0),
      sx = x0 < x1 ? 1 : -1,
      dy = -Math.abs(y1 - y0),
      sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    while (true) {
      paint(x0, y0);
      if (x0 === x1 && y0 === y1) break;
      const e = 2 * err;
      if (e >= dy) {
        err += dy;
        x0 += sx;
      }
      if (e <= dx) {
        err += dx;
        y0 += sy;
      }
    }
  }
  function resize(pixels, w, h, nw, nh) {
    const next = Array(nw * nh).fill(null);
    for (let y = 0; y < Math.min(h, nh); y++)
      for (let x = 0; x < Math.min(w, nw); x++)
        next[y * nw + x] = pixels[y * w + x];
    return next;
  }
  function sampleImage(source, width, height, placement) {
    const pixels = Array(width * height).fill(null);
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const sx = Math.floor(
          ((x + 0.5 - placement.x) * source.width) / placement.w,
        );
        const sy = Math.floor(
          ((y + 0.5 - placement.y) * source.height) / placement.h,
        );
        if (sx < 0 || sy < 0 || sx >= source.width || sy >= source.height)
          continue;
        const i = (sy * source.width + sx) * 4;
        if (source.data[i + 3] >= 128)
          pixels[y * width + x] = hex([
            source.data[i],
            source.data[i + 1],
            source.data[i + 2],
          ]);
      }
    return pixels;
  }
  function importResolution(width, height, axis, value, linked = true) {
    let cw = axis === 'cw' ? value : width,
      ch = axis === 'ch' ? value : height;
    if (linked) {
      const ratio = value / (axis === 'cw' ? width : height);
      cw = width * ratio;
      ch = height * ratio;
      const limit = Math.min(1, 48 / cw, 48 / ch);
      cw *= limit;
      ch *= limit;
    }
    return {
      cw: Math.max(1, Math.min(48, Math.round(cw))),
      ch: Math.max(1, Math.min(48, Math.round(ch))),
    };
  }
  function rescalePlacement(source, cw, ch, locked = true) {
    const sx = cw / source.cw,
      sy = ch / source.ch;
    const scale = locked ? Math.min(sx, sy) : null;
    return {
      cw,
      ch,
      w: Math.max(1, Math.min(192, Math.round(source.w * (scale ?? sx)))),
      h: Math.max(1, Math.min(192, Math.round(source.h * (scale ?? sy)))),
      x: Math.max(-192, Math.min(192, Math.round(source.x * sx))),
      y: Math.max(-192, Math.min(192, Math.round(source.y * sy))),
    };
  }
  function imageSource(value) {
    if (typeof value !== 'string') return null;
    value = value.trim();
    if (/^data:image\/(?:png|jpe?g|gif|webp|avif|bmp);base64,/i.test(value))
      return value;
    try {
      const url = new URL(value);
      if (
        !['http:', 'https:'].includes(url.protocol) ||
        url.username ||
        url.password
      )
        return null;
      const original = url.searchParams.get('imgurl');
      if (original) {
        const image = new URL(original);
        return ['http:', 'https:'].includes(image.protocol) &&
          !image.username &&
          !image.password
          ? image.href
          : null;
      }
      return url.href;
    } catch {
      return null;
    }
  }
  return {
    importResolution,
    sampleImage,
    rescalePlacement,
    autoOptimize,
    quantize,
    imageSource,
    ESC,
    RESET,
    rgb,
    hex,
    validHex,
    fence,
    generate,
    importAnsi,
    flood,
    line,
    resize,
  };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = AnseiCore;
