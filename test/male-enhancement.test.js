// Male Enhancement category tests: one canonical category ("libo"), browsed as a
// single grid with Images / Videos filters instead of one tile per page.
//
// The site is a single static index.html with an inline <script> and no build
// tooling, so this harness runs the real inline script (via Node's vm module)
// against a small fake DOM built from the actual cards in index.html. The
// assertions exercise the production code itself, not a re-implementation.
//
// Run with: node test/male-enhancement.test.js

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

function decodeEntities(s) {
  return s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

// One record per card: its data-* attributes plus what its creative markup holds.
function parseCards(rawHtml) {
  const parts = rawHtml.split(/(?=<div class="card")/).filter((p) => p.startsWith('<div class="card"'));
  return parts.map((p) => {
    const tag = p.slice(0, p.indexOf('>') + 1);
    const dataset = {};
    const attrRe = /data-([a-z-]+)="([^"]*)"/g;
    let m;
    while ((m = attrRe.exec(tag)) !== null) {
      dataset[m[1].replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = decodeEntities(m[2]);
    }
    const creative = p.split('<div class="card-actions">')[0];
    return { dataset, hasVideoTag: /<video[\s>]/.test(creative), hasImgTag: /<img[^>]*data-src=/.test(creative) };
  });
}

class Element {
  constructor(tag) {
    this.tagName = tag;
    this.style = {};
    this.dataset = {};
    this.children = [];
    this.textContent = '';
    this.className = '';
    this.value = '';
    this.checked = false;
    this.disabled = false;
    this._classes = new Set();
    const self = this;
    this.classList = {
      add(c) { self._classes.add(c); },
      remove(c) { self._classes.delete(c); },
      contains(c) { return self._classes.has(c); },
      toggle(c, on) {
        if (on === undefined ? !self._classes.has(c) : on) self._classes.add(c); else self._classes.delete(c);
      },
    };
  }
  set innerHTML(v) { this.children = []; this._html = v; }
  get innerHTML() { return this._html || ''; }
  get options() { return this.children; }
  appendChild(el) { this.children.push(el); return el; }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  addEventListener() {}
  setAttribute() {}
  getAttribute() { return null; }
}

function cardMatches(card, selector) {
  if (!selector.startsWith('.card')) return false;
  const attrRe = /\[data-([a-z-]+)="((?:[^"\\]|\\.)*)"\]/g;
  let m;
  while ((m = attrRe.exec(selector)) !== null) {
    const key = m[1].replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    if (card.dataset[key] !== m[2]) return false;
  }
  return true;
}

// A fresh page: the real inline script run against `records`, routed to `url`.
function loadPage(records, url = '/') {
  const u = new URL(url, 'http://localhost');
  const cards = records.map((r) => {
    const el = new Element('div');
    el.className = 'card';
    el.dataset = Object.assign({}, r.dataset);
    return el;
  });
  const byId = new Map();
  const getElementById = (id) => {
    if (!byId.has(id)) byId.set(id, new Element('div'));
    return byId.get(id);
  };
  const backBtn = new Element('button');
  const grid = new Element('div');
  grid.querySelectorAll = (sel) => (sel === '.card' ? cards.slice() : []);
  grid.appendChild = (el) => {
    const i = cards.indexOf(el);
    if (i !== -1) cards.splice(i, 1);
    cards.push(el);
    return el;
  };
  const document = {
    getElementById,
    createElement: (tag) => new Element(tag),
    querySelectorAll: (sel) => cards.filter((c) => cardMatches(c, sel)),
    querySelector: (sel) => (sel === '.grid' ? grid : sel === '#categoryHeader .back-btn' ? backBtn : null),
    addEventListener() {},
    body: new Element('body'),
  };
  const location = { pathname: u.pathname, search: u.search };
  const setUrl = (p) => { const n = new URL(p, 'http://localhost'); location.pathname = n.pathname; location.search = n.search; };
  const context = {
    document,
    window: { location, addEventListener() {}, scrollTo() {} },
    history: { state: null, pushState(s, t, p) { setUrl(p); }, replaceState(s, t, p) { setUrl(p); } },
    URLSearchParams,
    console,
  };
  context.window.document = document;
  vm.createContext(context);
  vm.runInContext(inlineScript, context);
  const visible = () => cards.filter((c) => c.style.display !== 'none' && context.currentCategory !== null &&
    getElementById('categoryHeader').style.display === 'flex');
  return { ctx: context, cards, byId: getElementById, backBtn, location, visible };
}

function extractInlineScript(rawHtml) {
  const scriptRe = /<script>([\s\S]*?)<\/script>/g;
  let m;
  while ((m = scriptRe.exec(rawHtml)) !== null) {
    if (m[1].includes('var currentSection')) return m[1];
  }
  throw new Error('Could not locate inline app script in index.html');
}

