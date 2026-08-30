import { h } from './dom.js';

export const DEFAULT_PAGE_SIZE = 7;

export function pageSlice<T>(rows: T[], page: number, pageSize = DEFAULT_PAGE_SIZE): {
  rows: T[];
  page: number;
  pages: number;
  start: number;
} {
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const current = Math.min(Math.max(page, 1), pages);
  const start = (current - 1) * pageSize;
  return { rows: rows.slice(start, start + pageSize), page: current, pages, start };
}

function pageButton(label: string, active: boolean, disabled: boolean, onClick: () => void): HTMLButtonElement {
  const button = h('button', {
    type: 'button',
    class: active ? 'btn-primary' : 'btn-ghost',
    disabled,
    style: { minWidth: '2.75rem' },
  }, label) as HTMLButtonElement;
  button.addEventListener('click', onClick);
  return button;
}

export function paginationControls(
  totalRows: number,
  page: number,
  setPage: (page: number) => void,
  pageSize = DEFAULT_PAGE_SIZE,
): HTMLElement | null {
  const pages = Math.max(1, Math.ceil(totalRows / pageSize));
  if (totalRows <= pageSize) return null;
  const current = Math.min(Math.max(page, 1), pages);
  const start = (current - 1) * pageSize;

  const controls = h('div', {
    class: 'button-row pager',
    style: { justifyContent: 'center', marginTop: '1.25rem', flexWrap: 'wrap' },
  });

  controls.append(pageButton('‹ Previous', false, current === 1, () => setPage(current - 1)));
  for (let n = 1; n <= pages; n += 1) {
    controls.append(pageButton(String(n), n === current, false, () => setPage(n)));
  }
  controls.append(pageButton('Next ›', false, current === pages, () => setPage(current + 1)));
  controls.append(h('span', { class: 'mono-meta dim-text', style: { alignSelf: 'center' } },
    `${start + 1}–${Math.min(start + pageSize, totalRows)} OF ${totalRows}`));

  return controls;
}
