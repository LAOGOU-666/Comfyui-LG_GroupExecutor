import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";
class GroupExecutorUI {
    static DOCK_MARGIN_X = 0;
    static DOCK_MARGIN_Y = 40;
    constructor() {
        this.container = null;
        this.isExecuting = false;
        this.isCancelling = false;
        this.groups = [];
        this.position = { x: 0, y: 0 };
        this.isDragging = false;
        this.dragOffset = { x: 0, y: 0 };
        this.DOCK_MARGIN_X = GroupExecutorUI.DOCK_MARGIN_X;
        this.DOCK_MARGIN_Y = GroupExecutorUI.DOCK_MARGIN_Y;
        this.createUI();
        this.attachEvents();
        this.container.instance = this;
    }
    createUI() {
        this.container = document.createElement('div');
        this.container.className = 'group-executor-ui';
        this.container.style.top = `${this.DOCK_MARGIN_Y}px`;
        this.container.style.right = `${this.DOCK_MARGIN_X}px`;
        this.container.innerHTML = `
            <div class="ge-header">
                <span class="ge-title">组执行管理器</span>
                <div class="ge-controls">
                    <button class="ge-dock-btn" title="停靠位置">📌</button>
                    <button class="ge-minimize-btn" title="最小化">-</button>
                    <button class="ge-close-btn" title="关闭">×</button>
                </div>
            </div>
            <div class="ge-content">
                <div class="ge-mode-switch">
                    <button class="ge-mode-btn active" data-mode="multi">多组执行</button>
                    <button class="ge-mode-btn" data-mode="single">单组执行</button>
                </div>
                <div class="ge-multi-mode">
                    <div class="ge-row ge-config-row">
                        <select class="ge-config-select">
                            <option value="">选择配置</option>
                        </select>
                        <button class="ge-save-config" title="保存配置">💾</button>
                        <button class="ge-delete-config" title="删除配置">🗑️</button>
                    </div>
                    <div class="ge-row">
                        <label>组数量:</label>
                        <input type="number" class="ge-group-count" min="1" max="50" value="1">
                    </div>
                    <div class="ge-groups-container"></div>
                    <div class="ge-row">
                        <label>重复次数:</label>
                        <input type="number" class="ge-repeat-count" min="1" max="100" value="1">
                    </div>
                    <div class="ge-row">
                        <label>延迟(秒):</label>
                        <input type="number" class="ge-delay" min="0" max="300" step="0.1" value="0">
                    </div>
                    <div class="ge-status"></div>
                    <div class="ge-buttons">
                        <button class="ge-execute-btn">执行</button>
                        <button class="ge-cancel-btn" disabled>取消</button>
                    </div>
                </div>
                <div class="ge-single-mode" style="display: none;">
                    <div class="ge-search-container">
                        <input type="text" class="ge-search-input" placeholder="搜索组名称...">
                        <button class="ge-search-clear" title="清除搜索">×</button>
                    </div>
                    <div class="ge-groups-list"></div>
                </div>
            </div>
        `;
        const style = document.createElement('style');
        style.textContent = `
            .group-executor-ui {
                position: fixed;
                top: 20px;
                right: 20px;
                width: 300px !important;
                min-width: 300px;
                max-width: 300px;
                background: #2a2a2a;
                border: 1px solid #444;
                border-radius: 8px;
                box-shadow: 0 4px 12px rgba(0,0,0,0.2);
                z-index: 1000;
                font-family: Arial, sans-serif;
                color: #fff;
                user-select: none;
            }
            .ge-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 8px 12px;
                background: #333;
                border-radius: 8px 8px 0 0;
                cursor: move;
                width: 100%;
                box-sizing: border-box;
            }
            .ge-controls button {
                background: none;
                border: none;
                color: #fff;
                margin-left: 8px;
                cursor: pointer;
                font-size: 16px;
            }
            .ge-content {
                padding: 12px;
                display: flex;
                flex-direction: column;
                max-height: calc(100vh - 100px);
            }
            .ge-row {
                display: flex;
                align-items: center;
                margin-bottom: 12px;
            }
            .ge-row label {
                flex: 1;
                margin-right: 12px;
            }
            .ge-row input {
                width: 100px;
                padding: 4px 8px;
                background: #333;
                border: 1px solid #444;
                color: #fff;
                border-radius: 4px;
            }
            .ge-groups-container,
            .ge-groups-list {
                max-height: calc(50vh - 180px);
                overflow-y: auto;
                margin-bottom: 12px;
                padding-right: 8px;
            }
            .ge-groups-container::-webkit-scrollbar,
            .ge-groups-list::-webkit-scrollbar {
                width: 6px;
            }
            .ge-groups-container::-webkit-scrollbar-track,
            .ge-groups-list::-webkit-scrollbar-track {
                background: #2a2a2a;
                border-radius: 3px;
            }
            .ge-groups-container::-webkit-scrollbar-thumb,
            .ge-groups-list::-webkit-scrollbar-thumb {
                background: #555;
                border-radius: 3px;
            }
            .ge-groups-container::-webkit-scrollbar-thumb:hover,
            .ge-groups-list::-webkit-scrollbar-thumb:hover {
                background: #666;
            }
            .ge-group-select {
                width: 100%;
                margin-bottom: 8px;
                padding: 4px 8px;
                background: #333;
                border: 1px solid #444;
                color: #fff;
                border-radius: 4px;
            }
            .ge-group-select:last-child {
                margin-bottom: 0;
            }
            .ge-group-item {
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: 10px;
                margin-bottom: 8px;
                background: #333;
                border-radius: 4px;
            }
            .ge-group-item:last-child {
                margin-bottom: 0;
            }
            .ge-group-name {
                flex: 1;
                margin-right: 8px;
            }
            .ge-group-controls {
                display: flex;
                gap: 10px;
                margin-left: auto;
            }
            .ge-buttons {
                display: flex;
                gap: 8px;
            }
            .ge-buttons button {
                flex: 1;
                padding: 8px;
                border: none;
                border-radius: 4px;
                cursor: pointer;
                font-weight: bold;
            }
            .ge-execute-btn {
                background: #4CAF50;
                color: white;
            }
            .ge-execute-btn:disabled {
                background: #2a5a2d;
                cursor: not-allowed;
            }
            .ge-cancel-btn {
                background: #f44336;
                color: white;
            }
            .ge-cancel-btn:disabled {
                background: #7a2520;
                cursor: not-allowed;
            }
            .ge-status {
                margin: 12px 0;
                padding: 8px;
                background: #333;
                border-radius: 4px;
                min-height: 20px;
                text-align: center;
                position: relative;
                overflow: hidden;
            }
            .ge-status::before {
                content: '';
                position: absolute;
                left: 0;
                top: 0;
                height: 100%;
                width: var(--progress, 0%);
                background: rgba(36, 145, 235, 0.8);
                transition: width 0.3s ease;
                z-index: 0;
            }
            .ge-status span {
                position: relative;
                z-index: 1;
            }
            .ge-minimized {
                width: auto !important;
                min-width: auto;
            }
            .ge-minimized .ge-content {
                display: none;
            }
            .ge-dock-menu {
                position: absolute;
                background: #333;
                border: 1px solid #444;
                border-radius: 4px;
                padding: 4px 0;
                z-index: 1001;
                visibility: hidden;
                opacity: 0;
                transition: opacity 0.2s;
            }
            .ge-dock-menu.visible {
                visibility: visible;
                opacity: 1;
            }
            .ge-dock-menu button {
                display: block;
                width: 100%;
                padding: 4px 12px;
                background: none;
                border: none;
                color: #fff;
                text-align: left;
                cursor: pointer;
            }
            .ge-dock-menu button:hover {
                background: #444;
            }
            .ge-title {
                flex: 1;
                pointer-events: none;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }
            .ge-config-row {
                display: flex;
                gap: 8px;
                margin-bottom: 12px;
            }
            .ge-config-select {
                flex: 1;
                padding: 4px 8px;
                background: #333;
                border: 1px solid #444;
                color: #fff;
                border-radius: 4px;
            }
            .ge-save-config,
            .ge-delete-config {
                background: #333;
                border: 1px solid #444;
                color: #fff;
                padding: 4px 8px;
                border-radius: 4px;
                cursor: pointer;
            }
            .ge-save-config:hover,
            .ge-delete-config:hover {
                background: #444;
            }
            .ge-delete-config:disabled {
                opacity: 0.5;
                cursor: not-allowed;
            }
            .ge-mode-switch {
                display: flex;
                margin-bottom: 12px;
                gap: 8px;
            }
            .ge-mode-btn {
                flex: 1;
                padding: 8px;
                background: #333;
                border: 1px solid #444;
                color: #fff;
                border-radius: 4px;
                cursor: pointer;
            }
            .ge-mode-btn.active {
                background: #4CAF50;
                border-color: #4CAF50;
            }
            .ge-execute-single-btn,
            .ge-cancel-single-btn {
                padding: 6px 12px;
                font-size: 14px;
                min-width: 60px;
                border: none;
                border-radius: 4px;
                cursor: pointer;
                font-weight: bold;
            }
            .ge-execute-single-btn {
                background: #4CAF50;
                color: white;
            }
            .ge-cancel-single-btn {
                background: #f44336;
                color: white;
                display: none;
            }
            .ge-execute-single-btn:disabled,
            .ge-cancel-single-btn:disabled {
                opacity: 0.5;
                cursor: not-allowed;
            }
            .ge-execute-single-btn:hover:not(:disabled) {
                background: #45a049;
            }
            .ge-cancel-single-btn:hover:not(:disabled) {
                background: #d32f2f;
            }
            .ge-search-container {
                display: flex;
                align-items: center;
                margin-bottom: 12px;
                gap: 8px;
            }
            .ge-search-input {
                flex: 1;
                padding: 8px 12px;
                background: #333;
                border: 1px solid #444;
                color: #fff;
                border-radius: 4px;
                font-size: 14px;
            }
            .ge-search-input:focus {
                outline: none;
                border-color: #666;
            }
            .ge-search-clear {
                background: #444;
                border: none;
                color: #fff;
                padding: 6px 10px;
                border-radius: 4px;
                cursor: pointer;
                font-size: 16px;
                display: none;
            }
            .ge-search-clear:hover {
                background: #555;
            }
        `;
        document.head.appendChild(style);
        document.body.appendChild(this.container);
    }
    attachEvents() {
        const header = this.container.querySelector('.ge-header');
        header.addEventListener('mousedown', (e) => {
            if (!e.target.matches('.ge-controls button')) {
                this.isDragging = true;
                const rect = this.container.getBoundingClientRect();
                this.dragOffset = {
                    x: e.clientX - rect.left,
                    y: e.clientY - rect.top
                };
            }
        });
        document.addEventListener('mousemove', (e) => {
            if (this.isDragging) {
                const x = e.clientX - this.dragOffset.x;
                const y = e.clientY - this.dragOffset.y;
                this.container.style.left = `${x}px`;
                this.container.style.top = `${y}px`;
            }
        });
        document.addEventListener('mouseup', () => {
            this.isDragging = false;
        });
        const dockBtn = this.container.querySelector('.ge-dock-btn');
        dockBtn.addEventListener('click', () => {
            this.showDockMenu(dockBtn);
        });
        const minimizeBtn = this.container.querySelector('.ge-minimize-btn');
        minimizeBtn.addEventListener('click', () => {
            this.container.classList.toggle('ge-minimized');
            minimizeBtn.textContent = this.container.classList.contains('ge-minimized') ? '+' : '-';
        });
        const closeBtn = this.container.querySelector('.ge-close-btn');
        closeBtn.addEventListener('click', () => {
            this.container.remove();
        });
        const groupCountInput = this.container.querySelector('.ge-group-count');
        groupCountInput.addEventListener('change', () => {
            this.updateGroupSelects(parseInt(groupCountInput.value));
        });
        const executeBtn = this.container.querySelector('.ge-execute-btn');
        executeBtn.addEventListener('click', () => {
            this.executeGroups();
        });
        const cancelBtn = this.container.querySelector('.ge-cancel-btn');
        cancelBtn.addEventListener('click', () => {
            this.cancelExecution();
        });
        this.updateGroupSelects(1);
        window.addEventListener('resize', () => {
            this.ensureInViewport();
        });
        const deleteConfigBtn = this.container.querySelector('.ge-delete-config');
        const saveConfigBtn = this.container.querySelector('.ge-save-config');
        const configSelect = this.container.querySelector('.ge-config-select');
        const updateDeleteButton = () => {
            deleteConfigBtn.disabled = !configSelect.value;
        };
        configSelect.addEventListener('change', () => {
            updateDeleteButton();
            if (configSelect.value) {
                this.loadConfig(configSelect.value);
            }
        });
        saveConfigBtn.addEventListener('click', () => {
            this.saveCurrentConfig();
        });
        deleteConfigBtn.addEventListener('click', () => {
            const configName = configSelect.value;
            if (configName) {
                this.deleteConfig(configName);
            }
        });
        updateDeleteButton();
        this.loadConfigs();
        const modeBtns = this.container.querySelectorAll('.ge-mode-btn');
        modeBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                const mode = btn.dataset.mode;
                this.switchMode(mode);
            });
        });
        this.updateSingleModeList();
        const searchInput = this.container.querySelector('.ge-search-input');
        const clearButton = this.container.querySelector('.ge-search-clear');
        
        searchInput.addEventListener('input', () => {
            clearButton.style.display = searchInput.value ? 'block' : 'none';
        });
    }
    showDockMenu(button) {
        const existingMenu = document.querySelector('.ge-dock-menu');
        if (existingMenu) {
            existingMenu.remove();
            return;
        }
        const menu = document.createElement('div');
        menu.className = 'ge-dock-menu';
        menu.innerHTML = `
            <button data-position="top-left">左上角</button>
            <button data-position="top-right">右上角</button>
            <button data-position="bottom-left">左下角</button>
            <button data-position="bottom-right">右下角</button>
        `;
        this.container.appendChild(menu);
        const buttonRect = button.getBoundingClientRect();
        const containerRect = this.container.getBoundingClientRect();
        menu.style.left = `${buttonRect.left - containerRect.left}px`;
        menu.style.top = `${buttonRect.bottom - containerRect.top + 5}px`;
        requestAnimationFrame(() => {
            menu.classList.add('visible');
        });
        menu.addEventListener('click', (e) => {
            const position = e.target.dataset.position;
            if (position) {
                this.dockTo(position);
                menu.classList.remove('visible');
                setTimeout(() => menu.remove(), 200);
            }
        });
        const closeMenu = (e) => {
            if (!menu.contains(e.target) && e.target !== button) {
                menu.classList.remove('visible');
                setTimeout(() => menu.remove(), 200);
                document.removeEventListener('click', closeMenu);
            }
        };
        setTimeout(() => {
            document.addEventListener('click', closeMenu);
        }, 0);
    }
    dockTo(position) {
        const style = this.container.style;
        style.transition = 'all 0.3s ease';
        const marginX = this.DOCK_MARGIN_X;
        const marginY = this.DOCK_MARGIN_Y;
        switch (position) {
            case 'top-left':
                style.top = `${marginY}px`;
                style.left = `${marginX}px`;
                style.right = 'auto';
                style.bottom = 'auto';
                break;
            case 'top-right':
                style.top = `${marginY}px`;
                style.right = `${marginX}px`;
                style.left = 'auto';
                style.bottom = 'auto';
                break;
            case 'bottom-left':
                style.bottom = `${marginY}px`;
                style.left = `${marginX}px`;
                style.right = 'auto';
                style.top = 'auto';
                break;
            case 'bottom-right':
                style.bottom = `${marginY}px`;
                style.right = `${marginX}px`;
                style.left = 'auto';
                style.top = 'auto';
                break;
        }
        setTimeout(() => {
            style.transition = '';
        }, 300);
    }
    updateGroupSelects(count) {
        const container = this.container.querySelector('.ge-groups-container');
        container.innerHTML = '';
        const groupNames = this.getGroupNames();
        for (let i = 0; i < count; i++) {
            const select = document.createElement('select');
            select.className = 'ge-group-select';
            select.innerHTML = `
                <option value="">选择组 #${i + 1}</option>
                ${groupNames.map(name => `<option value="${name}">${name}</option>`).join('')}
            `;
            container.appendChild(select);
        }
    }
    getGroupNames() {
        return [...app.graph._groups].map(g => g.title).sort();
    }
    updateStatus(text, progress = null) {
        const status = this.container.querySelector('.ge-status');
        status.innerHTML = `<span>${text}</span>`;
        if (progress !== null) {
            status.style.setProperty('--progress', `${progress}%`);
        }
    }
    async executeGroups() {
        if (this.isExecuting) {
            console.warn('[GroupExecutorUI] 已有执行任务在进行中');
            return;
        }
        const executeBtn = this.container.querySelector('.ge-execute-btn');
        const cancelBtn = this.container.querySelector('.ge-cancel-btn');
        const groupSelects = [...this.container.querySelectorAll('.ge-group-select')];
        const repeatCount = parseInt(this.container.querySelector('.ge-repeat-count').value);
        const delaySeconds = parseFloat(this.container.querySelector('.ge-delay').value);
        this.isExecuting = true;
        this.isCancelling = false;
        executeBtn.disabled = true;
        cancelBtn.disabled = false;
        const selectedGroups = groupSelects.map(select => select.value).filter(Boolean);
        const totalSteps = repeatCount * selectedGroups.length;
        let currentStep = 0;
        try {
            for (let repeat = 0; repeat < repeatCount; repeat++) {
                for (let i = 0; i < selectedGroups.length; i++) {
                    if (this.isCancelling) {
                        console.log('[GroupExecutorUI] 执行被用户取消');
                        await fetch('/interrupt', { method: 'POST' });
                        this.updateStatus("已取消");
                        break;
                    }
                    const groupName = selectedGroups[i];
                    currentStep++;
                    const progress = (currentStep / totalSteps) * 100;
                    this.updateStatus(`${currentStep}/${totalSteps} - ${groupName}`, progress);
                    try {
                        await this.executeGroup(groupName);
                        if (i < selectedGroups.length - 1 && delaySeconds > 0) {
                            this.updateStatus(`等待 ${delaySeconds}s...`);
                            await this.delay(delaySeconds);
                        }
                    } catch (error) {
                        throw new Error(`执行组 "${groupName}" 失败: ${error.message}`);
                    }
                }
                if (repeat < repeatCount - 1 && !this.isCancelling) {
                    await this.delay(delaySeconds);
                }
            }
            if (!this.isCancelling) {
                this.updateStatus("完成");
            }
        } catch (error) {
            console.error('[GroupExecutorUI] 执行错误:', error);
            this.updateStatus(`错误: ${error.message}`);
            app.ui.dialog.show(`执行错误: ${error.message}`);
        } finally {
            this.isExecuting = false;
            this.isCancelling = false;
            executeBtn.disabled = false;
            cancelBtn.disabled = true;
        }
    }
    async executeGroup(groupName) {
        const group = app.graph._groups.find(g => g.title === groupName);
        if (!group) {
            throw new Error(`未找到名为 "${groupName}" 的组`);
        }
        const outputNodes = [];
        for (const node of app.graph._nodes) {
            if (!node || !node.pos) continue;
            if (LiteGraph.overlapBounding(group._bounding, node.getBounding())) {
                if (node.mode !== LiteGraph.NEVER && node.constructor.nodeData?.output_node === true) {
                    outputNodes.push(node);
                }
            }
        }
        if (outputNodes.length === 0) {
            throw new Error(`组 "${groupName}" 中没有找到输出节点`);
        }
        const nodeIds = outputNodes.map(n => n.id);
        try {
            if (!rgthree || !rgthree.queueOutputNodes) {
                throw new Error('rgthree.queueOutputNodes 不可用');
            }
            await rgthree.queueOutputNodes(nodeIds);
            await this.waitForQueue();
        } catch (queueError) {
            console.warn(`[GroupExecutorUI] rgthree执行失败，使用默认方式:`, queueError);
            for (const n of outputNodes) {
                if (this.isCancelling) return;
                if (n.triggerQueue) {
                    await n.triggerQueue();
                    await this.waitForQueue();
                }
            }
        }
    }
    async cancelExecution() {
        if (!this.isExecuting) {
            console.warn('[GroupExecutorUI] 没有正在执行的任务');
            return;
        }
        try {
            this.isCancelling = true;
            this.updateStatus("已取消", 0);
            await fetch('/interrupt', { method: 'POST' });
        } catch (error) {
            console.error('[GroupExecutorUI] 取消执行时出错:', error);
            this.updateStatus(`取消失败: ${error.message}`, 0);
        }
    }
    async getQueueStatus() {
        try {
            const response = await fetch('/queue');
            const data = await response.json();
            return {
                isRunning: data.queue_running.length > 0,
                isPending: data.queue_pending.length > 0,
                runningCount: data.queue_running.length,
                pendingCount: data.queue_pending.length,
                rawRunning: data.queue_running,
                rawPending: data.queue_pending
            };
        } catch (error) {
            console.error('[GroupExecutor] 获取队列状态失败:', error);
            return {
                isRunning: false,
                isPending: false,
                runningCount: 0,
                pendingCount: 0,
                rawRunning: [],
                rawPending: []
            };
        }
    }
    async waitForQueue() {
        return new Promise((resolve, reject) => {
            const checkQueue = async () => {
                try {
                    const status = await this.getQueueStatus();
                    if (!status.isRunning && !status.isPending) {
                        setTimeout(resolve, 100);
                        return;
                    }
                    setTimeout(checkQueue, 500);
                } catch (error) {
                    console.warn(`[GroupExecutor] 检查队列状态失败:`, error);
                    setTimeout(checkQueue, 500);
                }
            };
            checkQueue();
        });
    }
    async delay(seconds) {
        if (seconds <= 0) return;
        return new Promise(resolve => setTimeout(resolve, seconds * 1000));
    }
    ensureInViewport() {
        const rect = this.container.getBoundingClientRect();
        const windowWidth = window.innerWidth;
        const windowHeight = window.innerHeight;
        if (this.container.style.right !== 'auto') {
            this.container.style.right = `${this.DOCK_MARGIN_X}px`;
        }
        if (this.container.style.left !== 'auto') {
            this.container.style.left = `${this.DOCK_MARGIN_X}px`;
        }
        if (this.container.style.top !== 'auto') {
            this.container.style.top = `${this.DOCK_MARGIN_Y}px`;
        }
        if (this.container.style.bottom !== 'auto') {
            this.container.style.bottom = `${this.DOCK_MARGIN_Y}px`;
        }
    }
    async loadConfigs() {
        try {
            const response = await api.fetchApi('/group_executor/configs', {
                method: 'GET'
            });
            const result = await response.json();
            if (result.status === "error") {
                throw new Error(result.message);
            }
            const select = this.container.querySelector('.ge-config-select');
            select.innerHTML = `
                <option value="">选择配置</option>
                ${result.configs.map(config => `<option value="${config.name}">${config.name}</option>`).join('')}
            `;
        } catch (error) {
            console.error('[GroupExecutor] 加载配置失败:', error);
            app.ui.dialog.show('加载配置失败: ' + error.message);
        }
    }
    async saveCurrentConfig() {
        const configName = prompt('请输入配置名称:', '新配置');
        if (!configName) return;
        const config = {
            name: configName,
            groups: [...this.container.querySelectorAll('.ge-group-select')]
                .map(select => select.value)
                .filter(Boolean),
            repeatCount: parseInt(this.container.querySelector('.ge-repeat-count').value),
            delay: parseFloat(this.container.querySelector('.ge-delay').value)
        };
        try {
            const jsonString = JSON.stringify(config);
            JSON.parse(jsonString);
            const response = await api.fetchApi('/group_executor/configs', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: jsonString
            });
            const result = await response.json();
            if (result.status === "error") {
                throw new Error(result.message);
            }
            await this.loadConfigs();
            app.ui.dialog.show('配置保存成功');
        } catch (error) {
            console.error('[GroupExecutor] 保存配置失败:', error);
            app.ui.dialog.show('保存配置失败: ' + error.message);
        }
    }
    async loadConfig(configName) {
        try {
            const response = await api.fetchApi(`/group_executor/configs/${configName}`, {
                method: 'GET',
                cache: 'no-store'
            });
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const config = await response.json();
            const groupCountInput = this.container.querySelector('.ge-group-count');
            groupCountInput.value = config.groups.length;
            await this.updateGroupSelects(config.groups.length);
            const selects = this.container.querySelectorAll('.ge-group-select');
            config.groups.forEach((group, index) => {
                if (selects[index]) selects[index].value = group;
            });
            this.container.querySelector('.ge-repeat-count').value = config.repeatCount;
            this.container.querySelector('.ge-delay').value = config.delay;
        } catch (error) {
            console.error('加载配置失败:', error);
            app.ui.dialog.show('加载配置失败: ' + error.message);
        }
    }
    async deleteConfig(configName) {
        if (!configName) return;
        if (!confirm(`确定要删除配置 "${configName}" 吗？`)) {
            return;
        }
        try {
            const response = await api.fetchApi(`/group_executor/configs/${configName}`, {
                method: 'DELETE'
            });
            const result = await response.json();
            if (result.status === "error") {
                throw new Error(result.message);
            }
            await this.loadConfigs();
            app.ui.dialog.show('配置已删除');
        } catch (error) {
            console.error('[GroupExecutor] 删除配置失败:', error);
            app.ui.dialog.show('删除配置失败: ' + error.message);
        }
    }
    switchMode(mode) {
        const multiMode = this.container.querySelector('.ge-multi-mode');
        const singleMode = this.container.querySelector('.ge-single-mode');
        const modeBtns = this.container.querySelectorAll('.ge-mode-btn');
        
        modeBtns.forEach(btn => {
            btn.classList.toggle('active', btn.dataset.mode === mode);
        });
        
        if (mode === 'multi') {
            multiMode.style.display = '';
            singleMode.style.display = 'none';
        } else {
            multiMode.style.display = 'none';
            singleMode.style.display = '';
            this.updateSingleModeList();
        }
    }
    updateSingleModeList() {
        const container = this.container.querySelector('.ge-groups-list');
        const searchInput = this.container.querySelector('.ge-search-input');
        const clearButton = this.container.querySelector('.ge-search-clear');
        const groupNames = this.getGroupNames();
        
        const filterGroups = (searchText) => {
            const normalizedSearch = searchText.toLowerCase();
            return groupNames.filter(name => 
                name.toLowerCase().includes(normalizedSearch)
            );
        };

        const renderGroups = (filteredGroups) => {
            container.innerHTML = filteredGroups.map(name => `
                <div class="ge-group-item" data-group="${name}">
                    <span class="ge-group-name">${name}</span>
                    <div class="ge-group-controls">
                        <button class="ge-execute-single-btn">执行</button>
                        <button class="ge-cancel-single-btn" disabled>取消</button>
                    </div>
                </div>
            `).join('');

            container.querySelectorAll('.ge-group-item').forEach(item => {
                const groupName = item.dataset.group;
                const executeBtn = item.querySelector('.ge-execute-single-btn');
                const cancelBtn = item.querySelector('.ge-cancel-single-btn');
                
                executeBtn.addEventListener('click', async () => {
                    executeBtn.disabled = true;
                    cancelBtn.disabled = false;
                    cancelBtn.style.display = 'block';
                    this.isExecuting = true;
                    this.isCancelling = false;
                    
                    try {
                        await this.executeGroup(groupName);
                        this.updateStatus(`组 "${groupName}" 执行完成`);
                    } catch (error) {
                        this.updateStatus(`执行失败: ${error.message}`);
                        console.error(error);
                    } finally {
                        this.isExecuting = false;
                        this.isCancelling = false;
                        executeBtn.disabled = false;
                        cancelBtn.disabled = true;
                        cancelBtn.style.display = 'none';
                    }
                });
                
                cancelBtn.addEventListener('click', async () => {
                    if (!this.isExecuting) return;
                    
                    try {
                        this.isCancelling = true;
                        this.updateStatus("正在取消...", 0);
                        await fetch('/interrupt', { method: 'POST' });
                        this.updateStatus("已取消", 0);
                    } catch (error) {
                        console.error('[GroupExecutorUI] 取消执行时出错:', error);
                        this.updateStatus(`取消失败: ${error.message}`, 0);
                    }
                });
            });
        };

        renderGroups(groupNames);

        searchInput.addEventListener('input', (e) => {
            const searchText = e.target.value;
            clearButton.style.display = searchText ? 'block' : 'none';
            const filteredGroups = filterGroups(searchText);
            renderGroups(filteredGroups);
        });

        clearButton.addEventListener('click', () => {
            searchInput.value = '';
            clearButton.style.display = 'none';
            renderGroups(groupNames);
        });
    }
}
app.registerExtension({
    name: "GroupExecutorUI",
    async setup() {
        await app.ui.settings.setup;
        
        // 先添加设置
        app.ui.settings.addSetting({
            id: "GroupExecutor.enabled",
            name: "显示组执行器按钮",
            type: "boolean",
            defaultValue: true,
            onChange: (value) => {
                const btn = document.querySelector('.group-executor-btn');
                if (btn) {
                    btn.style.display = value ? 'block' : 'none';
                }
            }
        });
        
        app.ui.settings.addSetting({
            id: "GroupExecutor.marginX",
            name: "组执行器水平边距",
            type: "number",
            defaultValue: 0,
            min: 0,
            max: 100,
            step: 1,
            onChange: (value) => {
                GroupExecutorUI.DOCK_MARGIN_X = value;
                document.querySelectorAll('.group-executor-ui').forEach(el => {
                    const instance = el.instance;
                    if (instance) {
                        instance.DOCK_MARGIN_X = value;
                        instance.ensureInViewport();
                    }
                });
            }
        });
        app.ui.settings.addSetting({
            id: "GroupExecutor.marginY",
            name: "组执行器垂直边距",
            type: "number",
            defaultValue: 60,
            min: 0,
            max: 100,
            step: 1,
            onChange: (value) => {
                GroupExecutorUI.DOCK_MARGIN_Y = value;
                document.querySelectorAll('.group-executor-ui').forEach(el => {
                    const instance = el.instance;
                    if (instance) {
                        instance.DOCK_MARGIN_Y = value;
                        instance.ensureInViewport();
                    }
                });
            }
        });
        try {
            const btn = new (await import("../../scripts/ui/components/button.js")).ComfyButton({
                icon: "layers-outline",
                action: () => {
                    new GroupExecutorUI();
                },
                tooltip: "组执行器",
                content: "组执行器",
                classList: "comfyui-button comfyui-menu-mobile-collapse group-executor-btn"
            }).element;
            
            // 修复: 不传递默认值参数
            let enabled = true;
            try {
                enabled = app.ui.settings.getSettingValue("GroupExecutor.enabled");
                // 如果返回undefined，则使用默认值
                if (enabled === undefined) {
                    enabled = true;
                }
            } catch (err) {
                console.warn("获取组执行器设置失败，使用默认值", err);
            }
            
            btn.style.display = enabled ? 'block' : 'none';
            app.menu?.actionsGroup.element.after(btn);
        } catch (error) {
            console.warn("创建现代UI按钮失败，使用传统按钮", error);
            const menu = document.querySelector(".comfy-menu");
            const clearButton = document.getElementById("comfy-clear-button");
            const groupExecutorButton = document.createElement("button");
            groupExecutorButton.textContent = "组执行器";
            groupExecutorButton.classList.add("group-executor-btn");
            
            // 修复: 不传递默认值参数
            let enabled = true;
            try {
                enabled = app.ui.settings.getSettingValue("GroupExecutor.enabled");
                // 如果返回undefined，则使用默认值
                if (enabled === undefined) {
                    enabled = true;
                }
            } catch (err) {
                console.warn("获取组执行器设置失败，使用默认值", err);
            }
            
            groupExecutorButton.style.display = enabled ? 'block' : 'none';
            groupExecutorButton.addEventListener("click", () => {
                new GroupExecutorUI();
            });
            if (clearButton) {
                menu.insertBefore(groupExecutorButton, clearButton);
            } else {
                menu.appendChild(groupExecutorButton);
            }
        }
    }
});