from server import PromptServer
import os
import sys
import time
import torch
import numpy as np
from PIL import Image
import folder_paths

class AnyType(str):
    """用于表示任意类型的特殊类，在类型比较时总是返回相等"""
    def __eq__(self, _) -> bool:
        return True

    def __ne__(self, __value: object) -> bool:
        return False

any = AnyType("*")

class MemoryCleanup:
    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "anything": (any, {}),
                "offload_model": ("BOOLEAN", {"default": True}),
                "offload_cache": ("BOOLEAN", {"default": True}),
            },
            "optional": {},
            "hidden": {
                "unique_id": "UNIQUE_ID",
                "extra_pnginfo": "EXTRA_PNGINFO",
            }
        }

    RETURN_TYPES = (any,)
    RETURN_NAMES = ("output",)
    OUTPUT_NODE = True
    FUNCTION = "empty_cache"
    CATEGORY = "Memory Management"

    def empty_cache(self, anything, offload_model, offload_cache, unique_id=None, extra_pnginfo=None):
        try:
            # 发送信号到前端
            PromptServer.instance.send_sync("memory_cleanup", {
                "type": "cleanup_request",
                "data": {
                    "unload_models": offload_model,
                    "free_memory": offload_cache
                }
            })
            print("已发送内存清理信号")
            
        except Exception as e:
            print(f"发送内存清理信号出错: {str(e)}")
            
        return (anything,)

class LG_ImageSender:
    def __init__(self):
        self.output_dir = folder_paths.get_temp_directory()
        self.type = "temp"
        self.compress_level = 1

    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "images": ("IMAGE", {"tooltip": "要发送的图像"}),
                "filename_prefix": ("STRING", {"default": "lg_send"}),
                "link_id": ("INT", {"default": 1, "min": 0, "max": sys.maxsize, "step": 1, "tooltip": "发送端连接ID"}),
                "trigger_always": ("BOOLEAN", {"default": False, "tooltip": "开启后每次都会触发"})
            },
            "optional": {
                "masks": ("MASK", {"tooltip": "要发送的遮罩"})
            },
            "hidden": {"prompt": "PROMPT", "extra_pnginfo": "EXTRA_PNGINFO"},
        }

    RETURN_TYPES = ()
    OUTPUT_NODE = True
    FUNCTION = "save_images"
    CATEGORY = "🎈LAOGOU"
    INPUT_IS_LIST = True

    @classmethod
    def IS_CHANGED(s, images, filename_prefix, link_id, trigger_always, masks=None, prompt=None, extra_pnginfo=None):
        if isinstance(trigger_always, list):
            trigger_always = trigger_always[0]
        
        if trigger_always:
            return float("NaN")
        
        # 同时考虑图像和遮罩的变化
        hash_value = hash(str(images) + str(masks))
        return hash_value

    def save_images(self, images, filename_prefix, link_id, trigger_always, masks=None, prompt=None, extra_pnginfo=None):
        timestamp = int(time.time() * 1000)
        results = list()
        
        # 获取实际的值
        filename_prefix = filename_prefix[0] if isinstance(filename_prefix, list) else filename_prefix
        link_id = link_id[0] if isinstance(link_id, list) else link_id
        trigger_always = trigger_always[0] if isinstance(trigger_always, list) else trigger_always
        
        for idx, image_batch in enumerate(images):
            try:
                image = image_batch.squeeze()
                # 转换为PIL图像
                rgb_image = Image.fromarray(np.clip(255. * image.cpu().numpy(), 0, 255).astype(np.uint8))
                
                # 获取对应的遮罩或创建空遮罩
                if masks is not None and idx < len(masks):
                    mask = masks[idx].squeeze()
                    mask_img = Image.fromarray(np.clip(255. * (1 - mask.cpu().numpy()), 0, 255).astype(np.uint8))
                else:
                    mask_img = Image.new('L', rgb_image.size, 255)
                
                # 合并RGB和遮罩为RGBA
                r, g, b = rgb_image.convert('RGB').split()
                rgba_image = Image.merge('RGBA', (r, g, b, mask_img))
                
                # 保存RGBA图像
                filename = f"{filename_prefix}_{link_id}_{timestamp}_{idx}.png"
                file_path = os.path.join(self.output_dir, filename)
                print(f"[ImageSender] 发送图像: {filename}")
                
                rgba_image.save(file_path, compress_level=self.compress_level)
                
                results.append({
                    "filename": filename,
                    "subfolder": "",
                    "type": self.type
                })

            except Exception as e:
                print(f"[ImageSender] 处理图像 {idx+1} 时出错: {str(e)}")
                import traceback
                traceback.print_exc()
                continue

        if results:
            PromptServer.instance.send_sync("img-send", {
                "link_id": link_id,
                "images": results
            })
        
        return { "ui": { "images": results } }

