/**
 * Be A Blessing Sourdough: order backend (Google Apps Script).
 * Bound to your Google Sheet: Extensions > Apps Script, paste this in, then Deploy as a Web app.
 *
 * Day-to-day changes are made in the SHEET, NOT in this code:
 *   - "Menu" tab:     every item (name, price, description), Status (Available / Sold Out / Not Available)
 *                     and an optional quantity limit for any item (great for gift baskets).
 *   - "Settings" tab: site notice, category capacity, week-specific changes (closed weeks, moved pickup
 *                     date, special pickup time) and, in columns K-M, the GENERAL SETTINGS:
 *                     weekly pickup day, pickup time window, order cutoff, location, gift fee,
 *                     payment options, email options, links and messages, and the SITE-WIDE DISCOUNT.
 *   - Discounts:      "Site-wide discount (%)" in the Settings tab puts everything on sale; the
 *                     "Discount %" column in the Menu tab puts just one item on sale (it wins over the site-wide one).
 *   - "Customers" tab: friends & family. Name, email, phone and a Discount %. When someone types a phone number
 *                     that is on this list, that % comes off every item whose "VIP" column (Menu tab) says Yes.
 * All tabs and settings rows are created automatically the first time the page loads.
 */

const CONFIG = {
  sheetName: 'Orders',
  settingsSheetName: 'Settings',
  menuSheetName: 'Menu',
  customersSheetName: 'Customers',
  // Starting values, used only to create the Settings tab the first time.
  // After that, edit the numbers in the Settings tab. Blank = unlimited.
  // Holiday Bundles is blank because each bundle has its own quantity in the Menu tab.
  defaultCapacity: {
    'Traditional Sourdough Boules': 6,
    'Everyday Sourdough Sandwich Loaves': 4,
    'Rolls, Buns & Other': 6,
    'Sweets & Treats': 10,
    'Holiday Bundles': ''
  },
  // Starting menu, used only to create the Menu tab the first time. After that, edit the Menu tab.
  // [category, item name, price, description, item id]
  defaultMenu: [
    ['Traditional Sourdough Boules', 'Plain Rustic Boule', 8, '', 'b1'],
    ['Traditional Sourdough Boules', 'Chocolate Chip Boule', 10, '', 'b2'],
    ['Traditional Sourdough Boules', 'Cranberry Almond Boule (Seasonal Nov-Dec)', 10, '', 'b3'],
    ['Traditional Sourdough Boules', 'Sourdough Pumpkin Boule (Seasonal Sept-Nov)', 12, '', 'b4'],
    ['Everyday Sourdough Sandwich Loaves', 'White Sourdough Sandwich Bread (13x5 loaf)', 10, '', 's1'],
    ['Everyday Sourdough Sandwich Loaves', 'Honey Oat Sourdough Sandwich Bread (13x5 loaf)', 12, '', 's2'],
    ['Everyday Sourdough Sandwich Loaves', 'Cinnamon Swirl Loaf (13x5 loaf)', 14, '', 's3'],
    ['Everyday Sourdough Sandwich Loaves', 'Seeded Honey Oat & Wheat Loaf', 16, '', 's4'],
    ['Rolls, Buns & Other', '9 Pack Dinner Rolls', 9, '', 'r1'],
    ['Rolls, Buns & Other', '8 Pack Garlic Bread Sticks', 10, '', 'r2'],
    ['Rolls, Buns & Other', '8 Pack Hamburger Buns', 12, '', 'r3'],
    ['Sweets & Treats', 'Single Serve Jumbo 10 oz Buttermilk Sourdough Cinnamon Roll', 4, '', 't1'],
    ['Sweets & Treats', 'Single Serve Jumbo Choco Chip Cookie', 4, '', 't2'],
    ['Sweets & Treats', '1 Lb Banana Bread Loaf', 9, '', 't3'],
    ['Sweets & Treats', '1/2 Dozen Gourmet Choco Chip Cookies', 15, '', 't4'],
    ['Sweets & Treats', '9 Pack Buttermilk Sourdough Cinnamon Rolls', 18, '', 't5'],
    ['Holiday Bundles', 'Comfort & Joy', 16, '', 'h1'],
    ['Holiday Bundles', 'The Warm Starter Set', 18, '', 'h2'],
    ['Holiday Bundles', 'Cozy Home Bundle', 24, '', 'h3'],
    ['Holiday Bundles', 'Bakehouse Breakfast Bundle', 35, '', 'h4'],
    ['Holiday Bundles', 'Get Started Bundle', 49, '', 'h5'],
    ['Holiday Bundles', 'The Ultimate Starter Bundle', 68, '', 'h6']
  ]
};

const HEADERS = ['Timestamp', 'Order ID', 'Name', 'Email', 'Phone', 'Pickup Day', 'Pickup Date',
                 'Category', 'Item', 'Qty', 'Unit Price', 'Line Total', 'Order Total', 'Notes',
                 'Payment Method', 'Gift Message', 'Gift Fee', 'Status', 'Gift Qty', 'WhatsApp Opt-in', 'Item ID',
                 'Discount %', 'Original Price'];

// Orders tab, "Pickup Day" column: the day name (e.g. "Wednesday") for standard pickups, or this for custom requests.
const CUSTOM_PICKUP = 'Other';

