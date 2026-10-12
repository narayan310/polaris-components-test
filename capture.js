// Builds the capture sheet: one frame per component variant, captioned in Figma's
// "Property=Value, Property=Value" naming so captured frames combine straight into variant sets.
(function () {
  'use strict';

  var SETS = [];

  // props: [['Variant', 'Primary'], ...]; width: fixed px width for components that fill their container.
  function set(name, note, width) {
    var s = { name: name, note: note, width: width, items: [] };
    SETS.push(s);
    return function (props, html) { s.items.push({ props: props, html: html }); };
  }

  function cap(word) { return word.charAt(0).toUpperCase() + word.slice(1); }
  function attr(name, value) { return value ? ' ' + name + '="' + value + '"' : ''; }
  function flag(name, on) { return on ? ' ' + name : ''; }

  var IMG = 'https://picsum.photos/id/21/200/200';

  // ---- Actions ----
  var button = set('Button', 'Variant × Tone × State.');
  ['primary', 'secondary', 'tertiary'].forEach(function (v) {
    ['auto', 'critical', 'neutral'].forEach(function (tone) {
      ['default', 'disabled', 'loading'].forEach(function (state) {
        button([['Variant', cap(v)], ['Tone', cap(tone)], ['State', cap(state)]],
          '<s-button variant="' + v + '"' + attr('tone', tone === 'auto' ? '' : tone) + flag('disabled', state === 'disabled') + flag('loading', state === 'loading') + '>Button</s-button>');
      });
    });
  });

  var iconButton = set('Button / Icon', 'Leading icon and icon-only buttons.');
  ['primary', 'secondary', 'tertiary'].forEach(function (v) {
    iconButton([['Variant', cap(v)], ['Layout', 'Leading icon']], '<s-button variant="' + v + '" icon="plus">Button</s-button>');
    iconButton([['Variant', cap(v)], ['Layout', 'Icon only']], '<s-button variant="' + v + '" icon="edit" accessibilityLabel="Edit"></s-button>');
  });

  var link = set('Link');
  ['auto', 'critical', 'neutral'].forEach(function (tone) {
    link([['Tone', cap(tone)]], '<s-link href="#"' + attr('tone', tone === 'auto' ? '' : tone) + '>Link text</s-link>');
  });

  // ---- Feedback ----
  var badge = set('Badge', 'Tone × Color × Size.');
  ['auto', 'info', 'success', 'caution', 'warning', 'critical', 'neutral'].forEach(function (tone) {
    ['base', 'strong'].forEach(function (color) {
      ['base', 'large'].forEach(function (size) {
        badge([['Tone', cap(tone)], ['Color', cap(color)], ['Size', cap(size)]],
          '<s-badge' + attr('tone', tone === 'auto' ? '' : tone) + attr('color', color === 'base' ? '' : color) + attr('size', size === 'base' ? '' : size) + '>Badge</s-badge>');
      });
    });
  });

  var banner = set('Banner', 'Tone × Heading. Fixed at 560px wide.', 560);
  ['auto', 'info', 'success', 'warning', 'critical'].forEach(function (tone) {
    banner([['Tone', cap(tone)], ['Heading', 'Yes']],
      '<s-banner tone="' + tone + '" heading="Banner heading" dismissible>Supporting message for the banner.<s-button slot="secondary-actions">Action</s-button></s-banner>');
    banner([['Tone', cap(tone)], ['Heading', 'No']], '<s-banner tone="' + tone + '">Supporting message for the banner.</s-banner>');
  });

  var spinner = set('Spinner');
  ['base', 'large'].forEach(function (size) {
    spinner([['Size', cap(size)]], '<s-spinner size="' + size + '" accessibilityLabel="Loading"></s-spinner>');
  });

  // ---- Chips ----
  var chip = set('Chip');
  ['base', 'subdued', 'strong'].forEach(function (c) {
    chip([['Color', cap(c)]], '<s-chip' + attr('color', c === 'base' ? '' : c) + '>Chip</s-chip>');
  });

  var clickableChip = set('Clickable chip');
  ['base', 'strong'].forEach(function (c) {
    [false, true].forEach(function (removable) {
      clickableChip([['Color', cap(c)], ['Removable', removable ? 'Yes' : 'No']],
        '<s-clickable-chip' + attr('color', c === 'base' ? '' : c) + flag('removable', removable) + ' accessibilityLabel="Filter">Filter</s-clickable-chip>');
    });
  });

  // ---- Media ----
  var avatar = set('Avatar');
  ['small', 'base', 'large'].forEach(function (size) {
    avatar([['Size', cap(size)], ['Content', 'Initials']], '<s-avatar size="' + size + '" initials="JD" alt="Jane Doe"></s-avatar>');
    avatar([['Size', cap(size)], ['Content', 'Image']], '<s-avatar size="' + size + '" src="https://picsum.photos/id/64/120/120" alt="Photo"></s-avatar>');
    avatar([['Size', cap(size)], ['Content', 'Empty']], '<s-avatar size="' + size + '" alt="Customer"></s-avatar>');
  });

  var thumbnail = set('Thumbnail');
  ['small', 'base', 'large'].forEach(function (size) {
    thumbnail([['Size', cap(size)], ['Content', 'Image']], '<s-thumbnail size="' + size + '" src="' + IMG + '" alt="Product"></s-thumbnail>');
    thumbnail([['Size', cap(size)], ['Content', 'Empty']], '<s-thumbnail size="' + size + '" alt="No image"></s-thumbnail>');
  });

  var icon = set('Icon', 'Common icons. Each becomes one variant of an Icon set; swap with the Type property.');
  ['home', 'order', 'product', 'cart', 'person', 'settings', 'search', 'filter', 'edit', 'delete', 'duplicate', 'plus', 'x',
    'menu-vertical', 'info', 'alert-circle', 'check-circle', 'calendar', 'email', 'arrow-up', 'arrow-down', 'save'].forEach(function (t) {
    icon([['Type', t]], '<s-icon type="' + t + '"></s-icon>');
  });

  // ---- Forms (fill their container, so fixed width) ----
  var textField = set('Text field', 'Fixed at 320px wide.', 320);
  textField([['State', 'Default']], '<s-text-field label="Label" placeholder="Placeholder"></s-text-field>');
  textField([['State', 'Filled']], '<s-text-field label="Label" value="Value"></s-text-field>');
  textField([['State', 'Help text']], '<s-text-field label="Label" details="Help text for this field"></s-text-field>');
  textField([['State', 'Error']], '<s-text-field label="Label" value="Value" error="Error message"></s-text-field>');
  textField([['State', 'Disabled']], '<s-text-field label="Label" value="Value" disabled></s-text-field>');
  textField([['State', 'Required']], '<s-text-field label="Label" required></s-text-field>');
  textField([['State', 'Icon']], '<s-text-field label="Label" icon="search" placeholder="Search"></s-text-field>');
  textField([['State', 'Prefix and suffix']], '<s-text-field label="Label" prefix="$" suffix="USD"></s-text-field>');

  var field = set('Field / Type', 'Specialised inputs. Fixed at 320px wide.', 320);
  [
    ['Email', '<s-email-field label="Email" placeholder="you@example.com"></s-email-field>'],
    ['Password', '<s-password-field label="Password" value="password123"></s-password-field>'],
    ['URL', '<s-url-field label="Website" placeholder="https://"></s-url-field>'],
    ['Search', '<s-search-field label="Search" placeholder="Search"></s-search-field>'],
    ['Number', '<s-number-field label="Quantity" value="1"></s-number-field>'],
    ['Money', '<s-money-field label="Price" value="24.99"></s-money-field>'],
    ['Date', '<s-date-field label="Date" value="2026-06-15"></s-date-field>'],
    ['Color', '<s-color-field label="Color" value="#008060"></s-color-field>'],
  ].forEach(function (f) { field([['Type', f[0]]], f[1]); });

  var textArea = set('Text area', 'Fixed at 320px wide.', 320);
  textArea([['State', 'Default']], '<s-text-area label="Description" rows="3"></s-text-area>');
  textArea([['State', 'Error']], '<s-text-area label="Description" rows="3" error="Error message"></s-text-area>');
  textArea([['State', 'Disabled']], '<s-text-area label="Description" rows="3" value="Value" disabled></s-text-area>');

  var select = set('Select', 'Fixed at 320px wide.', 320);
  var options = '<s-option value="a">Option A</s-option><s-option value="b">Option B</s-option>';
  select([['State', 'Default']], '<s-select label="Label">' + options + '</s-select>');
  select([['State', 'Error']], '<s-select label="Label" error="Error message">' + options + '</s-select>');
  select([['State', 'Disabled']], '<s-select label="Label" disabled>' + options + '</s-select>');

  var checkbox = set('Checkbox');
  ['unchecked', 'checked', 'indeterminate'].forEach(function (state) {
    [false, true].forEach(function (disabled) {
      checkbox([['State', cap(state)], ['Disabled', disabled ? 'Yes' : 'No']],
        '<s-checkbox label="Checkbox label"' + flag('checked', state === 'checked') + flag('indeterminate', state === 'indeterminate') + flag('disabled', disabled) + '></s-checkbox>');
    });
  });
  checkbox([['State', 'Error'], ['Disabled', 'No']], '<s-checkbox label="Checkbox label" error="Error message"></s-checkbox>');
  checkbox([['State', 'Help text'], ['Disabled', 'No']], '<s-checkbox label="Checkbox label" details="Help text"></s-checkbox>');

  var sw = set('Switch');
  [false, true].forEach(function (checked) {
    [false, true].forEach(function (disabled) {
      sw([['Checked', checked ? 'Yes' : 'No'], ['Disabled', disabled ? 'Yes' : 'No']],
        '<s-switch label="Switch label"' + flag('checked', checked) + flag('disabled', disabled) + '></s-switch>');
    });
  });

  var choice = set('Choice list', 'Fixed at 320px wide.', 320);
  var choices = '<s-choice value="1" selected>Option 1</s-choice><s-choice value="2">Option 2</s-choice><s-choice value="3">Option 3</s-choice>';
  choice([['Type', 'Single']], '<s-choice-list label="Label">' + choices + '</s-choice-list>');
  choice([['Type', 'Multiple']], '<s-choice-list label="Label" multiple>' + choices + '</s-choice-list>');

  var dropZone = set('Drop zone', 'Fixed at 320px wide.', 320);
  dropZone([['State', 'Default']], '<s-drop-zone label="Upload files" accept=".jpg,.png" multiple></s-drop-zone>');

  var pickers = set('Pickers');
  pickers([['Type', 'Date']], '<s-date-picker type="single" value="2026-06-15"></s-date-picker>');
  pickers([['Type', 'Color']], '<s-color-picker value="#3498DB"></s-color-picker>');

  // ---- Layout & structure ----
  var section = set('Section', 'Fixed at 560px wide.', 560);
  section([['Heading', 'Yes']], '<s-section heading="Section heading"><s-paragraph>Section content goes here.</s-paragraph></s-section>');
  section([['Heading', 'No']], '<s-section><s-paragraph>Section content goes here.</s-paragraph></s-section>');

  var box = set('Box', 'Fixed at 240px wide.', 240);
  ['base', 'subdued', 'strong'].forEach(function (bg) {
    [false, true].forEach(function (border) {
      box([['Background', cap(bg)], ['Border', border ? 'Yes' : 'No']],
        '<s-box padding="base" borderRadius="base" background="' + bg + '"' + attr('border', border ? 'base' : '') + '><s-text>Box content</s-text></s-box>');
    });
  });

  var divider = set('Divider', 'Fixed at 320px wide.', 320);
  divider([['Direction', 'Inline']], '<s-divider></s-divider>');

  var table = set('Table', 'Fixed at 720px wide. Build rows and cells as their own components in Figma.', 720);
  table([['Rows', '3']],
    '<s-table><s-table-header-row>' +
    '<s-table-header listSlot="primary">Product</s-table-header><s-table-header listSlot="inline">Status</s-table-header>' +
    '<s-table-header listSlot="labeled" format="numeric">Inventory</s-table-header><s-table-header listSlot="labeled" format="currency">Price</s-table-header>' +
    '</s-table-header-row><s-table-body>' +
    '<s-table-row><s-table-cell>Snowboard</s-table-cell><s-table-cell><s-badge tone="success">Active</s-badge></s-table-cell><s-table-cell>42</s-table-cell><s-table-cell>$749.95</s-table-cell></s-table-row>' +
    '<s-table-row><s-table-cell>Ski wax</s-table-cell><s-table-cell><s-badge>Draft</s-badge></s-table-cell><s-table-cell>0</s-table-cell><s-table-cell>$12.00</s-table-cell></s-table-row>' +
    '<s-table-row><s-table-cell>Gift card</s-table-cell><s-table-cell><s-badge tone="neutral">Archived</s-badge></s-table-cell><s-table-cell>—</s-table-cell><s-table-cell>$50.00</s-table-cell></s-table-row>' +
    '</s-table-body></s-table>');

  // ---- render ----
  var root = document.getElementById('cap');
  SETS.forEach(function (s) {
    var wrap = document.createElement('section');
    wrap.className = 'cap-set';
    wrap.setAttribute('data-set', s.name);
    if (s.width) wrap.setAttribute('data-width', s.width);
    var h = document.createElement('h2');
    h.textContent = s.name + ' (' + s.items.length + ')';
    wrap.appendChild(h);
    if (s.note) {
      var p = document.createElement('p');
      p.textContent = s.note;
      wrap.appendChild(p);
    }
    var grid = document.createElement('div');
    grid.className = 'cap-grid';
    s.items.forEach(function (item) {
      var label = item.props.map(function (p) { return p[0] + '=' + p[1]; }).join(', ');
      var fig = document.createElement('figure');
      fig.className = 'cap-cell';
      var cap = document.createElement('figcaption');
      cap.textContent = label;
      var frame = document.createElement('div');
      frame.className = 'cap-frame' + (s.width ? ' fixed' : '');
      if (s.width) frame.style.width = s.width + 'px';
      // Importers that name layers from attributes can pick these up.
      frame.id = (s.name + '--' + label).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      frame.setAttribute('data-name', label);
      frame.innerHTML = item.html;
      fig.appendChild(cap);
      fig.appendChild(frame);
      grid.appendChild(fig);
    });
    wrap.appendChild(grid);
    root.appendChild(wrap);
  });
})();
