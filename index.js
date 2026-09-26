const MODULE_NAME = 'quick-command-bar';

const DEFAULT_SETTINGS = {
    enabled: true,
    displayMode: 'floating',
    visibleCount: 5,
    items: [
        { id: 'continue', name: '继续', text: '请继续当前剧情。', group: '常用' },
        { id: 'describe', name: '细节', text: '请详细描写当前场景、人物动作、神态与环境细节。', group: '剧情' },
        { id: 'ooc', name: 'OOC', text: 'OOC：', group: 'OOC' },
    ],
};

let settings;
let currentPage = 0;
let searchQuery = '';
let activeGroup = '全部';
let dragItemId = null;

function cloneDefaults() {
    return JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
}

function makeId() {
    return globalThis.crypto?.randomUUID?.() || 'qcb-' + Date.now() + '-' + Math.random().toString(36).slice(2);
}

function getSettings() {
    const { extensionSettings, saveSettingsDebounced } = SillyTavern.getContext();
    if (!extensionSettings[MODULE_NAME]) {
        extensionSettings[MODULE_NAME] = cloneDefaults();
        saveSettingsDebounced();
    }

    settings = extensionSettings[MODULE_NAME];

    if (!Array.isArray(settings.items)) settings.items = [];
    settings.items.forEach(item => {
        if (!item.id) item.id = makeId();
        if (typeof item.name !== 'string') item.name = '';
        if (typeof item.text !== 'string') item.text = '';
        if (typeof item.group !== 'string' || !item.group.trim()) item.group = '常用';
    });
    if (!Number.isFinite(settings.visibleCount)) settings.visibleCount = 5;
    settings.visibleCount = Math.max(1, Math.min(12, Number(settings.visibleCount) || 5));
    if (!['floating', 'always', 'settings'].includes(settings.displayMode)) settings.displayMode = 'floating';
    if (typeof settings.enabled !== 'boolean') settings.enabled = true;

    return settings;
}

function save() {
    SillyTavern.getContext().saveSettingsDebounced();
}

function findInput() {
    const selectors = [
        '#send_textarea',
        '#send_form textarea',
        '#send_form input[type="text"]',
        'textarea[placeholder*="输入"]',
        'textarea',
    ];

    for (const selector of selectors) {
        const el = document.querySelector(selector);
        if (el && !el.disabled && el.offsetParent !== null) return el;
    }
    return null;
}

function insertText(text) {
    const input = findInput();
    if (!input) {
        toastr.warning('没有找到酒馆输入框。');
        return;
    }

    const value = input.value ?? '';
    let insertion = String(text ?? '');

    if (value.length > 0 && !value.endsWith('\n')) {
        insertion = '\n\n' + insertion;
    }

    const start = input.selectionStart ?? value.length;
    const end = input.selectionEnd ?? value.length;
    const nextValue = value.slice(0, start) + insertion + value.slice(end);
    const caret = start + insertion.length;

    input.focus();
    input.value = nextValue;
    input.setSelectionRange(caret, caret);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
}

function getGroups() {
    return [...new Set(settings.items.map(item => (item.group || '常用').trim() || '常用'))].sort((a, b) => a.localeCompare(b, 'zh-CN'));
}

function getFilteredItems() {
    const query = searchQuery.trim().toLowerCase();
    return settings.items.filter(item => {
        const group = (item.group || '常用').trim() || '常用';
        const haystack = [item.name, item.text, group].join('\n').toLowerCase();
        const matchesSearch = !query || haystack.includes(query);
        const matchesGroup = activeGroup === '全部' || group === activeGroup;
        return matchesSearch && matchesGroup;
    });
}

function pageCount() {
    const count = Math.max(1, Number(settings.visibleCount) || 5);
    return Math.max(1, Math.ceil(getFilteredItems().length / count));
}

function clampPage() {
    currentPage = Math.min(currentPage, pageCount() - 1);
    if (currentPage < 0) currentPage = 0;
}

function createPopupControls(root) {
    const search = root.querySelector('.qcb-search');
    const group = root.querySelector('.qcb-group');

    search.value = searchQuery;
    if (!search.dataset.bound) {
        search.dataset.bound = '1';
        search.addEventListener('input', () => {
            searchQuery = search.value;
            currentPage = 0;
            renderBar();
        });
    }

    group.replaceChildren();
    const all = document.createElement('option');
    all.value = '全部';
    all.textContent = '全部';
    group.appendChild(all);

    getGroups().forEach(name => {
        const option = document.createElement('option');
        option.value = name;
        option.textContent = name;
        group.appendChild(option);
    });
    group.value = activeGroup;
    if (!group.value) {
        activeGroup = '全部';
        group.value = '全部';
    }
    if (!group.dataset.bound) {
        group.dataset.bound = '1';
        group.addEventListener('change', () => {
            activeGroup = group.value;
            currentPage = 0;
            renderBar();
        });
    }
}

