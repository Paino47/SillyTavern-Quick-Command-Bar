(() => {
    'use strict';

    const MODULE = 'user-persona-forge';
    const DEFAULT_CATEGORIES = [
        '基础档案', '外貌特征', '性格内核', '身世经历', '身份职业',
        '行为习惯', '偏好禁忌', '能力资源', '关系网络', '当前处境', '补充设定'
    ];
    const FIELD_TEMPLATES = [
        ['基础档案', '姓名'], ['基础档案', '年龄'], ['基础档案', '生日'],
        ['基础档案', '性别与代词'], ['基础档案', '身高'], ['基础档案', '体重'],
        ['基础档案', '身份称谓'], ['外貌特征', '外貌概述'], ['外貌特征', '发色与瞳色'],
        ['外貌特征', '体态与体征'], ['外貌特征', '声音与气味'], ['性格内核', '核心性格'],
        ['性格内核', '性格反差'], ['性格内核', '价值观与底线'], ['性格内核', '欲望与恐惧'],
        ['身世经历', '出身与家庭'], ['身世经历', '成长经历'], ['身世经历', '关键事件'],
        ['身份职业', '职业与社会身份'], ['身份职业', '所属组织 / 阵营'],
        ['行为习惯', '日常习惯'], ['行为习惯', '说话方式'], ['偏好禁忌', '喜好与厌恶'],
        ['偏好禁忌', '雷点与禁忌'], ['能力资源', '能力与特长'], ['能力资源', '弱点与限制'],
        ['关系网络', '重要关系'], ['关系网络', '与 {{char}} 的关系'], ['当前处境', '当前目标'],
        ['当前处境', '现阶段处境'], ['补充设定', '其他补充']
    ];

    let settings;
    let panel;
    let activeTab = 'library';
    let activeCategory = '全部';
    let searchText = '';
    let editingBlock = null;
    let observer = null;

    const clone = value => JSON.parse(JSON.stringify(value));
    const makeId = () => (crypto.randomUUID ? crypto.randomUUID() : 'upf-' + Date.now() + '-' + Math.random().toString(36).slice(2));
    const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));
    const ctx = () => {
        try { return window.SillyTavern?.getContext?.() || window.parent?.SillyTavern?.getContext?.() || null; }
        catch (_) { return null; }
    };

    function getSettings() {
        const context = ctx();
        const store = context?.extensionSettings || window.extension_settings;
        if (store) {
            if (!store[MODULE]) {
                store[MODULE] = { blocks: [], masks: [], categories: clone(DEFAULT_CATEGORIES), builderIds: [] };
            }
            settings = store[MODULE];
        } else {
            try {
                settings = JSON.parse(localStorage.getItem(MODULE) || 'null') ||
                    { blocks: [], masks: [], categories: clone(DEFAULT_CATEGORIES), builderIds: [] };
            } catch (_) {
                settings = { blocks: [], masks: [], categories: clone(DEFAULT_CATEGORIES), builderIds: [] };
            }
        }

        if (!Array.isArray(settings.blocks)) settings.blocks = [];
        if (!Array.isArray(settings.masks)) settings.masks = [];
        if (!Array.isArray(settings.categories)) settings.categories = clone(DEFAULT_CATEGORIES);
        if (!Array.isArray(settings.builderIds)) settings.builderIds = [];
        DEFAULT_CATEGORIES.forEach(name => {
            if (!settings.categories.includes(name)) settings.categories.push(name);
        });
        settings.blocks.forEach(block => {
            if (!block.id) block.id = makeId();
            block.title = String(block.title ?? '未命名区块');
            block.content = String(block.content ?? '');
            block.category = String(block.category ?? '补充设定');
            if (!settings.categories.includes(block.category)) settings.categories.push(block.category);
        });
        settings.masks.forEach(mask => {
            if (!mask.id) mask.id = makeId();
            if (!Array.isArray(mask.blockIds)) mask.blockIds = [];
        });
        settings.builderIds = settings.builderIds.filter(id => settings.blocks.some(block => block.id === id));
        return settings;
    }

    function save() {
        const context = ctx();
        if (context?.saveSettingsDebounced) {
            context.saveSettingsDebounced();
        } else {
            try { localStorage.setItem(MODULE, JSON.stringify(settings)); } catch (error) {
                console.warn('[User 面具工坊] 保存失败', error);
            }
        }
    }

    function notify(message, type) {
        const method = window.toastr?.[type || 'info'];
        if (typeof method === 'function') method(message);
        else console[(type === 'error' ? 'error' : 'log')]('[User 面具工坊] ' + message);
    }

    function getBlock(id) {
        return settings.blocks.find(block => block.id === id);
    }

    function getBuilderBlocks() {
        return settings.builderIds.map(getBlock).filter(Boolean);
    }

    function buildOutput() {
        const groups = new Map();
        getBuilderBlocks().forEach(block => {
            if (!block.content.trim()) return;
            if (!groups.has(block.category)) groups.set(block.category, []);
            groups.get(block.category).push(block);
        });
        return Array.from(groups.entries()).map(([category, blocks]) => {
            const lines = blocks.map(block => {
                const content = block.content.trim();
                return block.title ? (content.includes('\n') ? block.title + '\n' + content : block.title + '：' + content) : content;
            });
            return '【' + category + '】\n' + lines.join('\n\n');
        }).join('\n\n');
    }

    function ensurePanel() {
        if (panel) return panel;
        panel = document.createElement('div');
        panel.id = 'upf-root';
        panel.innerHTML =
            '<div class="upf-backdrop" data-action="close"></div>' +
            '<section class="upf-window" role="dialog" aria-modal="true" aria-label="User 面具工坊">' +
                '<header class="upf-header">' +
                    '<div class="upf-brand"><span class="upf-brand-mark">U</span><div><strong>User 面具工坊</strong><small>PERSONA COMPOSER · 区块化人设管理</small></div></div>' +
                    '<div class="upf-header-actions"><span class="upf-save-state">本地资料库 · 自动保存</span><button class="upf-icon-btn" data-action="close" aria-label="关闭">×</button></div>' +
                '</header>' +
                '<nav class="upf-tabs">' +
                    '<button data-action="tab" data-tab="library">区块库 <span class="upf-tab-count" id="upf-block-count">0</span></button>' +
                    '<button data-action="tab" data-tab="compose">合成台 <span class="upf-tab-count" id="upf-builder-count">0</span></button>' +
                    '<button data-action="tab" data-tab="masks">已保存面具 <span class="upf-tab-count" id="upf-mask-count">0</span></button>' +
                    '<span class="upf-tab-spacer"></span>' +
                    '<button class="upf-subtle-tab" data-action="export-library">备份资料库</button>' +
                    '<button class="upf-subtle-tab" data-action="import-library">导入备份</button>' +
                '</nav>' +
                '<main class="upf-body"></main>' +
            '</section>';
        document.body.appendChild(panel);

        panel.addEventListener('click', onPanelClick);
        panel.addEventListener('input', onPanelInput);
        panel.addEventListener('change', onPanelChange);
        return panel;
    }

    function openPanel(tab) {
        ensurePanel();
        if (tab) activeTab = tab;
        panel.classList.add('upf-open');
        document.body.classList.add('upf-lock-scroll');
        render();
    }

    function closePanel() {
        if (!panel) return;
        panel.classList.remove('upf-open');
        document.body.classList.remove('upf-lock-scroll');
        editingBlock = null;
    }

    function render() {
        if (!panel) return;
        panel.querySelectorAll('[data-tab]').forEach(button => {
            button.classList.toggle('is-active', button.dataset.tab === activeTab);
        });
        panel.querySelector('#upf-block-count').textContent = String(settings.blocks.length);
        panel.querySelector('#upf-builder-count').textContent = String(settings.builderIds.length);
        panel.querySelector('#upf-mask-count').textContent = String(settings.masks.length);

        const body = panel.querySelector('.upf-body');
        if (editingBlock) body.innerHTML = renderEditor();
        else if (activeTab === 'compose') body.innerHTML = renderComposer();
        else if (activeTab === 'masks') body.innerHTML = renderMasks();
        else body.innerHTML = renderLibrary();
    }

    function renderLibrary() {
        const query = searchText.trim().toLocaleLowerCase();
        const blocks = settings.blocks.filter(block => {
            const matchesCategory = activeCategory === '全部' || block.category === activeCategory;
            const haystack = (block.title + '\n' + block.category + '\n' + block.content).toLocaleLowerCase();
            return matchesCategory && (!query || haystack.includes(query));
        });
        const categories = ['全部'].concat(settings.categories);
        const categoryHtml = categories.map(category =>
            '<button class="upf-category ' + (activeCategory === category ? 'is-active' : '') +
            '" data-action="category" data-category="' + esc(category) + '">' +
            '<span>' + esc(category) + '</span><small>' +
            (category === '全部' ? settings.blocks.length : settings.blocks.filter(item => item.category === category).length) +
            '</small></button>'
        ).join('');

        const cards = blocks.length ? blocks.map(block => {
            const selected = settings.builderIds.includes(block.id);
            const preview = block.content.trim() ? block.content.trim().replace(/\s+/g, ' ').slice(0, 105) : '尚未填写内容 · 点击编辑';
            return '<article class="upf-block-card">' +
                '<div class="upf-block-main"><div class="upf-card-kicker">' + esc(block.category) + '</div>' +
                '<strong>' + esc(block.title) + '</strong><p>' + esc(preview) + '</p></div>' +
                '<div class="upf-card-actions">' +
                    '<button class="upf-mini-btn" data-action="edit-block" data-id="' + esc(block.id) + '">编辑</button>' +
                    '<button class="upf-add-btn ' + (selected ? 'is-added' : '') + '" data-action="' + (selected ? 'remove-block' : 'add-block') +
                    '" data-id="' + esc(block.id) + '">' + (selected ? '已加入 ✓' : '加入合成 +') + '</button>' +
                '</div></article>';
        }).join('') : '<div class="upf-empty"><span class="upf-empty-symbol">＋</span><strong>' +
            (settings.blocks.length ? '没有找到匹配的区块' : '这里还没有资料区块') +
            '</strong><p>' + (settings.blocks.length ? '换个关键词或分类试试。' : '从常用字段开始，逐步建立自己的 User 资料库。') +
            '</p><button class="upf-primary-btn" data-action="new-block">新建第一个区块</button></div>';

        return '<div class="upf-toolbar">' +
            '<div><div class="upf-eyebrow">01 / LIBRARY</div><h2>资料区块库</h2><p>每一块资料都能独立保存，也可以反复加入不同面具。</p></div>' +
            '<div class="upf-toolbar-actions"><button class="upf-secondary-btn" data-action="create-fields">生成常用字段</button>' +
            '<button class="upf-primary-btn" data-action="new-block">＋ 新建区块</button></div></div>' +
            '<div class="upf-library-layout"><aside class="upf-category-rail"><div class="upf-rail-title">资料分类</div>' +
            categoryHtml + '<button class="upf-add-category" data-action="add-category">＋ 新增分类</button></aside>' +
            '<section class="upf-library-content"><div class="upf-search-row"><input class="upf-search" type="search" placeholder="搜索区块名称、分类或内容…" value="' + esc(searchText) + '">' +
            '<span class="upf-result-count">' + blocks.length + ' / ' + settings.blocks.length + ' 个区块</span></div>' +
            '<div class="upf-block-list">' + cards + '</div></section></div>';
    }

    function renderComposer() {
        const blocks = getBuilderBlocks();
        const output = buildOutput();
        const rows = blocks.length ? blocks.map((block, index) =>
            '<article class="upf-builder-row"><div class="upf-order">' + String(index + 1).padStart(2, '0') + '</div>' +
            '<div class="upf-builder-info"><strong>' + esc(block.title) + '</strong><small>' + esc(block.category) +
            (block.content.trim() ? '' : ' · 空内容') + '</small></div>' +
            '<div class="upf-builder-actions"><button data-action="move-block" data-id="' + esc(block.id) + '" data-dir="-1" ' + (index === 0 ? 'disabled' : '') + ' title="上移">↑</button>' +
            '<button data-action="move-block" data-id="' + esc(block.id) + '" data-dir="1" ' + (index === blocks.length - 1 ? 'disabled' : '') + ' title="下移">↓</button>' +
            '<button data-action="edit-block" data-id="' + esc(block.id) + '" title="编辑">✎</button>' +
            '<button data-action="remove-block" data-id="' + esc(block.id) + '" title="移出合成">×</button></div></article>'
        ).join('') : '<div class="upf-builder-empty"><strong>合成台还是空的</strong><p>去区块库挑选资料，按需要拼成一份 User Persona。</p><button class="upf-primary-btn" data-action="tab" data-tab="library">前往区块库</button></div>';

        return '<div class="upf-toolbar"><div><div class="upf-eyebrow">02 / COMPOSER</div><h2>面具合成台</h2><p>选择需要的资料区块，调整顺序，右侧会同步生成最终文本。</p></div>' +
            '<div class="upf-toolbar-actions"><button class="upf-secondary-btn" data-action="clear-builder">清空合成台</button>' +
            '<button class="upf-primary-btn" data-action="save-mask" ' + (blocks.length ? '' : 'disabled') + '>保存为面具</button></div></div>' +
            '<div class="upf-compose-layout"><section class="upf-builder-panel"><div class="upf-section-head"><div><span>ASSEMBLED PARTS</span><strong>已选区块</strong></div><b>' + blocks.length + '</b></div>' +
            '<div class="upf-builder-list">' + rows + '</div><button class="upf-wide-ghost" data-action="tab" data-tab="library">＋ 继续添加资料区块</button></section>' +
            '<section class="upf-preview-panel"><div class="upf-section-head"><div><span>LIVE PREVIEW</span><strong>人设预览</strong></div><b>' + (output ? output.length + ' 字符' : '空白') + '</b></div>' +
            '<div class="upf-preview-paper">' + (output ? '<pre>' + esc(output) + '</pre>' : '<div class="upf-preview-empty">选择并填写区块后，完整的人设文本会显示在这里。</div>') + '</div>' +
            '<div class="upf-output-actions"><button class="upf-primary-btn" data-action="copy-output" ' + (output ? '' : 'disabled') + '>复制合成文本</button>' +
            '<button class="upf-secondary-btn" data-action="apply-output" ' + (output ? '' : 'disabled') + '>写入当前人设</button>' +
            '<button class="upf-text-btn" data-action="download-output" ' + (output ? '' : 'disabled') + '>导出 TXT</button></div>' +
            '<p class="upf-safe-note">写入操作只替换当前 Persona 的描述文本，不会改动人设名称、头像或绑定关系。</p></section></div>';
    }

    function renderMasks() {
        const cards = settings.masks.length ? settings.masks.map(mask =>
            '<article class="upf-mask-card"><div class="upf-mask-symbol">M</div><div class="upf-mask-info"><strong>' + esc(mask.name) +
            '</strong><p>' + (mask.blockIds || []).length + ' 个区块 · 保存于 ' + esc(mask.updatedAt ? new Date(mask.updatedAt).toLocaleDateString() : '未知日期') +
            '</p></div><div class="upf-mask-actions"><button class="upf-primary-btn" data-action="load-mask" data-id="' + esc(mask.id) + '">载入</button>' +
            '<button data-action="rename-mask" data-id="' + esc(mask.id) + '" title="重命名">✎</button><button data-action="duplicate-mask" data-id="' + esc(mask.id) + '" title="复制方案">⧉</button>' +
            '<button data-action="delete-mask" data-id="' + esc(mask.id) + '" title="删除方案">×</button></div></article>'
        ).join('') : '<div class="upf-empty"><span class="upf-empty-symbol">M</span><strong>还没有保存的面具</strong><p>把区块加入合成台、调整好顺序，然后保存为一套可重复使用的方案。</p>' +
            '<button class="upf-primary-btn" data-action="tab" data-tab="compose">前往合成台</button></div>';

        return '<div class="upf-toolbar"><div><div class="upf-eyebrow">03 / MASK COLLECTION</div><h2>已保存的面具</h2><p>一套面具只保存区块组合关系，不会复制素材；修改区块后，相关方案也会使用最新内容。</p></div>' +
            '<div class="upf-toolbar-actions"><button class="upf-secondary-btn" data-action="export-library">导出完整资料库</button></div></div>' +
            '<div class="upf-mask-list">' + cards + '</div>';
    }

    function renderEditor() {
        const block = editingBlock || {};
        const categories = settings.categories.map(category =>
            '<option value="' + esc(category) + '" ' + (block.category === category ? 'selected' : '') + '>' + esc(category) + '</option>'
        ).join('');
        return '<div class="upf-editor-wrap"><div class="upf-editor-top"><button class="upf-back-btn" data-action="cancel-edit">← 返回区块库</button>' +
            '<span class="upf-eyebrow">BLOCK EDITOR</span></div><div class="upf-editor-card"><div class="upf-eyebrow">' +
            (block.id ? 'EDIT EXISTING BLOCK' : 'CREATE NEW BLOCK') + '</div><h2>' + (block.id ? '编辑资料区块' : '新建资料区块') + '</h2>' +
            '<label>区块名称<input id="upf-edit-title" maxlength="80" value="' + esc(block.title || '') + '" placeholder="例如：姓名、身高与体重、性格核心"></label>' +
            '<label>所属分类<div class="upf-category-select-row"><select id="upf-edit-category">' + categories + '</select><button class="upf-secondary-btn" data-action="add-category">新增分类</button></div></label>' +
            '<label>资料内容<textarea id="upf-edit-content" rows="10" placeholder="写下这一块资料。可以是简短字段，也可以是完整段落；支持换行。">' + esc(block.content || '') + '</textarea></label>' +
            '<label class="upf-checkline"><input id="upf-add-after-save" type="checkbox" ' + (block.id && settings.builderIds.includes(block.id) ? 'checked' : 'checked') + '> 保存后加入当前合成台</label>' +
            '<div class="upf-editor-footer"><button class="upf-secondary-btn" data-action="cancel-edit">取消</button><button class="upf-primary-btn" data-action="save-block">保存区块</button></div></div></div>';
    }

    function startEdit(id) {
        const block = id ? getBlock(id) : null;
        editingBlock = block ? clone(block) : { id: '', title: '', category: activeCategory === '全部' ? '基础档案' : activeCategory, content: '' };
        activeTab = 'library';
        render();
    }

    function saveBlock() {
        const title = panel.querySelector('#upf-edit-title')?.value.trim();
        const category = panel.querySelector('#upf-edit-category')?.value || '补充设定';
        const content = panel.querySelector('#upf-edit-content')?.value ?? '';
        const addToBuilder = panel.querySelector('#upf-add-after-save')?.checked ?? true;
        if (!title) {
            notify('请先填写区块名称。', 'warning');
            panel.querySelector('#upf-edit-title')?.focus();
            return;
        }
        if (!settings.categories.includes(category)) settings.categories.push(category);

        let block = editingBlock.id ? getBlock(editingBlock.id) : null;
        if (block) {
            block.title = title;
            block.category = category;
            block.content = content;
            block.updatedAt = new Date().toISOString();
        } else {
            block = { id: makeId(), title, category, content, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
            settings.blocks.unshift(block);
        }

        if (addToBuilder && !settings.builderIds.includes(block.id)) settings.builderIds.push(block.id);
        if (!addToBuilder) settings.builderIds = settings.builderIds.filter(id => id !== block.id);
        editingBlock = null;
        save();
        activeCategory = category;
        render();
        notify('资料区块已保存。', 'success');
    }

    function addBlock(id) {
        if (!settings.builderIds.includes(id)) settings.builderIds.push(id);
        save();
        render();
    }

    function removeBlock(id) {
        settings.builderIds = settings.builderIds.filter(item => item !== id);
        save();
        render();
    }

    function moveBlock(id, direction) {
        const index = settings.builderIds.indexOf(id);
        const target = index + Number(direction);
        if (index < 0 || target < 0 || target >= settings.builderIds.length) return;
        const next = settings.builderIds.slice();
        const temp = next[index];
        next[index] = next[target];
        next[target] = temp;
        settings.builderIds = next;
        save();
        render();
    }

    function saveMask() {
        if (!settings.builderIds.length) return;
        const name = window.prompt('给这套 User 面具起一个名字：', '新面具');
        if (!name || !name.trim()) return;
        settings.masks.unshift({
            id: makeId(),
            name: name.trim(),
            blockIds: settings.builderIds.slice(),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        });
        save();
        activeTab = 'masks';
        render();
        notify('面具方案已保存。', 'success');
    }

    function loadMask(id) {
        const mask = settings.masks.find(item => item.id === id);
        if (!mask) return;
        settings.builderIds = mask.blockIds.filter(blockId => !!getBlock(blockId));
        save();
        activeTab = 'compose';
        render();
        notify('已载入「' + mask.name + '」。', 'success');
    }

    function addCategory() {
        const name = window.prompt('输入新的资料分类名称：');
        if (!name || !name.trim()) return;
        const clean = name.trim();
        if (!settings.categories.includes(clean)) {
            settings.categories.push(clean);
            save();
            render();
        }
    }

    function createFieldTemplates() {
        let added = 0;
        FIELD_TEMPLATES.forEach(([category, title]) => {
            const exists = settings.blocks.some(block => block.category === category && block.title === title);
            if (exists) return;
            settings.blocks.push({ id: makeId(), title, category, content: '', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
            added++;
        });
        save();
        activeCategory = '全部';
        render();
        notify(added ? '已建立 ' + added + ' 个常用空白字段，可逐条填写。' : '常用字段已经存在，无需重复建立。', 'success');
    }

    async function copyText(text) {
        try {
            if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(text);
            } else {
                const textarea = document.createElement('textarea');
                textarea.value = text;
                textarea.style.position = 'fixed';
                textarea.style.opacity = '0';
                document.body.appendChild(textarea);
                textarea.select();
                const ok = document.execCommand('copy');
                textarea.remove();
                if (!ok) throw new Error('clipboard unavailable');
            }
            notify('合成文本已复制。', 'success');
        } catch (error) {
            console.error('[User 面具工坊] copy failed', error);
            notify('复制失败，请检查浏览器剪贴板权限。', 'error');
        }
    }

    function applyToCurrentPersona() {
        const output = buildOutput();
        if (!output) {
            notify('当前合成内容为空，请先填写并选择区块。', 'warning');
            return;
        }
        const field = document.querySelector('#persona_description');
        if (!field) {
            notify('没有找到 Persona 描述框。请先打开酒馆顶部的人设管理面板，再执行写入。', 'warning');
            return;
        }
        field.value = output;
        field.dispatchEvent(new Event('input', { bubbles: true }));
        field.dispatchEvent(new Event('change', { bubbles: true }));
        notify('已写入当前 Persona 描述，并触发酒馆原生保存逻辑。', 'success');
    }

    function downloadFile(name, content, mime) {
        const blob = new Blob([content], { type: mime || 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = name;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1200);
    }

    function exportLibrary() {
        const payload = {
            schema: 'user-persona-forge',
            version: 1,
            exportedAt: new Date().toISOString(),
            categories: settings.categories,
            blocks: settings.blocks,
            masks: settings.masks
        };
        downloadFile('user-persona-forge-backup.json', JSON.stringify(payload, null, 2), 'application/json;charset=utf-8');
    }

    function importLibrary() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json,application/json';
        input.addEventListener('change', async () => {
            const file = input.files?.[0];
            if (!file) return;
            try {
                const data = JSON.parse(await file.text());
                if (!Array.isArray(data.blocks)) throw new Error('缺少 blocks 数组');
                if (!window.confirm('导入会覆盖当前区块库、分类与面具方案。建议先导出备份。确定继续吗？')) return;
                settings.blocks = data.blocks.map(block => ({
                    id: String(block.id || makeId()),
                    title: String(block.title || '未命名区块'),
                    category: String(block.category || '补充设定'),
                    content: String(block.content || ''),
                    createdAt: block.createdAt || new Date().toISOString(),
                    updatedAt: block.updatedAt || new Date().toISOString()
                }));
                settings.categories = Array.isArray(data.categories) ? data.categories.map(String) : clone(DEFAULT_CATEGORIES);
                settings.masks = Array.isArray(data.masks) ? data.masks.map(mask => ({
                    id: String(mask.id || makeId()),
                    name: String(mask.name || '未命名面具'),
                    blockIds: Array.isArray(mask.blockIds) ? mask.blockIds.map(String) : [],
                    createdAt: mask.createdAt || new Date().toISOString(),
                    updatedAt: mask.updatedAt || new Date().toISOString()
                })) : [];
                settings.builderIds = [];
                getSettings();
                save();
                render();
                notify('资料库备份导入完成。', 'success');
            } catch (error) {
                console.error('[User 面具工坊] import failed', error);
                notify('导入失败：文件不是有效的面具工坊 JSON 备份。', 'error');
            }
        });
        input.click();
    }

    function onPanelInput(event) {
        if (event.target.matches('.upf-search')) {
            searchText = event.target.value;
            const cursor = event.target.selectionStart;
            const value = event.target.value;
            const body = panel.querySelector('.upf-body');
            body.innerHTML = renderLibrary();
            const next = body.querySelector('.upf-search');
            if (next) {
                next.focus();
                next.setSelectionRange(cursor, cursor);
            }
        }
    }

    function onPanelChange(event) {
        if (event.target.matches('#upf-edit-category')) {
            event.target.dataset.changed = '1';
        }
    }

    function onPanelClick(event) {
        const button = event.target.closest('[data-action]');
        if (!button || !panel.contains(button)) return;
        const action = button.dataset.action;
        const id = button.dataset.id;

        if (action === 'close') closePanel();
        else if (action === 'tab') {
            editingBlock = null;
            activeTab = button.dataset.tab || 'library';
            render();
        }
        else if (action === 'category') {
            activeCategory = button.dataset.category || '全部';
            render();
        }
        else if (action === 'new-block') startEdit();
        else if (action === 'edit-block') startEdit(id);
        else if (action === 'save-block') saveBlock();
        else if (action === 'cancel-edit') { editingBlock = null; render(); }
        else if (action === 'add-block') addBlock(id);
        else if (action === 'remove-block') removeBlock(id);
        else if (action === 'move-block') moveBlock(id, button.dataset.dir);
        else if (action === 'save-mask') saveMask();
        else if (action === 'load-mask') loadMask(id);
        else if (action === 'add-category') addCategory();
        else if (action === 'create-fields') createFieldTemplates();
        else if (action === 'clear-builder') {
            if (window.confirm('清空当前合成台？区块库和已保存面具不会受到影响。')) {
                settings.builderIds = [];
                save();
                render();
            }
        }
        else if (action === 'copy-output') copyText(buildOutput());
        else if (action === 'apply-output') applyToCurrentPersona();
        else if (action === 'download-output') downloadFile('user-persona.txt', buildOutput(), 'text/plain;charset=utf-8');
        else if (action === 'export-library') exportLibrary();
        else if (action === 'import-library') importLibrary();
        else if (action === 'rename-mask') {
            const mask = settings.masks.find(item => item.id === id);
            if (!mask) return;
            const name = window.prompt('修改面具名称：', mask.name);
            if (name && name.trim()) {
                mask.name = name.trim();
                mask.updatedAt = new Date().toISOString();
                save();
                render();
            }
        }
        else if (action === 'duplicate-mask') {
            const mask = settings.masks.find(item => item.id === id);
            if (!mask) return;
            const name = window.prompt('复制后的面具名称：', mask.name + ' - 副本');
            if (name && name.trim()) {
                settings.masks.unshift({ ...clone(mask), id: makeId(), name: name.trim(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
                save();
                render();
            }
        }
        else if (action === 'delete-mask') {
            const mask = settings.masks.find(item => item.id === id);
            if (!mask || !window.confirm('删除面具方案「' + mask.name + '」？原始资料区块不会被删除。')) return;
            settings.masks = settings.masks.filter(item => item.id !== id);
            save();
            render();
        }
    }

    function mountLauncher() {
        if (document.querySelector('#upf-launch')) return true;
        const personaButton = document.querySelector('#persona-management-button');
        const host = personaButton?.parentElement ||
            document.querySelector('#top-bar, #top-settings-holder, #extensionsMenu');
        if (!host) return false;

        const button = document.createElement('button');
        button.type = 'button';
        button.id = 'upf-launch';
        button.className = 'menu_button upf-launch';
        button.innerHTML = '<span class="upf-launch-icon">U</span><span>面具工坊</span>';
        button.title = '打开 User 面具工坊';
        button.addEventListener('click', () => openPanel('library'));

        if (personaButton) personaButton.insertAdjacentElement('afterend', button);
        else host.appendChild(button);
        return true;
    }

    function init() {
        getSettings();
        if (mountLauncher()) return;
        if (observer) observer.disconnect();
        observer = new MutationObserver(() => {
            if (mountLauncher()) {
                observer.disconnect();
                observer = null;
            }
        });
        observer.observe(document.documentElement, { childList: true, subtree: true });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
        init();
    }
})();