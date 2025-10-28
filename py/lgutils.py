from server import PromptServer
import os
import json
import threading
import time
import uuid
import asyncio
from aiohttp import web
import execution
import nodes

CATEGORY_TYPE = "🎈LAOGOU/Group"

# ============ 后台执行辅助函数 ============

def is_output_node(node_type):
    """通过检查节点类定义判断是否为输出节点"""
    try:
        if node_type in nodes.NODE_CLASS_MAPPINGS:
            node_class = nodes.NODE_CLASS_MAPPINGS[node_type]
            return getattr(node_class, "OUTPUT_NODE", False)
    except Exception as e:
        print(f"[GroupExecutor] 检查输出节点失败 {node_type}: {e}")
    return False

def is_node_in_group(node, group):
    """判断节点是否在组的边界框内（使用重叠检测）"""
    try:
        node_pos = node.get("pos", [0, 0])
        node_size = node.get("size", [140, 80])
        
        # 节点边界框
        node_x1 = node_pos[0]
        node_y1 = node_pos[1]
        node_x2 = node_pos[0] + node_size[0]
        node_y2 = node_pos[1] + node_size[1]
        
        # 组边界框 [x, y, width, height]
        group_bounding = group.get("bounding", [0, 0, 0, 0])
        group_x1 = group_bounding[0]
        group_y1 = group_bounding[1]
        group_x2 = group_bounding[0] + group_bounding[2]
        group_y2 = group_bounding[1] + group_bounding[3]
        
        # 检查是否重叠（LiteGraph 的重叠逻辑）
        return not (node_x2 < group_x1 or 
                   node_x1 > group_x2 or 
                   node_y2 < group_y1 or 
                   node_y1 > group_y2)
    except Exception as e:
        print(f"[GroupExecutor] 检查节点是否在组内失败: {e}")
        return False

def build_prompt_for_nodes(workflow, output_node_ids):
    """从输出节点反向构建包含所有依赖的 prompt"""
    try:
        nodes_list = workflow.get("nodes", [])
        links_list = workflow.get("links", [])
        
        # 构建节点映射
        node_map = {n["id"]: n for n in nodes_list}
        
        # 构建输入连接映射
        input_connections = {}
        for link in links_list:
            # link 格式: [link_id, source_node, source_output, target_node, target_input, type]
            if len(link) >= 6:
                target_node = link[3]
                if target_node not in input_connections:
                    input_connections[target_node] = []
                input_connections[target_node].append({
                    "input_index": link[4],
                    "source_node": link[1],
                    "source_output": link[2]
                })
        
        # 递归收集依赖节点
        required_nodes = set()
        
        def collect_dependencies(node_id):
            if node_id in required_nodes:
                return
            if node_id not in node_map:
                return
            required_nodes.add(node_id)
            
            # 递归收集输入节点
            if node_id in input_connections:
                for conn in input_connections[node_id]:
                    collect_dependencies(conn["source_node"])
        
        # 从所有输出节点开始收集
        for output_id in output_node_ids:
            collect_dependencies(output_id)
        
        # 构建 prompt
        prompt = {}
        for node_id in required_nodes:
            node = node_map[node_id]
            node_inputs = {}
            
            # 处理连接输入
            if node_id in input_connections:
                for conn in input_connections[node_id]:
                    # 找到输入名称
                    node_input_list = node.get("inputs", [])
                    if conn["input_index"] < len(node_input_list):
                        input_name = node_input_list[conn["input_index"]]["name"]
                        node_inputs[input_name] = [str(conn["source_node"]), conn["source_output"]]
            
            # 处理 widget 值
            widgets_values = node.get("widgets_values", [])
            if widgets_values:
                # 获取节点类的输入定义
                node_type = node["type"]
                if node_type in nodes.NODE_CLASS_MAPPINGS:
                    node_class = nodes.NODE_CLASS_MAPPINGS[node_type]
                    if hasattr(node_class, "INPUT_TYPES"):
                        try:
                            try:
                                input_types_result = node_class.INPUT_TYPES()
                            except:
                                # 有些节点的 INPUT_TYPES 需要参数
                                input_types_result = {}
                            
                            required_inputs = input_types_result.get("required", {})
                            optional_inputs = input_types_result.get("optional", {})
                            
                            # 收集所有输入定义（按顺序）
                            all_inputs = {}
                            all_inputs.update(required_inputs)
                            all_inputs.update(optional_inputs)
                            
                            # 将 widget 值映射到参数名
                            widget_index = 0
                            for param_name, param_def in all_inputs.items():
                                if param_name not in node_inputs:  # 只处理未连接的输入
                                    if widget_index < len(widgets_values):
                                        value = widgets_values[widget_index]
                                        node_inputs[param_name] = value
                                        widget_index += 1
                                        
                                        # 处理 control_after_generate（额外的 widget）
                                        # param_def 格式: ("TYPE", {config}) 或 ("TYPE",)
                                        if isinstance(param_def, (list, tuple)) and len(param_def) > 1:
                                            param_config = param_def[1]
                                            if isinstance(param_config, dict):
                                                if param_config.get("control_after_generate", False):
                                                    # 跳过 control_after_generate widget（在 widgets_values 中占一个位置）
                                                    widget_index += 1
                        except Exception as widget_error:
                            print(f"[GroupExecutor] 处理节点 {node_id} 的 widget 值时出错: {widget_error}")
                            import traceback
                            traceback.print_exc()
            
            prompt[str(node_id)] = {
                "class_type": node["type"],
                "inputs": node_inputs
            }
        
        return prompt
    except Exception as e:
        print(f"[GroupExecutor] 构建 prompt 失败: {e}")
        import traceback
        traceback.print_exc()
        return {}

