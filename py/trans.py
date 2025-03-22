from server import PromptServer
import os
import sys
import time
import torch
import numpy as np
from PIL import Image
import folder_paths
import random
from nodes import SaveImage
import json
from comfy.cli_args import args
from PIL.PngImagePlugin import PngInfo
import psutil
import ctypes
from ctypes import wintypes


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
            if offload_model:
                import comfy.model_management
                comfy.model_management.unload_all_models()
            if offload_cache:
                import torch
                import gc
                torch.cuda.empty_cache()
                gc.collect()
        except Exception as e:
            print(f"内存清理出错: {str(e)}")
            import traceback
            print(traceback.format_exc())
            
        return (anything,)
    

class RAMCleanup:
    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "anything": (any, {}),
                "clean_file_cache": ("BOOLEAN", {"default": True, "label": "清理文件缓存"}),
                "clean_processes": ("BOOLEAN", {"default": True, "label": "清理进程内存"}),
                "clean_dlls": ("BOOLEAN", {"default": True, "label": "清理未使用DLL"}),
                "retry_times": ("INT", {
                    "default": 3, 
                    "min": 1, 
                    "max": 10, 
                    "step": 1,
                    "label": "重试次数"
                }),
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
    FUNCTION = "clean_ram"
    CATEGORY = "Memory Management"

    def get_ram_usage(self):
        memory = psutil.virtual_memory()
        return memory.percent, memory.available / (1024 * 1024) 

    def clean_ram(self, anything, clean_file_cache, clean_processes, clean_dlls, retry_times, unique_id=None, extra_pnginfo=None):
        try:
            current_usage, available_mb = self.get_ram_usage()
            print(f"开始清理RAM - 当前使用率: {current_usage:.1f}%, 可用: {available_mb:.1f}MB")
            
            for attempt in range(retry_times):
                
                if clean_file_cache:
                    try:
                        ctypes.windll.kernel32.SetSystemFileCacheSize(-1, -1, 0)
                    except Exception as e:
                        print(f"清理文件缓存失败: {str(e)}")
                        
                if clean_processes:
                    cleaned_processes = 0
                    for process in psutil.process_iter(['pid', 'name']):
                        try:
                            handle = ctypes.windll.kernel32.OpenProcess(
                                wintypes.DWORD(0x001F0FFF),
                                wintypes.BOOL(False),
                                wintypes.DWORD(process.info['pid'])
                            )
                            ctypes.windll.psapi.EmptyWorkingSet(handle)
                            ctypes.windll.kernel32.CloseHandle(handle)
                            cleaned_processes += 1
                        except:
                            continue

                if clean_dlls:
                    try:
                        ctypes.windll.kernel32.SetProcessWorkingSetSize(-1, -1, -1)
                    except Exception as e:
                        print(f"释放DLL失败: {str(e)}")

                time.sleep(1)
                current_usage, available_mb = self.get_ram_usage()
                print(f"清理后内存使用率: {current_usage:.1f}%, 可用: {available_mb:.1f}MB")

            print(f"清理完成 - 最终内存使用率: {current_usage:.1f}%, 可用: {available_mb:.1f}MB")

        except Exception as e:
            print(f"RAM清理过程出错: {str(e)}")
            
        return (anything,)

