import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";
import { queueManager } from "./queue_utils.js";

app.registerExtension({
    name: "GroupExecutorSender",
    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        if (nodeData.name === "GroupExecutorSender") {
            nodeType.prototype.onNodeCreated = function() {
                this.properties = {
                    ...this.properties,
                    isExecuting: false,
                    isCancelling: false,
                    statusText: "",
                    showStatus: false
                };
                
                this.size = this.computeSize();
            };

            const onDrawForeground = nodeType.prototype.onDrawForeground;
            nodeType.prototype.onDrawForeground = function(ctx) {
                const r = onDrawForeground?.apply?.(this, arguments);

                if (!this.flags.collapsed && this.properties.showStatus) {
                    const text = this.properties.statusText;
                    if (text) {
                        ctx.save();

                        ctx.font = "bold 30px sans-serif";
                        ctx.textAlign = "center";
                        ctx.textBaseline = "middle";

                        ctx.fillStyle = this.properties.isExecuting ? "dodgerblue" : "limegreen";

                        const centerX = this.size[0] / 2;
                        const centerY = this.size[1] / 2 + 10; 

                        ctx.fillText(text, centerX, centerY);
                        
                        ctx.restore();
                    }
                }

                return r;
            };

            nodeType.prototype.computeSize = function() {
                return [400, 100]; // 固定宽度和高度
            };

            nodeType.prototype.updateStatus = function(text) {
                this.properties.statusText = text;
                this.properties.showStatus = true;
                this.setDirtyCanvas(true, true);
            };

            nodeType.prototype.resetStatus = function() {
                this.properties.statusText = "";
                this.properties.showStatus = false;
                this.setDirtyCanvas(true, true);
            };

            nodeType.prototype.getGroupOutputNodes = function(groupName) {

                const group = app.graph._groups.find(g => g.title === groupName);
                if (!group) {
                    console.warn(`[GroupExecutorSender] 未找到名为 "${groupName}" 的组`);
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
            };

            nodeType.prototype.getOutputNodes = function(nodes) {
                return nodes.filter((n) => {
                    return n.mode !== LiteGraph.NEVER && 
                           n.constructor.nodeData?.output_node === true;
                });
            };

            nodeType.prototype.getQueueStatus = async function() {
                try {
                    const response = await api.fetchApi('/queue');
                    if (!response.ok) {
                        throw new Error(`HTTP error! status: ${response.status}`);
                    }
                    const data = await response.json();

                    const queueRunning = data.queue_running || [];
                    const queuePending = data.queue_pending || [];
                    
                    return {
                        isRunning: queueRunning.length > 0,
                        isPending: queuePending.length > 0,
                        runningCount: queueRunning.length,
                        pendingCount: queuePending.length,
                        rawRunning: queueRunning,
                        rawPending: queuePending
                    };
                } catch (error) {
                    console.error('[GroupExecutorSender] 获取队列状态失败:', error);

                    return {
                        isRunning: false,
                        isPending: false,
                        runningCount: 0,
                        pendingCount: 0,
                        rawRunning: [],
                        rawPending: []
                    };
                }
            };

            nodeType.prototype.waitForQueue = async function() {
                return new Promise((resolve, reject) => {
                    const checkQueue = async () => {
                        try {
                            if (this.properties.isCancelling) {
                                resolve();
                                return;
                            }
                            
                            const status = await this.getQueueStatus();

                            if (!status.isRunning && !status.isPending) {
                                setTimeout(resolve, 100);
                                return;
                            }

                            setTimeout(checkQueue, 500);
                        } catch (error) {
                            console.warn(`[GroupExecutorSender] 检查队列状态失败:`, error);
                            setTimeout(checkQueue, 500);
                        }
                    };

                    checkQueue();
                });
            };

            nodeType.prototype.cancelExecution = async function() {
                if (!this.properties.isExecuting) {
                    console.warn('[GroupExecutorSender] 没有正在执行的任务');
                    return;
                }

                try {
                    this.properties.isCancelling = true;
                    this.updateStatus("正在取消执行...");
                    
                    await fetch('/interrupt', { method: 'POST' });
                    
                    this.updateStatus("已取消");
                    setTimeout(() => this.resetStatus(), 2000);
                    
                } catch (error) {
                    console.error('[GroupExecutorSender] 取消执行时出错:', error);
                    this.updateStatus(`取消失败: ${error.message}`);
                }
            };

            const originalFetchApi = api.fetchApi;
            api.fetchApi = async function(url, options = {}) {
                if (url === '/interrupt') {
                    api.dispatchEvent(new CustomEvent("execution_interrupt", { 
                        detail: { timestamp: Date.now() }
                    }));
                }

                return originalFetchApi.call(this, url, options);
            };
            api.addEventListener("execution_interrupt", () => {
                const senderNodes = app.graph._nodes.filter(n => 
                    n.type === "GroupExecutorSender" && n.properties.isExecuting
                );

                senderNodes.forEach(node => {
                    if (node.properties.isExecuting && !node.properties.isCancelling) {
                        console.log(`[GroupExecutorSender] 接收到中断请求，取消节点执行:`, node.id);
                        node.properties.isCancelling = true;
                        node.updateStatus("正在取消执行...");
                    }
                });
            });

            api.addEventListener("execute_group_list", async ({ detail }) => {
                if (!detail || !detail.node_id || !Array.isArray(detail.execution_list)) {
                    console.error('[GroupExecutorSender] 收到无效的执行数据:', detail);
                    return;
                }

                const node = app.graph._nodes_by_id[detail.node_id];
                if (!node) {
                    console.error(`[GroupExecutorSender] 未找到节点: ${detail.node_id}`);
                    return;
                }

                try {
                    const executionList = detail.execution_list;
                    console.log(`[GroupExecutorSender] 收到执行列表:`, executionList);

                    if (node.properties.isExecuting) {
                        console.warn('[GroupExecutorSender] 已有执行任务在进行中');
                        return;
                    }

                    node.properties.isExecuting = true;
                    node.properties.isCancelling = false;

                    let totalTasks = executionList.reduce((total, item) => {
                        if (item.group_name !== "__delay__") {
                            return total + (parseInt(item.repeat_count) || 1);
                        }
                        return total;
                    }, 0);
                    let currentTask = 0;

                    try {
                        for (const execution of executionList) {
                            if (node.properties.isCancelling) {
                                console.log('[GroupExecutorSender] 执行被取消');
                                break;
                            }
                            
                            const group_name = execution.group_name || '';
                            const repeat_count = parseInt(execution.repeat_count) || 1;
                            const delay_seconds = parseFloat(execution.delay_seconds) || 0;

                            if (!group_name) {
                                console.warn('[GroupExecutorSender] 跳过无效的组名称:', execution);
                                continue;
                            }

                            if (group_name === "__delay__") {
                                if (delay_seconds > 0 && !node.properties.isCancelling) {
                                    node.updateStatus(
                                        `等待下一组 ${delay_seconds}s...`
                                    );
                                    await new Promise(resolve => setTimeout(resolve, delay_seconds * 1000));
                                }
                                continue;
                            }

                            for (let i = 0; i < repeat_count; i++) {
                                if (node.properties.isCancelling) {
                                    break;
                                }

                                currentTask++;
                                const progress = (currentTask / totalTasks) * 100;
                                node.updateStatus(
                                    `执行组: ${group_name} (${currentTask}/${totalTasks}) - 第${i + 1}/${repeat_count}次`,
                                    progress
                                );
                                
                                try {
                                    const outputNodes = node.getGroupOutputNodes(group_name);
                                    if (!outputNodes || !outputNodes.length) {
                                        throw new Error(`组 "${group_name}" 中没有找到输出节点`);
                                    }

                                    const nodeIds = outputNodes.map(n => n.id);
                                    
                                    try {
                                        if (node.properties.isCancelling) {
                                            break;
                                        }
                                        await queueManager.queueOutputNodes(nodeIds);
                                        await node.waitForQueue();
                                    } catch (queueError) {
                                        if (node.properties.isCancelling) {
                                            break;
                                        }
                                        console.warn(`[GroupExecutorSender] 队列执行失败，使用默认方式:`, queueError);
                                            for (const n of outputNodes) {
                                                if (node.properties.isCancelling) {
                                                    break;
                                                }
                                                if (n.triggerQueue) {
                                                    await n.triggerQueue();
                                                    await node.waitForQueue();
                                                }
                                            }
                                        }
                                    

                                    if (delay_seconds > 0 && (i < repeat_count - 1 || currentTask < totalTasks) && !node.properties.isCancelling) {
                                        node.updateStatus(
                                            `执行组: ${group_name} (${currentTask}/${totalTasks}) - 等待 ${delay_seconds}s`,
                                            progress
                                        );
                                        await new Promise(resolve => setTimeout(resolve, delay_seconds * 1000));
                                    }
                                } catch (error) {
                                    throw new Error(`执行组 "${group_name}" 失败: ${error.message}`);
                                }
                            }
                            
                            if (node.properties.isCancelling) {
                                break;
                            }
                        }

                        if (node.properties.isCancelling) {
                            node.updateStatus("已取消");
                            setTimeout(() => node.resetStatus(), 2000);
                        } else {
                            node.updateStatus(`执行完成 (${totalTasks}/${totalTasks})`, 100);
                            setTimeout(() => node.resetStatus(), 2000);
                        }

                    } catch (error) {
                        console.error('[GroupExecutorSender] 执行错误:', error);
                        node.updateStatus(`错误: ${error.message}`);
                        app.ui.dialog.show(`执行错误: ${error.message}`);
                    } finally {
                        node.properties.isExecuting = false;
                        node.properties.isCancelling = false;
                    }

                } catch (error) {
                    console.error(`[GroupExecutorSender] 执行失败:`, error);
                    app.ui.dialog.show(`执行错误: ${error.message}`);
                    node.updateStatus(`错误: ${error.message}`);
                    node.properties.isExecuting = false;
                    node.properties.isCancelling = false;
                }
            });
        }
    }
});