class GroupExecutorBackend:
    """后台执行管理器"""
    
    def __init__(self):
        self.running_tasks = {}
        self.task_lock = threading.Lock()
        self.interrupted_prompts = set()  # 记录被中断的 prompt_id
        self._setup_interrupt_handler()
    
    def _setup_interrupt_handler(self):
        """设置中断处理器，监听 execution_interrupted 消息"""
        try:
            server = PromptServer.instance
            backend_instance = self
            
            # 保存原始的 send_sync 方法
            original_send_sync = server.send_sync
            
            def patched_send_sync(event, data, sid=None):
                # 调用原始方法
                original_send_sync(event, data, sid)
                
                # 监听 execution_interrupted 事件
                if event == "execution_interrupted":
                    prompt_id = data.get("prompt_id")
                    if prompt_id:
                        backend_instance.interrupted_prompts.add(prompt_id)
                        # 取消所有后台任务
                        backend_instance._cancel_all_on_interrupt()
            
            server.send_sync = patched_send_sync
        except Exception as e:
            print(f"[GroupExecutor] 设置中断监听器失败: {e}")
            import traceback
            traceback.print_exc()
    
    def _cancel_all_on_interrupt(self):
        """响应全局中断，取消所有正在运行的后台任务"""
        with self.task_lock:
            for node_id, task_info in list(self.running_tasks.items()):
                if task_info.get("status") == "running" and not task_info.get("cancel"):
                    task_info["cancel"] = True
    
    def execute_in_background(self, node_id, execution_list, workflow):
        """启动后台执行线程"""
        with self.task_lock:
            if node_id in self.running_tasks and self.running_tasks[node_id].get("status") == "running":
                return False
            
            thread = threading.Thread(
                target=self._execute_task,
                args=(node_id, execution_list, workflow),
                daemon=True
            )
            thread.start()
            
            self.running_tasks[node_id] = {
                "thread": thread,
                "status": "running",
                "cancel": False
            }
            return True
    
    def cancel_task(self, node_id):
        """取消任务"""
        with self.task_lock:
            if node_id in self.running_tasks:
                self.running_tasks[node_id]["cancel"] = True
                
                # 中断当前正在执行的任务
                try:
                    server = PromptServer.instance
                    server.send_sync("interrupt", {})
                except Exception as e:
                    print(f"[GroupExecutor] 发送中断信号失败: {e}")
                
                return True
            return False
    
    def _execute_task(self, node_id, execution_list, workflow):
        """后台执行任务的核心逻辑"""
        try:
            for execution in execution_list:
                # 检查取消标志
                if self.running_tasks.get(node_id, {}).get("cancel"):
                    print(f"[GroupExecutor] 任务被取消")
                    break
                
                group_name = execution.get("group_name", "")
                repeat_count = int(execution.get("repeat_count", 1))
                delay_seconds = float(execution.get("delay_seconds", 0))
                
                # 处理延迟
                if group_name == "__delay__":
                    if delay_seconds > 0 and not self.running_tasks.get(node_id, {}).get("cancel"):
                        # 分段延迟，以便能快速响应取消
                        delay_steps = int(delay_seconds * 2)  # 每 0.5 秒检查一次
                        for _ in range(delay_steps):
                            if self.running_tasks.get(node_id, {}).get("cancel"):
                                break
                            time.sleep(0.5)
                    continue
                
                if not group_name:
                    continue
                
                # 查找组
                groups = workflow.get("groups", [])
                group = next((g for g in groups if g.get("title") == group_name), None)
                
                if not group:
                    print(f"[GroupExecutor] 未找到组: {group_name}")
                    continue
                
                # 获取组内节点
                all_nodes = workflow.get("nodes", [])
                nodes_in_group = [n for n in all_nodes if is_node_in_group(n, group)]
                
                # 筛选输出节点
                output_nodes = [n for n in nodes_in_group if is_output_node(n.get("type", ""))]
                
                if not output_nodes:
                    print(f"[GroupExecutor] 组 '{group_name}' 中没有输出节点")
                    continue
                
                # 执行 repeat_count 次
                for i in range(repeat_count):
                    # 检查取消标志
                    if self.running_tasks.get(node_id, {}).get("cancel"):
                        break
                    
                    if repeat_count > 1:
                        print(f"[GroupExecutor] 执行组 '{group_name}' ({i+1}/{repeat_count})")
                    
                    # 构建 prompt
                    output_ids = [n["id"] for n in output_nodes]
                    prompt = build_prompt_for_nodes(workflow, output_ids)
                    
                    if not prompt:
                        print(f"[GroupExecutor] 构建 prompt 失败")
                        continue
                    
                    # 处理随机种子：为每个有 seed 参数的节点生成新的随机值
                    import random
                    for node_id_str, node_data in prompt.items():
                        if "seed" in node_data.get("inputs", {}):
                            new_seed = random.randint(0, 0xffffffffffffffff)
                            prompt[node_id_str]["inputs"]["seed"] = new_seed
                    
                    # 提交到队列
                    prompt_id = self._queue_prompt(prompt)
                    
                    if prompt_id:
                        # 等待执行完成（返回是否检测到中断）
                        was_interrupted = self._wait_for_completion(prompt_id, node_id)
                        
                        # 如果等待期间检测到中断，立即退出
                        if was_interrupted:
                            break
                    else:
                        print(f"[GroupExecutor] 提交 prompt 失败")
                    
                    # 延迟（支持中断）
                    if delay_seconds > 0 and i < repeat_count - 1:
                        if not self.running_tasks.get(node_id, {}).get("cancel"):
                            # 分段延迟，以便能快速响应取消
                            delay_steps = int(delay_seconds * 2)  # 每 0.5 秒检查一次
                            for _ in range(delay_steps):
                                if self.running_tasks.get(node_id, {}).get("cancel"):
                                    break
                                time.sleep(0.5)
            
            if self.running_tasks.get(node_id, {}).get("cancel"):
                print(f"[GroupExecutor] 任务已取消")
            else:
                print(f"[GroupExecutor] 任务执行完成")
            
        except Exception as e:
            print(f"[GroupExecutor] 后台执行出错: {e}")
            import traceback
            traceback.print_exc()
        finally:
            with self.task_lock:
                if node_id in self.running_tasks:
                    was_cancelled = self.running_tasks[node_id].get("cancel", False)
                    self.running_tasks[node_id]["status"] = "cancelled" if was_cancelled else "completed"
    
    def _queue_prompt(self, prompt):
        """提交 prompt 到队列"""
        try:
            server = PromptServer.instance
            prompt_id = str(uuid.uuid4())
            
            # 验证 prompt（validate_prompt 是异步函数，需要在事件循环中运行）
            try:
                loop = server.loop
                # 在事件循环中运行异步函数
                valid = asyncio.run_coroutine_threadsafe(
                    execution.validate_prompt(prompt_id, prompt, None),
                    loop
                ).result(timeout=30)
            except Exception as validate_error:
                print(f"[GroupExecutor] Prompt 验证出错: {validate_error}")
                import traceback
                traceback.print_exc()
                return None
            
            if not valid[0]:
                print(f"[GroupExecutor] Prompt 验证失败: {valid[1]}")
                return None
            
            # 提交到队列
            number = server.number
            server.number += 1
            
            # 获取输出节点列表
            outputs_to_execute = list(valid[2])
            
            server.prompt_queue.put((number, prompt_id, prompt, {}, outputs_to_execute))
            
            return prompt_id
            
        except Exception as e:
            print(f"[GroupExecutor] 提交队列失败: {e}")
            import traceback
            traceback.print_exc()
            return None
    
    def _wait_for_completion(self, prompt_id, node_id):
        """等待 prompt 执行完成，同时响应取消请求
        返回: True 如果检测到中断，False 正常完成
        """
        try:
            server = PromptServer.instance
            
            while True:
                # 检查这个 prompt 是否被中断
                if prompt_id in self.interrupted_prompts:
                    # 设置任务取消标志
                    with self.task_lock:
                        if node_id in self.running_tasks:
                            self.running_tasks[node_id]["cancel"] = True
                    # 从中断集合中移除
                    self.interrupted_prompts.discard(prompt_id)
                    return True  # 返回中断状态
                
                # 检查是否被取消
                if self.running_tasks.get(node_id, {}).get("cancel"):
                    # 从队列中删除这个 prompt（如果还在队列中）
                    try:
                        def should_delete(item):
                            return len(item) >= 2 and item[1] == prompt_id
                        server.prompt_queue.delete_queue_item(should_delete)
                    except Exception as del_error:
                        print(f"[GroupExecutor] 删除队列项时出错: {del_error}")
                    return True  # 返回中断状态
                
                # 检查是否在历史记录中（表示已完成）
                if prompt_id in server.prompt_queue.history:
                    # 检查是否是因为中断而完成的
                    if prompt_id in self.interrupted_prompts:
                        self.interrupted_prompts.discard(prompt_id)
                        return True
                    return False  # 正常完成
                
                # 检查是否还在队列中
                running, pending = server.prompt_queue.get_current_queue()
                
                in_queue = False
                for item in running:
                    if len(item) >= 2 and item[1] == prompt_id:
                        in_queue = True
                        break
                
                if not in_queue:
                    for item in pending:
                        if len(item) >= 2 and item[1] == prompt_id:
                            in_queue = True
                            break
                
                if not in_queue and prompt_id not in server.prompt_queue.history:
                    # 可能已经执行完成但还没更新历史记录，再等一会
                    time.sleep(0.5)
                    # 再次检查
                    if prompt_id in server.prompt_queue.history:
                        # 检查是否是因为中断完成的
                        if prompt_id in self.interrupted_prompts:
                            self.interrupted_prompts.discard(prompt_id)
                            return True
                        return False
                    if not in_queue:
                        return False
                
                time.sleep(0.5)
                
        except Exception as e:
            print(f"[GroupExecutor] 等待执行完成时出错: {e}")
            return False

