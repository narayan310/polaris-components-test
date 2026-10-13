// Serialises every variant on the capture sheet into a JSON tree the Figma plugin rebuilds as native
// components: boxes, flex layout (-> auto layout), borders, radii, shadows, text and SVG icons.
// It walks the *rendered* (flat) tree: open shadow roots, slots resolved to their assigned nodes,
// display:contents elements replaced by their children.
(function () {
  'use strict';

  var canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  var ctx = canvas.getContext('2d', { willReadFrequently: true });

  // Any computed CSS color -> {r,g,b,a} in 0..1, or null when transparent/unparseable.
  function rgba(value) {
    if (!value || value === 'transparent' || value === 'none') return null;
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = 'rgba(0,0,0,0)';
    ctx.fillStyle = value;
    ctx.fillRect(0, 0, 1, 1);
    var d = ctx.getImageData(0, 0, 1, 1).data;
    if (d[3] === 0) return null;
    return { r: d[0] / 255, g: d[1] / 255, b: d[2] / 255, a: Math.round((d[3] / 255) * 1000) / 1000 };
  }

  function px(v) { var n = parseFloat(v); return isNaN(n) ? 0 : n; }
  function round(n) { return Math.round(n * 100) / 100; }

  // Split a CSS list on top-level commas (not inside parentheses).
  function splitTop(value) {
    var out = [], depth = 0, cur = '';
    for (var i = 0; i < value.length; i++) {
      var ch = value[i];
      if (ch === '(') depth++;
      if (ch === ')') depth--;
      if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; } else cur += ch;
    }
    if (cur.trim()) out.push(cur.trim());
    return out;
  }

  function shadows(value) {
    if (!value || value === 'none') return [];
    return splitTop(value).map(function (s) {
      var m = s.match(/^((?:[a-z-]+\([^)]*\))|#[0-9a-f]+|[a-z]+)\s+(.*)$/i);
      if (!m) return null;
      var color = rgba(m[1]);
      var nums = m[2].replace('inset', '').trim().split(/\s+/).map(px);
      if (!color) return null;
      return { inset: /inset/.test(m[2]), color: color, x: nums[0] || 0, y: nums[1] || 0, blur: nums[2] || 0, spread: nums[3] || 0 };
    }).filter(Boolean);
  }

  function visible(cs) {
    return cs.display !== 'none' && cs.visibility !== 'hidden' && parseFloat(cs.opacity) > 0;
  }

  var SKIP = { STYLE: 1, SCRIPT: 1, TEMPLATE: 1, LINK: 1, META: 1 };

  // Rendered children of an element, each with the element its styles inherit from.
  function renderedChildren(el) {
    var out = [];
    function expand(nodes, styleEl) {
      for (var i = 0; i < nodes.length; i++) {
        var n = nodes[i];
        if (n.nodeType === 3) {
          if (n.textContent.trim()) out.push({ node: n, styleEl: styleEl });
        } else if (n.nodeType === 1 && !SKIP[n.tagName]) {
          if (n.tagName === 'SLOT') {
            var assigned = n.assignedNodes({ flatten: true });
            expand(assigned.length ? assigned : n.childNodes, n);
          } else if (n.hasAttribute('data-figma-instance')) {
            // Library component markers stay as one node even when they have no box of their own.
            out.push({ node: n, styleEl: styleEl });
          } else if (getComputedStyle(n).display === 'contents') {
            expand(n.shadowRoot ? n.shadowRoot.childNodes : n.childNodes, n);
          } else {
            out.push({ node: n, styleEl: styleEl });
          }
        }
      }
    }
    expand(el.shadowRoot ? el.shadowRoot.childNodes : el.childNodes, el);
    return out;
  }

  function nameOf(el) {
    var tag = el.tagName.toLowerCase();
    if (tag.indexOf('s-') === 0) return tag;
    var part = el.getAttribute('part');
    if (part) return part;
    var cls = typeof el.className === 'string' && el.className.trim().split(/\s+/)[0];
    return cls ? tag + '.' + cls : tag;
  }

  function fontInfo(cs) {
    var size = px(cs.fontSize);
    var lh = cs.lineHeight === 'normal' ? Math.round(size * 1.2) : px(cs.lineHeight);
    return {
      fontFamily: cs.fontFamily,
      fontWeight: parseInt(cs.fontWeight, 10) || 400,
      fontSize: size,
      lineHeight: lh,
      letterSpacing: cs.letterSpacing === 'normal' ? 0 : px(cs.letterSpacing),
      color: rgba(cs.color),
      align: cs.textAlign,
      underline: /underline/.test(cs.textDecorationLine || cs.textDecoration),
      italic: cs.fontStyle === 'italic',
    };
  }

  function transform(text, cs) {
    if (cs.textTransform === 'uppercase') return text.toUpperCase();
    if (cs.textTransform === 'lowercase') return text.toLowerCase();
    return text;
  }

  // A text node -> one Figma text layer, boxed to its line height so it lines up with CSS.
  function serText(textNode, styleEl, origin) {
    var range = document.createRange();
    range.selectNodeContents(textNode);
    var rects = Array.prototype.filter.call(range.getClientRects(), function (r) { return r.width > 0; });
    if (!rects.length) return null;
    var box = range.getBoundingClientRect();
    var cs = getComputedStyle(styleEl);
    var f = fontInfo(cs);
    // Hidden or transparent text still takes up space (e.g. a loading button keeps its label to
    // hold its width under the spinner): keep the layer for sizing, but with no color.
    if (cs.visibility !== 'visible') f.color = null;
    var tops = {};
    rects.forEach(function (r) { tops[Math.round(r.top)] = 1; });
    var lines = Object.keys(tops).length;
    var lead = Math.max(0, (f.lineHeight - rects[0].height) / 2);
    var collapse = cs.whiteSpace.indexOf('pre') === 0 ? textNode.textContent : textNode.textContent.replace(/\s+/g, ' ').trim();
    return Object.assign({
      type: 'text',
      name: collapse.slice(0, 24),
      characters: transform(collapse, cs),
      x: round(box.left - origin.left),
      y: round(box.top - origin.top - lead),
      w: round(box.width),
      h: round(Math.max(box.height, lines * f.lineHeight)),
      wrap: lines > 1,
    }, f);
  }

  // value/placeholder of form controls, which are not text nodes.
  function controlText(el, cs, origin) {
    var text = '', placeholder = false;
    if (el.tagName === 'SELECT') text = el.options[el.selectedIndex] ? el.options[el.selectedIndex].text : '';
    else if (el.type === 'password' && el.value) text = el.value.replace(/./g, '•');
    else if (el.type !== 'checkbox' && el.type !== 'radio' && el.type !== 'color' && el.type !== 'range') {
      text = el.value || el.placeholder || '';
      placeholder = !el.value;
    }
    if (!text) return null;
    var f = fontInfo(placeholder ? getComputedStyle(el, '::placeholder') : cs);
    if (placeholder && !f.color) f.color = rgba(cs.color);
    var r = el.getBoundingClientRect();
    var left = r.left + px(cs.borderLeftWidth) + px(cs.paddingLeft);
    var innerH = r.height - px(cs.borderTopWidth) - px(cs.borderBottomWidth);
    return Object.assign({
      type: 'text', name: placeholder ? 'Placeholder' : 'Value', characters: text,
      x: round(left - origin.left),
      y: round(r.top + px(cs.borderTopWidth) + (el.tagName === 'TEXTAREA' ? px(cs.paddingTop) : (innerH - f.lineHeight) / 2) - origin.top),
      w: round(r.width - px(cs.paddingLeft) - px(cs.paddingRight) - px(cs.borderLeftWidth) - px(cs.borderRightWidth)),
      h: f.lineHeight, wrap: el.tagName === 'TEXTAREA', position: 'absolute',
    }, f);
  }

  // Inline computed fill/stroke so icons keep their color outside the page's CSS.
  function svgString(el, rect) {
    var clone = el.cloneNode(true);
    var src = [el].concat(Array.prototype.slice.call(el.querySelectorAll('*')));
    var dst = [clone].concat(Array.prototype.slice.call(clone.querySelectorAll('*')));
    src.forEach(function (s, i) {
      var cs = getComputedStyle(s);
      if (cs.fill && cs.fill !== 'none') dst[i].setAttribute('fill', cs.fill.replace(/currentcolor/i, cs.color));
      else if (cs.fill === 'none') dst[i].setAttribute('fill', 'none');
      if (cs.stroke && cs.stroke !== 'none') dst[i].setAttribute('stroke', cs.stroke.replace(/currentcolor/i, cs.color));
    });
    clone.setAttribute('width', round(rect.width));
    clone.setAttribute('height', round(rect.height));
    if (!clone.getAttribute('xmlns')) clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    return new XMLSerializer().serializeToString(clone);
  }

  // Like rgba(), but keeps fully transparent colors (gradient stops fade to them).
  function rgbaStop(value) {
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = 'rgba(0,0,0,0)';
    ctx.fillStyle = value;
    ctx.fillRect(0, 0, 1, 1);
    var d = ctx.getImageData(0, 0, 1, 1).data;
    if (d[3] === 0) {
      // Canvas zeroes the RGB of transparent pixels; recover it from the color string if we can.
      var m = value.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/);
      return m ? { r: m[1] / 255, g: m[2] / 255, b: m[3] / 255, a: 0 } : { r: 0, g: 0, b: 0, a: 0 };
    }
    return { r: d[0] / 255, g: d[1] / 255, b: d[2] / 255, a: Math.round((d[3] / 255) * 1000) / 1000 };
  }

  var COLOR_START = /^([a-z][a-z-]*\([^()]*\)|#[0-9a-f]{3,8}\b|[a-z]+)/i;

  function isColor(token) { return CSS.supports('color', token); }

  // "rgba(…) 20%", "rgba(…) 4px" -> {color, pos (fraction of the gradient length or null)}
  function parseStops(parts, length) {
    var stops = parts.map(function (p) {
      var m = p.trim().match(COLOR_START);
      if (!m || !isColor(m[1])) return null;
      var rest = p.trim().slice(m[1].length).trim().split(/\s+/)[0];
      var pos = null;
      if (/%$/.test(rest)) pos = parseFloat(rest) / 100;
      else if (/px$/.test(rest)) pos = length ? parseFloat(rest) / length : 0;
      return { color: rgbaStop(m[1]), pos: pos };
    }).filter(Boolean);
    if (!stops.length) return null;
    // CSS rules: first defaults to 0, last to 1, missing ones spread evenly between neighbours,
    // and a stop never sits before the previous one.
    if (stops[0].pos == null) stops[0].pos = 0;
    if (stops[stops.length - 1].pos == null) stops[stops.length - 1].pos = Math.max(1, stops[0].pos);
    for (var i = 1; i < stops.length; i++) {
      if (stops[i].pos == null) {
        var j = i;
        while (stops[j].pos == null) j++;
        for (var k = i; k < j; k++) stops[k].pos = stops[i - 1].pos + (stops[j].pos - stops[i - 1].pos) * (k - i + 1) / (j - i + 1);
      }
      if (stops[i].pos < stops[i - 1].pos) stops[i].pos = stops[i - 1].pos;
    }
    return stops.map(function (s) { return { position: Math.round(s.pos * 10000) / 10000, color: s.color }; });
  }

  function lengthIn(token, total) {
    if (/%$/.test(token)) return parseFloat(token) / 100 * total;
    return px(token);
  }

  var KEYWORD_POS = { left: 0, top: 0, center: 50, right: 100, bottom: 100 };

  function position(tokens, w, h) {
    var x = w / 2, y = h / 2;
    if (tokens[0]) {
      var t0 = tokens[0], t1 = tokens[1];
      if (t0 === 'top' || t0 === 'bottom') { var tmp = t0; t0 = t1 || 'center'; t1 = tmp; }
      x = t0 in KEYWORD_POS ? KEYWORD_POS[t0] / 100 * w : lengthIn(t0, w);
      if (t1) y = t1 in KEYWORD_POS ? KEYWORD_POS[t1] / 100 * h : lengthIn(t1, h);
    }
    return { x: x, y: y };
  }

  // Figma gradientTransform maps normalised layer coordinates to gradient space, where a linear
  // gradient runs from (0, .5) to (1, .5) and a radial one is the ellipse inscribed in the unit square.
  function linearGradient(prelude, parts, w, h) {
    var angle = Math.PI; // CSS default: to bottom
    if (prelude) {
      var deg = prelude.match(/(-?[\d.]+)(deg|rad|turn|grad)/);
      if (deg) {
        var v = parseFloat(deg[1]);
        angle = deg[2] === 'deg' ? v * Math.PI / 180 : deg[2] === 'rad' ? v : deg[2] === 'turn' ? v * 2 * Math.PI : v * Math.PI / 200;
      } else if (/^to /.test(prelude)) {
        var sx = /right/.test(prelude) ? 1 : /left/.test(prelude) ? -1 : 0;
        var sy = /bottom/.test(prelude) ? 1 : /top/.test(prelude) ? -1 : 0;
        var vx = sx && sy ? sx * h : sx, vy = sx && sy ? sy * w : sy;
        angle = Math.atan2(vx, -vy);
      }
    }
    var dx = Math.sin(angle), dy = -Math.cos(angle);
    var L = Math.abs(w * dx) + Math.abs(h * dy);
    var stops = parseStops(parts, L);
    if (!stops) return null;
    // Project in pixel space (so the angle survives non-square boxes), then express the result
    // per normalised coordinate: t = ((x*w, y*h) - start) . d / L.
    var sx0 = w / 2 - dx * L / 2, sy0 = h / 2 - dy * L / 2;
    var nx = -dy, ny = dx;
    return {
      type: 'gradient', kind: 'linear', stops: stops,
      transform: [
        [dx * w / L, dy * h / L, -(sx0 * dx + sy0 * dy) / L],
        [nx * w / L, ny * h / L, 0.5 - (sx0 * nx + sy0 * ny) / L],
      ],
    };
  }

  function radialGradient(prelude, parts, w, h) {
    var sizePart = prelude || '', posPart = '';
    var at = sizePart.indexOf('at ');
    if (at !== -1) { posPart = sizePart.slice(at + 3).trim(); sizePart = sizePart.slice(0, at).trim(); }
    var c = position(posPart ? posPart.split(/\s+/) : [], w, h);
    var tokens = sizePart.split(/\s+/).filter(Boolean);
    var circle = tokens.indexOf('circle') !== -1;
    tokens = tokens.filter(function (t) { return t !== 'circle' && t !== 'ellipse'; });
    var sideX = [c.x, w - c.x], sideY = [c.y, h - c.y];
    var keyword = tokens[0] && /side|corner/.test(tokens[0]) ? tokens[0] : (tokens.length ? null : 'farthest-corner');
    var rx, ry;
    if (keyword) {
      var fx = keyword.indexOf('closest') === 0 ? Math.min.apply(null, sideX) : Math.max.apply(null, sideX);
      var fy = keyword.indexOf('closest') === 0 ? Math.min.apply(null, sideY) : Math.max.apply(null, sideY);
      if (/corner/.test(keyword)) {
        if (circle) rx = ry = Math.sqrt(fx * fx + fy * fy);
        else { rx = fx * Math.SQRT2; ry = fy * Math.SQRT2; }
      } else if (circle) {
        rx = ry = keyword.indexOf('closest') === 0 ? Math.min(fx, fy) : Math.max(fx, fy);
      } else { rx = fx; ry = fy; }
    } else {
      rx = lengthIn(tokens[0], w);
      ry = tokens[1] ? lengthIn(tokens[1], h) : rx;
    }
    if (!(rx > 0) || !(ry > 0)) return null;
    var stops = parseStops(parts, rx);
    if (!stops) return null;
    var cx = c.x / w, cy = c.y / h, rxn = rx / w, ryn = ry / h;
    return {
      type: 'gradient', kind: 'radial', stops: stops,
      transform: [
        [1 / (2 * rxn), 0, 0.5 - cx / (2 * rxn)],
        [0, 1 / (2 * ryn), 0.5 - cy / (2 * ryn)],
      ],
    };
  }

  // Background layers, bottom to top: background-color, then each background-image gradient
  // (CSS lists images top-first), as real linear/radial gradients sized to the box.
  function backgroundFills(cs, w, h) {
    var fills = [];
    var base = rgba(cs.backgroundColor);
    if (base) fills.push(base);
    if (cs.backgroundImage && cs.backgroundImage !== 'none' && w > 0 && h > 0) {
      splitTop(cs.backgroundImage).reverse().forEach(function (layer) {
        var m = layer.match(/^(linear|radial)-gradient\((.*)\)$/);
        if (!m) return;
        var parts = splitTop(m[2]);
        var first = parts[0].trim();
        var firstColor = first.match(COLOR_START);
        var prelude = firstColor && isColor(firstColor[1]) ? null : parts.shift().trim();
        var g = m[1] === 'linear' ? linearGradient(prelude, parts, w, h) : radialGradient(prelude, parts, w, h);
        if (g && g.stops.some(function (s) { return s.color.a > 0; })) fills.push(g);
      });
    }
    // Anything under a fully opaque solid layer is invisible.
    for (var i = fills.length - 1; i > 0; i--) if (fills[i].type !== 'gradient' && fills[i].a >= 1) return fills.slice(i);
    return fills;
  }

  var SIDES = ['Top', 'Right', 'Bottom', 'Left'];

  function boxStyle(cs, w, h) {
    var borderColor = null;
    var borders = SIDES.map(function (s) {
      var w = cs['border' + s + 'Style'] === 'none' ? 0 : px(cs['border' + s + 'Width']);
      if (w && !borderColor) borderColor = rgba(cs['border' + s + 'Color']);
      return w;
    });
    return {
      fills: backgroundFills(cs, w, h),
      stroke: borderColor ? { color: borderColor, widths: borders } : null,
      borders: borders,
      radius: [cs.borderTopLeftRadius, cs.borderTopRightRadius, cs.borderBottomRightRadius, cs.borderBottomLeftRadius].map(px),
      effects: shadows(cs.boxShadow),
      opacity: parseFloat(cs.opacity),
    };
  }

  // Icons drawn as a CSS mask over a background color: rebuild them as a colored SVG.
  function maskSvg(cs, w, h) {
    var mask = cs.maskImage && cs.maskImage !== 'none' ? cs.maskImage : cs.webkitMaskImage;
    if (!mask || mask === 'none') return null;
    var m = mask.match(/url\(["']?(data:image\/svg\+xml[^"')]*)["']?\)/);
    if (!m) return null;
    var data = m[1], svg;
    try {
      svg = /;base64,/.test(data) ? atob(data.split(',')[1]) : decodeURIComponent(data.slice(data.indexOf(',') + 1));
    } catch (e) { return null; }
    var color = cs.backgroundColor;
    var doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
    var root = doc.documentElement;
    if (!root || root.nodeName.toLowerCase() !== 'svg') return null;
    Array.prototype.forEach.call(root.querySelectorAll('*'), function (n) {
      if (n.getAttribute('fill') !== 'none') n.setAttribute('fill', color);
      if (n.getAttribute('stroke') && n.getAttribute('stroke') !== 'none') n.setAttribute('stroke', color);
    });
    root.setAttribute('width', round(w));
    root.setAttribute('height', round(h));
    return new XMLSerializer().serializeToString(root);
  }

  // ::before / ::after boxes. Only absolutely positioned ones can be placed reliably (they are
  // usually overlays: bevels, borders, focus rings, checkmarks); others are recorded for diagnosis.
  function pseudo(el, which, r, origin, skipped) {
    var cs = getComputedStyle(el, which);
    if (!cs.content || cs.content === 'none' || cs.content === 'normal' || cs.display === 'none') return null;
    if (cs.position !== 'absolute' && cs.position !== 'fixed') { skipped.push(which + ':' + cs.position); return null; }
    var host = getComputedStyle(el);
    var left = r.left + px(host.borderLeftWidth), top = r.top + px(host.borderTopWidth);
    var pw = r.width - px(host.borderLeftWidth) - px(host.borderRightWidth);
    var ph = r.height - px(host.borderTopWidth) - px(host.borderBottomWidth);
    function num(v) { return v === 'auto' ? null : px(v); }
    var L = num(cs.left), R = num(cs.right), T = num(cs.top), B = num(cs.bottom);
    var w = cs.width !== 'auto' ? px(cs.width) : (L != null && R != null ? pw - L - R : 0);
    var h = cs.height !== 'auto' ? px(cs.height) : (T != null && B != null ? ph - T - B : 0);
    if (cs.boxSizing === 'content-box' && cs.width !== 'auto') w += px(cs.paddingLeft) + px(cs.paddingRight) + px(cs.borderLeftWidth) + px(cs.borderRightWidth);
    if (cs.boxSizing === 'content-box' && cs.height !== 'auto') h += px(cs.paddingTop) + px(cs.paddingBottom) + px(cs.borderTopWidth) + px(cs.borderBottomWidth);
    if (w <= 0 || h <= 0) return null;
    var x = L != null ? left + L : R != null ? left + pw - R - w : left;
    var y = T != null ? top + T : B != null ? top + ph - B - h : top;
    var base = { name: which, x: round(x - origin.left), y: round(y - origin.top), w: round(w), h: round(h), position: 'absolute', grow: 0, alignSelf: 'auto' };
    var icon = maskSvg(cs, w, h);
    if (icon) return Object.assign(base, { type: 'svg', svg: icon });
    var box = boxStyle(cs, w, h);
    var node = Object.assign(base, box, { type: 'frame', clip: false, children: [] });
    delete node.borders;
    return hasVisuals(node) ? node : null;
  }

  function hasVisuals(n) {
    return (n.fills && n.fills.length) || n.fill || n.stroke || (n.effects && n.effects.length) || n.radius.some(function (r) { return r > 0; });
  }

  // An element marked data-figma-instance="Set" data-figma-variant="Prop=Value, …" becomes an
  // instance of that library component in Figma. Its rendered tree travels along as a fallback for
  // files where the component doesn't exist, and its text becomes the instance's label override.
  function serInstance(el, origin) {
    var fallback;
    if (getComputedStyle(el).display === 'contents') {
      var kids = renderedChildren(el).map(function (c) {
        return c.node.nodeType === 3 ? serText(c.node, c.styleEl, origin) : serElement(c.node, origin);
      }).filter(Boolean);
      if (!kids.length) return null;
      var x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
      kids.forEach(function (c) { x1 = Math.min(x1, c.x); y1 = Math.min(y1, c.y); x2 = Math.max(x2, c.x + c.w); y2 = Math.max(y2, c.y + c.h); });
      fallback = kids.length === 1 ? kids[0] : {
        type: 'frame', name: nameOf(el), x: round(x1), y: round(y1), w: round(x2 - x1), h: round(y2 - y1),
        fills: [], stroke: null, radius: [0, 0, 0, 0], effects: [], opacity: 1, clip: false, position: 'flow', grow: 0, alignSelf: 'auto', children: kids,
      };
    } else {
      fallback = serElement(el, origin, true);
    }
    if (!fallback) return null;
    var cs = getComputedStyle(el);
    return {
      type: 'instance', name: el.getAttribute('data-figma-instance'),
      set: el.getAttribute('data-figma-instance'), variant: el.getAttribute('data-figma-variant') || '',
      label: (el.getAttribute('data-figma-label') || el.textContent).replace(/\s+/g, ' ').trim(),
      x: fallback.x, y: fallback.y, w: fallback.w, h: fallback.h,
      position: cs.position === 'absolute' || cs.position === 'fixed' ? 'absolute' : 'flow',
      grow: px(cs.flexGrow), alignSelf: cs.alignSelf, fallback: fallback,
    };
  }

  function serElement(el, origin, notInstance) {
    if (!notInstance && el.hasAttribute('data-figma-instance')) return serInstance(el, origin);
    var cs = getComputedStyle(el);
    if (!visible(cs)) return null;
    var r = el.getBoundingClientRect();
    var base = {
      name: nameOf(el),
      x: round(r.left - origin.left), y: round(r.top - origin.top), w: round(r.width), h: round(r.height),
      position: cs.position === 'absolute' || cs.position === 'fixed' ? 'absolute' : 'flow',
      grow: px(cs.flexGrow), alignSelf: cs.alignSelf,
    };
    var tag = el.tagName.toLowerCase();
    if (tag === 'svg') {
      if (r.width === 0 || r.height === 0) return null;
      return Object.assign(base, { type: 'svg', svg: svgString(el, r) });
    }
    if (tag === 'img') return Object.assign(base, { type: 'image', radius: [px(cs.borderTopLeftRadius)] });

    var maskIcon = maskSvg(cs, r.width, r.height);
    if (maskIcon && r.width && r.height) return Object.assign(base, { type: 'svg', svg: maskIcon });
    var box = boxStyle(cs, r.width, r.height);
    var borders = box.borders;
    delete box.borders;
    var sides = SIDES;
    var node = Object.assign(base, box, {
      type: 'frame',
      clip: cs.overflow !== 'visible',
      children: [],
    });
    if (/flex/.test(cs.display)) {
      var row = cs.flexDirection.indexOf('row') === 0;
      node.layout = {
        direction: row ? 'row' : 'column',
        reverse: /reverse/.test(cs.flexDirection),
        gap: px(row ? cs.columnGap : cs.rowGap),
        crossGap: px(row ? cs.rowGap : cs.columnGap),
        // Figma strokes don't take layout space, so the border width moves into the padding.
        padding: sides.map(function (s, i) { return px(cs['padding' + s]) + borders[i]; }),
        justify: cs.justifyContent,
        align: cs.alignItems,
        wrap: cs.flexWrap !== 'nowrap',
      };
    }
    var skipped = [];
    var before = pseudo(el, '::before', r, origin, skipped);
    if (before) node.children.push(before);
    if (cs.backgroundImage && cs.backgroundImage !== 'none' && !/gradient/.test(cs.backgroundImage)) node.bgImage = cs.backgroundImage.slice(0, 120);
    if (tag === 'input' || tag === 'textarea' || tag === 'select') {
      var t = controlText(el, cs, origin);
      if (t) node.children.push(t);
    } else {
      renderedChildren(el).forEach(function (c) {
        var child = c.node.nodeType === 3 ? serText(c.node, c.styleEl, origin) : serElement(c.node, origin);
        if (child) node.children.push(child);
      });
    }
    // A wrapper with no box of its own (inline wrappers around blocks, zero-size hosts) takes the
    // bounds of its content, so child offsets stay local.
    if ((node.w < 0.5 || node.h < 0.5) && node.children.length) {
      var x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
      node.children.forEach(function (c) {
        x1 = Math.min(x1, c.x); y1 = Math.min(y1, c.y);
        x2 = Math.max(x2, c.x + c.w); y2 = Math.max(y2, c.y + c.h);
      });
      node.x = round(x1); node.y = round(y1); node.w = round(x2 - x1); node.h = round(y2 - y1);
    }
    var after = pseudo(el, '::after', r, origin, skipped);
    if (after) node.children.push(after);
    if (skipped.length) node.skippedPseudo = skipped;
    if (node.layout && node.layout.reverse) node.children.reverse();
    // Drop invisible empties; collapse plain wrappers that exactly contain one child.
    if (!hasVisuals(node) && !node.children.length) return null;
    if (!hasVisuals(node) && !node.layout && node.children.length === 1 && node.position === 'flow') {
      var only = node.children[0];
      if (Math.abs(only.x - node.x) < 0.5 && Math.abs(only.y - node.y) < 0.5 && Math.abs(only.w - node.w) < 0.5 && Math.abs(only.h - node.h) < 0.5) {
        only.grow = node.grow;
        only.alignSelf = node.alignSelf;
        if (node.name.indexOf('s-') === 0) only.name = node.name;
        return only;
      }
    }
    return node;
  }

  function serialiseFrame(frame) {
    var origin = frame.getBoundingClientRect();
    var root = {
      type: 'frame', name: 'root', x: 0, y: 0, w: round(origin.width), h: round(origin.height),
      fills: [], stroke: null, radius: [0, 0, 0, 0], effects: [], opacity: 1, clip: false, position: 'flow', children: [],
    };
    // renderedChildren skips display:contents hosts (Polaris' s-* elements): they have no box, and
    // measuring them gives 0x0 at the page origin, which threw their content far off-component.
    renderedChildren(frame).forEach(function (c) {
      var n = c.node.nodeType === 3 ? serText(c.node, c.styleEl, origin) : serElement(c.node, origin);
      if (n) root.children.push(n);
    });
    return root;
  }

  function exportAll() {
    var script = document.querySelector('script[src*="cdn.shopify.com/shopifycloud/"]');
    var file = script ? script.src.split('/').pop() : 'unknown';
    var out = {
      kind: 'polaris-components',
      exportVersion: 3,
      source: file,
      version: /polaris-1/.test(file) ? 'Polaris 1' : /polaris-2/.test(file) ? 'Polaris 2.0' : file,
      capturedAt: new Date().toISOString(),
      sets: [],
    };
    document.querySelectorAll('.cap-set').forEach(function (setEl) {
      var set = { name: setEl.getAttribute('data-set'), fixedWidth: setEl.getAttribute('data-width') ? +setEl.getAttribute('data-width') : null, items: [] };
      setEl.querySelectorAll('.cap-frame').forEach(function (frame) {
        set.items.push({ variant: frame.getAttribute('data-name'), tree: serialiseFrame(frame) });
      });
      out.sets.push(set);
    });
    return out;
  }

  window.polarisExportComponents = exportAll;

  // ---------- debug info ----------
  // Raw computed styles for a few representative variants, short enough to paste into a chat.
  var DEBUG_VARIANTS = [
    ['Button', 'Variant=Primary, Tone=Auto, State=Default'],
    ['Button', 'Variant=Primary, Tone=Auto, State=Loading'],
    ['Checkbox', 'State=Unchecked, Disabled=No'],
    ['Banner', 'Tone=Info, Heading=Yes'],
  ];
  var DEBUG_PROPS = ['display', 'position', 'backgroundColor', 'backgroundImage', 'borderTopWidth', 'borderTopStyle', 'borderTopColor',
    'borderRadius', 'boxShadow', 'outline', 'filter', 'opacity', 'visibility', 'color', 'maskImage', 'appearance'];
  var DEFAULTS = { display: 'inline', position: 'static', backgroundColor: 'rgba(0, 0, 0, 0)', backgroundImage: 'none', borderTopWidth: '0px',
    borderTopStyle: 'none', borderRadius: '0px', boxShadow: 'none', filter: 'none', opacity: '1', visibility: 'visible', maskImage: 'none', appearance: 'none' };

  function styleLine(cs) {
    return DEBUG_PROPS.map(function (p) {
      var v = cs[p];
      if (v == null || v === '' || DEFAULTS[p] === v) return null;
      if (p === 'borderTopColor' && cs.borderTopStyle === 'none') return null;
      if (p === 'outline' && /none|0px/.test(v)) return null;
      return p + '=' + (v.length > 160 ? v.slice(0, 160) + '…' : v);
    }).filter(Boolean).join('; ');
  }

  function debugFrame(frame) {
    var origin = frame.getBoundingClientRect(), lines = [], max = 45;
    (function walk(el, depth) {
      if (lines.length >= max) return;
      renderedChildren(el).forEach(function (c) {
        if (lines.length >= max) return;
        var pad = Array(depth + 1).join('  ');
        if (c.node.nodeType === 3) {
          var cs = getComputedStyle(c.styleEl);
          lines.push(pad + 'TEXT "' + c.node.textContent.trim().slice(0, 30) + '" color=' + cs.color + ' font=' + cs.fontWeight + ' ' + cs.fontSize + ' visibility=' + cs.visibility);
          return;
        }
        var n = c.node, r = n.getBoundingClientRect();
        lines.push(pad + nameOf(n) + ' [' + round(r.left - origin.left) + ',' + round(r.top - origin.top) + ' ' + round(r.width) + 'x' + round(r.height) + '] ' + styleLine(getComputedStyle(n)));
        ['::before', '::after'].forEach(function (w) {
          var ps = getComputedStyle(n, w);
          if (ps.content && ps.content !== 'none' && ps.content !== 'normal') lines.push(pad + '  ' + w + ' content=' + ps.content.slice(0, 20) + ' inset=' + ps.top + '/' + ps.right + '/' + ps.bottom + '/' + ps.left + ' size=' + ps.width + 'x' + ps.height + ' ' + styleLine(ps));
        });
        if (n.tagName !== 'svg') walk(n, depth + 1);
      });
    })(frame, 0);
    return lines;
  }

  function debugInfo() {
    var out = ['Polaris debug — ' + (document.querySelector('script[src*="cdn.shopify.com/shopifycloud/"]') || {}).src];
    DEBUG_VARIANTS.forEach(function (v) {
      var setEl = document.querySelector('.cap-set[data-set="' + v[0] + '"]');
      var frame = setEl && Array.prototype.filter.call(setEl.querySelectorAll('.cap-frame'), function (f) { return f.getAttribute('data-name') === v[1]; })[0];
      out.push('', '## ' + v[0] + ' / ' + v[1]);
      out = out.concat(frame ? debugFrame(frame) : ['(not found)']);
    });
    return out.join('\n');
  }
  window.polarisDebugInfo = debugInfo;

  // Screens: whole layouts (e.g. dashboard.html) marked data-figma-screen="Name".
  function exportScreens() {
    var script = document.querySelector('script[src*="cdn.shopify.com/shopifycloud/"]');
    var file = script ? script.src.split('/').pop() : 'unknown';
    return {
      kind: 'polaris-screens', exportVersion: 3, source: file,
      version: /polaris-1/.test(file) ? 'Polaris 1' : /polaris-2/.test(file) ? 'Polaris 2.0' : file,
      capturedAt: new Date().toISOString(),
      screens: Array.prototype.map.call(document.querySelectorAll('[data-figma-screen]'), function (el) {
        return { name: el.getAttribute('data-figma-screen'), tree: serialiseFrame(el) };
      }),
    };
  }
  window.polarisExportScreens = exportScreens;

  function download(data, name) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }));
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  var button = document.getElementById('cap-export');
  var screenButton = document.getElementById('screen-export');
  var status = document.getElementById('cap-export-status') || document.getElementById('screen-export-status');
  var tags = ['s-button', 's-badge', 's-text-field', 's-section'];
  var timeout = new Promise(function (_, reject) { setTimeout(reject, 8000); });
  Promise.race([Promise.all(tags.map(function (t) { return customElements.whenDefined(t); })), timeout]).then(function () {
    return new Promise(function (r) { setTimeout(r, 800); });
  }).then(function () {
    [button, debugButton, screenButton].forEach(function (b) { if (b) b.disabled = false; });
    status.textContent = 'Ready.';
  }, function () {
    status.textContent = 'Polaris did not load, so there is nothing to export.';
  });

  if (screenButton) screenButton.addEventListener('click', function () {
    status.textContent = 'Exporting…';
    setTimeout(function () {
      try {
        var data = exportScreens();
        var instances = 0, layers = 0;
        data.screens.forEach(function (s) {
          (function walk(n) {
            layers++;
            if (n.type === 'instance') instances++;
            (n.children || []).forEach(walk);
          })(s.tree);
        });
        download(data, 'polaris-screens-' + data.version.replace(/\W+/g, '-').toLowerCase() + '.json');
        status.textContent = 'Downloaded ' + data.screens.length + ' screens: ' + layers + ' layers, ' + instances + ' library instances. Load the file in the Figma plugin.';
      } catch (e) {
        console.error(e);
        status.textContent = 'Export failed: ' + e.message;
      }
    }, 0);
  });

  var debugButton = document.getElementById('cap-debug');
  if (debugButton) debugButton.addEventListener('click', function () {
    var text = debugInfo();
    var box = document.getElementById('cap-debug-text');
    box.value = text;
    box.style.display = 'block';
    box.select();
    navigator.clipboard.writeText(text).then(function () {
      status.textContent = 'Debug info copied (' + text.length + ' characters). Paste it to Claude.';
    }, function () {
      status.textContent = 'Clipboard blocked: copy the debug info from the box below.';
    });
  });

  if (button) button.addEventListener('click', function () {
    status.textContent = 'Exporting…';
    setTimeout(function () {
      try {
        var data = exportAll();
        var count = 0, empty = 0, layers = 0, filled = 0, texts = 0, icons = 0, outside = 0;
        function within(n, p) {
          if (n.x < p.x - 1 || n.y < p.y - 1 || n.x + n.w > p.x + p.w + 1 || n.y + n.h > p.y + p.h + 1) outside++;
          (n.children || []).forEach(function (c) { within(c, n); });
        }
        data.sets.forEach(function (s) {
          s.items.forEach(function (i) {
            count++;
            if (!i.tree.children.length) empty++;
            i.tree.children.forEach(function (c) { within(c, i.tree); });
            (function walk(n) {
              layers++;
              if (n.type === 'text') texts++;
              if (n.type === 'svg') icons++;
              if ((n.fills && n.fills.length) || n.stroke) filled++;
              (n.children || []).forEach(walk);
            })(i.tree);
          });
        });
        download(data, 'polaris-components-' + data.version.replace(/\W+/g, '-').toLowerCase() + '.json');
        status.textContent = 'Downloaded ' + data.sets.length + ' sets, ' + count + ' variants: ' + layers + ' layers (' + filled + ' filled boxes, ' + texts + ' text, ' + icons + ' icons).' +
          (empty ? ' Warning: ' + empty + ' variants captured nothing — Polaris may be hiding its internals; tell Claude.' : '') +
          (outside ? ' Warning: ' + outside + ' layers fall outside their parent and may be clipped in Figma; tell Claude.' : '') +
          (empty || outside ? '' : ' Load the file in the Figma plugin.');
      } catch (e) {
        console.error(e);
        status.textContent = 'Export failed: ' + e.message;
      }
    }, 0);
  });
})();