// ---------- GENERAL SETTINGS (Settings tab, columns K-M) ----------
// One row per setting. The label (column K) is how the script finds the row, so don't rename labels.
// Missing rows are added automatically with the default value. opt = blank is allowed (blank means "none").
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const SETTING_DEFS = [
  { key: 'pickupDay',     label: 'Weekly pickup day', def: 'Wednesday', list: DAYS,
    hint: 'The day of the week customers pick up. The next one is calculated automatically.' },
  { key: 'pickupTime',    label: 'Pickup time window', def: '3:00 PM – 6:00 PM',
    hint: 'Free text, shown on the order page and in confirmation emails (e.g. 3:00 PM – 6:00 PM). Can be overridden for one week in the week-specific table.' },
  { key: 'cutoffDays',    label: 'Order cutoff: days before pickup', def: '2',
    hint: 'Orders close this many days before the pickup day. 0 = the pickup day itself, 1 = the day before.' },
  { key: 'cutoffTime',    label: 'Order cutoff: time of day', def: '6:00 PM',
    hint: 'Type like 6:00 PM, 12:00 PM or noon.' },
  { key: 'pickupStyle',   label: 'Pickup style name', def: 'Porch Pickup',
    hint: 'Shows as "Wednesday Porch Pickup" (day + this name). Change to "Market Pickup", etc.' },
  { key: 'location',      label: 'Pickup location', def: 'Deerwood, MN',
    hint: 'Town / area shown to customers and in emails.' },
  { key: 'locationNote',  label: 'Pickup location note', def: '(Exact porch pickup address provided upon order confirmation)', opt: true,
    hint: 'Shown after the location. Leave blank for none.' },
  { key: 'giftFee',       label: 'Gift packaging fee per item ($)', def: '2',
    hint: 'Added per item when a customer marks an item as a gift.' },
  { key: 'siteDiscount',  label: 'Site-wide discount (%)', def: '', opt: true,
    hint: 'Type a number like 10 for 10% off EVERYTHING. Blank or 0 = no sale. An item with its own Discount in the Menu tab uses that instead (type 0 there to leave one item out of the sale).' },
  { key: 'saleLabel',     label: 'Sale name', def: 'Sale', opt: true,
    hint: 'Shown in the banner at the top of the order page when a site-wide discount is on (e.g. Holiday Sale, Black Friday).' },
  { key: 'vipMessage',    label: 'Friends & family discount message', opt: true,
    def: 'You are receiving a special friends & family discount from Lis for your order. Thanks for supporting me & I hope this blesses you!',
    hint: 'Shown at the bottom of the order page when a customer from the Customers tab gets their discount. Leave blank to hide it.' },
  { key: 'notifyEmail',   label: 'Email me for each new order', def: 'beblessedbabs@gmail.com', opt: true,
    hint: 'Your email for new-order alerts and the reply-to on customer emails. Blank = no alerts.' },
  { key: 'emailCustomer', label: 'Email confirmation to customers (Yes/No)', def: 'Yes', list: ['Yes', 'No'],
    hint: 'Sends each customer an order confirmation from your Gmail.' },
  { key: 'payment1',      label: 'Payment option 1', def: 'Venmo Business @BeABlessingSourdough',
    hint: 'Shown as a choice on the order form. If it starts with "Venmo", the thank-you page shows the Venmo link below.' },
  { key: 'payment2',      label: 'Payment option 2', def: 'Cash (Must arrange with Lis prior to pickup)', opt: true,
    hint: 'Leave blank to hide.' },
  { key: 'payment3',      label: 'Payment option 3', def: '', opt: true,
    hint: 'Optional extra payment choice. Leave blank to hide.' },
  { key: 'venmoUrl',      label: 'Venmo payment link', def: 'https://www.venmo.com/u/beablessingsourdough', opt: true,
    hint: 'Link for the "Click here to pay" button after a Venmo order.' },
  { key: 'whatsappUrl',   label: 'WhatsApp group link', def: 'https://chat.whatsapp.com/JBdxEzMWYfi1cK7FYBnuV3?mode=gi_t', opt: true,
    hint: 'Used in the "orders are closed" message.' },
  { key: 'skippedNote',   label: 'Skipped pickup notice', opt: true,
    def: 'NOTE: Orders for this {skippedDay}, {skippedDate} closed {closedDay} at {closedTime}. This order is for {orderDay}, {orderDate}.',
    hint: 'Shown in the pickup step (Step 2) from the moment the nearest pickup closes until the end of that pickup day. Placeholders: {skippedDay} {skippedDate} {closedDay} {closedDate} {closedTime} {orderDay} {orderDate}. Leave blank to turn the notice off.' },
  { key: 'skippedCustom', label: 'Skipped pickup notice: custom request line', opt: true,
    def: "Need something sooner? Choose Custom Pickup Day / Time and I'll do my best to accommodate.",
    hint: 'Added after the notice above, only when custom orders are open that week. Same placeholders. Leave blank for none.' },
  { key: 'fullMessage',   label: 'Sold-out message', def: 'Thank you so much for the love! We have officially hit our maximum baking capacity for this item. Check back next week, or keep an eye on our WhatsApp community for any extra pop-up loaves!',
    hint: 'Shown when a category is full.' }
];
const SETTINGS_COL = 11; // column K
const SETTINGS_FIRST_ROW = 6;

function tz_() { return Session.getScriptTimeZone(); }

function norm_(v) {
  return v instanceof Date ? Utilities.formatDate(v, tz_(), 'yyyy-MM-dd') : String(v).trim();
}

function isIso_(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')); }

function dayName_(iso) {
  return Utilities.formatDate(Utilities.parseDate(iso, tz_(), 'yyyy-MM-dd'), tz_(), 'EEEE');
}

// "6:00 PM", "6pm", "18:00", "noon" -> minutes after midnight (dflt if it can't be understood)
function parseTime_(s, dflt) {
  s = String(s || '').trim().toLowerCase();
  if (s === 'noon') return 720;
  if (s === 'midnight') return 0;
  const m = /(\d{1,2})(?::(\d{2}))?\s*(a|p)?\.?m?/.exec(s);
  if (!m) return dflt;
  let h = Number(m[1]);
  const mi = Number(m[2] || 0);
  if (m[3] === 'p' && h < 12) h += 12;
  if (m[3] === 'a' && h === 12) h = 0;
  if (h > 23 || mi > 59) return dflt;
  return h * 60 + mi;
}

// Which pickup is currently open for ordering?
// Normally it's the next pickup day (from the Settings tab). If you put a "New Pickup Date" in the
// week-specific table on that week's row, that date is used instead (for that week only).
// Orders close "cutoff days" before the pickup date at the cutoff time (Settings tab).
// As soon as that passes, ordering rolls over to the FOLLOWING week (capacity starts fresh).
// Returns { base: the regular pickup date, date: the actual pickup date }.
function pickupInfo_(overrides, g) {
  const tz = tz_();
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  const dow = String(g.pickupDow);
  while (Utilities.formatDate(d, tz, 'u') !== dow) d.setDate(d.getDate() + 1); // next pickup day (or today)

  const effective = function (base) {
    const o = overrides[base] || {};
    return isIso_(o.newDate) ? o.newDate : base;
  };
  const cutoffFor = function (iso) {
    const day = Utilities.parseDate(iso, tz, 'yyyy-MM-dd');
    day.setDate(day.getDate() - g.cutoffDays);
    const hh = Math.floor(g.cutoffMinutes / 60), mm = g.cutoffMinutes % 60;
    return Utilities.parseDate(Utilities.formatDate(day, tz, 'yyyy-MM-dd') + ' ' + hh + ':' + (mm < 10 ? '0' : '') + mm, tz, 'yyyy-MM-dd H:mm');
  };

  let base = Utilities.formatDate(d, tz, 'yyyy-MM-dd');
  let date = effective(base);
  let skipped = null;
  const cut = cutoffFor(date);
  if (new Date() >= cut) {
    skipped = { date: date, closedAt: cut }; // the nearest pickup, already past its cutoff
    d.setDate(d.getDate() + 7);
    base = Utilities.formatDate(d, tz, 'yyyy-MM-dd');
    date = effective(base);
  }
  // Only report a skipped pickup that is today or later AND earlier than the one being shown.
  // It drops out on its own once that pickup day is over (then it is no longer the nearest one).
  const today = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  if (skipped && !(skipped.date >= today && date > skipped.date)) skipped = null;
  return { base: base, date: date, skipped: skipped };
}

// Builds the "that pickup already closed" notice from the wording in the Settings tab.
// Returns null when there is nothing to show (no skipped pickup, notice left blank, or standard ordering closed that week).
function skippedInfo_(p, g, standardClosed, customClosed) {
  const s = p.skipped;
  if (!s || standardClosed || !g.skippedNote) return null;
  const tz = tz_();
  const fmt = iso => Utilities.formatDate(Utilities.parseDate(iso, tz, 'yyyy-MM-dd'), tz, 'MMM d');
  const vals = {
    skippedDay: dayName_(s.date),
    skippedDate: fmt(s.date),
    closedDay: Utilities.formatDate(s.closedAt, tz, 'EEEE'),
    closedDate: Utilities.formatDate(s.closedAt, tz, 'MMM d'),
    closedTime: g.cutoffText,
    orderDay: dayName_(p.date),
    orderDate: fmt(p.date)
  };
  const fill = t => String(t).replace(/\{(\w+)\}/g, (m, k) => vals[k] !== undefined ? vals[k] : m);
  let message = fill(g.skippedNote);
  if (!customClosed && g.skippedCustom) message += ' ' + fill(g.skippedCustom);
  return Object.assign({ message: message }, vals);
}

function sheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(CONFIG.sheetName);
  if (!sh) {
    sh = ss.insertSheet(CONFIG.sheetName);
    sh.appendRow(HEADERS);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold');
    sh.getRange('G:G').setNumberFormat('@'); // keep Pickup Date as plain text
  }
  // keep the header row in sync if columns were added in a newer version of this code
  if (sh.getMaxColumns() < HEADERS.length) sh.insertColumnsAfter(sh.getMaxColumns(), HEADERS.length - sh.getMaxColumns());
  const hdr = sh.getRange(1, 1, 1, HEADERS.length).getValues()[0];
  if (String(hdr[HEADERS.length - 1]) === '') sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight('bold');
  return sh;
}

