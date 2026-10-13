// Imports the foundations JSON exported by the Polaris components site into this file as:
//   - a "Polaris" color variable collection, one mode per Polaris version (re-running updates in place)
//   - text styles for the measured type hierarchy
//   - optionally, a specimen frame that uses both, as a visual check
// Bump when the plugin learns a new export kind, so a stale copy is easy to spot.
var PLUGIN_VERSION = '4 (foundations, components, screens)';
var KNOWN_KINDS = ['polaris-components', 'polaris-screens'];

figma.showUI(__html__, { width: 420, height: 460 });
figma.ui.postMessage({ type: 'version', version: PLUGIN_VERSION });

figma.ui.onmessage = async function (msg) {
  if (msg.type !== 'import') return;
  try {
    var kind = msg.data && msg.data.kind;
    if (kind && KNOWN_KINDS.indexOf(kind) === -1) {
      throw new Error('This is a "' + kind + '" export, which this plugin version (' + PLUGIN_VERSION + ') does not support. Update the plugin: re-import figma-plugin/manifest.json from the latest download.');
    }
    var report = kind === 'polaris-components' ? await buildComponents(msg.data, msg.options || {})
      : kind === 'polaris-screens' ? await buildScreens(msg.data)
      : await importFoundations(msg.data, msg.options || {});
    figma.ui.postMessage({ type: 'done', report: report });
    figma.notify(kind === 'polaris-components' ? 'Polaris components built' : kind === 'polaris-screens' ? 'Polaris screens built' : 'Polaris foundations imported');
  } catch (e) {
    var detail = e && e.message ? e.message : String(e);
    console.error(e);
    figma.ui.postMessage({ type: 'error', message: 'Import failed: ' + detail });
    figma.notify('Polaris import failed: ' + detail, { error: true });
  }
};

var COLLECTION_NAME = 'Polaris';

// ---------- colors ----------

function hexToRGBA(hex, alpha) {
  var n = parseInt(hex.replace('#', ''), 16);
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255, a: alpha == null ? 1 : alpha };
}

// Figma variable names cannot contain '.', '{', '}' or ':'; '/' makes groups.
function variableName(name) {
  return name.replace(/[.{}:$]/g, '-').split('/').map(function (p) { return p.trim(); }).filter(Boolean).join('/');
}

async function getCollectionAndMode(modeName, report) {
  var collections = await figma.variables.getLocalVariableCollectionsAsync();
  var collection = collections.filter(function (c) { return c.name === COLLECTION_NAME; })[0];
  if (!collection) {
    collection = figma.variables.createVariableCollection(COLLECTION_NAME);
    collection.renameMode(collection.modes[0].modeId, modeName);
    return { collection: collection, modeId: collection.modes[0].modeId };
  }
  var mode = collection.modes.filter(function (m) { return m.name === modeName; })[0];
  if (mode) return { collection: collection, modeId: mode.modeId };
  try {
    return { collection: collection, modeId: collection.addMode(modeName) };
  } catch (e) {
    // Plans with a single mode per collection: write into the existing mode instead.
    var first = collection.modes[0];
    report.push('Could not add a "' + modeName + '" mode (' + e.message + '). Values were written to the "' + first.name + '" mode instead.');
    return { collection: collection, modeId: first.modeId };
  }
}

async function importColors(items, prefix, ctx) {
  var existing = await figma.variables.getLocalVariablesAsync('COLOR');
  var byName = {};
  existing.forEach(function (v) {
    if (v.variableCollectionId === ctx.collection.id) byName[v.name] = v;
  });
  var created = 0, updated = 0, vars = [];
  items.forEach(function (item) {
    var name = variableName(prefix + '/' + item.name);
    var v = byName[name];
    if (v) updated++;
    else {
      v = figma.variables.createVariable(name, ctx.collection, 'COLOR');
      byName[name] = v;
      created++;
    }
    v.setValueForMode(ctx.modeId, hexToRGBA(item.hex, item.alpha));
    if (item.cssVar) v.setVariableCodeSyntax('WEB', 'var(' + item.cssVar + ')');
    vars.push({ variable: v, label: item.name });
  });
  return { created: created, updated: updated, vars: vars };
}

// ---------- text ----------

var WEIGHT_WORDS = [
  ['extralight', 200], ['ultralight', 200], ['extrabold', 800], ['ultrabold', 800],
  ['semibold', 600], ['demibold', 600], ['hairline', 100], ['thin', 100],
  ['light', 300], ['regular', 400], ['normal', 400], ['book', 400], ['roman', 400],
  ['medium', 500], ['bold', 700], ['heavy', 900], ['black', 900],
];

function styleWeight(style) {
  var s = style.toLowerCase().replace(/[\s-]/g, '');
  for (var i = 0; i < WEIGHT_WORDS.length; i++) if (s.indexOf(WEIGHT_WORDS[i][0]) !== -1) return WEIGHT_WORDS[i][1];
  return 400;
}

// System font keywords in a CSS stack, mapped to fonts a designer is likely to have.
var SYSTEM_FONTS = {
  '-apple-system': ['SF Pro Text', 'SF Pro'],
  'blinkmacsystemfont': ['SF Pro Text', 'SF Pro'],
  'system-ui': ['SF Pro Text', 'SF Pro', 'Segoe UI', 'Roboto'],
  'ui-sans-serif': ['SF Pro Text', 'SF Pro', 'Segoe UI', 'Roboto'],
};