class LG_ImageReceiver:
    @classmethod
    def INPUT_TYPES(s):
        temp_dir = folder_paths.get_temp_directory()
        files = [f for f in os.listdir(temp_dir) if os.path.isfile(os.path.join(temp_dir, f))]
        
        return {
            "required": {
                "image": ("STRING", {"default": "", "multiline": False, "tooltip": "多个文件名用逗号分隔"}),
                "link_id": ("INT", {"default": 1, "min": 0, "max": sys.maxsize, "step": 1, "tooltip": "发送端连接ID"}),
            }
        }

    CATEGORY = "🎈LAOGOU"
    RETURN_TYPES = ("IMAGE", "MASK")
    RETURN_NAMES = ("images", "masks")
    OUTPUT_IS_LIST = (True, True)
    FUNCTION = "load_image"

    def load_image(self, image, link_id):
        image_files = [x.strip() for x in image.split(',') if x.strip()]
        print(f"[ImageReceiver] 加载图像: {image_files}")
        
        output_images = []
        output_masks = []
        
        if not image_files:
            empty_image = torch.zeros((1, 64, 64, 3), dtype=torch.float32)
            empty_mask = torch.zeros((1, 64, 64), dtype=torch.float32)
            return ([empty_image], [empty_mask])
        
        temp_dir = folder_paths.get_temp_directory()
        
        for img_file in image_files:
            try:
                img_path = os.path.join(temp_dir, img_file)
                
                if not os.path.exists(img_path):
                    continue
                    
                # 加载RGBA图像
                img = Image.open(img_path)
                
                if img.mode == 'RGBA':
                    # 分离RGB和Alpha通道
                    r, g, b, a = img.split()
                    # 合并RGB通道
                    rgb_image = Image.merge('RGB', (r, g, b))
                    # 转换为tensor
                    image = np.array(rgb_image).astype(np.float32) / 255.0
                    image = torch.from_numpy(image)[None,]
                    # 转换alpha为mask，并确保维度是 (B, H, W)
                    mask = np.array(a).astype(np.float32) / 255.0
                    mask = torch.from_numpy(mask)[None,]  # 添加batch维度
                    # 反转遮罩值
                    mask = 1.0 - mask
                else:
                    # 如果不是RGBA，按原来的方式处理
                    image = np.array(img.convert('RGB')).astype(np.float32) / 255.0
                    image = torch.from_numpy(image)[None,]
                    mask = torch.zeros((1, image.shape[1], image.shape[2]), dtype=torch.float32, device="cpu")
                
                output_images.append(image)
                output_masks.append(mask)
                
            except Exception as e:
                print(f"[ImageReceiver] 处理文件 {img_file} 时出错: {str(e)}")
                import traceback
                traceback.print_exc()
                continue
        
        return (output_images, output_masks)