// ---------- Settings tab (edited by you, in the sheet) ----------
function createSettings_(ss) {
  const sh = ss.insertSheet(CONFIG.settingsSheetName);
  sh.getRange('A1').setValue('BABS ORDER SETTINGS: change these cells any time. No code changes needed. (Items, prices and statuses are in the Menu tab.)').setFontWeight('bold');
  sh.getRange('A3').setValue('Site notice (shows at the top of the order page; leave blank for none)');
  sh.getRange('B3').setBackground('#fff2cc');
  sh.getRange('A5:B5').setValues([['Category (do not rename)', 'Weekly capacity (standard pickup, blank = unlimited)']]).setFontWeight('bold');
  const cats = Object.keys(CONFIG.defaultCapacity);
  sh.getRange(6, 1, cats.length, 2).setValues(cats.map(c => [c, CONFIG.defaultCapacity[c]]));
  sh.getRange(6, 2, cats.length, 1).setBackground('#fff2cc');
  sh.getRange('D3').setValue('WEEK-SPECIFIC CHANGES: add one row for that week.').setFontWeight('bold');
  sh.getRange('D5:G5').setValues([['Regular pickup date (YYYY-MM-DD)', 'New Pickup Date (YYYY-MM-DD)', 'Status (Open / Closed)', 'Message shown to customers']]).setFontWeight('bold');
  sh.getRange('D6:G30').setBackground('#fff2cc');
  sh.setColumnWidth(1, 330); sh.setColumnWidth(2, 190); sh.setColumnWidth(3, 30);
  sh.setColumnWidth(4, 190); sh.setColumnWidth(5, 190); sh.setColumnWidth(6, 160); sh.setColumnWidth(7, 520);
  return sh;
}

// Creates / completes the GENERAL SETTINGS block (columns K-M) and returns the values as strings.
// Rows that are missing (for example after an update of this script) are added with their default.
function generalValues_(sh) {
  const C = SETTINGS_COL, F = SETTINGS_FIRST_ROW;
  if (sh.getMaxColumns() < C + 2) sh.insertColumnsAfter(sh.getMaxColumns(), C + 2 - sh.getMaxColumns());
  if (String(sh.getRange(F - 1, C).getValue()).trim() === '') {
    sh.getRange(F - 3, C).setValue('GENERAL SETTINGS: pickup day, time, cutoff, payments and more. Change the yellow cells; do not rename the labels.').setFontWeight('bold');
    sh.getRange(F - 1, C, 1, 3).setValues([['Setting (do not rename)', 'Value', 'What it does']]).setFontWeight('bold');
    sh.setColumnWidth(C - 1, 30); sh.setColumnWidth(C, 300); sh.setColumnWidth(C + 1, 380); sh.setColumnWidth(C + 2, 520);
  }
  const rowsN = Math.max(SETTING_DEFS.length + 10, 30);
  const rows = sh.getRange(F, C, rowsN, 2).getDisplayValues().map(r => [String(r[0]).trim(), String(r[1])]);
  const find = label => rows.findIndex(r => r[0].toLowerCase() === label.toLowerCase());
  SETTING_DEFS.forEach(d => {
    if (find(d.label) >= 0) return;
    let i = rows.findIndex(r => r[0] === '');
    if (i < 0) { i = rows.length; rows.push(['', '']); }
    const range = sh.getRange(F + i, C, 1, 3);
    sh.getRange(F + i, C + 1).setNumberFormat('@').setBackground('#fff2cc'); // plain text so "6:00 PM" stays text
    range.setValues([[d.label, d.def, d.hint]]);
    sh.getRange(F + i, C + 2).setFontColor('#777777');
    if (d.list) sh.getRange(F + i, C + 1).setDataValidation(
      SpreadsheetApp.newDataValidation().requireValueInList(d.list, true).setAllowInvalid(true).build());
    rows[i] = [d.label, d.def];
  });
  const out = {};
  SETTING_DEFS.forEach(d => {
    let v = rows[find(d.label)][1].trim();
    if (v === '' && !d.opt) v = d.def;
    out[d.key] = v;
  });
  return out;
}

// "10", "10%", " 10 % " -> 10. Blank / not a number -> null. Always limited to 0-100.
function parsePct_(s) {
  const t = String(s == null ? '' : s).replace(/[%\s]/g, '');
  if (t === '') return null;
  const n = Number(t);
  if (isNaN(n)) return null;
  return Math.min(100, Math.max(0, n));
}

function general_(sh) {
  const v = generalValues_(sh);
  const dayIdx = DAYS.findIndex(x => x.toLowerCase().slice(0, 3) === String(v.pickupDay).toLowerCase().slice(0, 3));
  const days = parseInt(v.cutoffDays, 10);
  const fee = Number(v.giftFee);
  return {
    pickupDow: dayIdx >= 0 ? dayIdx + 1 : 3,   // 1 = Monday ... 7 = Sunday (Wednesday if not understood)
    pickupTime: v.pickupTime,
    cutoffDays: isNaN(days) || days < 0 ? 2 : days,
    cutoffText: v.cutoffTime,
    cutoffMinutes: parseTime_(v.cutoffTime, 18 * 60),
    pickupStyle: v.pickupStyle,
    location: v.location,
    locationNote: v.locationNote,
    giftFee: isNaN(fee) || fee < 0 ? 2 : fee,
    siteDiscount: parsePct_(v.siteDiscount) || 0,
    saleLabel: v.saleLabel || 'Sale',
    vipMessage: v.vipMessage,
    notifyEmail: v.notifyEmail,
    emailCustomer: !/^\s*no/i.test(v.emailCustomer),
    payments: [v.payment1, v.payment2, v.payment3].filter(x => x),
    venmoUrl: v.venmoUrl,
    whatsappUrl: v.whatsappUrl,
    skippedNote: v.skippedNote,
    skippedCustom: v.skippedCustom,
    fullMessage: v.fullMessage
  };
}

