import { downloadQueueDiv } from '../../globals.js';
import { isDesktopDevice } from '../../utils/device-detection.js';
import * as DownloadHistory from '../download-history.js';
import {
  clear,
  renderContent,
  safeHtml,
  safeRaw,
  DL_ICONS,
  installQueueTouchTracking,
  renderCollapsedPill,
  renderEmptyQueueModal
} from './ui-helpers.js';

export function updateDownloadQueueUI(manager) {
  if (!downloadQueueDiv) return;

  if (downloadQueueDiv._userTouching) {
    downloadQueueDiv._pendingUpdate = true;
    return;
  }
  installQueueTouchTracking(manager);

  const prevScroll = downloadQueueDiv.querySelector('.download-queue-scroll');
  const savedScrollTop = prevScroll ? prevScroll.scrollTop : 0;

  clear(downloadQueueDiv);

  if (typeof isDesktopDevice === 'function' && isDesktopDevice()) {
    downloadQueueDiv.classList.add('hidden');
    return;
  }

  const inProgressCount = manager.persistentQueue.filter(
    i => DownloadHistory.IN_PROGRESS_STATUSES.includes(i.status)
  ).length;
  if (inProgressCount === 0 && !manager.explicitlyOpen) {
    downloadQueueDiv.classList.add('hidden');
    return;
  }

  downloadQueueDiv.classList.remove('hidden');

  const activeCount = manager.persistentQueue.filter(i => i.status === 'pending' || i.status === 'downloading').length;
  const totalCount = manager.persistentQueue.length;

  if (manager.isCollapsed) {
    renderCollapsedPill(manager, activeCount, totalCount);
    return;
  }

  downloadQueueDiv.className = 'fixed bottom-0 right-4 sm:right-8 z-40 w-[22rem] max-w-[calc(100vw-2rem)] dl-queue-container';

  const header = document.createElement('div');
  header.className = 'modal-header';

  const dlIcon = document.createElement('div');
  dlIcon.className = 'dl-icon';
  renderContent(dlIcon, safeHtml`<svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`);
  header.appendChild(dlIcon);

  const titleLabel = document.createElement('span');
  titleLabel.className = 'modal-title';
  titleLabel.textContent = 'Downloads';
  header.appendChild(titleLabel);

  const counter = document.createElement('span');
  counter.className = 'modal-count';
  counter.textContent = `${activeCount} / ${totalCount}`;
  header.appendChild(counter);

  const actionGroup = document.createElement('div');
  actionGroup.className = 'header-actions';

  const collapseBtn = document.createElement('button');
  collapseBtn.type = 'button';
  collapseBtn.className = 'ha';
  collapseBtn.title = 'Collapse';
  renderContent(collapseBtn, safeHtml`<svg viewBox="0 0 24 24"><polyline points="18 15 12 9 6 15" stroke="currentColor" stroke-width="2" fill="none"/></svg>`);
  collapseBtn.onclick = (e) => {
    e.stopPropagation();
    manager.toggleCollapsed();
  };
  actionGroup.appendChild(collapseBtn);

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'ha';
  closeBtn.title = 'Close';
  renderContent(closeBtn, safeHtml`<svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18" stroke="currentColor" stroke-width="2"/><line x1="6" y1="6" x2="18" y2="18" stroke="currentColor" stroke-width="2"/></svg>`);
  closeBtn.onclick = (e) => {
    e.stopPropagation();
    manager.explicitlyOpen = false;
    downloadQueueDiv.classList.add('hidden');
  };
  actionGroup.appendChild(closeBtn);

  header.appendChild(actionGroup);
  downloadQueueDiv.appendChild(header);

  const parts = manager.getPartitioned();
  const tabDefs = [
    { key: 'in-progress', label: 'In Progress', items: parts.inProgress },
    { key: 'downloaded', label: 'Downloaded', items: parts.downloaded },
    { key: 'failed', label: 'Failed', items: parts.failed }
  ];
  if (!tabDefs.some(t => t.key === manager.activeTab)) manager.activeTab = 'in-progress';

  const tabBar = document.createElement('div');
  tabBar.className = 'dl-tabs';
  tabDefs.forEach(t => {
    const tabBtn = document.createElement('button');
    tabBtn.type = 'button';
    tabBtn.className = 'dl-tab' + (t.key === manager.activeTab ? ' active' : '');
    tabBtn.textContent = `${t.label} (${t.items.length})`;
    tabBtn.onclick = (e) => {
      e.stopPropagation();
      manager.activeTab = t.key;
      manager.updateQueueUI();
    };
    tabBar.appendChild(tabBtn);
  });
  downloadQueueDiv.appendChild(tabBar);

  const activeItems = (tabDefs.find(t => t.key === manager.activeTab) || tabDefs[0]).items;

  const queueContent = document.createElement('div');
  queueContent.className = 'download-queue-scroll';

  if (manager.activeTab === 'in-progress') {
    const syncIndicator = document.createElement('div');
    const syncText = document.createElement('p');
    renderContent(syncIndicator, safeHtml`<svg viewBox="0 0 24 24"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>`);
    if (manager.useBackgroundFetch) {
      syncIndicator.className = 'sync-notice sync-active';
      syncText.textContent = 'Downloads run one at a time — see progress in your notifications.';
    } else {
      syncIndicator.className = 'sync-notice sync-warning';
      syncText.textContent = 'Keep this tab open — background downloads unavailable on this device.';
    }
    syncIndicator.appendChild(syncText);
    queueContent.appendChild(syncIndicator);

    if (activeItems.length > 0) {
      const bar = document.createElement('div');
      bar.className = 'dl-batch-bar';
      const mk = (title, cls, icon, handler) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = `dl-batch-btn ${cls}`;
        b.title = title;
        b.setAttribute('aria-label', title);
        renderContent(b, safeRaw(icon));
        b.onclick = (e) => {
          e.stopPropagation();
          handler();
        };
        bar.appendChild(b);
      };
      mk('Start all', 'start', DL_ICONS.start, () => manager.startAll());
      mk('Pause all', 'pause', DL_ICONS.pause, () => manager.pauseAll());
      mk('Cancel all', 'cancel', DL_ICONS.cancel, () => manager.cancelAll());
      queueContent.appendChild(bar);
    }
  }

  if (manager.activeTab === 'failed' && activeItems.length > 0) {
    const retryBar = document.createElement('div');
    retryBar.className = 'dl-retry-all-bar';
    const retryBtn = document.createElement('button');
    retryBtn.type = 'button';
    retryBtn.className = 'dl-retry-all-btn';
    retryBtn.title = `Retry all (${activeItems.length})`;
    retryBtn.setAttribute('aria-label', `Retry all (${activeItems.length})`);
    renderContent(retryBtn, safeRaw(DL_ICONS.retry));
    retryBtn.onclick = (e) => {
      e.stopPropagation();
      manager.retryAllFailed();
    };
    retryBar.appendChild(retryBtn);
    queueContent.appendChild(retryBar);
  }

  const list = document.createElement('div');
  list.className = 'item-list';

  if (activeItems.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'dl-tab-empty';
    empty.textContent = manager.activeTab === 'in-progress'
      ? 'Nothing downloading right now.'
      : (manager.activeTab === 'downloaded'
        ? 'No comics downloaded in the last 24 hours.'
        : 'No failed downloads in the last 24 hours.');
    list.appendChild(empty);
  }

  activeItems.forEach(item => {
    const wrapper = document.createElement('div');
    wrapper.className = 'item';
    wrapper.dataset.comicId = item.id;

    const topRow = document.createElement('div');
    topRow.className = 'item-top';

    const dot = document.createElement('span');
    let statusDotClass = 'dot-pending';
    let statusLabel = 'Queued';

    if (item.status === 'downloading') {
      statusDotClass = 'dot-active';
      statusLabel = 'Downloading…';
    } else if (item.status === 'paused') {
      statusDotClass = 'dot-paused';
      statusLabel = 'Paused';
    } else if (item.status === 'error') {
      statusDotClass = 'dot-error';
      statusLabel = item.error || 'Download failed';
    } else if (item.status === 'completed') {
      statusDotClass = 'dot-completed';
      statusLabel = 'Completed';
    }

    dot.className = `status-dot ${statusDotClass}`;
    topRow.appendChild(dot);

    const title = document.createElement('span');
    title.className = 'item-name';
    title.title = item.displayName || item.comicName;
    title.textContent = item.displayName || item.comicName;
    topRow.appendChild(title);

    const makeAction = (actionTitle, svg, handler) => {
      const b = document.createElement('div');
      b.className = 'dl-action';
      b.title = actionTitle;
      renderContent(b, safeRaw(svg));
      b.onclick = (e) => {
        e.stopPropagation();
        handler();
      };
      topRow.appendChild(b);
    };
    if (item.status === 'downloading') {
      makeAction('Pause', '<svg viewBox="0 0 24 24"><rect x="6" y="5" width="4" height="14"/><rect x="14" y="5" width="4" height="14"/></svg>',
        () => manager.pauseDownload(item.id));
    } else if (item.status === 'paused') {
      makeAction('Resume', '<svg viewBox="0 0 24 24"><polygon points="6 4 20 12 6 20 6 4"/></svg>',
        () => manager.resumeDownload(item.id));
    } else if (item.status === 'error') {
      makeAction('Retry', '<svg viewBox="0 0 24 24"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg>',
        () => manager.restartDownload(item.id));
    }

    const cancelBtn = document.createElement('div');
    cancelBtn.className = 'cancel';
    cancelBtn.title = (item.status === 'completed' || item.status === 'error') ? 'Remove' : 'Cancel';
    renderContent(cancelBtn, safeHtml`<svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`);
    cancelBtn.onclick = (e) => {
      e.stopPropagation();
      manager.cancelDownload(item.id);
    };
    topRow.appendChild(cancelBtn);
    wrapper.appendChild(topRow);

    const statusRow = document.createElement('div');
    statusRow.className = 'item-status';
    const labelSpan = document.createElement('span');
    labelSpan.className = `status-label${item.status === 'error' ? ' status-error' : ''}`;
    labelSpan.textContent = statusLabel;
    statusRow.appendChild(labelSpan);
    wrapper.appendChild(statusRow);

    list.appendChild(wrapper);
  });

  queueContent.appendChild(list);
  downloadQueueDiv.appendChild(queueContent);
  queueContent.scrollTop = savedScrollTop;
}

export function showDownloadQueue(manager) {
  if (!downloadQueueDiv) return;

  manager.explicitlyOpen = true;

  if (manager.isCollapsed) {
    manager.isCollapsed = false;
    manager.saveCollapsedState(false);
  }

  if (manager.persistentQueue.length === 0) {
    renderEmptyQueueModal(manager);
  } else {
    manager.updateQueueUI();
  }
}