# 全局后台执行器实例
_backend_executor = GroupExecutorBackend()

# ============ 节点定义 ============

class GroupExecutorSingle:
    """单组执行节点"""
    
    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "group_name": ("STRING", {"default": "", "multiline": False}),
                "repeat_count": ("INT", {"default": 1, "min": 1, "max": 100, "step": 1}),
                "delay_seconds": ("FLOAT", {"default": 0.0, "min": 0.0, "max": 60.0, "step": 0.1}),
            },
            "optional": {
                "signal": ("SIGNAL",),
            },
            "hidden": {
                "unique_id": "UNIQUE_ID"
            }
        }
    
    RETURN_TYPES = ("SIGNAL",)
    FUNCTION = "execute_group"
    CATEGORY = CATEGORY_TYPE

    def execute_group(self, group_name, repeat_count, delay_seconds, signal=None, unique_id=None):
        try:
            current_execution = {
                "group_name": group_name,
                "repeat_count": repeat_count,
                "delay_seconds": delay_seconds
            }
            
            # 如果有信号输入
            if signal is not None:
                if isinstance(signal, list):
                    signal.append(current_execution)
                    return (signal,)
                else:
                    result = [signal, current_execution]
                    return (result,)

            return (current_execution,)

        except Exception as e:
            print(f"[GroupExecutorSingle {unique_id}] 错误: {e}")
            import traceback
            traceback.print_exc()
            return ({"error": str(e)},)