function settings_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(CONFIG.settingsSheetName) || createSettings_(ss);
  const g = general_(sh);
  const notice = String(sh.getRange('B3').getValue() || '').trim();
  const capacity = {};
  sh.getRange(6, 1, 20, 2).getValues().forEach(r => {
    const name = String(r[0]).trim();
    if (name && r[1] !== '' && !isNaN(Number(r[1]))) capacity[name] = Number(r[1]); // blank = unlimited
  });

  // Tidy the older "Wednesday" wording (only changes cells that still say Wednesday).
  const b5 = sh.getRange('B5');
  if (/wednesday/i.test(String(b5.getValue()))) b5.setValue('Weekly capacity (standard pickup, blank = unlimited)');
  const d3 = sh.getRange('D3'), d4 = sh.getRange('D4');
  if (/wednesday/i.test(String(d3.getValue()))) d3.setValue('WEEK-SPECIFIC CHANGES: add one row for that week.');
  const d4Text = 'Regular pickup date = the normal pickup date for that week. Closed = no standard ordering that week. New Pickup Date = moves pickup to that date for that week only. Pickup time = changes the time window for that week only. Message = shown inside the pickup step (Step 2) of the order form.';
  if (String(d4.getValue()) !== d4Text) d4.setValue(d4Text);
  const a12 = sh.getRange('A12');
  if (String(a12.getValue()) === '') a12.setValue('➡ GENERAL SETTINGS (pickup day, time window, order cutoff, payments, etc.) are in columns K–M.').setFontColor('#6b4f3a').setFontWeight('bold');

  // The week-specific table is read by its column HEADINGS (row 5, starting at column D),
  // so it still works if you insert or move a column in that table.
  const readHdr = () => sh.getRange(5, 4, 1, 6).getValues()[0].map(x => String(x).toLowerCase());
  let hdr = readHdr();
  hdr.forEach((x, i) => { // rename the old headings
    if (/^wednesday date/.test(x)) sh.getRange(5, 4 + i).setValue('Regular pickup date (YYYY-MM-DD)');
    if (/^new pickup day/.test(x)) sh.getRange(5, 4 + i).setValue('New Pickup Date (YYYY-MM-DD)');
  });
  hdr = readHdr();
  // Adds missing columns automatically the first time (in the next empty spot of the table).
  [['custom orders', 'Custom orders (Open / Closed)', 220], ['pickup time', 'Pickup time (this week only)', 220]].forEach(c => {
    if (hdr.findIndex(x => x.indexOf(c[0]) !== -1) >= 0) return;
    const emptyI = hdr.findIndex(x => x === '');
    if (emptyI < 0) return;
    sh.getRange(5, 4 + emptyI).setValue(c[1]).setFontWeight('bold');
    sh.getRange(6, 4 + emptyI, 25, 1).setBackground('#fff2cc');
    if (c[0] === 'pickup time') sh.getRange(6, 4 + emptyI, 25, 1).setNumberFormat('@');
    sh.setColumnWidth(4 + emptyI, c[2]);
    hdr = readHdr();
  });
  const find = (test, fallback) => { const i = hdr.findIndex(test); return i >= 0 ? i : fallback; };
  const dateI = find(x => /(regular|wednesday) pickup date|wednesday date|^pickup date/.test(x), 0);
  const newI = find(x => x.indexOf('new pickup') !== -1, -1);
  const statusI = find(x => x.indexOf('status') !== -1, 1);
  const msgI = find(x => x.indexOf('message') !== -1, 2);
  const customI = find(x => x.indexOf('custom orders') !== -1, -1);
  const timeI = find(x => x.indexOf('pickup time') !== -1, -1);

  const overrides = {};
  const tbl = sh.getRange(6, 4, 25, 6);
  const raw = tbl.getValues(), shown = tbl.getDisplayValues();
  raw.forEach((r, ri) => {
    if (r[dateI] === '' || r[dateI] === null) return;
    overrides[norm_(r[dateI])] = {
      customStatus: customI >= 0 ? String(r[customI]).trim().toLowerCase() : '',
      status: String(r[statusI]).trim().toLowerCase(),
      message: String(r[msgI]).trim(),
      time: timeI >= 0 ? String(shown[ri][timeI]).trim() : '',
      newDate: newI >= 0 && r[newI] !== '' && r[newI] !== null ? norm_(r[newI]) : ''
    };
  });
  return { notice: notice, capacity: capacity, overrides: overrides, g: g };
}

// ---------- Menu tab (edited by you, in the sheet) ----------
// The Menu tab is read by its column HEADINGS (row 1), so you can move, insert or reorder columns freely.
// Keep these words in the headings: "Category", "Item name", "Price", "Description", "Status",
// "Quantity", "Quantity type" and "Item ID". Status, Quantity, Quantity type and Item ID are added
// at the right automatically if they are missing.
// Quantity type: "Weekly" (default: resets every week, standard pickup only)
//             or "Total" (never resets, counts every order, standard AND custom pickup)
const LIMIT_TYPES = ['Weekly (resets each week)', 'Total (never resets)'];
const STATUS_TYPES = ['Available', 'Sold Out', 'Not Available'];

function statusRule_() { return SpreadsheetApp.newDataValidation().requireValueInList(STATUS_TYPES, true).setAllowInvalid(false).build(); }
function typeRule_() { return SpreadsheetApp.newDataValidation().requireValueInList(LIMIT_TYPES, true).setAllowInvalid(true).build(); }

const DISCOUNT_HEADING = 'Discount % (optional, e.g. 10)';
const VIP_HEADING = 'VIP (Yes = friends & family discount applies)';
function vipRule_() { return SpreadsheetApp.newDataValidation().requireValueInList(['Yes', 'No'], true).setAllowInvalid(true).build(); }

function createMenu_(ss) {
  const sh = ss.insertSheet(CONFIG.menuSheetName);
  sh.getRange(1, 1, 1, 10).setValues([['Category', 'Item name', 'Price', 'Description (optional)', 'Status', 'Quantity (blank = no limit)', 'Item ID (automatic, do not edit)', 'Quantity type (Weekly or Total)', DISCOUNT_HEADING, VIP_HEADING]]).setFontWeight('bold');
  sh.setFrozenRows(1);
  const rows = CONFIG.defaultMenu.map(m => [m[0], m[1], m[2], m[3], 'Available', '', m[4], '', '', 'Yes']);
  sh.getRange(2, 1, rows.length, 10).setValues(rows);
  sh.getRange(2, 1, 300, 6).setBackground('#fff2cc');
  sh.getRange(2, 7, 300, 1).setBackground('#eeeeee').setFontColor('#888888');
  sh.getRange(2, 8, 300, 2).setBackground('#fff2cc');
  sh.setColumnWidth(9, 230);
  sh.getRange(2, 10, 300, 1).setBackground('#fff2cc').setDataValidation(vipRule_());
  sh.setColumnWidth(10, 300);
  sh.getRange(2, 5, 300, 1).setDataValidation(statusRule_());
  sh.getRange(2, 8, 300, 1).setDataValidation(typeRule_());
  sh.getRange(2, 3, 300, 1).setNumberFormat('0.00');
  sh.setColumnWidth(1, 270); sh.setColumnWidth(2, 420); sh.setColumnWidth(3, 70); sh.setColumnWidth(4, 260);
  sh.setColumnWidth(5, 120); sh.setColumnWidth(6, 230); sh.setColumnWidth(7, 150); sh.setColumnWidth(8, 230);
  return sh;
}

