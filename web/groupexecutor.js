import { app } from "../../scripts/app.js";
import { ComfyWidgets } from "../../scripts/widgets.js";
import { api } from "../../scripts/api.js";
class BaseNode extends LGraphNode {
    static defaultComfyClass = "BaseNode";
     constructor(title, comfyClass) {
        super(title);
        this.isVirtualNode = false;
        this.configuring = false;
        this.__constructed__ = false;
        this.widgets = this.widgets || [];
        this.properties = this.properties || {};
        this.comfyClass = comfyClass || this.constructor.comfyClass || BaseNode.defaultComfyClass;
         setTimeout(() => {
            this.checkAndRunOnConstructed();
        });
    }
    checkAndRunOnConstructed() {
        if (!this.__constructed__) {
            this.onConstructed();
        }
        return this.__constructed__;
    }
    onConstructed() {
        if (this.__constructed__) return false;
        this.type = this.type ?? undefined;
        this.__constructed__ = true;
        return this.__constructed__;
    }
    configure(info) {
        this.configuring = true;
        super.configure(info);
        for (const w of this.widgets || []) {
            w.last_y = w.last_y || 0;
        }
        this.configuring = false;
    }
    static setUp() {
        if (!this.type) {
            throw new Error(`Missing type for ${this.name}: ${this.title}`);
        }
        LiteGraph.registerNodeType(this.type, this);
        if (this._category) {
            this.category = this._category;
        }
    }
}
class GroupExecutorNode extends BaseNode {
    static type = "GroupExecutor";
    static title = "Group Executor";
    static category = "🎈LAOGOU";
    static _category = "🎈LAOGOU";
    constructor(title = GroupExecutorNode.title) {
        super(title, null);
        this.isVirtualNode = true;
        this.addProperty("groupCount", 1, "int");
        this.addProperty("groups", [], "array");
        this.addProperty("isExecuting", false, "boolean");
        this.addProperty("repeatCount", 1, "int");
        this.addProperty("delaySeconds", 0, "number");
        const groupCountWidget = ComfyWidgets["INT"](this, "groupCount", ["INT", {
            min: 1,
            max: 10,
            step: 1,
            default: 1
        }], app);
        const repeatCountWidget = ComfyWidgets["INT"](this, "repeatCount", ["INT", {
            min: 1,
            max: 100,
            step: 1,
            default: 1,
            label: "Repeat Count",
            tooltip: "执行重复次数"
        }], app);
        const delayWidget = ComfyWidgets["FLOAT"](this, "delaySeconds", ["FLOAT", {
            min: 0,
            max: 300,
            step: 0.1,
            default: 0,
            label: "Delay (s)",
            tooltip: "队列之间的延迟时间(秒)"
        }], app);
        if (repeatCountWidget.widget && delayWidget.widget) {
            const widgets = [repeatCountWidget.widget, delayWidget.widget];
            widgets.forEach((widget, index) => {
                const widgetIndex = this.widgets.indexOf(widget);
                if (widgetIndex !== -1) {
                    const w = this.widgets.splice(widgetIndex, 1)[0];
                    this.widgets.splice(1 + index, 0, w);
                }
            });
        }
        groupCountWidget.widget.callback = (v) => {
            this.properties.groupCount = Math.max(1, Math.min(10, parseInt(v) || 1));
            this.updateGroupWidgets();
        };
        repeatCountWidget.widget.callback = (v) => {
            this.properties.repeatCount = Math.max(1, Math.min(100, parseInt(v) || 1));
        };
        delayWidget.widget.callback = (v) => {
            this.properties.delaySeconds = Math.max(0, Math.min(300, parseFloat(v) || 0));
        };
        this.addWidget("button", "Execute Groups", "Execute", () => {
            this.executeGroups();
        });
        this.addWidget("button", "Cancel", "Cancel", () => {
            this.cancelExecution();
        });
        this.addProperty("isCancelling", false, "boolean");
        this.updateGroupWidgets();
        const self = this;
        app.canvas.onDrawBackground = (() => {
            const original = app.canvas.onDrawBackground;
            return function() {
                self.updateGroupList();
                return original?.apply(this, arguments);
            };
        })();
        this.originalTitle = title;
    }
    getGroupNames() {
        return [...app.graph._groups].map(g => g.title).sort();
    }
    getGroupOutputNodes(groupName) {
        const group = app.graph._groups.find(g => g.title === groupName);
        if (!group) {
            console.warn(`[GroupExecutor] 未找到名为 "${groupName}" 的组`);
            return [];
        }
        const groupNodes = [];
        for (const node of app.graph._nodes) {
            if (!node || !node.pos) continue;
            if (LiteGraph.overlapBounding(group._bounding, node.getBounding())) {
                groupNodes.push(node);
            }
        }
        group._nodes = groupNodes;
        return this.getOutputNodes(group._nodes);
    }
    getOutputNodes(nodes) {
        return nodes.filter((n) => {
            return n.mode !== LiteGraph.NEVER &&
                   n.constructor.nodeData?.output_node === true;
        });
    }
    updateGroupWidgets() {
        const currentGroups = [...this.properties.groups];
        this.properties.groups = new Array(this.properties.groupCount).fill("").map((_, i) =>
            currentGroups[i] || ""
        );
        this.widgets = this.widgets.filter(w =>
            w.name === "groupCount" ||
            w.name === "repeatCount" ||
            w.name === "delaySeconds" ||
            w.name === "Execute Groups" ||
            w.name === "Cancel"
        );
        const executeButton = this.widgets.find(w => w.name === "Execute Groups");
        const cancelButton = this.widgets.find(w => w.name === "Cancel");
        if (executeButton) {
            this.widgets = this.widgets.filter(w => w.name !== "Execute Groups");
        }
        if (cancelButton) {
            this.widgets = this.widgets.filter(w => w.name !== "Cancel");
        }
        const groupNames = this.getGroupNames();
        for (let i = 0; i < this.properties.groupCount; i++) {
            const widget = this.addWidget(
                "combo",
                `Group #${i + 1}`,
                this.properties.groups[i] || "",
                (v) => {
                    this.properties.groups[i] = v;
                },
                {
                    values: groupNames
                }
            );
        }
        if (executeButton) {
            this.widgets.push(executeButton);
        }
        if (cancelButton) {
            this.widgets.push(cancelButton);
        }
        this.size = this.computeSize();
    }
    updateGroupList() {
        const groups = this.getGroupNames();
        this.widgets.forEach(w => {
            if (w.type === "combo") {
                w.options.values = groups;
            }
        });
    }
    async delay(seconds) {
        if (seconds <= 0) return;
        return new Promise(resolve => setTimeout(resolve, seconds * 1000));
    }
    updateStatus(text) {
        this.title = `${this.originalTitle} - ${text}`;
        this.setDirtyCanvas(true, true);
    }
    resetStatus() {
        this.title = this.originalTitle;
        this.setDirtyCanvas(true, true);
    }
    async cancelExecution() {
        if (!this.properties.isExecuting) {
            console.warn('[GroupExecutor] 没有正在执行的任务');
            return;
        }
        try {
            this.properties.isCancelling = true;
            this.updateStatus("已取消");
            await fetch('/interrupt', { method: 'POST' });
        } catch (error) {
            console.error('[GroupExecutor] 取消执行时出错:', error);
            this.updateStatus(`取消失败: ${error.message}`);
        }
    }
    async executeGroups() {
        if (this.properties.isExecuting) {
            console.warn('[GroupExecutor] 已有执行任务在进行中');
            return;
        }
        this.properties.isExecuting = true;
        this.properties.isCancelling = false;
        const totalSteps = this.properties.repeatCount * this.properties.groupCount;
        let currentStep = 0;
        try {
            for (let repeat = 0; repeat < this.properties.repeatCount; repeat++) {
                for (let i = 0; i < this.properties.groupCount; i++) {
                    if (this.properties.isCancelling) {
                        console.log('[GroupExecutor] 执行被用户取消');
                        await fetch('/interrupt', { method: 'POST' });
                        this.updateStatus("已取消");
                        setTimeout(() => this.resetStatus(), 2000);
                        return;
                    }
                    const groupName = this.properties.groups[i];
                    if (!groupName) continue;
                    currentStep++;
                    this.updateStatus(
                        `${currentStep}/${totalSteps} - ${groupName}`
                    );
                    const outputNodes = this.getGroupOutputNodes(groupName);
                    if (outputNodes && outputNodes.length > 0) {
                        try {
                            if (!rgthree || !rgthree.queueOutputNodes) {
                                throw new Error('rgthree.queueOutputNodes 不可用');
                            }
                            const nodeIds = outputNodes.map(n => n.id);
                            try {
                                if (this.properties.isCancelling) {
                                    return;
                                }
                                await rgthree.queueOutputNodes(nodeIds);
                                await this.waitForQueue();
                            } catch (queueError) {
                                if (this.properties.isCancelling) {
                                    return;
                                }
                                console.warn(`[GroupExecutorSender] rgthree执行失败，使用默认方式:`, queueError);
                                for (const n of outputNodes) {
                                    if (this.properties.isCancelling) {
                                        return;
                                    }
                                    if (n.triggerQueue) {
                                        await n.triggerQueue();
                                        await this.waitForQueue();
                                    }
                                }
                            }
                            if (i < this.properties.groupCount - 1) {
                                if (this.properties.isCancelling) {
                                    return;
                                }
                                this.updateStatus(
                                    `等待 ${this.properties.delaySeconds}s...`
                                );
                                await this.delay(this.properties.delaySeconds);
                            }
                        } catch (error) {
                            console.error(`[GroupExecutor] 执行组 ${groupName} 时发生错误:`, error);
                            throw error;
                        }
                    }
                }
                if (repeat < this.properties.repeatCount - 1) {
                    if (this.properties.isCancelling) {
                        return;
                    }
                    await this.delay(this.properties.delaySeconds);
                }
            }
            if (!this.properties.isCancelling) {
                this.updateStatus("完成");
                setTimeout(() => this.resetStatus(), 2000);
            }
        } catch (error) {
            console.error('[GroupExecutor] 执行错误:', error);
            this.updateStatus(`错误: ${error.message}`);
            app.ui.dialog.show(`执行错误: ${error.message}`);
        } finally {
            this.properties.isExecuting = false;
            this.properties.isCancelling = false;
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
    computeSize() {
        const widgetHeight = 28;
        const padding = 4;
        const width = 200;
        const height = (this.properties.groupCount + 4) * widgetHeight + padding * 2;
        return [width, height];
    }
    static setUp() {
        LiteGraph.registerNodeType(this.type, this);
        this.category = this._category;
    }
    serialize() {
        const data = super.serialize();
        data.properties = {
            ...data.properties,
            groupCount: parseInt(this.properties.groupCount) || 1,
            groups: [...this.properties.groups],
            isExecuting: this.properties.isExecuting,
            repeatCount: parseInt(this.properties.repeatCount) || 1,
            delaySeconds: parseFloat(this.properties.delaySeconds) || 0
        };
        return data;
    }
    configure(info) {
        super.configure(info);
        if (info.properties) {
            this.properties.groupCount = parseInt(info.properties.groupCount) || 1;
            this.properties.groups = info.properties.groups ? [...info.properties.groups] : [];
            this.properties.isExecuting = info.properties.isExecuting ?? false;
            this.properties.repeatCount = parseInt(info.properties.repeatCount) || 1;
            this.properties.delaySeconds = parseFloat(info.properties.delaySeconds) || 0;
        }
        this.widgets.forEach(w => {
            if (w.name === "groupCount") {
                w.value = this.properties.groupCount;
            } else if (w.name === "repeatCount") {
                w.value = this.properties.repeatCount;
            } else if (w.name === "delaySeconds") {
                w.value = this.properties.delaySeconds;
            }
        });
        if (!this.configuring) {
            this.updateGroupWidgets();
        }
    }
}
app.registerExtension({
    name: "GroupExecutor",
    registerCustomNodes() {
        GroupExecutorNode.setUp();
    }
});