class GroupExecutorSender:
    """执行信号发送节点"""
    
    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "signal": ("SIGNAL",),
                "execution_mode": (["前端执行", "后台执行"], {"default": "后台执行"}),
            },
            "hidden": {
                "unique_id": "UNIQUE_ID",
                "prompt": "PROMPT",
                "extra_pnginfo": "EXTRA_PNGINFO"
            }
        }
    
    RETURN_TYPES = () 
    FUNCTION = "execute"
    CATEGORY = CATEGORY_TYPE
    OUTPUT_NODE = True

    def execute(self, signal, execution_mode, unique_id=None, prompt=None, extra_pnginfo=None):
        try:
            if not signal:
                raise ValueError("没有收到执行信号")

            execution_list = signal if isinstance(signal, list) else [signal]

            if execution_mode == "后台执行":
                # 获取完整的 workflow
                workflow = None
                if extra_pnginfo and "workflow" in extra_pnginfo:
                    workflow = extra_pnginfo["workflow"]
                else:
                    print(f"[GroupExecutor] 警告：无法获取 workflow，降级为前端执行")
                    # 降级为前端执行
                    PromptServer.instance.send_sync(
                        "execute_group_list", {
                            "node_id": unique_id,
                            "execution_list": execution_list
                        }
                    )
                    return ()
                
                # 启动后台执行
                _backend_executor.execute_in_background(
                    unique_id, 
                    execution_list, 
                    workflow
                )
                
            else:
                # 前端执行模式（原有方式）
                PromptServer.instance.send_sync(
                    "execute_group_list", {
                        "node_id": unique_id,
                        "execution_list": execution_list
                    }
                )
            
            return ()  

        except Exception as e:
            print(f"[GroupExecutor] 执行错误: {str(e)}")
            import traceback
            traceback.print_exc()
            return ()