// Finds each Menu column by its heading. Returns 0-based indexes (-1 = not found).
function menuCols_(sh) {
  const n = Math.max(sh.getLastColumn(), 1);
  const hdr = sh.getRange(1, 1, 1, n).getValues()[0].map(x => String(x).toLowerCase().trim());
  const find = f => hdr.findIndex(f);
  let name = find(x => x.indexOf('item name') !== -1);
  if (name < 0) name = find(x => /^name\b/.test(x));
  return {
    cat: find(x => x.indexOf('category') !== -1),
    name: name,
    price: find(x => x.indexOf('price') !== -1),
    desc: find(x => x.indexOf('description') !== -1),
    status: find(x => x.indexOf('status') !== -1),
    type: find(x => /quantity type|limit type|^type\b/.test(x)),
    qty: find(x => x.indexOf('quantity') !== -1 && !/type/.test(x)),
    id: find(x => x.indexOf('item id') !== -1),
    disc: find(x => x.indexOf('discount') !== -1),
    vip: find(x => /^vip\b/.test(x))
  };
}

// Adds a missing heading at the right-hand end of the Menu tab and returns its 0-based index.
function addMenuCol_(sh, heading) {
  const col = sh.getLastColumn() + 1;
  if (sh.getMaxColumns() < col) sh.insertColumnsAfter(sh.getMaxColumns(), col - sh.getMaxColumns());
  sh.getRange(1, col).setValue(heading).setFontWeight('bold');
  sh.setColumnWidth(col, 230);
  return col - 1;
}

// Reads the Menu tab. Gives any new row an Item ID (so items can be renamed without losing their order counts).
// Returns [{ name: category, items: [{ id, name, desc, price, status, limit, lifetime }] }] in the order of the sheet.
function menu_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(CONFIG.menuSheetName) || createMenu_(ss);
  let c = menuCols_(sh);
  if (c.cat < 0 || c.name < 0 || c.price < 0) {
    throw new Error('The Menu tab needs headings in row 1 that contain "Category", "Item name" and "Price".');
  }
  if (c.status < 0) { c.status = addMenuCol_(sh, 'Status'); sh.getRange(2, c.status + 1, 300, 1).setDataValidation(statusRule_()); }
  if (c.qty < 0) c.qty = addMenuCol_(sh, 'Quantity (blank = no limit)');
  if (c.type < 0) {
    c.type = addMenuCol_(sh, 'Quantity type (Weekly or Total)');
    sh.getRange(2, c.type + 1, 300, 1).setBackground('#fff2cc').setDataValidation(typeRule_());
  }
  if (c.id < 0) c.id = addMenuCol_(sh, 'Item ID (automatic, do not edit)');
  if (c.disc < 0) {
    c.disc = addMenuCol_(sh, DISCOUNT_HEADING);
    sh.getRange(2, c.disc + 1, 300, 1).setBackground('#fff2cc');
  }
  if (c.vip < 0) { // new VIP column: every existing item starts as Yes, so you only change the ones you want left out
    c.vip = addMenuCol_(sh, VIP_HEADING);
    const lr = sh.getLastRow();
    if (lr >= 2) {
      const nm = sh.getRange(2, c.name + 1, lr - 1, 1).getValues();
      sh.getRange(2, c.vip + 1, lr - 1, 1).setValues(nm.map(r => [String(r[0]).trim() ? 'Yes' : '']));
    }
    sh.getRange(2, c.vip + 1, 300, 1).setBackground('#fff2cc').setDataValidation(vipRule_());
    sh.setColumnWidth(c.vip + 1, 300);
  }

  const last = sh.getLastRow();
  if (last < 2) return [];
  const vals = sh.getRange(2, 1, last - 1, sh.getLastColumn()).getValues();
  const shownVals = sh.getRange(2, 1, last - 1, sh.getLastColumn()).getDisplayValues(); // so "10%" and "10" both read as 10
  const seen = {};
  let idsChanged = false;
  const cats = [], byName = {};
  vals.forEach((r, ri) => {
    const cat = String(r[c.cat]).trim(), name = String(r[c.name]).trim();
    if (!cat || !name) return;
    let id = String(r[c.id]).trim();
    if (!id || seen[id]) { // blank, or a copied row with a duplicate id
      id = 'i' + Utilities.getUuid().replace(/-/g, '').slice(0, 8);
      r[c.id] = id; idsChanged = true;
    }
    seen[id] = true;
    const price = Number(r[c.price]);
    if (r[c.price] === '' || isNaN(price)) return; // a row without a valid price is skipped
    const key = String(r[c.status]).toLowerCase().replace(/[^a-z]/g, '');
    const status = key === 'soldout' ? 'soldout' : (key === 'notavailable' || key === 'unavailable') ? 'notavailable' : 'available';
    const q = r[c.qty];
    const limit = (q === '' || q === null || isNaN(Number(q))) ? null : Math.max(0, Math.floor(Number(q)));
    const lifetime = /total|never/i.test(String(r[c.type]));
    const desc = c.desc >= 0 ? String(r[c.desc]).trim() : '';
    if (!byName[cat]) { byName[cat] = { name: cat, items: [] }; cats.push(byName[cat]); }
    const discount = parsePct_(shownVals[ri][c.disc]); // null = blank (use the site-wide discount), 0 = no discount on this item
    const vip = !/^\s*(no|n|false)\s*$/i.test(String(r[c.vip])); // blank counts as Yes
    byName[cat].items.push({ id: id, name: name, desc: desc, price: price, status: status, limit: limit, lifetime: lifetime, discount: discount, vip: vip });
  });
  if (idsChanged) sh.getRange(2, c.id + 1, vals.length, 1).setValues(vals.map(r => [r[c.id]]));
  return cats;
}

// ---------- Customers tab (friends & family discounts, edited by you, in the sheet) ----------
// Columns are found by their headings: one containing "phone" and one containing "discount".
const CUSTOMERS_HEADERS = ['Name', 'Email', 'Phone', 'Discount % (e.g. 10 = 10% off)'];

function customersSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(CONFIG.customersSheetName);
  if (!sh) {
    sh = ss.insertSheet(CONFIG.customersSheetName);
    sh.getRange(1, 1, 1, 4).setValues([CUSTOMERS_HEADERS]).setFontWeight('bold');
    sh.setFrozenRows(1);
    sh.getRange(2, 1, 300, 4).setBackground('#fff2cc');
    sh.getRange(2, 3, 300, 1).setNumberFormat('@'); // keep phone numbers as plain text
    sh.setColumnWidth(1, 220); sh.setColumnWidth(2, 260); sh.setColumnWidth(3, 170); sh.setColumnWidth(4, 260);
  }
  return sh;
}

