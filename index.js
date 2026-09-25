const MODULE_NAME = 'quick-command-bar';

const DEFAULT_SETTINGS = {
    enabled: true,
    visibleCount: 5,
    items: [
        { id: 'continue', name: '继续', text: '请继续当前剧情。' },
        { id: 'describe', name: '细节', text: '请详细描写当前场景、人物动作、神态与环境细节。' },
        { id: 'ooc', name: 'OOC', text: 'OOC：' },
    ],
};

let settings;
let currentPage = 0;
let barRoot = null;

function cloneDefaults() {
    return JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
}

function getSettings() {
    const { extensionSettings, saveSettingsDebounced } = SillyTavern.getContext();
    if (!extensionSettings[MODULE_NAME]) {
        extensionSettings[MODULE_NAME] = cloneDefaults();
        saveSettingsDebounced();
    }
    settings = extensionSettings[MODULE_NAME];

    if (!Array.isArray(settings.items)) settings.items = [];
    if (!Number.isFinite(settings.visibleCount)) settings.visibleCount = 5;
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

    // V0.1: 每次点击都作为一个新段落插入。
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

    // 触发 ST / 前端监听器能够识别的原生输入事件。
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
}

function pageCount() {
    return Math.max(1, Math.ceil(settings.items.length / Math.max(1, settings.visibleCount)));
}

function clampPage() {
    currentPage = Math.min(currentPage, pageCount() - 1);
    if (currentPage < 0) currentPage = 0;
}

function renderBar() {
    if (!barRoot) return;
    clampPage();

    const list = barRoot.querySelector('.qcb-items');
    list.replaceChildren();

    const count = Math.max(1, settings.visibleCount);
    const start = currentPage * count;
    const pageItems = settings.items.slice(start, start + count);

    for (const item of pageItems) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'qcb-item';
        button.title = item.text;
        button.textContent = item.name || item.text.slice(0, 20) || '未命名';
        button.addEventListener('click', () => insertText(item.text));
        list.appendChild(button);
    }

    const prev = barRoot.querySelector('.qcb-prev');
    const next = barRoot.querySelector('.qcb-next');
    const total = pageCount();

    prev.disabled = currentPage <= 0;
    next.disabled = currentPage >= total - 1;

    barRoot.querySelector('.qcb-page').textContent =
        total > 1 ? `${currentPage + 1} / ${total}` : '';
}

function createBar() {
    if (document.querySelector('#quick-command-bar')) return;

    barRoot = document.createElement('section');
    barRoot.id = 'quick-command-bar';
    barRoot.className = 'qcb-root';
    barRoot.innerHTML = `
        <button type="button" class="qcb-arrow qcb-prev" aria-label="上一页">▲</button>
        <div class="qcb-items" aria-label="快捷指令"></div>
        <button type="button" class="qcb-arrow qcb-next" aria-label="下一页">▼</button>
        <span class="qcb-page" aria-hidden="true"></span>
    `;

    barRoot.querySelector('.qcb-prev').addEventListener('click', () => {
        currentPage--;
        renderBar();
    });
    barRoot.querySelector('.qcb-next').addEventListener('click', () => {
        currentPage++;
        renderBar();
    });

    // 优先放在发送表单之前，避免修改酒馆外侧布局。
    const sendForm = document.querySelector('#send_form');
    if (sendForm?.parentElement) {
        sendForm.parentElement.insertBefore(barRoot, sendForm);
    } else {
        document.body.appendChild(barRoot);
    }

    renderBar();
}

function removeBar() {
    document.querySelector('#quick-command-bar')?.remove();
    barRoot = null;
}

function renderSettings() {
    const host = document.querySelector('#extensions_settings2, #extensions_settings');
    if (!host || document.querySelector('#qcb-settings')) return;

    const panel = document.createElement('div');
    panel.id = 'qcb-settings';
    panel.className = 'qcb-settings inline-drawer';
    panel.innerHTML = `
      <div class="inline-drawer-toggle inline-drawer-header">
        <b>Quick Command Bar 0.1</b>
        <div class="inline-drawer-icon fa-solid fa-circle-chevron-down"></div>
      </div>
      <div class="inline-drawer-content">
        <label class="qcb-setting-row">
          <input id="qcb-enabled" type="checkbox">
          <span>启用底部快捷栏</span>
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
        if (settings.enabled) createBar(); else removeBar();
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
            id: crypto.randomUUID(),
            name: '新快捷项',
            text: '',
        });
        currentPage = 0;
        renderSettingsList();
        renderBar();
        save();
    });

    renderSettingsList();
}

function renderSettingsList() {
    const list = document.querySelector('#qcb-list');
    if (!list) return;
    list.replaceChildren();

    settings.items.forEach((item, index) => {
        const row = document.createElement('div');
        row.className = 'qcb-edit-row';
        row.innerHTML = `
          <input class="qcb-name" type="text" placeholder="显示名称">
          <textarea class="qcb-text" rows="3" placeholder="点击按钮后实际插入的文字"></textarea>
          <div class="qcb-edit-actions">
            <button type="button" class="menu_button qcb-up" title="上移">↑</button>
            <button type="button" class="menu_button qcb-down" title="下移">↓</button>
            <button type="button" class="menu_button qcb-delete" title="删除">删除</button>
          </div>
        `;

        const name = row.querySelector('.qcb-name');
        const text = row.querySelector('.qcb-text');
        name.value = item.name ?? '';
        text.value = item.text ?? '';

        name.addEventListener('input', () => {
            item.name = name.value;
            renderBar();
            save();
        });
        text.addEventListener('input', () => {
            item.text = text.value;
            renderBar();
            save();
        });

        row.querySelector('.qcb-up').addEventListener('click', () => {
            if (index <= 0) return;
            [settings.items[index - 1], settings.items[index]] =
                [settings.items[index], settings.items[index - 1]];
            renderSettingsList();
            renderBar();
            save();
        });

        row.querySelector('.qcb-down').addEventListener('click', () => {
            if (index >= settings.items.length - 1) return;
            [settings.items[index + 1], settings.items[index]] =
                [settings.items[index], settings.items[index + 1]];
            renderSettingsList();
            renderBar();
            save();
        });

        row.querySelector('.qcb-delete').addEventListener('click', () => {
            settings.items.splice(index, 1);
            clampPage();
            renderSettingsList();
            renderBar();
            save();
        });

        list.appendChild(row);
    });
}

async function init() {
    getSettings();

    // DOM may still be settling during extension activation.
    const start = Date.now();
    const timer = setInterval(() => {
        const sendForm = document.querySelector('#send_form');
        const settingsHost = document.querySelector('#extensions_settings2, #extensions_settings');

        if (settings.enabled && sendForm) createBar();
        if (settingsHost) renderSettings();

        if ((settings.enabled && sendForm && settingsHost) || Date.now() - start > 10000) {
            clearInterval(timer);
        }
    }, 250);
}

window.addEventListener('resize', () => {
    if (barRoot) renderBar();
});

$(init);
