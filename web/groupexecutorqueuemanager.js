import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

app.registerExtension({
    name: "GroupExecutorQueueManager",
    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        if (api.fetchApi._isGroupExecutorQueueManager) {
            return;
        }

        const originalFetchApi = api.fetchApi;

        function collectRelatedNodes(prompt, nodeId, relevantNodes) {
            if (!prompt[nodeId] || relevantNodes.has(nodeId)) return;
            relevantNodes.add(nodeId);

            const node = prompt[nodeId];
            if (node.inputs) {
                Object.values(node.inputs).forEach(input => {
                    if (input && input.length > 0) {
                        collectRelatedNodes(prompt, input[0], relevantNodes);
                    }
                });
            }
        }

        const newFetchApi = async function(url, options = {}) {

            if (url === '/prompt' && options.method === 'POST') {
                const requestData = JSON.parse(options.body);

                if (requestData.extra_data?.isGroupExecutorRequest) {
                    return originalFetchApi.call(api, url, options);
                }

                const prompt = requestData.prompt;

                const hasGroupExecutor = Object.values(prompt).some(node => 
                    node.class_type === "GroupExecutorSender"
                );

                if (hasGroupExecutor) {

                    const relevantNodes = new Set();
                    
                    for (const [nodeId, node] of Object.entries(prompt)) {
                        if (node.class_type === "GroupExecutorSender") {
                            collectRelatedNodes(prompt, nodeId, relevantNodes);
                        }
                    }

                    const filteredPrompt = {};
                    for (const nodeId of relevantNodes) {
                        if (prompt[nodeId]) {
                            filteredPrompt[nodeId] = prompt[nodeId];
                        }
                    }

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

        newFetchApi._isGroupExecutorQueueManager = true;

        api.fetchApi = newFetchApi;
    }
}); 



api.addEventListener("img-send", async ({ detail }) => {
    if (detail.images.length === 0) return;

    const filenames = detail.images.map(data => data.filename).join(', ');

    for (const node of app.graph._nodes) {
        if (node.type === "LG_ImageReceiver") {
            let isLinked = false;

            const linkWidget = node.widgets.find(w => w.name === "link_id");
            if (linkWidget.value === detail.link_id) {
                isLinked = true;
            }

            if (isLinked) {
                if (node.widgets[0]) {
                    node.widgets[0].value = filenames;
                    if (node.widgets[0].callback) {
                        node.widgets[0].callback(filenames);
                    }
                }

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