class GroupExecutorRepeater:
    """执行列表重复处理节点"""
    
    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "signal": ("SIGNAL",),
                "repeat_count": ("INT", {
                    "default": 1, 
                    "min": 1, 
                    "max": 100,
                    "step": 1
                }),
                "group_delay": ("FLOAT", {
                    "default": 0.0,
                    "min": 0.0,
                    "max": 300.0,
                    "step": 0.1
                }),
            },
        }
    
    RETURN_TYPES = ("SIGNAL",)
    FUNCTION = "repeat"
    CATEGORY = CATEGORY_TYPE

    def repeat(self, signal, repeat_count, group_delay):
        try:
            if not signal:
                raise ValueError("没有收到执行信号")

            execution_list = signal if isinstance(signal, list) else [signal]

            repeated_list = []
            for i in range(repeat_count):

                repeated_list.extend(execution_list)

                if i < repeat_count - 1:

                    repeated_list.append({
                        "group_name": "__delay__",
                        "repeat_count": 1,
                        "delay_seconds": group_delay
                    })
            
            return (repeated_list,)

        except Exception as e:
            print(f"重复处理错误: {str(e)}")
            return ([],)
        

CONFIG_DIR = os.path.join(os.path.dirname(os.path.realpath(__file__)), "group_configs")
os.makedirs(CONFIG_DIR, exist_ok=True)

routes = PromptServer.instance.routes
@routes.get("/group_executor/configs")
async def get_configs(request):
    try:

        configs = []
        for filename in os.listdir(CONFIG_DIR):
            if filename.endswith('.json'):
                configs.append({
                    "name": filename[:-5]
                })
        return web.json_response({"status": "success", "configs": configs})
    except Exception as e:
        print(f"[GroupExecutor] 获取配置失败: {str(e)}")
        return web.json_response({"status": "error", "message": str(e)}, status=500)

@routes.post("/group_executor/configs")
async def save_config(request):
    try:
        print("[GroupExecutor] 收到保存配置请求")
        data = await request.json()
        config_name = data.get('name')
        if not config_name:
            return web.json_response({"status": "error", "message": "配置名称不能为空"}, status=400)
            
        safe_name = "".join(c for c in config_name if c.isalnum() or c in (' ', '-', '_'))
        filename = os.path.join(CONFIG_DIR, f"{safe_name}.json")
        
        with open(filename, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
            
        print(f"[GroupExecutor] 配置已保存: {filename}")
        return web.json_response({"status": "success"})
    except json.JSONDecodeError as e:
        print(f"[GroupExecutor] JSON解析错误: {str(e)}")
        return web.json_response({"status": "error", "message": f"JSON格式错误: {str(e)}"}, status=400)
    except Exception as e:
        print(f"[GroupExecutor] 保存配置失败: {str(e)}")
        import traceback
        traceback.print_exc()
        return web.json_response({"status": "error", "message": str(e)}, status=500)

@routes.get('/group_executor/configs/{name}')
async def get_config(request):
    try:
        config_name = request.match_info.get('name')
        if not config_name:
            return web.json_response({"error": "配置名称不能为空"}, status=400)
            
        filename = os.path.join(CONFIG_DIR, f"{config_name}.json")
        if not os.path.exists(filename):
            return web.json_response({"error": "配置不存在"}, status=404)
            
        with open(filename, 'r', encoding='utf-8') as f:
            config = json.load(f)
            
        return web.json_response(config)
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)

@routes.delete('/group_executor/configs/{name}')
async def delete_config(request):
    try:
        config_name = request.match_info.get('name')
        if not config_name:
            return web.json_response({"error": "配置名称不能为空"}, status=400)
            
        filename = os.path.join(CONFIG_DIR, f"{config_name}.json")
        if not os.path.exists(filename):
            return web.json_response({"error": "配置不存在"}, status=404)
            
        os.remove(filename)
        return web.json_response({"status": "success"})
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)