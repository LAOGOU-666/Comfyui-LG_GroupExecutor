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
        this.addProperty("delaySeconds", 0, "number");  // 新增：延迟时间属性

        // 组数量组件
        const groupCountWidget = ComfyWidgets["INT"](this, "groupCount", ["INT", {
            min: 1,
            max: 10,
            step: 1,
            default: 1
        }], app);

        // 重复次数组件
        const repeatCountWidget = ComfyWidgets["INT"](this, "repeatCount", ["INT", {
            min: 1,
            max: 100,
            step: 1,
            default: 1,
            label: "Repeat Count",
            tooltip: "执行重复次数"
        }], app);

        // 新增：延迟时间组件
        const delayWidget = ComfyWidgets["FLOAT"](this, "delaySeconds", ["FLOAT", {
            min: 0,
            max: 300,  // 最大300秒
            step: 0.1,
            default: 0,
            label: "Delay (s)",
            tooltip: "队列之间的延迟时间(秒)"
        }], app);

        // 调整组件顺序
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

        // 监听值变化
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

        // 添加执行按钮
        this.addWidget("button", "Execute Groups", "Execute", () => {
            this.executeGroups();
        });

        // 添加取消按钮（放在执行按钮后面）
        this.addWidget("button", "Cancel", "Cancel", () => {
            this.cancelExecution();
        });
        
        // 添加取消状态属性
        this.addProperty("isCancelling", false, "boolean");

        // 初始化组选择下拉框
        this.updateGroupWidgets();

        // 监听画布变化以更新组列表
        const self = this;
        app.canvas.onDrawBackground = (() => {
            const original = app.canvas.onDrawBackground;
            return function() {
                self.updateGroupList();
                return original?.apply(this, arguments);
            };
        })();

        // 保存原始标题
        this.originalTitle = title;
    }

    // 获取所有组名称
    getGroupNames() {
        return [...app.graph._groups].map(g => g.title).sort();
    }

    // 获取指定组的输出节点
    getGroupOutputNodes(groupName) {
        // 找到指定名称的组
        const group = app.graph._groups.find(g => g.title === groupName);
        if (!group) {
            console.warn(`[GroupExecutor] 未找到名为 "${groupName}" 的组`);
            return [];
        }

        // 获取组内的所有节点
        const groupNodes = [];
        for (const node of app.graph._nodes) {
            if (!node || !node.pos) continue;
            if (LiteGraph.overlapBounding(group._bounding, node.getBounding())) {
                groupNodes.push(node);
            }
        }
        group._nodes = groupNodes;

        // 获取输出节点
        return this.getOutputNodes(group._nodes);
    }

    // 获取输出节点
    getOutputNodes(nodes) {
        return nodes.filter((n) => {
            return n.mode !== LiteGraph.NEVER && 
                   n.constructor.nodeData?.output_node === true;
        });
    }

    // 更新组选择下拉框
    updateGroupWidgets() {
        // 保留已有的组选择，只初始化新增的
        const currentGroups = [...this.properties.groups];
        this.properties.groups = new Array(this.properties.groupCount).fill("").map((_, i) => 
            currentGroups[i] || ""
        );
        
        // 1. 首先移除所有组选择下拉框
        this.widgets = this.widgets.filter(w => 
            w.name === "groupCount" || 
            w.name === "repeatCount" || 
            w.name === "delaySeconds" ||
            w.name === "Execute Groups" ||
            w.name === "Cancel"
        );

        // 2. 获取执行按钮和取消按钮的引用
        const executeButton = this.widgets.find(w => w.name === "Execute Groups");
        const cancelButton = this.widgets.find(w => w.name === "Cancel");

        // 3. 如果存在这些按钮，先从widgets中移除
        if (executeButton) {
            this.widgets = this.widgets.filter(w => w.name !== "Execute Groups");
        }
        if (cancelButton) {
            this.widgets = this.widgets.filter(w => w.name !== "Cancel");
        }

        // 4. 添加组选择下拉框
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

        // 5. 最后重新添加执行按钮和取消按钮
        if (executeButton) {
            this.widgets.push(executeButton);
        }
        if (cancelButton) {
            this.widgets.push(cancelButton);
        }

        // 6. 更新节点大小
        this.size = this.computeSize();
    }

    // 更新组列表
    updateGroupList() {
        const groups = this.getGroupNames();
        this.widgets.forEach(w => {
            if (w.type === "combo") {
                w.options.values = groups;
            }
        });
    }

    // 添加延迟函数
    async delay(seconds) {
        if (seconds <= 0) return;
        return new Promise(resolve => setTimeout(resolve, seconds * 1000));
    }

    // 更新状态显示
    updateStatus(text) {
        // 更新节点标题来显示状态
        this.title = `${this.originalTitle} - ${text}`;
        this.setDirtyCanvas(true, true);
    }

    // 重置状态显示
    resetStatus() {
        this.title = this.originalTitle;
        this.setDirtyCanvas(true, true);
    }

    // 修改取消方法
    async cancelExecution() {
        if (!this.properties.isExecuting) {
            console.warn('[GroupExecutor] 没有正在执行的任务');
            return;
        }

        try {
            this.properties.isCancelling = true;
            this.updateStatus("已取消");
            
            // 中断当前执行的队列
            await fetch('/interrupt', { method: 'POST' });
            
            // 不需要清理待执行队列，因为通过 isCancelling 标志会阻止新队列的添加
            
        } catch (error) {
            console.error('[GroupExecutor] 取消执行时出错:', error);
            this.updateStatus(`取消失败: ${error.message}`);
        }
    }

    // 修改执行方法，添加取消检查
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
                    // 检查是否已取消
                    if (this.properties.isCancelling) {
                        console.log('[GroupExecutor] 执行被用户取消');
                        // 中断当前执行的队列
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
                                // 在每个队列执行前检查取消状态
                                if (this.properties.isCancelling) {
                                    return;
                                }
                                await rgthree.queueOutputNodes(nodeIds);
                                await this.waitForQueue();
                            } catch (queueError) {
                                // 在回退执行前检查取消状态
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
                                // 延迟前检查是否取消
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
                    // 重复前检查是否取消
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

    // 获取队列状态
    async getQueueStatus() {
        try {
            const response = await fetch('/queue');
            const data = await response.json();

            return {
                isRunning: data.queue_running.length > 0,
                isPending: data.queue_pending.length > 0,
                runningCount: data.queue_running.length,
                pendingCount: data.queue_pending.length,
                // 保存原始数据用于调试
                rawRunning: data.queue_running,
                rawPending: data.queue_pending
            };
        } catch (error) {
            console.error('[GroupExecutor] 获取队列状态失败:', error);
            // 返回默认状态而不是 null，避免空值判断
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

    // 等待队列完成
    async waitForQueue() {
        return new Promise((resolve, reject) => {
            const checkQueue = async () => {
                try {
                    const status = await this.getQueueStatus();
                    
                    // 只有当运行队列和等待队列都为空时才算完成
                    if (!status.isRunning && !status.isPending) {
                        // 额外等待100ms确保状态完全更新
                        setTimeout(resolve, 100);
                        return;
                    }

                    // 继续检查队列状态，使用较短的间隔以提高响应性
                    setTimeout(checkQueue, 500);
                } catch (error) {
                    console.warn(`[GroupExecutor] 检查队列状态失败:`, error);
                    // 发生错误时继续检查，而不是中断
                    setTimeout(checkQueue, 500);
                }
            };

            // 开始检查队列
            checkQueue();
        });
    }

    // 修改计算节点大小方法以适应新按钮
    computeSize() {
        const widgetHeight = 28;
        const padding = 4;
        const width = 200;
        const height = (this.properties.groupCount + 4) * widgetHeight + padding * 2;  // +4 包含重复次数组件和取消按钮
        return [width, height];
    }

    static setUp() {
        LiteGraph.registerNodeType(this.type, this);
        this.category = this._category;
    }

    // 序列化节点数据
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

    // 反序列化节点数据
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