// The friends & family discount (%) for this phone number, or 0 if it isn't on the Customers tab.
// Numbers are matched on their last 10 digits, so (218) 555-1234, 218-555-1234 and 2185551234 all match.
function customerPct_(phone) {
  const want = String(phone || '').replace(/\D/g, '').slice(-10);
  if (want.length < 10) return 0;
  const sh = customersSheet_(), last = sh.getLastRow();
  if (last < 2) return 0;
  const n = Math.max(sh.getLastColumn(), 1);
  const hdr = sh.getRange(1, 1, 1, n).getValues()[0].map(x => String(x).toLowerCase());
  const pi = hdr.findIndex(x => x.indexOf('phone') !== -1), di = hdr.findIndex(x => x.indexOf('discount') !== -1);
  if (pi < 0 || di < 0) return 0;
  const rows = sh.getRange(2, 1, last - 1, n).getDisplayValues();
  for (const r of rows) {
    if (String(r[pi]).replace(/\D/g, '').slice(-10) === want) return parsePct_(r[di]) || 0;
  }
  return 0;
}

// How many of each category / item are already ordered for this week's pickup.
// Counts orders saved under the pickup date OR the regular pickup date, so orders placed
// before you moved the pickup day still count toward that week's capacity.
// Items are matched by Item ID (older orders without an ID are matched by item name).
// byCat / byItem = this week's standard pickup. byItemAll = every order ever (all pickup types),
// used for "Total" quantity items. To give a quantity back (e.g. a cancelled order), type
// Cancelled in the Status column of that order's rows in the Orders tab, or delete the rows.
function usage_(dates, menu) {
  const sh = sheet_(), byCat = {}, byItem = {}, byItemAll = {};
  const last = sh.getLastRow();
  if (last < 2) return { byCat: byCat, byItem: byItem, byItemAll: byItemAll };
  const nameToId = {};
  menu.forEach(c => c.items.forEach(it => { nameToId[it.name] = it.id; }));
  const rows = sh.getRange(2, 1, last - 1, HEADERS.length).getValues();
  rows.forEach(r => {
    if (/cancel/i.test(String(r[17]))) return;
    const q = Number(r[9] || 0);
    const id = String(r[20] || '').trim() || nameToId[String(r[8]).trim()];
    if (id) byItemAll[id] = (byItemAll[id] || 0) + q;
    // any pickup that is not a custom request counts as a standard pickup (works whatever day it is)
    if (String(r[5]) !== CUSTOM_PICKUP && dates.indexOf(norm_(r[6])) !== -1) {
      byCat[r[7]] = (byCat[r[7]] || 0) + q;
      if (id) byItem[id] = (byItem[id] || 0) + q;
    }
  });
  return { byCat: byCat, byItem: byItem, byItemAll: byItemAll };
}

// Sale price of one item. The item's own Discount (Menu tab) wins; if it is blank, the site-wide discount applies.
// Returns { pct, price (what the customer pays), was (regular price) }. Rounded to whole cents.
function priced_(it, g) {
  const pct = it.discount !== null && it.discount !== undefined ? it.discount : g.siteDiscount;
  const price = pct > 0 ? Math.round(it.price * (1 - pct / 100) * 100) / 100 : it.price;
  return { pct: pct > 0 ? pct : 0, price: price, was: it.price };
}

function pickupNote_(time, g) {
  return time + ' in ' + g.location + (g.locationNote ? ' ' + g.locationNote : '');
}

function status_() {
  customersSheet_(); // makes sure the Customers tab exists
  const s = settings_();
  const g = s.g;
  const p = pickupInfo_(s.overrides, g);
  const o = s.overrides[p.base] || {};
  const time = o.time || g.pickupTime;
  const menu = menu_();
  const u = usage_([p.date, p.base], menu);
  // What the order page gets: "Not Available" items are left out completely.
  const menuOut = menu.map(c => ({
    name: c.name,
    items: c.items.filter(it => it.status !== 'notavailable').map(it => {
      const pr = priced_(it, g);
      return {
      id: it.id, name: it.name, desc: it.desc, price: it.price, vip: it.vip,
      pct: pr.pct, salePrice: pr.price,   // pct = % off (0 = none), salePrice = what the customer pays
      soldOut: it.status === 'soldout',
      lifetime: it.lifetime,
      left: it.limit === null ? null : Math.max(0, it.limit - ((it.lifetime ? u.byItemAll[it.id] : u.byItem[it.id]) || 0))
      };
    })
  })).filter(c => c.items.length);
  return {
    version: 'friends-family-v1',       // lets you confirm in the browser which script version is live
    pickupDate: p.date,
    pickupDayName: dayName_(p.date),
    pickupTime: time,
    pickupNote: pickupNote_(time, g),
    capacity: s.capacity,
    used: u.byCat,
    menu: menuOut,
    notice: s.notice,
    weekNote: o.message || '',
    wedClosed: o.status === 'closed',   // (name kept for the order page: standard pickup closed this week)
    customClosed: o.customStatus === 'closed',
    skipped: skippedInfo_(p, g, o.status === 'closed', o.customStatus === 'closed'), // null unless the nearest pickup was skipped
    settings: g,                        // used by the server (doPost); the order page reads `config`
    config: {
      pickupStyle: g.pickupStyle,
      location: g.location,
      locationNote: g.locationNote,
      cutoffDays: g.cutoffDays,
      cutoffText: g.cutoffText,
      giftFee: g.giftFee,
      siteDiscount: g.siteDiscount,
      saleLabel: g.saleLabel,
      vipMessage: g.vipMessage,
      payments: g.payments,
      venmoUrl: g.venmoUrl,
      whatsappUrl: g.whatsappUrl,
      fullMessage: g.fullMessage
    }
  };
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// The order page never needs the private settings (your notify email, etc.), so strip them before sending.
function publicStatus_(st) {
  const out = {};
  Object.keys(st).forEach(k => { if (k !== 'settings') out[k] = st[k]; });
  return out;
}

// Has this email or phone number already said "Yes" to the WhatsApp group on a past order?
function optedIn_(email, phone) {
  const sh = sheet_(), last = sh.getLastRow();
  if (last < 2) return false;
  const e = String(email || '').trim().toLowerCase();
  const ph = String(phone || '').replace(/\D/g, '').slice(-10);
  if (!e && ph.length < 10) return false;
  const rows = sh.getRange(2, 1, last - 1, HEADERS.length).getValues();
  return rows.some(r => /^\s*yes/i.test(String(r[19])) &&
    ((e && String(r[3]).trim().toLowerCase() === e) ||
     (ph.length === 10 && String(r[4]).replace(/\D/g, '').slice(-10) === ph)));
}

// The order page's status (menu, settings, what's left) is cached for 30 seconds so most visitors get an
// instant answer instead of waiting for the sheet to be read. The cache is cleared whenever an order comes in,
// so "left" counts stay accurate. Changes you make in the sheet show up on the page within ~30 seconds.
// (Order checks in doPost always use fresh data, never the cache.)
const STATUS_CACHE_SECONDS = 30;

function cachedStatusJson_() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get('status');
  if (hit) return hit;
  const out = JSON.stringify(publicStatus_(status_()));
  try { cache.put('status', out, STATUS_CACHE_SECONDS); } catch (err) { /* too big or cache unavailable: just skip */ }
  return out;
}

