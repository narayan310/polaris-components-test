// Measures typography and color from the rendered Polaris components and writes the results into
// the Foundations sections as plain DOM, so they import into Figma as ordinary layers.
// Nothing is hard-coded: switching Polaris versions (?polaris=1) changes the output.
(function () {
  'use strict';

  // Everything measured, in a shape the Figma plugin (figma-plugin/) can import.
  var EXPORT = { colors: [], tokens: [], text: [], fonts: [] };

  var TYPE_NAMES = {
    'page-title': 'Heading/Page title',
    'section-heading': 'Heading/Section',
    'subsection-heading': 'Heading/Sub-section',
    'heading': 'Heading/Heading',
    'paragraph': 'Body/Paragraph',
    'paragraph-subdued': 'Body/Paragraph subdued',
    'text': 'Body/Text',
    'text-strong': 'Body/Text strong',
    'text-subdued': 'Body/Text subdued',
    'link': 'Body/Link',
    'button': 'Label/Button',
    'badge': 'Label/Badge',
    'field-label': 'Label/Field',
  };

  // ---------- helpers ----------

  // Every element under a node, descending into open shadow roots.
  function deepElements(root) {
    var out = [];
    (function walk(node) {
      var kids = node.children || [];
      for (var i = 0; i < kids.length; i++) {
        out.push(kids[i]);
        if (kids[i].shadowRoot) walk(kids[i].shadowRoot);
        walk(kids[i]);
      }
    })(root);
    return out;
  }

  function deepQuery(host, selector) {
    var all = host.shadowRoot ? deepElements(host.shadowRoot) : [];
    for (var i = 0; i < all.length; i++) if (all[i].matches(selector)) return all[i];
    return null;
  }

  // The element whose computed style the visible text inherits.
  function textTarget(host, mode) {
    if (!host.shadowRoot) return host;
    if (mode === 'heading') return deepQuery(host, 'h1,h2,h3,h4,h5,h6,[role="heading"]') || host;
    if (mode === 'label') return deepQuery(host, 'label') || host;
    if (mode === 'button') return deepQuery(host, 'button,a') || host;
    return deepQuery(host, 'slot:not([name])') || host;
  }

  var canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  var ctx = canvas.getContext('2d', { willReadFrequently: true });

  // Any CSS color (rgb, oklch, color(), light-dark resolved) -> {r,g,b,a}, or null.
  function toRGBA(value) {
    if (!value || /currentcolor|inherit|initial|unset|light-dark/i.test(value) || !CSS.supports('color', value)) return null;
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = '#000';
    ctx.fillStyle = value;
    ctx.fillRect(0, 0, 1, 1);
    var d = ctx.getImageData(0, 0, 1, 1).data;
    return { r: d[0], g: d[1], b: d[2], a: Math.round((d[3] / 255) * 100) / 100 };
  }

  function hex(c) {
    var h = '#' + [c.r, c.g, c.b].map(function (n) { return n.toString(16).padStart(2, '0'); }).join('').toUpperCase();
    return c.a < 1 ? h + ' · ' + Math.round(c.a * 100) + '%' : h;
  }

  function hex6(c) {
    return '#' + [c.r, c.g, c.b].map(function (n) { return n.toString(16).padStart(2, '0'); }).join('').toUpperCase();
  }

  // "Badge · success · label" in group "Badges" -> "Badges/success/label"
  function figmaColorName(group, name) {
    var parts = name.split(' · ');
    if (parts.length > 1 && group.toLowerCase().indexOf(parts[0].toLowerCase()) === 0) parts.shift();
    return group + '/' + parts.join('/');
  }

  function luminance(c) {
    var ch = [c.r, c.g, c.b].map(function (v) {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  }

  function contrast(a, b) {
    var l1 = luminance(a), l2 = luminance(b);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  }

  function isPainted(style) {
    var c = toRGBA(style.backgroundColor);
    return c && c.a > 0;
  }

  function hasBorder(style) {
    return parseFloat(style.borderTopWidth) > 0 && style.borderTopStyle !== 'none';
  }

  // First element (host first, then shadow descendants) matching a paint test.
  function firstPaint(host, mode) {
    var els = [host].concat(host.shadowRoot ? deepElements(host.shadowRoot) : []);
    for (var i = 0; i < els.length; i++) {
      var s = getComputedStyle(els[i]);
      if (mode === 'bg' && isPainted(s)) return toRGBA(s.backgroundColor);
      if (mode === 'border' && hasBorder(s)) return toRGBA(s.borderTopColor);
      if (mode === 'line') {
        if (hasBorder(s)) return toRGBA(s.borderTopColor);
        if (isPainted(s)) return toRGBA(s.backgroundColor);
      }
    }
    return null;
  }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function note(text) { return el('p', 'fd-note', text); }

  function swatch(name, color, extra) {
    var s = el('div', 'fd-swatch');
    var chip = el('div', 'fd-chip');
    chip.style.background = 'rgba(' + color.r + ',' + color.g + ',' + color.b + ',' + color.a + ')';
    var meta = el('div', 'fd-meta');
    meta.appendChild(el('div', 'fd-name', name));
    meta.appendChild(el('div', null, hex(color)));
    if (extra) meta.appendChild(el('div', null, extra));
    s.appendChild(chip);
    s.appendChild(meta);
    return s;
  }

  // ---------- CSS custom properties ----------

  // Collect "--name: value" declarations from document and shadow-root stylesheets,
  // remembering an element in each scope where they can be resolved.
  function collectCustomProps() {
    var found = new Map(); // name -> resolver element
    function fromRules(rules, scopeEl) {
      for (var i = 0; i < rules.length; i++) {
        var r = rules[i];
        if (r.style) {
          for (var j = 0; j < r.style.length; j++) {
            var n = r.style[j];
            if (n.startsWith('--') && !found.has(n)) found.set(n, scopeEl);
          }
        }
        if (r.cssRules) fromRules(r.cssRules, scopeEl);
      }
    }
    function fromSheets(sheets, scopeEl) {
      for (var i = 0; i < sheets.length; i++) {
        try { fromRules(sheets[i].cssRules, scopeEl); } catch (e) { /* cross-origin sheet */ }
      }
    }
    fromSheets(document.styleSheets, document.documentElement);
    fromSheets(document.adoptedStyleSheets || [], document.documentElement);
    deepElements(document.body).forEach(function (h) {
      if (!h.shadowRoot) return;
      var inner = h.shadowRoot.firstElementChild || h;
      fromSheets(h.shadowRoot.adoptedStyleSheets || [], inner);
      fromSheets(Array.prototype.map.call(h.shadowRoot.querySelectorAll('style'), function (s) { return s.sheet; }).filter(Boolean), inner);
    });
    var out = [];
    found.forEach(function (scopeEl, name) {
      // Our own page variables would only add noise.
      if (name.startsWith('--fd-')) return;
      var v = getComputedStyle(scopeEl).getPropertyValue(name).trim()
        || getComputedStyle(document.documentElement).getPropertyValue(name).trim();
      if (v) out.push({ name: name, value: v });
    });
    return out.sort(function (a, b) { return a.name.localeCompare(b.name); });
  }

  function groupKey(name) {
    var parts = name.replace(/^--/, '').split('-');
    // Drop a short namespace prefix like "p" or "s", and a leading "color".
    if (parts[0].length <= 2) parts.shift();
    if (parts[0] === 'color') parts.shift();
    return parts[0] || 'other';
  }

  // ---------- renderers ----------

  function renderFonts() {
    var box = document.getElementById('fd-fonts');
    box.textContent = '';
    var seen = {}, rows = [];
    document.fonts.forEach(function (f) {
      var key = f.family + '|' + f.weight + '|' + f.style;
      if (seen[key]) return;
      seen[key] = true;
      rows.push(f);
      EXPORT.fonts.push({ family: f.family.replace(/"/g, ''), weight: f.weight, style: f.style, status: f.status });
    });
    if (!rows.length) {
      box.appendChild(note('No web fonts registered — Polaris is using the system font stack shown in the hierarchy below.'));
      return;
    }
    var t = el('table', 'fd-table');
    rows.forEach(function (f) {
      var tr = el('tr');
      var sample = el('td');
      var s = el('span', null, 'Aa Bb Cc 123');
      s.style.fontFamily = f.family;
      s.style.fontWeight = f.weight;
      s.style.fontStyle = f.style;
      s.style.fontSize = '20px';
      sample.appendChild(s);
      tr.appendChild(sample);
      tr.appendChild(el('td', null, f.family.replace(/"/g, '')));
      tr.appendChild(el('td', null, 'weight ' + f.weight + (f.style !== 'normal' ? ' · ' + f.style : '')));
      tr.appendChild(el('td', null, f.status));
      t.appendChild(tr);
    });
    box.appendChild(t);
  }

  function renderTypeHierarchy() {
    document.querySelectorAll('[data-type-probe]').forEach(function (probe) {
      // data-type-ref measures another element: the page itself, or the section this row sits in.
      var ref = probe.getAttribute('data-type-ref');
      var row = probe.closest('.fd-row');
      var host = ref === 'page' ? document.querySelector('s-page')
        : ref === 'section' ? row.parentElement.closest('s-section')
        : probe;
      var target = textTarget(host, probe.getAttribute('data-type-mode'));
      var s = getComputedStyle(target);
      var spec = row.querySelector('.fd-spec');
      var family = s.fontFamily.split(',')[0].replace(/["']/g, '').trim();
      var color = toRGBA(s.color);
      spec.innerHTML = '';
      [
        ['Font', family],
        ['Size / line', s.fontSize + ' / ' + s.lineHeight],
        ['Weight', s.fontWeight],
        ['Tracking', s.letterSpacing],
        ['Color', color ? hex(color) : s.color],
      ].forEach(function (p) {
        var line = el('div');
        line.appendChild(el('b', null, p[0] + ': '));
        line.appendChild(document.createTextNode(p[1]));
        spec.appendChild(line);
      });
      EXPORT.text.push({
        name: TYPE_NAMES[probe.getAttribute('data-type-probe')] || probe.getAttribute('data-type-probe'),
        fontFamily: s.fontFamily,
        fontSize: s.fontSize,
        lineHeight: s.lineHeight,
        fontWeight: s.fontWeight,
        letterSpacing: s.letterSpacing,
        color: color ? hex6(color) : null,
      });
      spec.title = 'Full stack: ' + s.fontFamily + (target === host ? ' (measured on host — shadow root not readable)' : '');
    });
  }

  function renderTypeTokens(props) {
    var box = document.getElementById('fd-type-tokens');
    box.textContent = '';
    var type = props.filter(function (p) {
      return /font|line-height|letter-spacing|text-(size|weight)|typography/.test(p.name) && !toRGBA(p.value);
    });
    if (!type.length) {
      box.appendChild(note('Polaris does not expose type tokens as CSS variables in this version — use the measured hierarchy above.'));
      return;
    }
    var t = el('table', 'fd-table');
    type.forEach(function (p) {
      var tr = el('tr');
      var sample = el('td');
      if (/size/.test(p.name)) {
        var s = el('span', null, 'Aa');
        s.style.fontSize = p.value;
        sample.appendChild(s);
      } else if (/weight/.test(p.name)) {
        var w = el('span', null, 'Aa');
        w.style.fontWeight = p.value;
        sample.appendChild(w);
      }
      tr.appendChild(sample);
      tr.appendChild(el('td', null, p.name));
      tr.appendChild(el('td', null, p.value));
      t.appendChild(tr);
    });
    box.appendChild(t);
  }

  var COLOR_PROBES = [
    { group: 'Surfaces', html: '<s-section>Card</s-section>', m: [['bg', 'Card surface']], card: true },
    { group: 'Surfaces', html: '<s-box background="base" padding="base">x</s-box>', m: [['bg', 'Box · base']] },
    { group: 'Surfaces', html: '<s-box background="subdued" padding="base">x</s-box>', m: [['bg', 'Box · subdued']] },
    { group: 'Surfaces', html: '<s-box background="strong" padding="base">x</s-box>', m: [['bg', 'Box · strong']] },

    { group: 'Actions', html: '<s-button variant="primary">x</s-button>', m: [['bg', 'Primary button'], ['text', 'Primary button · label']] },
    { group: 'Actions', html: '<s-button variant="secondary">x</s-button>', m: [['bg', 'Secondary button'], ['border', 'Secondary button · border'], ['text', 'Secondary button · label']] },
    { group: 'Actions', html: '<s-button variant="primary" tone="critical">x</s-button>', m: [['bg', 'Critical button'], ['text', 'Critical button · label']] },
    { group: 'Actions', html: '<s-link href="#">x</s-link>', m: [['text', 'Link']] },

    { group: 'Text', html: '<s-text>x</s-text>', m: [['text', 'Text · default']] },
    { group: 'Text', html: '<s-text color="subdued">x</s-text>', m: [['text', 'Text · subdued']] },
    { group: 'Text', html: '<s-text tone="info">x</s-text>', m: [['text', 'Text · info']] },
    { group: 'Text', html: '<s-text tone="success">x</s-text>', m: [['text', 'Text · success']] },
    { group: 'Text', html: '<s-text tone="caution">x</s-text>', m: [['text', 'Text · caution']] },
    { group: 'Text', html: '<s-text tone="warning">x</s-text>', m: [['text', 'Text · warning']] },
    { group: 'Text', html: '<s-text tone="critical">x</s-text>', m: [['text', 'Text · critical']] },

    { group: 'Borders', html: '<s-divider></s-divider>', m: [['line', 'Divider']] },
    { group: 'Borders', html: '<s-box border="base" padding="base">x</s-box>', m: [['border', 'Box · border']] },
    { group: 'Borders', html: '<s-text-field label="x"></s-text-field>', m: [['border', 'Field · border']] },
  ];
  ['neutral', 'info', 'success', 'caution', 'warning', 'critical'].forEach(function (tone) {
    COLOR_PROBES.push({ group: 'Badges', html: '<s-badge tone="' + tone + '">x</s-badge>', m: [['bg', 'Badge · ' + tone], ['text', 'Badge · ' + tone + ' · label']] });
  });
  ['info', 'success', 'warning', 'critical'].forEach(function (tone) {
    COLOR_PROBES.push({ group: 'Banners', html: '<s-banner tone="' + tone + '" heading="x">x</s-banner>', m: [['bg', 'Banner · ' + tone]] });
  });

  function mountProbes() {
    var stage = document.getElementById('fd-probes');
    COLOR_PROBES.forEach(function (p) {
      var wrap = document.createElement('div');
      wrap.innerHTML = p.html;
      stage.appendChild(wrap);
      p.host = wrap.firstElementChild;
    });
  }

  function renderColors() {
    var box = document.getElementById('fd-colors');
    box.textContent = '';
    var card = null;
    var cardProbe = COLOR_PROBES.filter(function (p) { return p.card; })[0];
    if (cardProbe) card = firstPaint(cardProbe.host, 'bg');
    var white = { r: 255, g: 255, b: 255, a: 1 };

    var groups = {};
    COLOR_PROBES.forEach(function (p) {
      p.m.forEach(function (pair) {
        var mode = pair[0], name = pair[1];
        var c = mode === 'text' ? toRGBA(getComputedStyle(textTarget(p.host)).color) : firstPaint(p.host, mode);
        if (!c) return;
        var extra = null;
        if (mode === 'text') {
          // Labels sit on their own component; plain text sits on the card.
          var bg = (p.group === 'Text' || p.group === 'Actions' && /Link/.test(name)) ? (card || white) : (firstPaint(p.host, 'bg') || card || white);
          extra = contrast(c, bg).toFixed(2) + ':1 contrast';
        }
        (groups[p.group] = groups[p.group] || []).push(swatch(name, c, extra));
        EXPORT.colors.push({ name: figmaColorName(p.group, name), hex: hex6(c), alpha: c.a });
      });
    });
    Object.keys(groups).forEach(function (g) {
      box.appendChild(el('div', 'fd-group', g));
      var grid = el('div', 'fd-swatches');
      groups[g].forEach(function (s) { grid.appendChild(s); });
      box.appendChild(grid);
    });
    if (!box.children.length) box.appendChild(note('Could not read colors — the components did not render.'));
  }

  function renderColorTokens(props) {
    var box = document.getElementById('fd-color-tokens');
    box.textContent = '';
    var colors = props.map(function (p) { return { name: p.name, value: p.value, c: toRGBA(p.value) }; })
      .filter(function (p) { return p.c; });
    if (!colors.length) {
      box.appendChild(note('Polaris does not expose color tokens as CSS variables in this version (or keeps them in a closed shadow root). Use “Colors — as rendered” above.'));
      return;
    }
    box.appendChild(note(colors.length + ' color variables found.'));
    var groups = {};
    colors.forEach(function (p) { (groups[groupKey(p.name)] = groups[groupKey(p.name)] || []).push(p); });
    Object.keys(groups).sort().forEach(function (g) {
      box.appendChild(el('div', 'fd-group', g + ' (' + groups[g].length + ')'));
      var grid = el('div', 'fd-swatches');
      groups[g].forEach(function (p) {
        grid.appendChild(swatch(p.name, p.c));
        var rest = p.name.replace(/^--/, '').split('-');
        if (rest[0].length <= 2) rest.shift();
        if (rest[0] === 'color') rest.shift();
        rest.shift();
        EXPORT.tokens.push({ name: g + '/' + (rest.join('-') || 'default'), cssVar: p.name, hex: hex6(p.c), alpha: p.c.a });
      });
      box.appendChild(grid);
    });
  }

  function publishExport() {
    var script = document.querySelector('script[src*="cdn.shopify.com/shopifycloud/"]');
    var file = script ? script.src.split('/').pop() : 'unknown';
    EXPORT.source = file;
    EXPORT.version = /polaris-1/.test(file) ? 'Polaris 1' : /polaris-2/.test(file) ? 'Polaris 2.0' : file;
    EXPORT.capturedAt = new Date().toISOString();
    window.polarisFoundations = EXPORT;

    var json = JSON.stringify(EXPORT, null, 2);
    var status = document.getElementById('fd-export-status');
    var copy = document.getElementById('fd-copy');
    var download = document.getElementById('fd-download');
    status.textContent = EXPORT.version + ': ' + EXPORT.colors.length + ' rendered colors, ' + EXPORT.tokens.length + ' color tokens, ' + EXPORT.text.length + ' text styles.';
    copy.removeAttribute('disabled');
    download.removeAttribute('disabled');
    copy.addEventListener('click', function () {
      navigator.clipboard.writeText(json).then(function () {
        status.textContent = 'Copied. Paste it into the Polaris Foundations plugin in Figma.';
      }, function () {
        status.textContent = 'Clipboard blocked by the browser — use Download instead.';
      });
    });
    download.addEventListener('click', function () {
      var a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
      a.download = 'polaris-foundations-' + EXPORT.version.replace(/\W+/g, '-').toLowerCase() + '.json';
      a.click();
      URL.revokeObjectURL(a.href);
    });
  }

  function fail(msg) {
    document.getElementById('fd-export-status').textContent = 'Nothing to export: ' + msg;
    ['fd-fonts', 'fd-type-tokens', 'fd-colors', 'fd-color-tokens'].forEach(function (id) {
      var b = document.getElementById(id);
      b.textContent = '';
      b.appendChild(note(msg));
    });
  }

  // ---------- run ----------

  var tags = ['s-page', 's-section', 's-text', 's-button', 's-badge', 's-banner', 's-box'];
  var defined = Promise.all(tags.map(function (t) { return customElements.whenDefined(t); }));
  var timeout = new Promise(function (_, reject) { setTimeout(reject, 8000); });

  Promise.race([defined, timeout]).then(function () {
    mountProbes();
    // Give the components a moment to render before measuring.
    return Promise.all([document.fonts.ready, new Promise(function (r) { setTimeout(r, 600); })]).then(function () {
      try {
        var props = collectCustomProps();
        renderFonts();
        renderTypeHierarchy();
        renderTypeTokens(props);
        renderColors();
        renderColorTokens(props);
        publishExport();
      } catch (e) {
        console.error(e);
        fail('Measuring failed: ' + e.message + '. See the browser console.');
      }
    });
  }, function () {
    fail('Polaris did not load, so nothing could be measured. Check your connection and the browser console.');
  });
})();