function pickFont(stack, weight, available) {
  var families = {};
  available.forEach(function (f) {
    var key = f.fontName.family.toLowerCase();
    (families[key] = families[key] || { family: f.fontName.family, styles: [] }).styles.push(f.fontName.style);
  });
  var candidates = [];
  stack.split(',').forEach(function (raw) {
    var name = raw.replace(/["']/g, '').trim();
    var mapped = SYSTEM_FONTS[name.toLowerCase()];
    candidates = candidates.concat(mapped || [name]);
  });
  // Polaris' own families (e.g. ShopifyInter) are Inter-based, so Inter is the best stand-in
  // when the first family is missing; the rest of the CSS stack is system/script fallbacks.
  var first = stack.split(',')[0].replace(/["']/g, '').trim().toLowerCase();
  var firstCount = (SYSTEM_FONTS[first] || [first]).length;
  candidates.splice(firstCount, 0, 'Inter');
  for (var i = 0; i < candidates.length; i++) {
    var fam = families[candidates[i].toLowerCase()];
    if (!fam) continue;
    var upright = fam.styles.filter(function (s) { return !/italic|oblique/i.test(s); });
    if (!upright.length) continue;
    // Nearest weight; on a tie prefer the lighter style (e.g. 650 -> Semi Bold).
    var best = upright.slice().sort(function (a, b) {
      var da = Math.abs(styleWeight(a) - weight), db = Math.abs(styleWeight(b) - weight);
      return da - db || styleWeight(a) - styleWeight(b);
    })[0];
    return { fontName: { family: fam.family, style: best }, fallback: i > 0 };
  }
  return null;
}

function px(value) {
  var n = parseFloat(value);
  return isNaN(n) ? null : n;
}

// Text styles have no modes, so each Polaris version gets its own folder: "Polaris 2.0/Heading/Section".
async function importText(items, folder, report) {
  var available = await figma.listAvailableFontsAsync();
  var existing = await figma.getLocalTextStylesAsync();
  var byName = {};
  existing.forEach(function (s) { byName[s.name] = s; });
  var seenSpecs = {}, styles = [], created = 0, updated = 0;

  for (var i = 0; i < items.length; i++) {
    var t = items[i];
    var weight = parseInt(t.fontWeight, 10) || 400;
    var pick = pickFont(t.fontFamily, weight, available);
    if (!pick) { report.push('Skipped "' + t.name + '": no usable font for ' + t.fontFamily); continue; }
    var size = px(t.fontSize);
    var lh = px(t.lineHeight);
    var ls = px(t.letterSpacing) || 0;
    // Figma text styles carry no color, so styles that differ only by color collapse into one.
    var spec = [pick.fontName.family, pick.fontName.style, size, lh, ls].join('|');
    if (seenSpecs[spec]) { report.push('"' + t.name + '" renders with the same font, size and spacing as "' + seenSpecs[spec] + '"; reuse that style (with a different fill if the color differs).'); continue; }
    seenSpecs[spec] = t.name;

    await figma.loadFontAsync(pick.fontName);
    var styleName = folder + '/' + t.name;
    var style = byName[styleName];
    if (style) updated++; else { style = figma.createTextStyle(); created++; }
    style.name = styleName;
    style.fontName = pick.fontName;
    style.fontSize = size || 13;
    style.lineHeight = lh ? { unit: 'PIXELS', value: lh } : { unit: 'AUTO' };
    style.letterSpacing = { unit: 'PIXELS', value: ls };
    style.description = 'Measured from Polaris: ' + t.fontWeight + ' weight, color ' + (t.color || 'n/a');
    if (pick.fallback) report.push('"' + t.name + '": ' + t.fontFamily.split(',')[0].trim() + ' is not available in Figma, used ' + pick.fontName.family + ' ' + pick.fontName.style + '.');
    else if (styleWeight(pick.fontName.style) !== weight) report.push('"' + t.name + '": CSS weight ' + weight + ' mapped to "' + pick.fontName.style + '".');
    styles.push({ style: style, color: t.color });
  }
  return { created: created, updated: updated, styles: styles };
}

// ---------- specimen ----------

function autoFrame(name, direction, gap) {
  var f = figma.createFrame();
  f.name = name;
  f.layoutMode = direction;
  f.itemSpacing = gap;
  f.primaryAxisSizingMode = 'AUTO';
  f.counterAxisSizingMode = 'AUTO';
  f.fills = [];
  return f;
}

function label(text, size, bold) {
  var t = figma.createText();
  t.fontName = { family: 'Inter', style: bold ? 'Semi Bold' : 'Regular' };
  t.characters = text;
  t.fontSize = size;
  return t;
}

async function drawSpecimen(title, colorGroups, textStyles) {
  await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
  await figma.loadFontAsync({ family: 'Inter', style: 'Semi Bold' });

  var root = autoFrame(title, 'VERTICAL', 32);
  root.paddingLeft = root.paddingRight = root.paddingTop = root.paddingBottom = 40;
  root.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }];
  root.appendChild(label(title, 24, true));

  if (textStyles.length) {
    var type = autoFrame('Type', 'VERTICAL', 16);
    type.appendChild(label('Type', 16, true));
    for (var i = 0; i < textStyles.length; i++) {
      var s = textStyles[i].style;
      await figma.loadFontAsync(s.fontName);
      var t = figma.createText();
      t.characters = s.name;
      await t.setTextStyleIdAsync(s.id);
      if (textStyles[i].color) {
        var c = hexToRGBA(textStyles[i].color);
        t.fills = [{ type: 'SOLID', color: { r: c.r, g: c.g, b: c.b } }];
      }
      type.appendChild(t);
    }
    root.appendChild(type);
  }

  colorGroups.forEach(function (group) {
    if (!group.vars.length) return;
    var section = autoFrame(group.title, 'VERTICAL', 12);
    section.appendChild(label(group.title, 16, true));
    var grid = autoFrame('Swatches', 'HORIZONTAL', 12);
    grid.layoutWrap = 'WRAP';
    grid.counterAxisSpacing = 12;
    grid.primaryAxisSizingMode = 'FIXED';
    grid.resize(1040, grid.height);
    group.vars.forEach(function (entry) {
      var cell = autoFrame(entry.variable.name, 'VERTICAL', 6);
      var chip = figma.createRectangle();
      chip.resize(160, 56);
      chip.cornerRadius = 8;
      chip.strokes = [{ type: 'SOLID', color: { r: 0.89, g: 0.89, b: 0.89 } }];
      chip.fills = [figma.variables.setBoundVariableForPaint({ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }, 'color', entry.variable)];
      cell.appendChild(chip);
      cell.appendChild(label(entry.variable.name, 11, false));
      grid.appendChild(cell);
    });
    section.appendChild(grid);
    root.appendChild(section);
  });

  figma.currentPage.appendChild(root);
  root.x = figma.viewport.center.x - root.width / 2;
  root.y = figma.viewport.center.y - root.height / 2;
  figma.currentPage.selection = [root];
  figma.viewport.scrollAndZoomIntoView([root]);
}

// ---------- main ----------

async function importFoundations(data, options) {
  if (!data || !Array.isArray(data.colors) || !Array.isArray(data.text)) {
    throw new Error('This does not look like the foundations export (missing "colors" or "text").');
  }
  var report = [];
  var modeName = data.version || 'Polaris';
  var ctx = await getCollectionAndMode(modeName, report);

  var rendered = await importColors(data.colors, 'Rendered', ctx);
  var tokens = { created: 0, updated: 0, vars: [] };
  if (options.tokens && data.tokens && data.tokens.length) tokens = await importColors(data.tokens, 'Tokens', ctx);
  var text = await importText(data.text, modeName, report);

  report.unshift(
    'Mode "' + modeName + '" in collection "' + COLLECTION_NAME + '":',
    '  Rendered colors: ' + rendered.created + ' created, ' + rendered.updated + ' updated',
    '  Color tokens: ' + tokens.created + ' created, ' + tokens.updated + ' updated' + (data.tokens && data.tokens.length ? '' : ' (none in export)'),
    'Text styles in "' + modeName + '/": ' + text.created + ' created, ' + text.updated + ' updated',
    ''
  );

  if (options.specimen) {
    await drawSpecimen('Polaris foundations — ' + modeName, [
      { title: 'Rendered colors', vars: rendered.vars },
      { title: 'Color tokens', vars: tokens.vars },
    ], text.styles);
    report.push('', 'Specimen frame added to this page.');
  }
  return report;
}

// ---------- components ----------
// Rebuilds the capture sheet export (components-export.js) as native components: flex containers become
// auto layout, colors bind to the "Polaris" variables and text to the version's text styles when the
// values match exactly, and each set's variants are combined into a component set.

function colorKey(c) {
  function h(v) { return Math.round(v * 255).toString(16).padStart(2, '0'); }
  return h(c.r) + h(c.g) + h(c.b) + ':' + Math.round((c.a == null ? 1 : c.a) * 100);
}

async function makeBinder(version) {
  var colors = {}, styles = {};
  var collections = await figma.variables.getLocalVariableCollectionsAsync();
  var collection = collections.filter(function (c) { return c.name === COLLECTION_NAME; })[0];
  if (collection) {
    var mode = collection.modes.filter(function (m) { return m.name === version; })[0] || collection.modes[0];
    var vars = await figma.variables.getLocalVariablesAsync('COLOR');
    vars.forEach(function (v) {
      if (v.variableCollectionId !== collection.id) return;
      var val = v.valuesByMode[mode.modeId];
      if (!val || val.type === 'VARIABLE_ALIAS') return;
      var key = colorKey(val);
      (colors[key] = colors[key] || []).push(v);
    });
  }
  var textStyles = await figma.getLocalTextStylesAsync();
  textStyles.forEach(function (s) {
    if (s.name.indexOf(version + '/') !== 0) return;
    var lh = s.lineHeight.unit === 'PIXELS' ? s.lineHeight.value : 'auto';
    styles[[s.fontName.family, s.fontName.style, s.fontSize, lh].join('|')] = s;
  });
  return { colors: colors, styles: styles, hasVariables: !!collection, bound: 0, raw: 0 };
}

// Several variables can share a value (e.g. a button fill and an avatar text token are both
// #101010), so a value match alone can pick a misleading name. Rank candidates by how well the
// name fits the role the color plays here: fill, text or border.
var ROLE_WORDS = {
  fill: /(^|\/|-)(bg|fill|surface|background|button|badge|banner|box|card)/,
  text: /(^|\/|-)(text|label|link|fg|foreground)/,
  border: /(^|\/|-)(border|divider|stroke|outline)/,
};

function roleScore(name, role) {
  var n = name.toLowerCase();
  var fits = ROLE_WORDS[role].test(n);
  var clashes = Object.keys(ROLE_WORDS).some(function (r) { return r !== role && ROLE_WORDS[r].test(n) && !fits; });
  var score = n.indexOf('rendered/') === 0 ? 50 : 0;
  if (fits) score += 40;
  if (clashes) score -= 40;
  if (/-[0-9a-f]{5}$/.test(n)) score -= 10; // generated hash suffixes read as noise
  return score;
}

function paint(c, binder, role) {
  if (c.type === 'gradient') {
    binder.raw++;
    return {
      type: c.kind === 'radial' ? 'GRADIENT_RADIAL' : 'GRADIENT_LINEAR',
      gradientTransform: c.transform,
      gradientStops: c.stops.map(function (s) {
        return { position: Math.min(1, Math.max(0, s.position)), color: s.color };
      }),
    };
  }
  var solid = { type: 'SOLID', color: { r: c.r, g: c.g, b: c.b }, opacity: c.a == null ? 1 : c.a };
  var candidates = binder.colors[colorKey(c)];
  if (candidates && candidates.length) {
    var best = candidates.slice().sort(function (a, b) {
      return roleScore(b.name, role) - roleScore(a.name, role) || a.name.length - b.name.length;
    })[0];
    // Only bind when the name plausibly describes this use; a raw value beats a wrong name.
    if (roleScore(best.name, role) >= 0) {
      binder.bound++;
      return figma.variables.setBoundVariableForPaint({ type: 'SOLID', color: solid.color }, 'color', best);
    }
  }
  binder.raw++;
  return solid;
}

var JUSTIFY = { 'flex-start': 'MIN', start: 'MIN', left: 'MIN', normal: 'MIN', center: 'CENTER', 'flex-end': 'MAX', end: 'MAX', right: 'MAX', 'space-between': 'SPACE_BETWEEN' };
var ALIGN = { 'flex-start': 'MIN', start: 'MIN', 'self-start': 'MIN', normal: 'MIN', stretch: 'MIN', center: 'CENTER', 'flex-end': 'MAX', end: 'MAX', 'self-end': 'MAX', baseline: 'BASELINE' };

function size(n, w, h) { n.resize(Math.max(w, 0.01), Math.max(h, 0.01)); }

// CSS lists shadows top-first; Figma's effects list draws later entries on top, like fills.
function toEffects(list) {
  return (list || []).slice().reverse().map(function (e) {
    return { type: e.inset ? 'INNER_SHADOW' : 'DROP_SHADOW', color: e.color, offset: { x: e.x, y: e.y }, radius: e.blur, spread: e.spread, visible: true, blendMode: 'NORMAL' };
  });
}

function applyBox(frame, node, binder) {
  frame.name = node.name;
  var fills = node.fills || (node.fill ? [node.fill] : []);
  frame.fills = fills.map(function (f) { return paint(f, binder, 'fill'); });
  if (node.stroke) {
    frame.strokes = [paint(node.stroke.color, binder, 'border')];
    frame.strokeAlign = 'INSIDE';
    frame.strokeTopWeight = node.stroke.widths[0];
    frame.strokeRightWeight = node.stroke.widths[1];
    frame.strokeBottomWeight = node.stroke.widths[2];
    frame.strokeLeftWeight = node.stroke.widths[3];
  } else {
    frame.strokes = [];
  }
  var r = node.radius || [0, 0, 0, 0];
  frame.topLeftRadius = r[0] || 0;
  frame.topRightRadius = r[1] || 0;
  frame.bottomRightRadius = r[2] || 0;
  frame.bottomLeftRadius = r[3] || 0;
  frame.effects = toEffects(node.effects);
  if (node.opacity != null && node.opacity < 1) frame.opacity = node.opacity;
  frame.clipsContent = !!node.clip;
}

// Every node the builder creates is tagged with its kind, so a re-import can recognise and reuse
// it. Reusing nodes keeps their ids, which is what keeps instance overrides (e.g. a button label
// changed to "Save") alive across library updates.
var KIND_KEY = 'polarisKind';
function tag(n, kind) { n.setPluginData(KIND_KEY, kind); return n; }
function reusable(existing, node) {
  if (!existing) return false;
  // Nodes built before kinds were tagged: infer the kind from the node type.
  var kind = existing.getPluginData(KIND_KEY) ||
    (existing.type === 'TEXT' ? 'text' : existing.type === 'RECTANGLE' && existing.name === 'Image' ? 'image' : existing.type === 'FRAME' ? 'frame' : '');
  if (node.type === 'text') return kind === 'text' && existing.type === 'TEXT';
  if (node.type === 'image') return kind === 'image' && existing.type === 'RECTANGLE';
  if (node.type === 'frame') return kind === 'frame' && existing.type === 'FRAME';
  return false; // vectors are always rebuilt: their geometry can't be updated in place
}

async function loadExistingFonts(t) {
  if (!t.characters.length) return;
  var fonts = t.fontName === figma.mixed ? t.getRangeAllFontNames(0, t.characters.length) : [t.fontName];
  for (var i = 0; i < fonts.length; i++) await figma.loadFontAsync(fonts[i]);
}

async function buildText(node, ctx, existing) {
  var t = existing || tag(figma.createText(), 'text');
  if (existing) await loadExistingFonts(existing);
  var key = node.fontFamily + '|' + node.fontWeight + '|' + node.italic;
  var font = ctx.fonts[key];
  if (font === undefined) {
    var pick = pickFont(node.fontFamily, node.fontWeight, ctx.available);
    font = pick ? pick.fontName : null;
    if (font && node.italic) {
      var italic = ctx.available.filter(function (f) { return f.fontName.family === font.family && /italic/i.test(f.fontName.style) && styleWeight(f.fontName.style) === styleWeight(font.style); })[0];
      if (italic) font = italic.fontName;
    }
    if (font) await figma.loadFontAsync(font);
    if (pick && pick.fallback) ctx.fallbacks[node.fontFamily.split(',')[0].trim() + ' → ' + font.family] = 1;
    ctx.fonts[key] = font;
  }
  var style = font && ctx.binder.styles[[font.family, font.style, node.fontSize, node.lineHeight].join('|')];
  if (!style && t.textStyleId) await t.setTextStyleIdAsync('');
  if (font) t.fontName = font;
  if (t.characters !== node.characters) t.characters = node.characters;
  t.name = node.name || node.characters.slice(0, 24);
  if (style) {
    await t.setTextStyleIdAsync(style.id);
    ctx.textStyled++;
  } else {
    t.fontSize = node.fontSize;
    t.lineHeight = { unit: 'PIXELS', value: node.lineHeight };
    t.letterSpacing = { unit: 'PIXELS', value: node.letterSpacing || 0 };
  }
  // No color = hidden in the browser (e.g. a loading button's label under its spinner).
  if (node.color) t.fills = [paint(node.color, ctx.binder, 'text')];
  else { t.fills = []; t.name = (node.name || 'Text') + ' (hidden)'; }
  t.textDecoration = node.underline ? 'UNDERLINE' : 'NONE';
  t.textAlignHorizontal = node.align === 'center' ? 'CENTER' : node.align === 'right' || node.align === 'end' ? 'RIGHT' : 'LEFT';
  if (node.wrap) {
    t.textAutoResize = 'HEIGHT';
    size(t, node.w, node.h);
  } else {
    t.textAutoResize = 'WIDTH_AND_HEIGHT';
  }
  return t;
}

function buildSvg(node, ctx) {
  try {
    var f = tag(figma.createNodeFromSvg(node.svg), 'svg');
    f.name = node.name === 'svg' ? 'Icon' : node.name;
    size(f, node.w, node.h);
    // An empty-fill frame casts its shadow from its vectors, which is what filter: drop-shadow does.
    if (node.effects && node.effects.length) f.effects = toEffects(node.effects);
    return f;
  } catch (e) {
    ctx.svgFailures++;
    var r = tag(figma.createRectangle(), 'svg');
    r.name = 'Icon (could not import SVG)';
    size(r, node.w, node.h);
    r.fills = [{ type: 'SOLID', color: { r: 0.8, g: 0.8, b: 0.8 } }];
    return r;
  }
}

// CSS margins are invisible to auto layout, so take spacing from the measured positions instead
// of the CSS gap. Uneven spacing can't be expressed as one item spacing: return null and the
// frame is built with absolute positions instead, which keeps the rendered layout exact.
function measuredLayout(node, L) {
  if (L.wrap) return L;
  var row = L.direction === 'row';
  var start = row ? 'x' : 'y', extent = row ? 'w' : 'h';
  var flow = node.children.filter(function (c) { return c.position !== 'absolute'; });
  if (!flow.length) return L;
  var out = Object.assign({}, L, { padding: L.padding.slice() });
  var distributed = /space-(between|around|evenly)/.test(L.justify);
  if (flow.length > 1 && !distributed) {
    var gaps = [];
    for (var i = 1; i < flow.length; i++) gaps.push(flow[i][start] - (flow[i - 1][start] + flow[i - 1][extent]));
    var min = Math.min.apply(null, gaps), max = Math.max.apply(null, gaps);
    if (max - min > 1.5 || min < -0.5) return null;
    out.gap = Math.round((min + max) / 2);
  }
  // Leading margin on the first item, when items pack to the start.
  if ((JUSTIFY[L.justify] || 'MIN') === 'MIN') {
    var lead = flow[0][start] - node[start];
    var p = row ? 3 : 0;
    if (lead > out.padding[p] + 0.5) out.padding[p] = Math.round(lead);
  }
  return out;
}

// Builds `node` into `target` when given (an existing frame or component), else into a new frame.
// Children are reconciled by position: an existing child of the same kind and name is updated in
// place; anything else is created fresh, and leftovers are removed.
// A library component placed in a screen: an instance of the matching variant with its label
// overridden, or, if the library doesn't have it, the rendered fallback built as plain layers.
async function buildInstance(node, ctx) {
  var set = ctx.library && ctx.library[node.set];
  var comp = set && set[variantKey(node.variant)];
  if (!comp) {
    ctx.missingInstances[node.set + ' / ' + node.variant] = 1;
    return buildNode(node.fallback, ctx);
  }
  var inst = comp.createInstance();
  if (node.label) {
    var texts = inst.findAll(function (n) { return n.type === 'TEXT' && n.fills !== figma.mixed && n.fills.length; });
    if (texts.length && texts[0].characters !== node.label) {
      await loadExistingFonts(texts[0]);
      texts[0].characters = node.label;
    }
  }
  ctx.instances++;
  return inst;
}

async function buildNode(node, ctx, target) {
  if (node.type === 'instance') return buildInstance(node, ctx);
  if (node.type === 'text') return buildText(node, ctx, target);
  if (node.type === 'svg') return buildSvg(node, ctx);
  if (node.type === 'image') {
    var img = target || tag(figma.createRectangle(), 'image');
    img.name = 'Image';
    size(img, node.w, node.h);
    img.cornerRadius = (node.radius && node.radius[0]) || 0;
    img.fills = [{ type: 'SOLID', color: { r: 0.85, g: 0.85, b: 0.85 } }];
    return img;
  }

  var frame = target || tag(figma.createFrame(), 'frame');
  applyBox(frame, node, ctx.binder);
  var L = node.layout ? measuredLayout(node, node.layout) : null;
  if (node.layout && !L) ctx.absoluteLayouts++;
  if (L) {
    frame.layoutMode = L.direction === 'row' ? 'HORIZONTAL' : 'VERTICAL';
    frame.itemSpacing = L.gap;
    frame.paddingTop = L.padding[0];
    frame.paddingRight = L.padding[1];
    frame.paddingBottom = L.padding[2];
    frame.paddingLeft = L.padding[3];
    frame.primaryAxisAlignItems = JUSTIFY[L.justify] || 'MIN';
    var align = ALIGN[L.align] || 'MIN';
    frame.counterAxisAlignItems = align === 'BASELINE' && frame.layoutMode !== 'HORIZONTAL' ? 'MIN' : align;
    if (frame.layoutMode === 'HORIZONTAL') {
      frame.layoutWrap = L.wrap ? 'WRAP' : 'NO_WRAP';
      if (L.wrap) frame.counterAxisSpacing = L.crossGap;
    }
    frame.primaryAxisSizingMode = 'FIXED';
    frame.counterAxisSizingMode = 'FIXED';
  } else {
    frame.layoutMode = 'NONE';
  }
  size(frame, node.w, node.h);

  var old = frame.children.slice(), used = [];
  var built = [];
  for (var i = 0; i < node.children.length; i++) {
    var childNode = node.children[i];
    var candidate = reusable(old[i], childNode) && old[i].name.replace(/ \(hidden\)$/, '') === (childNode.name || old[i].name).replace(/ \(hidden\)$/, '') ? old[i] : null;
    var child = await buildNode(childNode, ctx, candidate);
    if (candidate) { used.push(candidate); ctx.reused++; tag(candidate, childNode.type); } else ctx.created++;
    frame.insertChild(i, child);
    if (L) {
      child.layoutPositioning = childNode.position === 'absolute' ? 'ABSOLUTE' : 'AUTO';
      if (childNode.position !== 'absolute') {
        child.layoutAlign = 'INHERIT';
        child.layoutGrow = 0;
      } else {
        child.x = childNode.x - node.x;
        child.y = childNode.y - node.y;
      }
    } else {
      child.x = childNode.x - node.x;
      child.y = childNode.y - node.y;
    }
    built.push({ node: childNode, child: child });
  }
  old.forEach(function (o) { if (used.indexOf(o) === -1 && !o.removed) { o.remove(); ctx.removed++; } });

  // Figma only applies shadow spread to frames that clip their content. Polaris uses spread for
  // tight shadows (negative) and for 1px rings in place of borders (checkboxes), so turn clipping
  // on when the content stays inside the box anyway.
  var spread = (node.effects || []).some(function (e) { return e.spread; });
  if (spread && node.children.every(function (ch) {
    return ch.x >= node.x - 0.5 && ch.y >= node.y - 0.5 && ch.x + ch.w <= node.x + node.w + 0.5 && ch.y + ch.h <= node.y + node.h + 0.5;
  })) frame.clipsContent = true;

  if (L) {
    var horizontal = frame.layoutMode === 'HORIZONTAL';
    // In columns, children that span the full inner width become "fill" so the component resizes
    // properly; that needs a fixed width on this frame. Everything else hugs where hugging
    // reproduces the measured size, and keeps the measured size where it does not.
    var innerWidth = node.w - L.padding[1] - L.padding[3];
    var stretchers = horizontal ? [] : built.filter(function (b) {
      return b.node.position !== 'absolute' && (L.align === 'stretch' || L.align === 'normal') &&
        /auto|stretch|normal/.test(b.node.alignSelf || 'auto') && Math.abs(b.node.w - innerWidth) <= 1.5;
    });
    // A wrapping row only wraps at a fixed width; hugging would put every item on one line.
    frame.primaryAxisSizingMode = L.wrap ? 'FIXED' : 'AUTO';
    frame.counterAxisSizingMode = stretchers.length ? 'FIXED' : 'AUTO';
    var primaryOk = !L.wrap && Math.abs((horizontal ? frame.width : frame.height) - (horizontal ? node.w : node.h)) <= 1.5;
    var counterOk = stretchers.length || Math.abs((horizontal ? frame.height : frame.width) - (horizontal ? node.h : node.w)) <= 1.5;
    if (!primaryOk) frame.primaryAxisSizingMode = 'FIXED';
    if (!counterOk) frame.counterAxisSizingMode = 'FIXED';
    if (frame.primaryAxisSizingMode === 'FIXED' || frame.counterAxisSizingMode === 'FIXED') {
      size(frame,
        horizontal ? (primaryOk ? frame.width : node.w) : (stretchers.length || !counterOk ? node.w : frame.width),
        horizontal ? (counterOk ? frame.height : node.h) : (primaryOk ? frame.height : node.h));
    }
    stretchers.forEach(function (b) { b.child.layoutAlign = 'STRETCH'; });
    if (frame.primaryAxisSizingMode === 'FIXED') {
      built.forEach(function (b) { if (b.node.position !== 'absolute' && b.node.grow > 0) b.child.layoutGrow = 1; });
    }
  }
  return frame;
}

// "Tone=Auto, Variant=Primary" and "Variant=Primary, Tone=Auto" are the same variant.
function variantKey(name) {
  return name.split(',').map(function (p) { return p.trim().toLowerCase().replace(/\s*=\s*/, '='); }).sort().join('|');
}

async function findComponentsPage(name) {
  var pages = figma.root.children.filter(function (p) { return p.name === name; });
  if (pages.length) await pages[0].loadAsync();
  return { page: pages[0] || null, duplicates: Math.max(0, pages.length - 1) };
}

function layoutSet(cs) {
  cs.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }];
  cs.clipsContent = false;
  var widest = cs.children.reduce(function (m, c) { return Math.max(m, c.width); }, 0);
  cs.layoutMode = 'HORIZONTAL';
  cs.layoutWrap = 'WRAP';
  cs.itemSpacing = 24;
  cs.counterAxisSpacing = 24;
  cs.paddingTop = cs.paddingRight = cs.paddingBottom = cs.paddingLeft = 24;
  cs.primaryAxisSizingMode = 'FIXED';
  cs.counterAxisSizingMode = 'AUTO';
  size(cs, Math.max(1200, widest + 48), cs.height);
}

