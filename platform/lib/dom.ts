/**
 * A very small DOM helper layer.
 *
 * The public site is plain HTML with no framework, and the portal keeps that
 * property on purpose: a future committee should be able to read this code
 * without first learning a framework, and the site should keep deploying as
 * static files. `h()` is all the abstraction the portal actually needs.
 *
 * Everything goes through textContent or explicit attribute setting, so member
 * and applicant text is never interpolated into markup.
 */

type Falsy = null | undefined | false;
export type Child = Node | string | number | Falsy | Child[];

export interface Attrs {
  class?: string;
  id?: string;
  html?: string;              // trusted, author-written markup only
  dataset?: Record<string, string | undefined>;
  style?: Partial<CSSStyleDeclaration> | string;
  [key: string]: unknown;
}

function appendChild(parent: Node, child: Child): void {
  if (child === null || child === undefined || child === false) return;
  if (Array.isArray(child)) {
    for (const item of child) appendChild(parent, item);
  } else if (child instanceof Node) {
    parent.appendChild(child);
  } else {
    parent.appendChild(document.createTextNode(String(child)));
  }
}

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs?: Attrs | Child,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);

  const isAttrs = attrs !== null && typeof attrs === 'object' &&
    !Array.isArray(attrs) && !(attrs instanceof Node);

  if (isAttrs) {
    for (const [key, value] of Object.entries(attrs as Attrs)) {
      if (value === null || value === undefined || value === false) continue;

      if (key === 'class') {
        el.className = String(value);
      } else if (key === 'html') {
        el.innerHTML = String(value);
      } else if (key === 'dataset') {
        for (const [dk, dv] of Object.entries(value as Record<string, string>)) {
          if (dv !== undefined) el.dataset[dk] = dv;
        }
      } else if (key === 'style' && typeof value === 'object') {
        Object.assign(el.style, value);
      } else if (key.startsWith('on') && typeof value === 'function') {
        el.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
      } else if (value === true) {
        el.setAttribute(key, '');
      } else {
        el.setAttribute(key, String(value));
      }
    }
  } else if (attrs !== undefined) {
    appendChild(el, attrs as Child);
  }

  for (const child of children) appendChild(el, child);
  return el;
}

/** Replaces an element's contents in one go. */
export function render(target: Element | null, ...children: Child[]): void {
  if (!target) return;
  target.replaceChildren();
  for (const child of children) appendChild(target, child);
}

export function qs<T extends Element = HTMLElement>(selector: string, scope: ParentNode = document): T | null {
  return scope.querySelector<T>(selector);
}

export function mount(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Expected an element with id="${id}" on this page.`);
  return el;
}

/** Reads a form into a plain object, trimming strings and collecting repeats. */
export function formValues(form: HTMLFormElement): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const [key, raw] of new FormData(form).entries()) {
    const value = typeof raw === 'string' ? raw.trim() : '';
    const existing = out[key];
    if (existing === undefined) {
      out[key] = value;
    } else if (Array.isArray(existing)) {
      existing.push(value);
    } else {
      out[key] = [existing, value];
    }
  }
  return out;
}

/** Always an array, even when a multi-select yielded one value or none. */
export function asArray(value: string | string[] | undefined): string[] {
  if (value === undefined) return [];
  return (Array.isArray(value) ? value : [value]).filter((v) => v !== '');
}

/** One string from formValues(), never undefined. */
export function textOf(values: Record<string, string | string[]>, key: string): string {
  const value = values[key];
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value[0] ?? '';
  return '';
}
