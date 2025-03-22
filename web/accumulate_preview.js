import { app } from "../../scripts/app.js";

app.registerExtension({
    name: "LG_AccumulatePreview",
    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        if (nodeData.name === "LG_AccumulatePreview") {
            nodeType.prototype.onNodeCreated = function() {
                this.addWidget("button", "Reset", null, () => {
                    if (!this.properties) {
                        this.properties = {};
                    }
                    this.properties.needsReset = true;
                    this.onConfigure();
                });
                const widget = this.widgets[this.widgets.length - 1];
                widget.name_in_graph = false;
            };

            nodeType.prototype.onConfigure = function() {
                if (this._configuring) {
                    return;
                }
            
                if (document.readyState !== "complete") {
                    return;
                }
            
                if (!this.properties?.needsReset) {
                    return;
                }
                
                try {
                    this._configuring = true;

                    let new_node = LiteGraph.createNode(nodeType.comfyClass);
                    if (!new_node) {
                        return;
                    }
                    
                    new_node.pos = [this.pos[0], this.pos[1]];
                    
                    app.graph.add(new_node, false);
                    
                    node_info_copy(this, new_node, true);
                    
                    requestAnimationFrame(() => {
                        app.graph.remove(this);
                        app.graph.setDirtyCanvas(true, true);
                    });
                    
                } catch (error) {
                    console.error("重置节点失败:", error);
                } finally {
                    this._configuring = false;
                    if (this.properties) {
                        this.properties.needsReset = false;
                    }
                }
            };
        }
    }
});

function node_info_copy(src, dest, connect_both) {
    for(let i in src.inputs) {
        let input = src.inputs[i];
        if (input.widget !== undefined) {
            const destWidget = dest.widgets.find(x => x.name === input.widget.name);
            dest.convertWidgetToInput(destWidget);
        }
        if(input.link) {
            let link = app.graph.links[input.link];
            let src_node = app.graph.getNodeById(link.origin_id);
            src_node.connect(link.origin_slot, dest.id, input.name);
        }
    }

    if(connect_both) {
        let output_links = {};
        for(let i in src.outputs) {
            let output = src.outputs[i];
            if(output.links) {
                let links = [];
                for(let j in output.links) {
                    links.push(app.graph.links[output.links[j]]);
                }
                output_links[output.name] = links;
            }
        }

        for(let i in dest.outputs) {
            let links = output_links[dest.outputs[i].name];
            if(links) {
                for(let j in links) {
                    let link = links[j];
                    let target_node = app.graph.getNodeById(link.target_id);
                    dest.connect(parseInt(i), target_node, link.target_slot);
                }
            }
        }
    }

    dest.color = src.color;
    dest.bgcolor = src.bgcolor;
    dest.size = src.size;

    app.graph.afterChange();
} 