async function buildVariant(item, set, ctx, comp) {
  var root = item.tree;
  if (root.children.length === 1) {
    // Wrap the component in a vertical auto layout so it hugs (or stretches to a fixed width).
    root = Object.assign({}, root, {
      layout: { direction: 'column', gap: 0, crossGap: 0, padding: [0, 0, 0, 0], justify: 'flex-start', align: set.fixedWidth ? 'stretch' : 'flex-start', wrap: false },
    });
  }
  await buildNode(root, ctx, comp);
  if (set.fixedWidth && comp.layoutMode !== 'NONE') {
    comp.counterAxisSizingMode = 'FIXED';
    size(comp, set.fixedWidth, comp.height);
    comp.children.forEach(function (c) { if ('layoutAlign' in c) c.layoutAlign = 'STRETCH'; });
  }
}

async function buildComponents(data, options) {
  if (!Array.isArray(data.sets)) throw new Error('This does not look like the components export (missing "sets").');
  options = options || {};
  await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
  var ctx = {
    binder: await makeBinder(data.version),
    available: await figma.listAvailableFontsAsync(),
    fonts: {}, fallbacks: {}, svgFailures: 0, textStyled: 0, absoluteLayouts: 0,
    reused: 0, created: 0, removed: 0,
  };

  var pageName = data.version + ' components';
  var found = options.inPlace === false ? { page: null, duplicates: 0 } : await findComponentsPage(pageName);
  var page = found.page, updating = !!page;
  if (!page) {
    page = figma.createPage();
    page.name = pageName;
    page.backgrounds = [{ type: 'SOLID', color: { r: 0.945, g: 0.945, b: 0.945 } }];
  }
  await figma.setCurrentPageAsync(page);

  var y = page.children.reduce(function (m, n) { return Math.max(m, n.y + n.height + 120); }, 0);
  var variants = 0, sets = 0, emptyVariants = 0, updatedVariants = 0, addedVariants = 0, newSets = 0, stale = [];
  for (var s = 0; s < data.sets.length; s++) {
    var set = data.sets[s];
    if (!set.items.length) continue;
    figma.ui.postMessage({ type: 'progress', text: (updating ? 'Updating ' : 'Building ') + set.name + ' (' + (s + 1) + ' of ' + data.sets.length + ')…' });
    var existing = updating ? page.children.filter(function (n) { return n.type === 'COMPONENT_SET' && n.name === set.name; })[0] : null;
    var byKey = {};
    if (existing) existing.children.forEach(function (c) { byKey[variantKey(c.name)] = c; });
    var comps = [], seen = {};
    for (var i = 0; i < set.items.length; i++) {
      var item = set.items[i];
      if (!item.tree.children.length) emptyVariants++;
      var key = variantKey(item.variant);
      seen[key] = true;
      var comp = byKey[key];
      if (comp) {
        updatedVariants++;
      } else {
        comp = figma.createComponent();
        if (existing) addedVariants++;
      }
      await buildVariant(item, set, ctx, comp);
      comp.name = item.variant;
      if (existing && !byKey[key]) existing.appendChild(comp);
      if (!existing) { page.appendChild(comp); comps.push(comp); }
      variants++;
    }
    var cs = existing;
    if (!cs) {
      cs = figma.combineAsVariants(comps, page);
      cs.name = set.name;
      cs.x = 0;
      cs.y = y;
      newSets++;
    } else {
      existing.children.forEach(function (c) { if (!seen[variantKey(c.name)]) stale.push(set.name + ' / ' + c.name); });
    }
    layoutSet(cs);
    if (!existing) y += cs.height + 120;
    sets++;
  }
  figma.viewport.scrollAndZoomIntoView(page.children);

  var report = [
    updating
      ? 'Updated page "' + page.name + '" in place: ' + updatedVariants + ' variants updated, ' + addedVariants + ' variants added, ' + newSets + ' new sets. Republish the library to roll this out.'
      : 'Built ' + sets + ' component sets (' + variants + ' variants) on new page "' + page.name + '".',
    updating ? 'Layers: ' + ctx.reused + ' reused (instance overrides kept), ' + ctx.created + ' created, ' + ctx.removed + ' removed.' : null,
    'Export: ' + (data.exportVersion ? 'v' + data.exportVersion : 'OLD FORMAT — re-export from the latest capture page') + ', captured ' + (data.capturedAt || '?') + '.',
    ctx.binder.hasVariables
      ? 'Colors: ' + ctx.binder.bound + ' bound to Polaris variables, ' + ctx.binder.raw + ' left as raw values (no variable with that value and a fitting name).'
      : 'No "Polaris" variable collection found, so colors are raw values. Import the foundations first to bind them.',
    'Text layers using your text styles: ' + ctx.textStyled + '.',
    'Containers kept as fixed positions (uneven spacing auto layout cannot express): ' + ctx.absoluteLayouts + '.',
  ].filter(function (l) { return l !== null; });
  if (found.duplicates) report.unshift('Note: ' + (found.duplicates + 1) + ' pages are named "' + pageName + '"; the first one was updated. Delete the others to avoid confusion.', '');
  if (stale.length) report.push('Not in this export, left untouched (instances may use them; delete by hand if unused): ' + stale.slice(0, 10).join('; ') + (stale.length > 10 ? ' … and ' + (stale.length - 10) + ' more' : '') + '.');
  Object.keys(ctx.fallbacks).forEach(function (f) { report.push('Font fallback: ' + f + '.'); });
  if (emptyVariants) report.unshift('WARNING: ' + emptyVariants + ' of ' + variants + ' variants were empty in the export, so their components are empty. Re-export from the latest capture page.', '');
  if (ctx.svgFailures) report.push(ctx.svgFailures + ' icons could not be imported and are grey placeholders.');
  report.push('Images (avatars, thumbnails) are grey placeholders; drop real images in as fills.');
  report.push('', '--- Diagnostics (copy everything below to Claude) ---');
  report = report.concat(await diagnose(page));
  return report;
}

