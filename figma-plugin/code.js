// Imports the foundations JSON exported by the Polaris components site into this file as:
//   - a "Polaris" color variable collection, one mode per Polaris version (re-running updates in place)
//   - text styles for the measured type hierarchy
//   - optionally, a specimen frame that uses both, as a visual check
figma.showUI(__html__, { width: 420, height: 420 });

figma.ui.onmessage = async function (msg) {
  if (msg.type !== 'import') return;
  try {
    var report = await importFoundations(msg.data, msg.options || {});
    figma.ui.postMessage({ type: 'done', report: report });
    figma.notify('Polaris foundations imported');
  } catch (e) {
    figma.ui.postMessage({ type: 'error', message: 'Import failed: ' + (e && e.message ? e.message : String(e)) });
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
  candidates.push('Inter');
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