class ImageListSplitter:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "images": ("IMAGE",),
                "indices": ("STRING", {
                    "default": "", 
                    "multiline": False,
                    "tooltip": "输入要提取的图片索引，用逗号分隔，如：0,1,3,4"
                }),
            },
        }
    
    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("images",)
    FUNCTION = "split_images"
    CATEGORY = "🎈LAOGOU"

    INPUT_IS_LIST = True
    OUTPUT_IS_LIST = (True,)  # (images,)

    def split_images(self, images, indices):
        try:
            # 解析索引字符串
            try:
                if isinstance(indices, list):
                    indices = indices[0] if indices else ""
                indices = [int(idx.strip()) for idx in indices.split(',') if idx.strip()]
            except ValueError:
                print("[ImageSplitter] 索引格式错误，请使用逗号分隔的数字")
                return ([],)
            
            # 确保images是列表
            if not isinstance(images, list):
                images = [images]
            
            # 处理批量图片的情况
            if len(images) == 1 and len(images[0].shape) == 4:  # [B, H, W, C]
                batch_images = images[0]
                total_images = batch_images.shape[0]
                print(f"[ImageSplitter] 检测到批量图片，总数: {total_images}")
                
                selected_images = []
                for idx in indices:
                    if 0 <= idx < total_images:
                        # 保持批次维度，使用unsqueeze确保维度为 [1, H, W, C]
                        img = batch_images[idx].unsqueeze(0)
                        selected_images.append(img)
                        print(f"[ImageSplitter] 从批量中选择第 {idx} 张图片")
                    else:
                        print(f"[ImageSplitter] 索引 {idx} 超出批量范围 0-{total_images-1}")
                
                if not selected_images:
                    return ([],)
                return (selected_images,)
            
            # 处理图片列表的情况
            total_images = len(images)
            print(f"[ImageSplitter] 检测到图片列表，总数: {total_images}")
            
            if total_images == 0:
                print("[ImageSplitter] 没有输入图片")
                return ([],)
            
            selected_images = []
            for idx in indices:
                if 0 <= idx < total_images:
                    selected_image = images[idx]
                    # 确保输出维度为 [1, H, W, C]
                    if len(selected_image.shape) == 3:  # [H, W, C]
                        selected_image = selected_image.unsqueeze(0)
                    selected_images.append(selected_image)
                    print(f"[ImageSplitter] 从列表中选择第 {idx} 张图片")
                else:
                    print(f"[ImageSplitter] 索引 {idx} 超出列表范围 0-{total_images-1}")
            
            if not selected_images:
                return ([],)
            return (selected_images,)

        except Exception as e:
            print(f"[ImageSplitter] 处理出错: {str(e)}")
            return ([],)

class MaskListSplitter:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "masks": ("MASK",),
                "indices": ("STRING", {
                    "default": "", 
                    "multiline": False,
                    "tooltip": "输入要提取的遮罩索引，用逗号分隔，如：0,1,3,4"
                }),
            },
        }
    
    RETURN_TYPES = ("MASK",)
    RETURN_NAMES = ("masks",)
    FUNCTION = "split_masks"
    CATEGORY = "🎈LAOGOU"

    INPUT_IS_LIST = True
    OUTPUT_IS_LIST = (True,)  # (masks,)

    def split_masks(self, masks, indices):
        try:
            # 解析索引字符串
            try:
                if isinstance(indices, list):
                    indices = indices[0] if indices else ""
                indices = [int(idx.strip()) for idx in indices.split(',') if idx.strip()]
            except ValueError:
                print("[MaskSplitter] 索引格式错误，请使用逗号分隔的数字")
                return ([],)
            
            # 确保masks是列表
            if not isinstance(masks, list):
                masks = [masks]
            
            # 处理批量遮罩的情况
            if len(masks) == 1 and len(masks[0].shape) == 3:  # [B, H, W]
                batch_masks = masks[0]
                total_masks = batch_masks.shape[0]
                print(f"[MaskSplitter] 检测到批量遮罩，总数: {total_masks}")
                
                selected_masks = []
                for idx in indices:
                    if 0 <= idx < total_masks:
                        selected_masks.append(batch_masks[idx].unsqueeze(0))
                        print(f"[MaskSplitter] 从批量中选择第 {idx} 个遮罩")
                    else:
                        print(f"[MaskSplitter] 索引 {idx} 超出批量范围 0-{total_masks-1}")
                
                if not selected_masks:
                    return ([],)
                return (selected_masks,)
            
            # 处理遮罩列表的情况
            total_masks = len(masks)
            print(f"[MaskSplitter] 检测到遮罩列表，总数: {total_masks}")
            
            if total_masks == 0:
                print("[MaskSplitter] 没有输入遮罩")
                return ([],)
            
            selected_masks = []
            for idx in indices:
                if 0 <= idx < total_masks:
                    selected_mask = masks[idx]
                    if len(selected_mask.shape) == 2:  # [H, W]
                        selected_mask = selected_mask.unsqueeze(0)
                    elif len(selected_mask.shape) != 3:  # 不是 [B, H, W]
                        print(f"[MaskSplitter] 不支持的遮罩维度: {selected_mask.shape}")
                        continue
                    selected_masks.append(selected_mask)
                    print(f"[MaskSplitter] 从列表中选择第 {idx} 个遮罩")
                else:
                    print(f"[MaskSplitter] 索引 {idx} 超出列表范围 0-{total_masks-1}")
            
            if not selected_masks:
                return ([],)
            return (selected_masks,)

        except Exception as e:
            print(f"[MaskSplitter] 处理出错: {str(e)}")
            return ([],)