// ---------- screens ----------
// Whole layouts (dashboard.html) built as frames on a "<version> templates" page, using instances
// of the library's components wherever the page marked them. Templates are starting points that
// designers duplicate, so a re-import replaces a screen of the same name rather than merging.

async function libraryIndex(version) {
  var found = await findComponentsPage(version + ' components');
  var index = {};
  if (!found.page) return null;
  found.page.children.forEach(function (set) {
    if (set.type !== 'COMPONENT_SET') return;
    index[set.name] = {};
    set.children.forEach(function (comp) { index[set.name][variantKey(comp.name)] = comp; });
  });
  return index;
}

async function buildScreens(data) {
  if (!Array.isArray(data.screens)) throw new Error('This does not look like the screens export (missing "screens").');
  await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
  var ctx = {
    binder: await makeBinder(data.version),
    available: await figma.listAvailableFontsAsync(),
    library: await libraryIndex(data.version),
    fonts: {}, fallbacks: {}, svgFailures: 0, textStyled: 0, absoluteLayouts: 0,
    reused: 0, created: 0, removed: 0, instances: 0, missingInstances: {},
  };
  var pageName = data.version + ' templates';
  var page = figma.root.children.filter(function (p) { return p.name === pageName; })[0];
  if (page) await page.loadAsync();
  else {
    page = figma.createPage();
    page.name = pageName;
    page.backgrounds = [{ type: 'SOLID', color: { r: 0.9, g: 0.9, b: 0.9 } }];
  }
  await figma.setCurrentPageAsync(page);

  var built = [], x = 0;
  for (var i = 0; i < data.screens.length; i++) {
    var screen = data.screens[i];
    figma.ui.postMessage({ type: 'progress', text: 'Building ' + screen.name + '…' });
    var old = page.children.filter(function (n) { return n.name === screen.name; })[0];
    var frame = await buildNode(screen.tree, ctx);
    frame.name = screen.name;
    frame.clipsContent = true;
    if (old) { frame.x = old.x; frame.y = old.y; old.remove(); }
    else { frame.x = x; frame.y = 0; }
    page.appendChild(frame);
    x = Math.max(x, frame.x + frame.width + 160);
    built.push(frame);
  }
  figma.currentPage.selection = built;
  figma.viewport.scrollAndZoomIntoView(built);

  var missing = Object.keys(ctx.missingInstances);
  var report = [
    'Built ' + built.length + ' screens on page "' + pageName + '": ' + built.map(function (f) { return f.name; }).join(', ') + '.',
    ctx.library
      ? 'Library instances: ' + ctx.instances + ' (they update with the components).'
      : 'No "' + data.version + ' components" page in this file, so components were drawn as plain layers. Build the components first, or enable the published library, to get instances.',
    missing.length ? 'Not found in the library, drawn as plain layers instead: ' + missing.join('; ') + '.' : null,
    ctx.binder.hasVariables ? 'Colors: ' + ctx.binder.bound + ' bound to Polaris variables, ' + ctx.binder.raw + ' raw.' : null,
    'The side navigation, search, store picker and Sidekick bar are an approximation of the new admin frame: compare with your own admin before relying on exact sizes.',
  ].filter(function (l) { return l !== null; });
  Object.keys(ctx.fallbacks).forEach(function (f) { report.push('Font fallback: ' + f + '.'); });
  return report;
}

