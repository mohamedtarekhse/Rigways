import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const appJs = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const assetsHtml = readFileSync(new URL('../assets.html', import.meta.url), 'utf8');

function extract(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  assert.notEqual(from, -1, `Missing start marker: ${start}`);
  assert.notEqual(to, -1, `Missing end marker: ${end}`);
  return source.slice(from, to);
}

class FakeLink {
  constructor(href) {
    this.href = href;
    this.parent = null;
    this.className = 'sap-nav-item';
  }
  getAttribute(name) {
    return name === 'href' ? this.href : '';
  }
  remove() {
    if (!this.parent) return;
    this.parent.children = this.parent.children.filter((child) => child !== this);
    this.parent = null;
  }
}

class FakeNav {
  constructor(hrefs) {
    this.children = hrefs.map((href) => {
      const link = new FakeLink(href);
      link.parent = this;
      return link;
    });
  }
  querySelectorAll(selector) {
    if (selector === 'a.sap-nav-item') return this.children.filter((child) => child instanceof FakeLink);
    return [];
  }
  appendChild(child) {
    if (child instanceof FakeLink) child.parent = this;
    this.children.push(child);
  }
  set innerHTML(_value) {
    this.children = [];
  }
}

function runNormalize(role) {
  const nav = new FakeNav([
    'assets.html',
    'certificates.html',
    'clients.html',
    'inspectors.html',
    'functional-locations.html',
    'jobs.html',
    'notifications.html',
  ]);
  const context = {
    document: {
      querySelectorAll(selector) {
        return selector === '.sap-navbar__inner' ? [nav] : [];
      },
      createElement(tag) {
        return { tag, className: '', id: '' };
      },
    },
  };
  const code = extract(appJs, 'function normalizeNavbarStructure(role) {', 'function applyPageBodyClass()');
  vm.runInNewContext(`${code}; normalizeNavbarStructure(${JSON.stringify(role)});`, context);
  return nav.children.filter((child) => child instanceof FakeLink).map((link) => link.href);
}

assert.deepEqual(runNormalize('user'), ['assets.html', 'certificates.html']);
assert.deepEqual(runNormalize('technician'), ['assets.html', 'certificates.html']);
assert.deepEqual(runNormalize('manager'), ['assets.html', 'certificates.html', 'jobs.html', 'notifications.html']);
assert.deepEqual(runNormalize('admin'), [
  'assets.html',
  'certificates.html',
  'jobs.html',
  'notifications.html',
  'clients.html',
  'inspectors.html',
  'functional-locations.html',
]);

assert.match(
  assetsHtml,
  /id="locationFilter"[^>]*data-hide-roles="user"|data-hide-roles="user"[^>]*id="locationFilter"/,
  'Assets location filter must be hidden by the shared role visibility layer for user role',
);

console.log('user role nav visibility regression passed');
