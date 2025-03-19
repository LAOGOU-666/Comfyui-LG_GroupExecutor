import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

app.registerExtension({
    name: "GroupExecutorSender",
    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        if (nodeData.name === "GroupExecutorSender") {
            // 添加状态显示相关的属性
            nodeType.prototype.onNodeCreated = function() {
                this.properties = {
                    ...this.properties,
                    isExecuting: false,
                    statusText: "",
                    showStatus: false
                };
                this.size = this.computeSize();
            };

            // 重写绘制方法
            const onDrawForeground = nodeType.prototype.onDrawForeground;
            nodeType.prototype.onDrawForeground = function(ctx) {
                const r = onDrawForeground?.apply?.(this, arguments);

                if (!this.flags.collapsed && this.properties.showStatus) {
                    const text = this.properties.statusText;
                    if (text) {
                        ctx.save();
                        
                        // 设置字体
                        ctx.font = "bold 30px sans-serif";
                        ctx.textAlign = "center";
                        ctx.textBaseline = "middle";
                        
                        // 设置颜色
                        ctx.fillStyle = this.properties.isExecuting ? "dodgerblue" : "limegreen";
                        
                        // 计算中心位置
                        const centerX = this.size[0] / 2;
                        const centerY = this.size[1] / 2 + 10; // 稍微向下偏移以避开输入端口
                        
                        // 绘制文本
                        ctx.fillText(text, centerX, centerY);
                        
                        ctx.restore();
                    }
                }

                return r;
            };

            // 更新节点大小计算
            nodeType.prototype.computeSize = function() {
                return [400, 100]; // 固定宽度和高度
            };

            // 更新状态显示方法
            nodeType.prototype.updateStatus = function(text) {
                this.properties.statusText = text;
                this.properties.showStatus = true;
                this.setDirtyCanvas(true, true);
            };

            // 重置状态显示方法
            nodeType.prototype.resetStatus = function() {
                this.properties.statusText = "";
                this.properties.showStatus = false;
                this.setDirtyCanvas(true, true);
            };

            // 获取指定组的输出节点
            nodeType.prototype.getGroupOutputNodes = function(groupName) {
                // 找到指定名称的组
                const group = app.graph._groups.find(g => g.title === groupName);
                if (!group) {
                    console.warn(`[GroupExecutorSender] 未找到名为 "${groupName}" 的组`);
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
            };

            // 获取输出节点
            nodeType.prototype.getOutputNodes = function(nodes) {
                return nodes.filter((n) => {
                    return n.mode !== LiteGraph.NEVER && 
                           n.constructor.nodeData?.output_node === true;
                });
            };

            // 获取队列状态
            nodeType.prototype.getQueueStatus = async function() {
                try {
                    const response = await api.fetchApi('/queue');
                    if (!response.ok) {
                        throw new Error(`HTTP error! status: ${response.status}`);
                    }
                    const data = await response.json();
                    
                    // 确保数据包含必要的字段
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
                    // 返回默认状态而不是 null
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

            // 等待队列完成
            nodeType.prototype.waitForQueue = async function() {
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
                            console.warn(`[GroupExecutorSender] 检查队列状态失败:`, error);
                            // 发生错误时继续检查，而不是中断
                            setTimeout(checkQueue, 500);
                        }
                    };

                    // 开始检查队列
                    checkQueue();
                });
            };

            // 监听执行列表请求
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
                    // 计算实际任务数（排除延迟组）
                    let totalTasks = executionList.filter(item => item.group_name !== "__delay__").length;
                    let currentTask = 0;

                    try {
                        for (const execution of executionList) {
                            const group_name = execution.group_name || '';
                            const repeat_count = parseInt(execution.repeat_count) || 1;
                            const delay_seconds = parseFloat(execution.delay_seconds) || 0;

                            if (!group_name) {
                                console.warn('[GroupExecutorSender] 跳过无效的组名称:', execution);
                                continue;
                            }

                            // 处理延迟组
                            if (group_name === "__delay__") {
                                if (delay_seconds > 0) {
                                    node.updateStatus(
                                        `等待下一组 ${delay_seconds}s...`
                                    );
                                    await new Promise(resolve => setTimeout(resolve, delay_seconds * 1000));
                                }
                                continue;
                            }

                            // 更新当前任务计数
                            currentTask++;
                            const progress = (currentTask / totalTasks) * 100;
                            node.updateStatus(
                                `执行组: ${group_name} (${currentTask}/${totalTasks})`,
                                progress
                            );
                            
                            try {
                                const outputNodes = node.getGroupOutputNodes(group_name);
                                if (!outputNodes || !outputNodes.length) {
                                    throw new Error(`组 "${group_name}" 中没有找到输出节点`);
                                }

                                const nodeIds = outputNodes.map(n => n.id);
                                
                                if (rgthree?.queueOutputNodes) {
                                    try {
                                        await rgthree.queueOutputNodes(nodeIds);
                                        await node.waitForQueue();
                                    } catch (queueError) {
                                        console.warn(`[GroupExecutorSender] rgthree执行失败，使用默认方式:`, queueError);
                                        for (const n of outputNodes) {
                                            if (n.triggerQueue) {
                                                await n.triggerQueue();
                                                await node.waitForQueue();
                                            }
                                        }
                                    }
                                } else {
                                    for (const n of outputNodes) {
                                        if (n.triggerQueue) {
                                            await n.triggerQueue();
                                            await node.waitForQueue();
                                        }
                                    }
                                }

                                if (delay_seconds > 0 && currentTask < totalTasks) {
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

                        // 执行完成后保留最后的状态显示
                        node.updateStatus(`执行完成 (${totalTasks}/${totalTasks})`, 100);

                    } catch (error) {
                        console.error('[GroupExecutorSender] 执行错误:', error);
                        node.updateStatus(`错误: ${error.message}`);
                        app.ui.dialog.show(`执行错误: ${error.message}`);
                    } finally {
                        node.properties.isExecuting = false;
                    }

                } catch (error) {
                    console.error(`[GroupExecutorSender] 执行失败:`, error);
                    app.ui.dialog.show(`执行错误: ${error.message}`);
                    node.updateStatus(`错误: ${error.message}`);
                    node.properties.isExecuting = false;
                }
            });
        }
    }
});