// ---------- diagnostics ----------
// Describes what Figma actually built, so problems can be diagnosed from the report alone.

function hex2(n) { return Math.round(n * 255).toString(16).padStart(2, '0'); }

async function describePaints(paints) {
  if (!paints || paints === figma.mixed || !paints.length) return 'none';
  var out = [];
  for (var i = 0; i < paints.length; i++) {
    var p = paints[i];
    if (p.type !== 'SOLID') { out.push(p.type); continue; }
    var c = p.color, a = p.opacity == null ? 1 : p.opacity, via = '';
    if (p.boundVariables && p.boundVariables.color) {
      var v = await figma.variables.getVariableByIdAsync(p.boundVariables.color.id);
      if (v) {
        var coll = await figma.variables.getVariableCollectionByIdAsync(v.variableCollectionId);
        var val = v.valuesByMode[coll.defaultModeId];
        via = ' var:' + v.name;
        if (val && val.r != null) { c = val; a = val.a == null ? 1 : val.a; }
        else via += '(no value in default mode)';
      }
    }
    out.push('#' + hex2(c.r) + hex2(c.g) + hex2(c.b) + (a < 1 ? '@' + Math.round(a * 100) + '%' : '') + (p.visible === false ? '(hidden)' : '') + via);
  }
  return out.join(' + ');
}

