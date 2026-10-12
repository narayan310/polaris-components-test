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

  function hasVisuals(n) {
    return n.fill || n.stroke || (n.effects && n.effects.length) || n.radius.some(function (r) { return r > 0; });
  }

  function serElement(el, origin) {
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

    var sides = ['Top', 'Right', 'Bottom', 'Left'];
    var borderColor = null;
    var borders = sides.map(function (s) {
      var w = cs['border' + s + 'Style'] === 'none' ? 0 : px(cs['border' + s + 'Width']);
      if (w && !borderColor) borderColor = rgba(cs['border' + s + 'Color']);
      return w;
    });
    var node = Object.assign(base, {
      type: 'frame',
      fill: rgba(cs.backgroundColor),
      stroke: borderColor ? { color: borderColor, widths: borders } : null,
      radius: [cs.borderTopLeftRadius, cs.borderTopRightRadius, cs.borderBottomRightRadius, cs.borderBottomLeftRadius].map(px),
      effects: shadows(cs.boxShadow),
      opacity: parseFloat(cs.opacity),
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
    if (tag === 'input' || tag === 'textarea' || tag === 'select') {
      var t = controlText(el, cs, origin);
      if (t) node.children.push(t);
    } else {
      renderedChildren(el).forEach(function (c) {
        var child = c.node.nodeType === 3 ? serText(c.node, c.styleEl, origin) : serElement(c.node, origin);
        if (child) node.children.push(child);
      });
    }
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
      fill: null, stroke: null, radius: [0, 0, 0, 0], effects: [], opacity: 1, clip: false, position: 'flow', children: [],
    };
    Array.prototype.forEach.call(frame.children, function (c) {
      var n = serElement(c, origin);
      if (n) root.children.push(n);
    });
    return root;
  }

  function exportAll() {
    var script = document.querySelector('script[src*="cdn.shopify.com/shopifycloud/"]');
    var file = script ? script.src.split('/').pop() : 'unknown';
    var out = {
      kind: 'polaris-components',
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

  var button = document.getElementById('cap-export');
  var status = document.getElementById('cap-export-status');
  var tags = ['s-button', 's-badge', 's-text-field', 's-section'];
  var timeout = new Promise(function (_, reject) { setTimeout(reject, 8000); });
  Promise.race([Promise.all(tags.map(function (t) { return customElements.whenDefined(t); })), timeout]).then(function () {
    return new Promise(function (r) { setTimeout(r, 800); });
  }).then(function () {
    button.disabled = false;
    status.textContent = 'Ready.';
  }, function () {
    status.textContent = 'Polaris did not load, so there is nothing to export.';
  });

  button.addEventListener('click', function () {
    status.textContent = 'Exporting…';
    setTimeout(function () {
      try {
        var data = exportAll();
        var count = data.sets.reduce(function (n, s) { return n + s.items.length; }, 0);
        var a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }));
        a.download = 'polaris-components-' + data.version.replace(/\W+/g, '-').toLowerCase() + '.json';
        a.click();
        URL.revokeObjectURL(a.href);
        status.textContent = 'Downloaded ' + data.sets.length + ' sets, ' + count + ' variants. Load the file in the Figma plugin.';
      } catch (e) {
        console.error(e);
        status.textContent = 'Export failed: ' + e.message;
      }
    }, 0);
  });
})();
