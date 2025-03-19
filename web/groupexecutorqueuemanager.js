import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

app.registerExtension({
    name: "GroupExecutorQueueManager",
    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        // 检查是否已经重写过 fetchApi
        if (api.fetchApi._isGroupExecutorQueueManager) {
            return;
        }

        // 保存原始的 api.fetchApi
        const originalFetchApi = api.fetchApi;

        // 递归收集相关节点
        function collectRelatedNodes(prompt, nodeId, relevantNodes) {
            if (!prompt[nodeId] || relevantNodes.has(nodeId)) return;
            relevantNodes.add(nodeId);
            
            // 收集输入节点
            const node = prompt[nodeId];
            if (node.inputs) {
                Object.values(node.inputs).forEach(input => {
                    if (input && input.length > 0) {
                        collectRelatedNodes(prompt, input[0], relevantNodes);
                    }
                });
            }
        }

        // 重写 api.fetchApi
        const newFetchApi = async function(url, options = {}) {
            // 只拦截 POST /prompt 请求
            if (url === '/prompt' && options.method === 'POST') {
                const requestData = JSON.parse(options.body);
                
                // 如果是 GroupExecutorSender 的内部请求，直接放行
                if (requestData.extra_data?.isGroupExecutorRequest) {
                    return originalFetchApi.call(api, url, options);
                }

                const prompt = requestData.prompt;

                // 检查是否存在 GroupExecutorSender 节点
                const hasGroupExecutor = Object.values(prompt).some(node => 
                    node.class_type === "GroupExecutorSender"
                );

                if (hasGroupExecutor) {
                    // 找出所有 GroupExecutorSender 相关的节点
                    const relevantNodes = new Set();
                    
                    for (const [nodeId, node] of Object.entries(prompt)) {
                        if (node.class_type === "GroupExecutorSender") {
                            collectRelatedNodes(prompt, nodeId, relevantNodes);
                        }
                    }

                    // 创建过滤后的 prompt
                    const filteredPrompt = {};
                    for (const nodeId of relevantNodes) {
                        if (prompt[nodeId]) {
                            filteredPrompt[nodeId] = prompt[nodeId];
                        }
                    }

                    // 修改请求数据，添加标记表示这是内部请求
                    const modifiedOptions = {
                        ...options,
                        body: JSON.stringify({
                            ...requestData,
                            prompt: filteredPrompt,
                            extra_data: {
                                ...requestData.extra_data,
                                isGroupExecutorRequest: true
                            }
                        })
                    };

                    return originalFetchApi.call(api, url, modifiedOptions);
                }
            }

            return originalFetchApi.call(api, url, options);
        };

        // 标记新的 fetchApi 函数
        newFetchApi._isGroupExecutorQueueManager = true;
        
        // 替换 api.fetchApi
        api.fetchApi = newFetchApi;
    }
}); 



api.addEventListener("img-send", async ({ detail }) => {
    if (detail.images.length === 0) return;
    
    // 构建所有图像的文件名列表，用逗号连接
    const filenames = detail.images.map(data => data.filename).join(', ');

    // 查找所有LG_ImageReceiver节点
    for (const node of app.graph._nodes) {
        if (node.type === "LG_ImageReceiver") {
            let isLinked = false;

            // 检查link_id是否匹配
            const linkWidget = node.widgets.find(w => w.name === "link_id");
            if (linkWidget.value === detail.link_id) {
                isLinked = true;
            }

            if (isLinked) {
                // 更新image widget的值
                if (node.widgets[0]) {
                    node.widgets[0].value = filenames;
                    if (node.widgets[0].callback) {
                        node.widgets[0].callback(filenames);
                    }
                }

                // 加载所有预览图像
                Promise.all(detail.images.map(imageData => {
                    return new Promise((resolve) => {
                        const img = new Image();
                        img.onload = () => resolve(img);
                        img.src = `/view?filename=${encodeURIComponent(imageData.filename)}&type=${imageData.type}${app.getPreviewFormatParam()}`;
                    });
                })).then(loadedImages => {
                    node.imgs = loadedImages;
                    node.size[1] = Math.max(200, 100 + loadedImages.length * 100);
                    app.canvas.setDirty(true);
                });
            }
        }
    }
});

// 注册节点扩展
app.registerExtension({
    name: "Comfy.LG_Image",
    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        if (nodeData.name === "LG_ImageReceiver") {
            const onExecuted = nodeType.prototype.onExecuted;
            nodeType.prototype.onExecuted = function (message) {
                onExecuted?.apply(this, arguments);
            };
        }
    },
});





app.registerExtension({
    name: "memory.cleanup",
    init() {
        // 监听来自后端的内存清理信号
        api.addEventListener("memory_cleanup", ({ detail }) => {
            if (detail.type === "cleanup_request") {
                console.log("收到内存清理请求");
                
                // 发送清理请求到 /free 接口
                fetch("/free", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify(detail.data)
                })
                .then(response => {
                    if (response.ok) {
                        console.log("内存清理请求已发送");
                    } else {
                        console.error("内存清理请求失败");
                    }
                })
                .catch(error => {
                    console.error("发送内存清理请求出错:", error);
                });
            }
        });
    }
});