function moveItemBefore(draggedId, targetId) {
    if (!draggedId || !targetId || draggedId === targetId) return;
    const from = settings.items.findIndex(item => item.id === draggedId);
    const to = settings.items.findIndex(item => item.id === targetId);
    if (from < 0 || to < 0) return;

    const [moved] = settings.items.splice(from, 1);
    settings.items.splice(to, 0, moved);
    save();
    renderBar();
    renderSettingsList();
}

function renderBar() {
    clampPage();
    const root = document.querySelector('#quick-command-bar');
    if (!root) return;

    const list = root.querySelector('.qcb-items');
    if (!list) return;

    const popup = root.classList.contains('qcb-floating');
    if (popup) createPopupControls(root);

    list.replaceChildren();

    const count = Math.max(1, Number(settings.visibleCount) || 5);
    const filtered = getFilteredItems();
    const startIndex = currentPage * count;
    const pageItems = filtered.slice(startIndex, startIndex + count);

    if (!pageItems.length) {
        const empty = document.createElement('div');
        empty.className = 'qcb-empty';
        empty.textContent = settings.items.length ? '没有匹配的快捷项' : '还没有快捷项';
        list.appendChild(empty);
    }

    for (const item of pageItems) {
        const row = document.createElement('div');
        row.className = 'qcb-row';
        row.dataset.itemId = item.id;
        row.draggable = true;
        row.title = '拖动可排序';

        row.addEventListener('dragstart', event => {
            dragItemId = item.id;
            row.classList.add('qcb-dragging');
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData('text/plain', item.id);
        });
        row.addEventListener('dragend', () => {
            dragItemId = null;
            row.classList.remove('qcb-dragging');
        });
        row.addEventListener('dragover', event => {
            event.preventDefault();
            row.classList.add('qcb-drag-over');
        });
        row.addEventListener('dragleave', () => row.classList.remove('qcb-drag-over'));
        row.addEventListener('drop', event => {
            event.preventDefault();
            row.classList.remove('qcb-drag-over');
            moveItemBefore(dragItemId || event.dataTransfer.getData('text/plain'), item.id);
        });

        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'qcb-item';
        button.title = item.text;
        button.textContent = item.name || item.text.slice(0, 20) || '未命名';
        button.addEventListener('click', () => {
            insertText(item.text);
            closeQuickBar();
        });

        const group = document.createElement('span');
        group.className = 'qcb-item-group';
        group.textContent = item.group || '常用';

        const edit = document.createElement('button');
        edit.type = 'button';
        edit.className = 'qcb-edit';
        edit.textContent = '✎';
        edit.title = '直接编辑';
        edit.addEventListener('click', event => {
            event.stopPropagation();
            openInlineEditor(item);
        });

        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'qcb-delete';
        remove.textContent = '×';
        remove.title = '删除';
        remove.addEventListener('click', event => {
            event.stopPropagation();
            deleteItem(item.id);
        });

        const content = document.createElement('span');
        content.className = 'qcb-item-content';
        content.append(button, group);

        row.append(content, edit, remove);
        list.appendChild(row);
    }

    const total = pageCount();
    const prev = root.querySelector('.qcb-prev');
    const next = root.querySelector('.qcb-next');
    if (prev) prev.disabled = currentPage <= 0;
    if (next) next.disabled = currentPage >= total - 1;

    const page = root.querySelector('.qcb-page');
    if (page) page.textContent = total > 1 ? (currentPage + 1) + ' / ' + total : '';

    const result = root.querySelector('.qcb-result-count');
    if (result) result.textContent = filtered.length ? filtered.length + ' 项' : '';
}