class LG_ImageSender:
    def __init__(self):
        self.output_dir = folder_paths.get_temp_directory()
        self.type = "temp"
        self.compress_level = 1
        self.accumulated_results = []  # 添加积累结果列表
        
    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "images": ("IMAGE", {"tooltip": "要发送的图像"}),
                "filename_prefix": ("STRING", {"default": "lg_send"}),
                "link_id": ("INT", {"default": 1, "min": 0, "max": sys.maxsize, "step": 1, "tooltip": "发送端连接ID"}),
                "accumulate": ("BOOLEAN", {"default": False, "tooltip": "开启后将累积所有图像一起发送"})  # 改名为accumulate
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
    def IS_CHANGED(s, images, filename_prefix, link_id, accumulate, masks=None, prompt=None, extra_pnginfo=None):
        if isinstance(accumulate, list):
            accumulate = accumulate[0]
        
        if accumulate:
            return float("NaN") 
        
        # 非积累模式下计算hash
        hash_value = hash(str(images) + str(masks))
        return hash_value

    def save_images(self, images, filename_prefix, link_id, accumulate, masks=None, prompt=None, extra_pnginfo=None):
        timestamp = int(time.time() * 1000)
        results = list()

        filename_prefix = filename_prefix[0] if isinstance(filename_prefix, list) else filename_prefix
        link_id = link_id[0] if isinstance(link_id, list) else link_id
        accumulate = accumulate[0] if isinstance(accumulate, list) else accumulate
        
        for idx, image_batch in enumerate(images):
            try:
                image = image_batch.squeeze()

                rgb_image = Image.fromarray(np.clip(255. * image.cpu().numpy(), 0, 255).astype(np.uint8))

                if masks is not None and idx < len(masks):
                    mask = masks[idx].squeeze()
                    mask_img = Image.fromarray(np.clip(255. * (1 - mask.cpu().numpy()), 0, 255).astype(np.uint8))
                else:
                    mask_img = Image.new('L', rgb_image.size, 255)

                r, g, b = rgb_image.convert('RGB').split()
                rgba_image = Image.merge('RGBA', (r, g, b, mask_img))

                filename = f"{filename_prefix}_{link_id}_{timestamp}_{idx}.png"
                file_path = os.path.join(self.output_dir, filename)
                
                rgba_image.save(file_path, compress_level=self.compress_level)
                
                result = {
                    "filename": filename,
                    "subfolder": "",
                    "type": self.type
                }
                results.append(result)

                if accumulate:
                    self.accumulated_results.append(result)

            except Exception as e:
                print(f"[ImageSender] 处理图像 {idx+1} 时出错: {str(e)}")
                import traceback
                traceback.print_exc()
                continue

        send_results = self.accumulated_results if accumulate else results
        
        if send_results:
            print(f"[ImageSender] 发送 {len(send_results)} 张图像")
            PromptServer.instance.send_sync("img-send", {
                "link_id": link_id,
                "images": send_results
            })
        if not accumulate:
            self.accumulated_results = []
        
        return { "ui": { "images": send_results } }

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


    
class LG_FastPreview(SaveImage):
    def __init__(self):
        self.output_dir = folder_paths.get_temp_directory()
        self.type = "temp"
        self.prefix_append = "_temp_" + ''.join(random.choice("abcdefghijklmnopqrstupvxyz") for x in range(5))
        
    @classmethod
    def INPUT_TYPES(s):
        return {"required": {
                    "images": ("IMAGE", ),
                    "format": (["PNG", "JPEG", "WEBP"], {"default": "JPEG"}),
                    "quality": ("INT", {"default": 95, "min": 1, "max": 100, "step": 1}),
                },
                "hidden": {"prompt": "PROMPT", "extra_pnginfo": "EXTRA_PNGINFO"},
               }
    
    RETURN_TYPES = ()
    FUNCTION = "save_images"
    
    CATEGORY = "image"
    DESCRIPTION = "快速预览图像,支持多种格式和质量设置"

    def save_images(self, images, format="JPEG", quality=95, prompt=None, extra_pnginfo=None):
        filename_prefix = "preview"
        filename_prefix += self.prefix_append
        full_output_folder, filename, counter, subfolder, filename_prefix = folder_paths.get_save_image_path(filename_prefix, self.output_dir, images[0].shape[1], images[0].shape[0])
        
        results = list()
        for (batch_number, image) in enumerate(images):
            i = 255. * image.cpu().numpy()
            img = Image.fromarray(np.clip(i, 0, 255).astype(np.uint8))
            save_kwargs = {}
            if format == "PNG":
                file_extension = ".png"

                compress_level = int(9 * (1 - quality/100)) 
                save_kwargs["compress_level"] = compress_level

                if not args.disable_metadata:
                    metadata = PngInfo()
                    if prompt is not None:
                        metadata.add_text("prompt", json.dumps(prompt))
                    if extra_pnginfo is not None:
                        for x in extra_pnginfo:
                            metadata.add_text(x, json.dumps(extra_pnginfo[x]))
                    save_kwargs["pnginfo"] = metadata
            elif format == "JPEG":
                file_extension = ".jpg"
                save_kwargs["quality"] = quality
                save_kwargs["optimize"] = True
            else:  
                file_extension = ".webp"
                save_kwargs["quality"] = quality
                
            filename_with_batch_num = filename.replace("%batch_num%", str(batch_number))
            file = f"{filename_with_batch_num}_{counter:05}_{file_extension}"
            
            img.save(os.path.join(full_output_folder, file), format=format, **save_kwargs)
            
            results.append({
                "filename": file,
                "subfolder": subfolder,
                "type": self.type
            })
            counter += 1

        return { "ui": { "images": results } }
    
