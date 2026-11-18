// Node 26 owns the `localStorage` global, and it is undefined unless the
// process was started with --localstorage-file. Under jsdom that global is the
// only one there is: jsdom's window IS globalThis here, so there is no second
// implementation to fall back to, and every test touching storage fails with
// "Cannot read properties of undefined (reading 'clear')" without naming the
// Node version as the cause.
//
// The methods go on `Storage.prototype`, not on a subclass, because tests spy
// on `Storage.prototype.setItem` to simulate private mode and a quota error. A
// subclass with its own methods shadows the prototype, so the spy would be
// installed somewhere nothing ever reads and the test would pass vacuously.
// Only under a DOM environment. Files marked `@vitest-environment node` get
// Node's own Storage, whose `length` is not configurable, and they do not touch
// storage anyway.
const isDom = typeof document !== 'undefined';

const StorageCtor: { prototype: Storage; new (): Storage } =
  (globalThis as { Storage?: { prototype: Storage; new (): Storage } }).Storage ??
  (class Storage {} as unknown as { prototype: Storage; new (): Storage });

const backing = new WeakMap<object, Map<string, string>>();
const dataOf = (self: object) => {
  let m = backing.get(self);
  if (!m) backing.set(self, (m = new Map()));
  return m;
};

const define = (target: object, name: string, desc: PropertyDescriptor) => {
  try {
    Object.defineProperty(target, name, desc);
  } catch {
    // A host that owns this property and will not yield it. Leave it alone:
    // the environments that need the polyfill are the ones that have none.
  }
};

if (isDom) Object.entries({
  length: { configurable: true, get(this: object) { return dataOf(this).size; } },
  clear: { configurable: true, writable: true, value(this: object) { dataOf(this).clear(); } },
  getItem: {
    configurable: true, writable: true,
    value(this: object, key: string) { const m = dataOf(this); return m.has(String(key)) ? m.get(String(key))! : null; },
  },
  key: {
    configurable: true, writable: true,
    value(this: object, i: number) { return Array.from(dataOf(this).keys())[i] ?? null; },
  },
  removeItem: {
    configurable: true, writable: true,
    value(this: object, key: string) { dataOf(this).delete(String(key)); },
  },
  setItem: {
    configurable: true, writable: true,
    value(this: object, key: string, value: string) { dataOf(this).set(String(key), String(value)); },
  },
}).forEach(([name, desc]) => define(StorageCtor.prototype, name, desc as PropertyDescriptor));

for (const name of isDom ? (['localStorage', 'sessionStorage'] as const) : []) {
  if ((globalThis as Record<string, unknown>)[name]) continue;
  define(globalThis, name, {
    configurable: true,
    writable: true,
    value: Object.create(StorageCtor.prototype) as Storage,
  });
}

// jsdom implements none of the Web Animations API. Svelte's `animate:`
// directive reads `getAnimations()` on an element about to leave a keyed each,
// and throws where the method does not exist. The kit's presets return a zero
// duration wherever `Element.animate` is missing, so an empty list is the
// truthful answer in an environment that cannot animate.
if (isDom && typeof Element.prototype.getAnimations !== 'function') {
  define(Element.prototype, 'getAnimations', {
    configurable: true,
    writable: true,
    value: () => [],
  });
}