function openInlineEditor(item) {
    const root = document.querySelector('#quick-command-bar');
    const row = root?.querySelector('.qcb-row[data-item-id="' + CSS.escape(item.id) + '"]');
    if (!row) return;

    row.replaceChildren();
    row.classList.add('qcb-inline-editor');
    row.draggable = false;

    const name = document.createElement('input');
    name.type = 'text';
    name.value = item.name || '';
    name.placeholder = '显示名称';

    const group = document.createElement('input');
    group.type = 'text';
    group.value = item.group || '常用';
    group.placeholder = '分组，例如：常用 / 剧情 / OOC';

    const text = document.createElement('textarea');
    text.rows = 4;
    text.value = item.text || '';
    text.placeholder = '实际插入内容';

    const actions = document.createElement('div');
    actions.className = 'qcb-inline-actions';

    const saveButton = document.createElement('button');
    saveButton.type = 'button';
    saveButton.textContent = '保存';

    const cancelButton = document.createElement('button');
    cancelButton.type = 'button';
    cancelButton.textContent = '取消';

    saveButton.addEventListener('click', () => {
        item.name = name.value.trim() || '未命名';
        item.group = group.value.trim() || '常用';
        item.text = text.value;
        save();
        renderSettingsList();
        renderBar();
    });

    cancelButton.addEventListener('click', () => renderBar());

    actions.append(saveButton, cancelButton);
    row.append(name, group, text, actions);
    name.focus();
}

function deleteItem(id) {
    const index = settings.items.findIndex(item => item.id === id);
    if (index < 0) return;

    const item = settings.items[index];
    if (!confirm('删除快捷项「' + (item.name || '未命名') + '」？')) return;

    settings.items.splice(index, 1);
    clampPage();
    save();
    renderSettingsList();
    renderBar();
}

function closeQuickBar() {
    document.querySelector('#quick-command-bar')?.classList.remove('qcb-open');
}

function positionQuickBar() {
    const root = document.querySelector('#quick-command-bar.qcb-floating');
    const trigger = document.querySelector('#qcb-trigger');
    if (!root || !trigger) return;

    const r = trigger.getBoundingClientRect();
    const width = Math.min(340, window.innerWidth - 16);
    let left = r.left;

    if (left + width > window.innerWidth - 8) left = window.innerWidth - width - 8;
    if (left < 8) left = 8;

    root.style.width = width + 'px';
    root.style.left = left + 'px';
    root.style.bottom = Math.max(8, window.innerHeight - r.top + 8) + 'px';
}

function createFloatingBar() {
    if (document.querySelector('#qcb-trigger')) return;

    const trigger = document.createElement('button');
    trigger.id = 'qcb-trigger';
    trigger.type = 'button';
    trigger.className = 'qcb-trigger';
    trigger.title = '快捷指令';
    trigger.setAttribute('aria-label', '快捷指令');
    trigger.innerHTML = '<span>✦</span>';

    const root = document.createElement('section');
    root.id = 'quick-command-bar';
    root.className = 'qcb-root qcb-floating';
    root.innerHTML = '<div class="qcb-head"><strong>快捷指令</strong><span class="qcb-result-count"></span><button type="button" class="qcb-close">×</button></div>' +
        '<div class="qcb-filters"><input class="qcb-search" type="search" placeholder="搜索快捷指令"><select class="qcb-group"></select></div>' +
        '<button type="button" class="qcb-arrow qcb-prev">▲</button><div class="qcb-items"></div><button type="button" class="qcb-arrow qcb-next">▼</button>' +
        '<span class="qcb-page"></span><div class="qcb-footer"><button type="button" class="qcb-add">＋ 新增</button><button type="button" class="qcb-export">导出</button><button type="button" class="qcb-import">导入</button></div>';

    document.body.appendChild(root);

    trigger.addEventListener('click', () => {
        root.classList.toggle('qcb-open');
        if (root.classList.contains('qcb-open')) {
            renderBar();
            positionQuickBar();
            root.querySelector('.qcb-search')?.focus();
        }
    });

    root.querySelector('.qcb-close').addEventListener('click', closeQuickBar);
    root.querySelector('.qcb-prev').addEventListener('click', () => {
        currentPage--;
        renderBar();
    });
    root.querySelector('.qcb-next').addEventListener('click', () => {
        currentPage++;
        renderBar();
    });
    root.querySelector('.qcb-add').addEventListener('click', () => {
        const item = { id: makeId(), name: '新快捷项', text: '', group: '常用' };
        settings.items.push(item);
        activeGroup = '全部';
        searchQuery = '';
        currentPage = pageCount() - 1;
        save();
        renderSettingsList();
        renderBar();
        openInlineEditor(item);
    });

    root.querySelector('.qcb-export').addEventListener('click', exportItems);
    root.querySelector('.qcb-import').addEventListener('click', importItems);

    const extensionsButton = document.querySelector('#extensionsMenuButton');
    if (extensionsButton?.parentElement) {
        extensionsButton.parentElement.insertBefore(trigger, extensionsButton);
    } else {
        document.body.appendChild(trigger);
    }

    renderBar();
}

