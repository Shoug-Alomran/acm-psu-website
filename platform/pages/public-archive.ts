/**
 * The public digital archive, across every project.
 *
 * The per-project archive pages already in the repository keep working and are
 * untouched. This adds what a static manifest cannot: one place to search
 * everything the club has ever published, with folders, filters, previews and
 * a grid or list view.
 *
 * Only rows the archive policies allow are ever returned — anonymous visitors
 * see published public items, signed-in members additionally see internal
 * ones. The browser is not deciding that; the database is.
 */
import { h, render } from '../lib/dom.js';
import { isConfigured, supabase } from '../lib/supabase.js';
import { archiveDate, fileSize } from '../lib/format.js';
import { itemUrl, archiveItems, archiveFolders, projects, archiveCategories } from '../lib/api.js';
import type { ArchiveFolder, ArchiveItem, ArchiveCategory, Project } from '../lib/types.js';

function icon(item: ArchiveItem): string {
  if (item.kind === 'link') return '↗';
  const format = (item.format ?? item.mime_type ?? '').toLowerCase();
  if (format.includes('image')) return '▧';
  if (format.includes('html')) return '◇';
  if (format.includes('zip')) return '▢';
  return '▤';
}

function badge(item: ArchiveItem): string {
  if (item.kind === 'link') return 'LINK';
  return (item.format ?? item.mime_type?.split('/').pop() ?? 'FILE').toUpperCase();
}

async function start(): Promise<void> {
  const host = document.getElementById('archive-browser');
  if (!host) return;

  if (!isConfigured || !supabase) {
    render(host, h('p', { class: 'mono-meta dim-text' },
      'ARCHIVE INDEX UNAVAILABLE — browse the per-project archives from the projects page.'));
    return;
  }

  const [allProjects, allFolders, categories] = await Promise.all([
    projects(), archiveFolders(), archiveCategories(),
  ]);

  const projectTitle = new Map(allProjects.map((p: Project) => [p.id, p.title]));
  const folderName = new Map(allFolders.map((f: ArchiveFolder) => [f.id, f.name]));

  let search = '';
  let projectFilter = '';
  let categoryFilter = '';
  let folderId: string | null | undefined = undefined;   // undefined = every item
  let gridView = false;

  const listHost = h('div', { class: 'browser-list' });
  const crumbs = h('nav', { class: 'browser-crumbs', 'aria-label': 'Archive location' });
  const countLabel = h('span', { class: 'mono-meta dim-text' });

  async function open(item: ArchiveItem): Promise<void> {
    const url = await itemUrl(item);
    if (url) window.open(url, item.kind === 'link' ? '_blank' : '_self', 'noopener');
  }

  async function draw(): Promise<void> {
    render(listHost, h('div', { class: 'loading-state mono-meta' }, 'LOADING…'));

    const items = await archiveItems({
      ...(projectFilter ? { projectId: projectFilter } : {}),
      ...(folderId !== undefined ? { folderId } : {}),
      ...(search ? { search } : {}),
    });

    const visible = categoryFilter
      ? items.filter((item: ArchiveItem) => item.category === categoryFilter)
      : items;

    // Folders belonging to the current location, so the browser can be walked.
    const childFolders = allFolders.filter((folder: ArchiveFolder) =>
      (!projectFilter || folder.project_id === projectFilter) &&
      (folderId === undefined
        ? folder.parent_id === null
        : folder.parent_id === (folderId ?? null)) &&
      !search);

    render(crumbs,
      h('button', { type: 'button', onclick: () => { folderId = undefined; void draw(); } },
        'ARCHIVE'),
      folderId
        ? [h('span', { 'aria-hidden': 'true' }, '/'),
           h('span', { class: 'accent-text' }, folderName.get(folderId) ?? '')]
        : null);

    countLabel.textContent = `${visible.length} RECORD${visible.length === 1 ? '' : 'S'}`;

    if (!childFolders.length && !visible.length) {
      render(listHost, h('div', { class: 'empty-state' },
        h('span', { class: 'mono-meta' }, 'NO RECORDS'),
        h('p', search ? 'Nothing matches that search.' : 'Nothing published here yet.')));
      return;
    }

    render(listHost,
      childFolders.map((folder: ArchiveFolder) =>
        h('button', {
          type: 'button', class: 'browser-row',
          onclick: () => { folderId = folder.id; void draw(); },
        },
          h('div', { class: 'fname' },
            h('span', { class: 'icon' }, '▣'), h('span', folder.name)),
          h('span', { class: 'fcell' }, 'DIR'),
          h('span', { class: 'fcell col-hide' },
            folder.project_id ? projectTitle.get(folder.project_id) ?? '' : ''),
          h('span', { class: 'fcell col-hide' }, folder.section.toUpperCase()),
          h('span', { class: 'file-act' }, '→'))),

      visible.map((item: ArchiveItem) =>
        h('button', {
          type: 'button', class: 'browser-row',
          onclick: () => void open(item),
        },
          h('div', { class: 'fname' },
            h('span', { class: 'icon' }, icon(item)), h('span', item.name)),
          h('span', { class: 'fcell' }, badge(item)),
          h('span', { class: 'fcell col-hide' },
            item.project_id ? projectTitle.get(item.project_id) ?? '' : ''),
          h('span', { class: 'fcell col-hide' },
            item.size_label ?? fileSize(item.size_bytes)),
          h('span', { class: 'file-act' }, '›'))),
    );
  }

  const searchInput = h('input', {
    type: 'search', placeholder: 'Search the archive…', 'aria-label': 'Search the archive',
  }) as HTMLInputElement;

  let timer = 0;
  searchInput.addEventListener('input', () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      search = searchInput.value.trim();
      if (search) folderId = undefined;
      void draw();
    }, 250);
  });

  const projectSelect = h('select', { 'aria-label': 'Filter by project' },
    h('option', { value: '' }, 'All projects'),
    allProjects.map((p: Project) => h('option', { value: p.id }, p.title))) as HTMLSelectElement;
  projectSelect.addEventListener('change', () => {
    projectFilter = projectSelect.value; folderId = undefined; void draw();
  });

  const categorySelect = h('select', { 'aria-label': 'Filter by category' },
    h('option', { value: '' }, 'All categories'),
    categories.map((c: ArchiveCategory) =>
      h('option', { value: c.slug }, c.label))) as HTMLSelectElement;
  categorySelect.addEventListener('change', () => {
    categoryFilter = categorySelect.value; void draw();
  });

  const viewButton = h('button', { type: 'button', class: 'btn-ghost' }, 'GRID');
  viewButton.addEventListener('click', () => {
    gridView = !gridView;
    listHost.classList.toggle('is-grid', gridView);
    viewButton.textContent = gridView ? 'LIST' : 'GRID';
  });

  render(host,
    h('div', { class: 'browser-toolbar' },
      searchInput, projectSelect, categorySelect, viewButton, countLabel),
    crumbs,
    listHost);

  await draw();
}

void start().catch(() => {
  const host = document.getElementById('archive-browser');
  if (host) {
    render(host, h('p', { class: 'mono-meta dim-text' },
      'ARCHIVE INDEX UNAVAILABLE — the per-project archives are still browsable.'));
  }
});
