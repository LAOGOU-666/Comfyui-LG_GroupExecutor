from server import PromptServer
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
    CATEGORY = "🎈LAOGOU"

    def execute_group(self, group_name, repeat_count, delay_seconds, unique_id, signal=None):
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
                    return ([signal, current_execution],)

            return (current_execution,)

        except Exception as e:
            return ({"error": str(e)},)

class GroupExecutorSender:
    """执行信号发送节点"""
    
    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "signal": ("SIGNAL",),
            },
            "hidden": {
                "unique_id": "UNIQUE_ID"
            }
        }
    
    RETURN_TYPES = () 
    FUNCTION = "execute"
    CATEGORY = "🎈LAOGOU"
    OUTPUT_NODE = True

    def execute(self, signal, unique_id):
        try:
            if not signal:
                raise ValueError("没有收到执行信号")

            execution_list = signal if isinstance(signal, list) else [signal]

            PromptServer.instance.send_sync(
                "execute_group_list", {
                    "node_id": unique_id,
                    "execution_list": execution_list
                }
            )
            
            return ()  

        except Exception as e:
            print(f"执行错误: {str(e)}")
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
    CATEGORY = "🎈LAOGOU"

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
        