function createAlwaysBar() {
    if (document.querySelector('#quick-command-bar')) return;

    const root = document.createElement('section');
    root.id = 'quick-command-bar';
    root.className = 'qcb-root qcb-always';
    root.innerHTML = '<button type="button" class="qcb-arrow qcb-prev">▲</button><div class="qcb-items"></div><button type="button" class="qcb-arrow qcb-next">▼</button>';

    const sendForm = document.querySelector('#send_form');
    if (sendForm?.parentElement) sendForm.parentElement.insertBefore(root, sendForm);
    else document.body.appendChild(root);

    root.querySelector('.qcb-prev').addEventListener('click', () => {
        currentPage--;
        renderBar();
    });
    root.querySelector('.qcb-next').addEventListener('click', () => {
        currentPage++;
        renderBar();
    });
    renderBar();
}

function removeBar() {
    document.querySelector('#qcb-trigger')?.remove();
    document.querySelector('#quick-command-bar')?.remove();
}

function applyDisplayMode() {
    removeBar();
    if (!settings.enabled || settings.displayMode === 'settings') return;
    if (settings.displayMode === 'always') createAlwaysBar();
    else createFloatingBar();
}

function renderSettings() {
    const host = document.querySelector('#extensions_settings2, #extensions_settings');
    if (!host || document.querySelector('#qcb-settings')) return;

    const panel = document.createElement('div');
    panel.id = 'qcb-settings';
    panel.className = 'qcb-settings inline-drawer';
    panel.innerHTML = `
      <div class="inline-drawer-toggle inline-drawer-header">
        <b>Quick Command Bar 0.3</b>
        <div class="inline-drawer-icon fa-solid fa-circle-chevron-down"></div>
      </div>
      <div class="inline-drawer-content">
        <label class="qcb-setting-row">
          <input id="qcb-enabled" type="checkbox">
          <span>启用快捷指令栏</span>
        </label>

        <label class="qcb-setting-row">
          <span>显示方式</span>
          <select id="qcb-mode">
            <option value="floating">小图标：点击后弹出</option>
            <option value="always">始终显示在输入框上方</option>
            <option value="settings">只在扩展设置里管理</option>
          </select>
        </label>

        <label class="qcb-setting-row">
          <span>每页显示数量</span>
          <input id="qcb-count" type="number" min="1" max="12" step="1">
        </label>

        <div class="qcb-manager-head">
          <b>快捷项</b>
          <button id="qcb-add" class="menu_button" type="button">＋ 添加</button>
        </div>

        <div id="qcb-list"></div>

        <div class="qcb-data-actions">
          <button id="qcb-export-settings" class="menu_button" type="button">导出全部</button>
          <button id="qcb-import-settings" class="menu_button" type="button">导入 JSON</button>
        </div>
      </div>
    `;

    host.appendChild(panel);

    panel.querySelector('.inline-drawer-toggle').addEventListener('click', () => {
        panel.classList.toggle('open');
        panel.querySelector('.inline-drawer-content').style.display =
            panel.classList.contains('open') ? 'block' : '';
    });

    const enabled = panel.querySelector('#qcb-enabled');
    enabled.checked = settings.enabled;
    enabled.addEventListener('change', () => {
        settings.enabled = enabled.checked;
        applyDisplayMode();
        save();
    });

    const mode = panel.querySelector('#qcb-mode');
    mode.value = settings.displayMode;
    mode.addEventListener('change', () => {
        settings.displayMode = mode.value;
        currentPage = 0;
        applyDisplayMode();
        save();
    });

    const count = panel.querySelector('#qcb-count');
    count.value = settings.visibleCount;
    count.addEventListener('change', () => {
        settings.visibleCount = Math.max(1, Math.min(12, Number(count.value) || 5));
        currentPage = 0;
        renderBar();
        save();
    });

    panel.querySelector('#qcb-add').addEventListener('click', () => {
        settings.items.push({
            id: makeId(),
            name: '新快捷项',
            text: '',
            group: '常用',
        });
        currentPage = 0;
        renderSettingsList();
        renderBar();
        save();
    });

    panel.querySelector('#qcb-export-settings').addEventListener('click', exportItems);
    panel.querySelector('#qcb-import-settings').addEventListener('click', importItems);

    renderSettingsList();
}