class ImageListRepeater:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "images": ("IMAGE",),
                "repeat_times": ("INT", {
                    "default": 1,
                    "min": 1,
                    "max": 100,
                    "step": 1,
                    "tooltip": "每张图片重复的次数"
                }),
            },
        }
    
    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("images",)
    FUNCTION = "repeat_images"
    CATEGORY = "🎈LAOGOU"

    INPUT_IS_LIST = True
    OUTPUT_IS_LIST = (True,)

    def repeat_images(self, images, repeat_times):
        try:
            # 处理 repeat_times 参数
            if isinstance(repeat_times, list):
                repeat_times = repeat_times[0] if repeat_times else 1
            
            # 确保images是列表
            if not isinstance(images, list):
                images = [images]
            
            if len(images) == 0:
                print("[ImageRepeater] 没有输入图片")
                return ([],)
            
            # 创建重复后的图片列表
            repeated_images = []
            for idx, img in enumerate(images):
                for _ in range(int(repeat_times)):  # 确保 repeat_times 是整数
                    repeated_images.append(img)
                print(f"[ImageRepeater] 图片 {idx} 重复 {repeat_times} 次")
            
            print(f"[ImageRepeater] 输入 {len(images)} 张图片，输出 {len(repeated_images)} 张图片")
            return (repeated_images,)

        except Exception as e:
            print(f"[ImageRepeater] 处理出错: {str(e)}")
            return ([],)

class MaskListRepeater:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "masks": ("MASK",),
                "repeat_times": ("INT", {
                    "default": 1,
                    "min": 1,
                    "max": 100,
                    "step": 1,
                    "tooltip": "每张遮罩重复的次数"
                }),
            },
        }
    
    RETURN_TYPES = ("MASK",)            
    RETURN_NAMES = ("masks",)
    FUNCTION = "repeat_masks"
    CATEGORY = "🎈LAOGOU"

    INPUT_IS_LIST = True
    OUTPUT_IS_LIST = (True,)    

    def repeat_masks(self, masks, repeat_times):
        try:
            # 处理 repeat_times 参数
            if isinstance(repeat_times, list):
                repeat_times = repeat_times[0] if repeat_times else 1

            # 确保masks是列表
            if not isinstance(masks, list):
                masks = [masks]

            if len(masks) == 0:
                print("[MaskRepeater] 没有输入遮罩")
                return ([],)

            # 创建重复后的遮罩列表
            repeated_masks = []     
            for idx, mask in enumerate(masks):
                for _ in range(int(repeat_times)):  # 确保 repeat_times 是整数
                    repeated_masks.append(mask)
                print(f"[MaskRepeater] 遮罩 {idx} 重复 {repeat_times} 次")

            print(f"[MaskRepeater] 输入 {len(masks)} 个遮罩，输出 {len(repeated_masks)} 个遮罩")
            return (repeated_masks,)    

        except Exception as e:
            print(f"[MaskRepeater] 处理出错: {str(e)}")
            return ([],)