class LG_AccumulatePreview(SaveImage):
    def __init__(self):
        self.output_dir = folder_paths.get_temp_directory()
        self.type = "temp"
        self.prefix_append = "_acc_" + ''.join(random.choice("abcdefghijklmnopqrstupvxyz") for x in range(5))
        self.accumulated_images = []
        self.accumulated_masks = []
        self.counter = 0
        
    @classmethod
    def INPUT_TYPES(s):
        return {"required": {
                    "images": ("IMAGE", ),
                },
                "optional": {
                    "mask": ("MASK",),
                },
                "hidden": {
                    "prompt": "PROMPT", 
                    "extra_pnginfo": "EXTRA_PNGINFO",
                    "unique_id": "UNIQUE_ID"
                },
               }
    
    RETURN_TYPES = ("IMAGE", "MASK", "INT")
    RETURN_NAMES = ("images", "masks", "image_count")
    FUNCTION = "accumulate_images"
    OUTPUT_NODE = True
    OUTPUT_IS_LIST = (True, True, False)
    CATEGORY = "🎈LAOGOU"
    DESCRIPTION = "累计图像预览"

    def accumulate_images(self, images, mask=None, prompt=None, extra_pnginfo=None, unique_id=None):
        # 添加调试信息
        print(f"[AccumulatePreview] accumulate_images - 当前累积图片数量: {len(self.accumulated_images)}")
        print(f"[AccumulatePreview] accumulate_images - 新输入图片数量: {len(images)}")
        print(f"[AccumulatePreview] accumulate_images - unique_id: {unique_id}")
        
        filename_prefix = "accumulate"
        filename_prefix += self.prefix_append

        full_output_folder, filename, _, subfolder, filename_prefix = folder_paths.get_save_image_path(
            filename_prefix, self.output_dir, images[0].shape[1], images[0].shape[0]
        )

        for image in images:
            i = 255. * image.cpu().numpy()
            img = Image.fromarray(np.clip(i, 0, 255).astype(np.uint8))

            file = f"{filename}_{self.counter:05}.png"
            img.save(os.path.join(full_output_folder, file), format="PNG")

            if len(image.shape) == 3:
                image = image.unsqueeze(0) 
            self.accumulated_images.append({
                "image": image,
                "info": {
                    "filename": file,
                    "subfolder": subfolder,
                    "type": self.type
                }
            })

            if mask is not None:
                if len(mask.shape) == 2:
                    mask = mask.unsqueeze(0)
                self.accumulated_masks.append(mask)
            else:
                self.accumulated_masks.append(None)
            
            self.counter += 1

        if not self.accumulated_images:
            return {"ui": {"images": []}, "result": ([], [], 0)}

        accumulated_tensors = []
        for item in self.accumulated_images:
            img = item["image"]
            if len(img.shape) == 3:  # [H, W, C]
                img = img.unsqueeze(0)  # 变成 [1, H, W, C]
            accumulated_tensors.append(img)

        accumulated_masks = [m for m in self.accumulated_masks if m is not None]
        
        ui_images = [item["info"] for item in self.accumulated_images]
        
        return {
            "ui": {"images": ui_images},
            "result": (accumulated_tensors, accumulated_masks, len(self.accumulated_images))
        }