const inlineScript = extractInlineScript(html);
const records = parseCards(html);
const meRecords = records.filter((r) => r.dataset.category === 'libo');
const spiedMe = meRecords.filter((r) => r.dataset.section === 'spied');
const expected = {
  total: meRecords.length,
  spied: spiedMe.length,
  images: spiedMe.filter((r) => r.dataset.mediaType === 'image').length,
  videos: spiedMe.filter((r) => r.dataset.mediaType === 'video').length,
};

// Category tile names/counts as built by the page for a section.
function categoryTiles(page, section) {
  page.ctx.buildCategoryTiles(section);
  return page.byId('sectionCategoryTiles').children.map((tile) => {
    const label = tile.children.find((c) => c.className === 'category-tile-label');
    const name = label.children.find((c) => c.className === 'cat-name').textContent;
    const count = label.children.find((c) => c.className === 'cat-count').textContent;
    return { name, count };
  });
}

const tests = [];

tests.push(['index.html stores no card under the raw "male-enhancement" category', () => {
  assert.strictEqual(records.filter((r) => r.dataset.category === 'male-enhancement').length, 0);
  assert.ok(/'libo': 'Male Enhancement'/.test(html), 'canonical label must stay libo -> Male Enhancement');
  assert.ok(!/'male-enhancement'\s*:/.test(html), 'CATEGORY_LABELS must not gain a male-enhancement key');
}]);

tests.push(['Male Enhancement inventory: 170 cards, 149 spied (79 images / 70 videos), 24 Rugiet merged in', () => {
  assert.deepStrictEqual(expected, { total: 170, spied: 149, images: 79, videos: 70 });
  const rugiet = meRecords.filter((r) => r.dataset.page === 'Rugiet');
  assert.strictEqual(rugiet.length, 24);
  assert.ok(rugiet.every((r) => r.dataset.section === 'spied'));
}]);

tests.push(['no duplicate Ad IDs or filenames inside Male Enhancement', () => {
  const ids = meRecords.map((r) => (r.dataset.adText.match(/(?:Ad Library|Google Ads) ID: (\w+)/) || [])[1]).filter(Boolean);
  assert.strictEqual(new Set(ids).size, ids.length, 'duplicate Ad ID');
  const fns = meRecords.map((r) => r.dataset.filename);
  assert.strictEqual(new Set(fns).size, fns.length, 'duplicate filename');
}]);

tests.push(['canonicalCategory folds every Male Enhancement spelling onto "libo"', () => {
  const { ctx } = loadPage(records);
  ['Male Enhancement', 'male enhancement', 'male-enhancement', 'Male-Enhancement', 'MALE ENHANCEMENT',
    'male_enhancement', '  Male   Enhancement ', 'libo', 'LIBO'].forEach((raw) => {
    assert.strictEqual(ctx.canonicalCategory(raw), 'libo', raw);
  });
  assert.strictEqual(ctx.canonicalCategory('cbd'), 'cbd');
  assert.strictEqual(ctx.canonicalCategory('CBD Pain Relief'), 'cbd');
  assert.strictEqual(ctx.canonicalCategory('Joint Pain'), 'joint-pain');
  assert.strictEqual(ctx.canonicalCategory('something-new'), 'something-new', 'unknown categories pass through');
}]);

tests.push(['a future card tagged with any Male Enhancement spelling joins the one category', () => {
  const stray = ['male-enhancement', 'MALE ENHANCEMENT', 'Male-Enhancement'].map((cat, i) => ({
    dataset: Object.assign({}, spiedMe[0].dataset, { category: cat, filename: 'stray-' + i, index: String(90000 + i) }),
  }));
  const page = loadPage(records.concat(stray));
  assert.strictEqual(page.cards.filter((c) => c.dataset.category !== 'libo' && /male|enhancement/i.test(c.dataset.category)).length, 0);
  const tiles = categoryTiles(page, 'spied').filter((t) => /male|enhancement/i.test(t.name));
  assert.deepStrictEqual(tiles.map((t) => t.name), ['Male Enhancement']);
  assert.ok(tiles[0].count.startsWith(String(expected.spied + 3) + ' ads'), tiles[0].count);
}]);

tests.push(['exactly one visible Male Enhancement category tile per section', () => {
  const page = loadPage(records);
  const spied = categoryTiles(page, 'spied').filter((t) => /male|enhancement/i.test(t.name));
  assert.deepStrictEqual(spied, [{ name: 'Male Enhancement', count: '149 ads · 79 images · 70 videos' }]);
  const fresh = categoryTiles(page, 'fresh').filter((t) => /male|enhancement/i.test(t.name));
  assert.strictEqual(fresh.length, 1);
}]);

tests.push(['opening Male Enhancement shows one grid, not per-page tiles', () => {
  const page = loadPage(records);
  page.ctx.showSection('spied');
  page.ctx.showCategory('libo');
  assert.strictEqual(page.byId('brandScreen').style.display, 'none', 'page tiles screen must stay hidden');
  assert.strictEqual(page.byId('brandTiles').children.length, 0, 'no page tiles are built');
  assert.strictEqual(page.byId('categoryHeader').style.display, 'flex');
  assert.strictEqual(page.ctx.currentBrand, null);
  assert.strictEqual(page.byId('categoryTitleActive').textContent, 'Male Enhancement (Spied)');
  assert.strictEqual(page.backBtn.textContent, '← Back to categories');
  const shown = page.visible();
  assert.strictEqual(shown.length, 149);
  const pages = new Set(shown.map((c) => c.dataset.page));
  assert.ok(pages.has('Rugiet') && pages.size > 1, 'all advertisers appear together in one grid');
  assert.strictEqual(page.location.pathname, '/spied/male-enhancement');
}]);