function renderSettingsList() {
    const list = document.querySelector('#qcb-list');
    if (!list) return;
    list.replaceChildren();

    settings.items.forEach((item, index) => {
        const row = document.createElement('div');
        row.className = 'qcb-edit-row';
        row.dataset.itemId = item.id;

        const name = document.createElement('input');
        name.className = 'qcb-name';
        name.type = 'text';
        name.placeholder = '显示名称';
        name.value = item.name ?? '';

        const group = document.createElement('input');
        group.className = 'qcb-group-input';
        group.type = 'text';
        group.placeholder = '分组，例如：常用 / 剧情 / OOC';
        group.value = item.group ?? '常用';

        const text = document.createElement('textarea');
        text.className = 'qcb-text';
        text.rows = 3;
        text.placeholder = '点击按钮后实际插入的文字';
        text.value = item.text ?? '';

        const actions = document.createElement('div');
        actions.className = 'qcb-edit-actions';

        const up = document.createElement('button');
        up.type = 'button';
        up.className = 'menu_button qcb-up';
        up.title = '上移';
        up.textContent = '↑';

        const down = document.createElement('button');
        down.type = 'button';
        down.className = 'menu_button qcb-down';
        down.title = '下移';
        down.textContent = '↓';

        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'menu_button qcb-delete';
        del.title = '删除';
        del.textContent = '删除';

        actions.append(up, down, del);
        row.append(name, group, text, actions);

        name.addEventListener('input', () => {
            item.name = name.value;
            renderBar();
            save();
        });
        group.addEventListener('input', () => {
            item.group = group.value.trim() || '常用';
            renderBar();
            save();
        });
        text.addEventListener('input', () => {
            item.text = text.value;
            renderBar();
            save();
        });

        up.addEventListener('click', () => {
            if (index <= 0) return;
            [settings.items[index - 1], settings.items[index]] =
                [settings.items[index], settings.items[index - 1]];
            renderSettingsList();
            renderBar();
            save();
        });

        down.addEventListener('click', () => {
            if (index >= settings.items.length - 1) return;
            [settings.items[index + 1], settings.items[index]] =
                [settings.items[index], settings.items[index + 1]];
            renderSettingsList();
            renderBar();
            save();
        });

        del.addEventListener('click', () => deleteItem(item.id));

        list.appendChild(row);
    });
}

function exportItems() {
    const payload = {
        version: 1,
        exportedAt: new Date().toISOString(),
        items: settings.items,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'quick-command-bar.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function importItems() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';

    input.addEventListener('change', async () => {
        const file = input.files?.[0];
        if (!file) return;

        try {
            const data = JSON.parse(await file.text());
            const items = Array.isArray(data) ? data : data.items;
            if (!Array.isArray(items)) throw new Error('JSON 中没有 items 数组');

            settings.items = items.map(raw => ({
                id: raw.id || makeId(),
                name: String(raw.name ?? '未命名'),
                text: String(raw.text ?? ''),
                group: String(raw.group ?? '常用').trim() || '常用',
            }));

            currentPage = 0;
            searchQuery = '';
            activeGroup = '全部';
            save();
            renderSettingsList();
            renderBar();
            toastr.success('快捷指令已导入。');
        } catch (error) {
            console.error('[Quick Command Bar] import failed', error);
            toastr.error('导入失败：JSON 格式不正确。');
        }
    });

    input.click();
}

async function init() {
    getSettings();

    const start = Date.now();
    const timer = setInterval(() => {
        const sendForm = document.querySelector('#send_form');
        const settingsHost = document.querySelector('#extensions_settings2, #extensions_settings');

        if (sendForm && !document.querySelector('#qcb-trigger, #quick-command-bar')) applyDisplayMode();
        if (settingsHost) renderSettings();

        if ((sendForm && settingsHost) || Date.now() - start > 10000) {
            clearInterval(timer);
        }
    }, 250);

    document.addEventListener('click', event => {
        const root = document.querySelector('#quick-command-bar');
        const trigger = document.querySelector('#qcb-trigger');
        if (root?.classList.contains('qcb-open') &&
            !root.contains(event.target) &&
            !trigger?.contains(event.target)) {
            closeQuickBar();
        }
    });

    let touchStartY = null;
    document.addEventListener('touchstart', event => {
        if (!document.querySelector('#quick-command-bar.qcb-open')) return;
        touchStartY = event.touches[0]?.clientY ?? null;
    }, { passive: true });

    document.addEventListener('touchend', event => {
        if (touchStartY === null) return;
        const endY = event.changedTouches[0]?.clientY ?? touchStartY;
        const delta = endY - touchStartY;
        touchStartY = null;
        if (Math.abs(delta) < 45) return;

        const root = document.querySelector('#quick-command-bar.qcb-open');
        if (!root) return;

        if (delta < 0) {
            currentPage++;
        } else {
            currentPage--;
        }
        renderBar();
    }, { passive: true });

    window.addEventListener('resize', positionQuickBar);
    window.addEventListener('scroll', positionQuickBar, true);
}

$(init);