// Optional "keep warm" helper: add a time-driven trigger for this function (every 5 minutes) in Apps Script
// (clock icon > Add Trigger > warm > Time-driven > Minutes timer > Every 5 minutes). It's free and
// makes the first visitor after a quiet period faster.
function warm() { cachedStatusJson_(); }

function doGet(e) {
  const p = (e && e.parameter) || {};
  if (p.action === 'optin') return json_({ optedIn: optedIn_(p.email, p.phone) });
  if (p.action === 'discount') return json_({ discount: customerPct_(p.phone) }); // only the % is returned, never the name
  return ContentService.createTextOutput(cachedStatusJson_()).setMimeType(ContentService.MimeType.JSON);
}

function esc_(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Confirmation email to the customer. Sent from your Gmail; replies go to the notify email.
function sendConfirmation_(d) {
  const m = x => '$' + Number(x).toFixed(2);
  const first = String(d.name).trim().split(/\s+/)[0];
  const subject = (d.customOnly ? 'Your custom request #' : d.wed ? 'Your Be A Blessing Sourdough order #' : 'Your custom pickup request #') + d.orderId;
  let intro = d.customOnly
    ? "Thank you! Your custom request is in. It isn't confirmed yet. I'll review it and reach out to let you know if I can make it happen. Nothing is due until then!"
    : d.wed
      ? 'Thank you so much for your order! Here is your receipt.'
      : "Thank you! Your custom pickup request is in. It isn't confirmed yet. I'll review it and reach out to you, and I'll do my best to make it work!";
  if (d.customRequest && d.wed && !d.customOnly) intro += " Your custom request isn't confirmed yet. I'll reach out to let you know if I can make it happen.";
  const after = (d.wed && !d.customOnly)
    ? 'You will get a message (WhatsApp or email) with payment details. Your order is officially locked in once payment is received.'
    : '';
  const rows = d.lines.map(l => [l.qty + ' x ' + l.item + (l.pct ? ' (' + l.pct + '% off, regularly ' + m(l.origPrice) + ' each)' : '') + (l.giftQty ? ' (' + l.giftQty + ' as gift)' : ''), m(l.qty * l.price)]);
  if (d.giftCount) rows.push(['Gift packaging x ' + d.giftCount, m(d.giftFee)]);
  if (d.savings > 0) rows.push(['You saved', '-' + m(d.savings)]);
  rows.push(['Total', m(d.total)]);
  const info = [
    ['Order number', '#' + d.orderId],
    ['Pickup', (d.wed && !d.customOnly) ? d.pickupDayName + ', ' + d.pickupLabel + ' | ' + d.pickupNote : 'Custom request (pending my review)', true] // third value = bold in the email
  ];
  if (!d.customOnly) info.push(['Payment', d.payment]);
  if (d.vip) info.push(['Discount', 'Receiving friends & family discount']);
  if (d.giftCount && d.giftMessage) info.push(['Gift message', d.giftMessage]);
  if (d.notes) info.push(['Special Notes Or Requests', d.notes]);

  const text = 'Hi ' + first + ',\n\n' + intro + '\n\n' +
    rows.map(r => r[0] + ': ' + r[1]).join('\n') + '\n\n' +
    info.map(r => r[0] + ': ' + r[1]).join('\n') + '\n\n' + after + '\n\nBe A Blessing Sourdough';
  const td = 'style="padding:4px 0;vertical-align:top"';
  const html = '<div style="font-family:Arial,sans-serif;color:#333;max-width:560px">' +
    '<p>Hi ' + esc_(first) + ',</p><p>' + esc_(intro) + '</p>' +
    '<table style="width:100%;border-collapse:collapse">' +
    rows.map((r, i) => '<tr' + (i === rows.length - 1 ? ' style="font-weight:bold;border-top:1px solid #ddd"' : '') + '><td ' + td + '>' + esc_(r[0]) + '</td><td ' + td + ' align="right">' + esc_(r[1]) + '</td></tr>').join('') +
    '</table><p></p><table style="width:100%;border-collapse:collapse;color:#555">' +
    info.map(r => '<tr><td ' + td + ' width="38%"><b>' + esc_(r[0]) + '</b></td><td ' + td + '>' + (r[2] ? '<b style="color:#333">' : '') + esc_(r[1]).replace(/\n/g, '<br>') + (r[2] ? '</b>' : '') + '</td></tr>').join('') +
    '</table>' + (after ? '<p>' + esc_(after) + '</p>' : '') +
    '<p>Be A Blessing Sourdough</p></div>';
  const opts = { name: 'Be A Blessing Sourdough', htmlBody: html };
  if (d.replyTo) opts.replyTo = d.replyTo;
  MailApp.sendEmail(d.email, subject, text, opts);
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000); // prevents two people grabbing the last loaf at the same time
  try {
    const p = JSON.parse(e.postData.contents);
    const customReq = !!p.customRequest;   // "Other / Custom Request" option: can be ordered alone, total $0
    const given = Array.isArray(p.items) ? p.items : [];
    if (!p.name || !p.email || !p.phone || !p.payment || !(given.length || customReq)) return json_({ ok: false, error: 'Please fill in your name, email, phone number and payment method.' });

    const st = status_();
    const pub = publicStatus_(st);
    const g = st.settings;
    if (customReq && !String(p.notes || '').trim()) {
      return json_({ ok: false, status: pub, error: 'For a custom request, please describe what you are looking for in the Special Notes section.' });
    }
    const wed = p.pickup !== CUSTOM_PICKUP;   // "wed" = standard (limited) pickup, whatever day it is

    if (!wed && st.customClosed) {
      return json_({ ok: false, status: pub, error: 'Custom orders are not available this week.' + (st.wedClosed ? '' : ' Please choose the ' + st.pickupDayName + ' pickup.') });
    }
    if (wed) {
      if (st.wedClosed) {
        return json_({ ok: false, status: pub, error: st.weekNote || 'Porch pickup ordering is closed this week. Please choose Custom Pickup and reach out with your request.' });
      }
      if (p.pickupDate && p.pickupDate !== st.pickupDate) {
        return json_({ ok: false, status: pub, error: 'Ordering just rolled over to the next pickup (' + st.pickupDayName + ', ' + Utilities.formatDate(Utilities.parseDate(st.pickupDate, tz_(), 'yyyy-MM-dd'), tz_(), 'MMM d') + '). Please review your order and submit again.' });
      }
    }
    // Look every item up in the Menu tab: names and prices come from the sheet, not from the browser.
    const byId = {};
    st.menu.forEach(c => c.items.forEach(it => { byId[it.id] = { cat: c.name, it: it }; }));
    const vipPct = customerPct_(p.phone); // friends & family discount, looked up here so it can't be faked from the browser
    const lines = [];
    for (const l of given) {
      const hit = byId[l.id];
      const qty = Math.floor(Number(l.qty));
      if (!hit || !(qty > 0)) {
        return json_({ ok: false, status: pub, error: 'Something in your order is no longer available. Please review the menu and try again.' });
      }
      if (hit.it.soldOut || ((wed || hit.it.lifetime) && hit.it.left !== null && hit.it.left <= 0)) {
        return json_({ ok: false, status: pub, error: hit.it.name + ' is sold out. Please remove it from your order.' });
      }
      // price = what the customer pays (sale price if discounted), always taken from the sheet, never from the browser
      // Friends & family: applies to items marked VIP = Yes, and only when it beats the item's sale discount (they never stack).
      const useVip = hit.it.vip !== false && vipPct > (hit.it.pct || 0);
      const price = useVip ? Math.round(hit.it.price * (1 - vipPct / 100) * 100) / 100 : hit.it.salePrice;
      lines.push({ id: hit.it.id, category: hit.cat, item: hit.it.name, qty: qty, price: price,
                   origPrice: hit.it.price, pct: useVip ? vipPct : hit.it.pct, vip: useVip,
                   giftQty: Math.min(Math.max(Math.floor(Number(l.giftQty)) || 0, 0), qty) });
    }

    // payment is only needed when something with a price is ordered
    if (lines.length && g.payments.indexOf(p.payment) < 0) {
      return json_({ ok: false, status: pub, error: 'That payment option is no longer available. Please choose a payment method again.' });
    }

    const want = {}, wantItem = {};
    lines.forEach(l => {
      want[l.category] = (want[l.category] || 0) + l.qty;
      wantItem[l.id] = (wantItem[l.id] || 0) + l.qty;
    });
    if (wed) {
      const over = Object.keys(want).filter(cat => {
        const cap = st.capacity[cat];
        return cap !== undefined && (st.used[cat] || 0) + want[cat] > cap;
      });
      if (over.length) {
        return json_({ ok: false, status: pub,
          error: g.fullMessage + ' (' + over.join(', ') + ': someone just grabbed the last spots. Please adjust your order.)' });
      }
    }
    // item quantities: weekly ones only on standard pickup, "Total" ones on every pickup type
    const overItems = Object.keys(wantItem).filter(id => {
      const it = byId[id].it;
      return (wed || it.lifetime) && it.left !== null && wantItem[id] > it.left;
    }).map(id => byId[id].it.name);
    if (overItems.length) {
      return json_({ ok: false, status: pub,
        error: g.fullMessage + ' (' + overItems.join(', ') + ': someone just grabbed the last ones. Please adjust your order.)' });
    }

    // the custom request becomes its own $0 line, added after all the quantity checks above
    const vipApplied = lines.some(l => l.vip);
    const customOnly = customReq && lines.length === 0;
    if (customReq) lines.push({ id: 'custom', category: 'Custom Request', item: 'Custom request (see special notes)', qty: 1, price: 0, giftQty: 0, custom: true });

    const orderId = Utilities.formatDate(new Date(), tz_(), 'MMdd') + '-' + Math.floor(1000 + Math.random() * 9000);
    const giftCount = lines.reduce((s, l) => s + l.giftQty, 0);
    const giftFee = giftCount * g.giftFee;
    const total = Math.round((lines.reduce((s, l) => s + l.qty * l.price, 0) + giftFee) * 100) / 100;
    const savings = Math.round(lines.reduce((s, l) => s + (l.custom ? 0 : l.qty * (l.origPrice - l.price)), 0) * 100) / 100;
    const now = new Date();
    const status = wed ? 'New' : 'Custom request - pending';
    const sh = sheet_();
    const rows = lines.map(l => [now, orderId, p.name, p.email, p.phone || '', wed ? st.pickupDayName : CUSTOM_PICKUP,
      wed ? st.pickupDate : '', l.category, l.item, l.qty, l.price,
      Math.round(l.qty * l.price * 100) / 100, total, p.notes || '',
      p.payment || '', giftCount ? (p.giftMessage || '(gift)') : '', giftFee, l.custom ? 'Custom request - pending' : status, l.giftQty, p.whatsapp || '', l.id,
      l.pct ? l.pct + '%' : '', l.custom ? '' : l.origPrice]);
    sh.getRange(sh.getLastRow() + 1, 1, rows.length, HEADERS.length).setValues(rows);
    try { CacheService.getScriptCache().remove('status'); } catch (err) { /* ignore */ } // next visitor sees fresh counts

    if (g.notifyEmail) {
      const body = lines.map(l => l.qty + ' x ' + l.item + (l.pct ? ' [' + l.pct + '% off]' : '') + (l.giftQty ? ' [' + l.giftQty + ' as gift]' : '')).join('\n') +
        (savings > 0 ? '\n\nDiscount savings: $' + savings.toFixed(2) : '') +
        (vipApplied ? '\nFriends & family discount applied (' + vipPct + '%)' : '') +
        '\n\nGift packaging: $' + giftFee.toFixed(2) + (giftCount ? ' (' + giftCount + ' gift item(s)) - ' + (p.giftMessage || '') : '') + '\nPayment: ' + (p.payment || '') + '\nTotal: $' + total.toFixed(2) + '\nPickup: ' + (wed ? st.pickupDayName + ' (' + st.pickupDate + ') ' + st.pickupTime : 'CUSTOM REQUEST (needs your OK)') +
        '\n\n' + p.name + ' / ' + p.email + ' / ' + (p.phone || '') + '\n' + (p.notes || '');
      MailApp.sendEmail(g.notifyEmail, ((wed && !customReq) ? 'New sourdough order ' : (customReq && wed && !customOnly ? 'New order + CUSTOM request ' : 'CUSTOM sourdough request ')) + orderId, body);
    }
    let emailSent = false;
    if (g.emailCustomer && /^\S+@\S+\.\S+$/.test(String(p.email).trim())) {
      try {
        sendConfirmation_({
          name: p.name, email: String(p.email).trim(), orderId: orderId, wed: wed, lines: lines, total: total,
          customRequest: customReq, customOnly: customOnly, savings: savings, vip: vipApplied,
          giftFee: giftFee, giftCount: giftCount, giftMessage: p.giftMessage || '', notes: p.notes || '', payment: p.payment || '',
          pickupDayName: st.pickupDayName,
          pickupNote: st.pickupNote,
          replyTo: g.notifyEmail,
          pickupLabel: wed ? Utilities.formatDate(Utilities.parseDate(st.pickupDate, tz_(), 'yyyy-MM-dd'), tz_(), 'MMM d') : ''
        });
        emailSent = true;
      } catch (mailErr) { /* the order is already saved; a failed email must not fail the order */ }
    }
    return json_({ ok: true, customOnly: customOnly, orderId: orderId, total: total, savings: savings, vip: vipApplied, giftFee: giftFee, emailSent: emailSent, pickupDate: wed ? st.pickupDate : '', pickupDayName: wed ? st.pickupDayName : '', pickupTime: wed ? st.pickupTime : '' });
  } catch (err) {
    return json_({ ok: false, error: 'Server error: ' + err.message });
  } finally {
    lock.releaseLock();
  }
}