tests.push(['Images / Videos filters with counts classify every creative', () => {
  const page = loadPage(records, '/spied/male-enhancement');
  assert.strictEqual(page.byId('filterAll').textContent, 'All (149)');
  assert.strictEqual(page.byId('filterImages').textContent, 'Images (79)');
  assert.strictEqual(page.byId('filterVideos').textContent, 'Videos (70)');
  page.ctx.setMediaFilter('image');
  assert.strictEqual(page.visible().length, 79);
  assert.ok(page.visible().every((c) => c.dataset.mediaType === 'image'));
  page.ctx.setMediaFilter('video');
  assert.strictEqual(page.visible().length, 70);
  assert.ok(page.visible().every((c) => c.dataset.mediaType === 'video'));
  // The stored media type matches the creative markup: video tag <=> video.
  meRecords.forEach((r) => {
    assert.ok(r.dataset.mediaType === 'image' || r.dataset.mediaType === 'video', r.dataset.filename);
    assert.strictEqual(r.hasVideoTag, r.dataset.mediaType === 'video', r.dataset.filename);
  });
}]);

tests.push(['advertiser/page metadata is preserved on every Male Enhancement card', () => {
  const page = loadPage(records, '/spied/male-enhancement');
  const before = new Map(meRecords.map((r) => [r.dataset.filename, r.dataset]));
  page.visible().forEach((c) => {
    const orig = before.get(c.dataset.filename);
    assert.ok(c.dataset.page && c.dataset.brand, c.dataset.filename + ' lost page/brand');
    assert.strictEqual(c.dataset.page, orig.page);
    assert.strictEqual(c.dataset.brand, orig.brand);
  });
  assert.ok(meRecords.filter((r) => r.dataset.page === 'Rugiet').every((r) => r.dataset.brand === 'Rugiet'));
}]);

tests.push(['a Male Enhancement page link opens the whole category, not a page-only section', () => {
  const pageName = [...new Set(spiedMe.map((r) => r.dataset.page))]
    .find((p) => records.filter((r) => r.dataset.page === p).every((r) => r.dataset.category === 'libo'));
  const slug = pageName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const page = loadPage(records, '/' + slug);
  assert.strictEqual(page.ctx.currentCategory, 'libo');
  assert.strictEqual(page.ctx.currentBrand, null);
  assert.strictEqual(page.visible().length, 149);
}]);

tests.push(['Fresh Male Enhancement is flat too; Back returns to the category tiles', () => {
  const page = loadPage(records, '/fresh/male-enhancement');
  assert.strictEqual(page.visible().length, meRecords.filter((r) => r.dataset.section === 'fresh').length);
  page.ctx.backToBrands();
  assert.strictEqual(page.byId('sectionScreen').style.display, 'flex');
  assert.strictEqual(page.visible().length, 0);
}]);

tests.push(['source filter still combines with the flat Male Enhancement grid', () => {
  const page = loadPage(records, '/spied/male-enhancement');
  page.ctx.setSourceFilter('google');
  assert.strictEqual(page.visible().length, spiedMe.filter((r) => r.dataset.source === 'google').length);
  page.ctx.setSourceFilter('meta');
  assert.strictEqual(page.visible().length, spiedMe.filter((r) => (r.dataset.source || 'meta') === 'meta').length);
}]);

tests.push(['other categories keep page tiles and per-page grids', () => {
  const page = loadPage(records);
  page.ctx.showSection('spied');
  page.ctx.showCategory('bizopp');
  assert.strictEqual(page.byId('brandScreen').style.display, 'flex');
  const tiles = page.byId('brandTiles').children.length;
  assert.ok(tiles > 1, 'bizopp still shows one tile per page');
  const brand = records.find((r) => r.dataset.category === 'bizopp' && r.dataset.section === 'spied').dataset.page;
  page.ctx.showBrand(brand);
  assert.ok(page.visible().length > 0);
  assert.ok(page.visible().every((c) => c.dataset.page === brand && c.dataset.category === 'bizopp'));
  assert.strictEqual(page.backBtn.textContent, '← Back to pages');
}]);

let failures = 0;
for (const [name, fn] of tests) {
  try {
    fn();
    console.log('ok   -', name);
  } catch (err) {
    failures++;
    console.error('FAIL -', name);
    console.error('     ', err.message);
  }
}
if (failures) {
  console.error(`\n${failures} of ${tests.length} test(s) failed`);
  process.exit(1);
}
console.log(`\nAll ${tests.length} tests passed`);
