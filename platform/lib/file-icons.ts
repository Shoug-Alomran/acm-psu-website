/**
 * Line-art file icons.
 *
 * The archive surfaces used to draw geometric glyphs (▣ ▤ ◇ …), which told a
 * visitor nothing: every row looked like the same abstract shape. These are
 * plain 24×24 stroke paths — a folder looks like a folder, a slide deck looks
 * like a screen — inheriting colour through `currentColor`, so they still pick
 * up the muted grey and the accent-blue hover of whatever row they sit in.
 *
 * The per-project archive pages carry the same set in `assets/js/archive.js`;
 * that file is a plain script served straight to the browser rather than part
 * of this bundle, so the paths are duplicated there on purpose. Change both.
 */

export type IconName = keyof typeof GLYPHS;

export const GLYPHS = {
  folder: '<path d="M3 6.6A1.6 1.6 0 0 1 4.6 5h4.1l1.9 2.5h9.8A1.6 1.6 0 0 1 22 9.1v8.3A1.6 1.6 0 0 1 20.4 19H4.6A1.6 1.6 0 0 1 3 17.4z"/>',
  folderStack: '<path d="M5.6 7.4V5.6A1.4 1.4 0 0 1 7 4.2h3.4l1.7 2.2h6.5a1.4 1.4 0 0 1 1.4 1.4v1.1"/><path d="M2 10.6A1.6 1.6 0 0 1 3.6 9h4.1l1.9 2.4h9.8A1.6 1.6 0 0 1 21 13v5.4A1.6 1.6 0 0 1 19.4 20H3.6A1.6 1.6 0 0 1 2 18.4z"/>',
  doc: '<path d="M6.5 3.2h7L18.5 8v12.8h-12z"/><path d="M13.3 3.2v5h5.2"/><path d="M9.4 13h6.2M9.4 16.2h6.2"/>',
  template: '<path d="M6.5 3.2h7L18.5 8v12.8h-12z"/><path d="M13.3 3.2v5h5.2"/><path d="M9.4 12.6h6.2M9.4 15.6h6.2M9.4 18.2h3.1" stroke-dasharray="2.2 2"/>',
  report: '<path d="M6.5 3.2h7L18.5 8v12.8h-12z"/><path d="M13.3 3.2v5h5.2"/><path d="M9.6 17.6v-3.1M12.5 17.6v-5.4M15.4 17.6v-2"/>',
  list: '<path d="M4.5 7h1.6M4.5 12h1.6M4.5 17h1.6M9.6 7h9.9M9.6 12h9.9M9.6 17h9.9"/>',
  slides: '<path d="M2.8 4.8h18.4v10.6H2.8z"/><path d="M12 15.4v3.4M9 20.2h6"/>',
  web: '<path d="M3 5.2h18v13.6H3z"/><path d="M3 9.4h18"/><path d="M5.9 7.3h1.3M9.1 7.3h1.3"/>',
  image: '<path d="M3 5.2h18v13.6H3z"/><path d="M3 15.2l4.7-4.6 4.1 4 3-2.5 6.2 5.3"/><circle cx="8.6" cy="9.1" r="1.5"/>',
  video: '<path d="M3 5.6h18v12.8H3z"/><path d="M3 9.4h18M3 14.6h18M7.6 5.6v3.8M7.6 14.6v3.8M16.4 5.6v3.8M16.4 14.6v3.8"/>',
  code: '<path d="M8.6 8.4L4.4 12l4.2 3.6M15.4 8.4l4.2 3.6-4.2 3.6M13.4 5.4l-2.8 13.2"/>',
  zip: '<path d="M4 7.4l8-3.6 8 3.6v9.2l-8 3.6-8-3.6z"/><path d="M4 7.4l8 3.6 8-3.6M12 11v9.2"/>',
  link: '<path d="M14.2 3.8h6v6"/><path d="M20.2 3.8l-8.8 8.8"/><path d="M18.2 13.6v5.2a1.6 1.6 0 0 1-1.6 1.6H5.4a1.6 1.6 0 0 1-1.6-1.6V7.6A1.6 1.6 0 0 1 5.4 6h5.2"/>',
} as const;

/** Author-written markup, safe for `h(..., { html })`. */
export function svgIcon(name: IconName): string {
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${GLYPHS[name]}</svg>`;
}