async function diagnose(page) {
  var lines = [];
  var sets = page.children.filter(function (n) { return n.type === 'COMPONENT_SET'; });
  var outside = 0, hidden = 0, transparent = 0, zero = 0, total = 0;
  sets.forEach(function (set) {
    set.children.forEach(function (comp) {
      var cb = comp.absoluteBoundingBox;
      comp.findAll(function () { return true; }).forEach(function (n) {
        total++;
        var b = n.absoluteBoundingBox;
        if (b && cb && (b.x < cb.x - 1 || b.y < cb.y - 1 || b.x + b.width > cb.x + cb.width + 1 || b.y + b.height > cb.y + cb.height + 1)) outside++;
        if (n.visible === false || n.opacity === 0) hidden++;
        if (n.width < 0.5 || n.height < 0.5) zero++;
        if (n.fills && n.fills !== figma.mixed && n.fills.length && n.fills.every(function (p) { return p.opacity === 0 || p.visible === false; })) transparent++;
      });
    });
  });
  lines.push('Layers inside components: ' + total + '; outside their component: ' + outside + '; hidden/opacity 0: ' + hidden + '; transparent fills: ' + transparent + '; zero-size: ' + zero + '.');
  var first = sets[0] && sets[0].children[0];
  if (first) {
    lines.push('First variant "' + first.name + '" (' + Math.round(first.width) + 'x' + Math.round(first.height) + '):');
    var queue = [{ n: first, d: 0 }], shown = 0;
    while (queue.length && shown < 25) {
      var item = queue.shift(), n = item.n;
      var bits = [Array(item.d + 1).join('  ') + n.type + ' "' + n.name + '"', 'x' + Math.round(n.x) + ' y' + Math.round(n.y), Math.round(n.width) + 'x' + Math.round(n.height)];
      if (n.layoutMode && n.layoutMode !== 'NONE') bits.push(n.layoutMode + ' ' + n.primaryAxisSizingMode + '/' + n.counterAxisSizingMode);
      if (n.visible === false) bits.push('HIDDEN');
      if (n.opacity < 1) bits.push('opacity ' + n.opacity);
      if ('fills' in n) bits.push('fill ' + await describePaints(n.fills));
      if (n.type === 'TEXT') bits.push('"' + n.characters + '" ' + (n.fontName !== figma.mixed ? n.fontName.family + ' ' + n.fontName.style : 'mixed') + ' ' + String(n.fontSize));
      lines.push(bits.join(' · '));
      shown++;
      if ('children' in n) n.children.forEach(function (ch) { queue.splice(queue.length, 0, { n: ch, d: item.d + 1 }); });
    }
  }
  return lines;
}
