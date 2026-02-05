"""
视频合并节点
1. CreateAndSaveVideo: 从图片创建视频并保存，返回路径
2. ConcatVideoFiles: 使用 FFmpeg 合并多个视频文件（多行文本输入路径）
3. SaveAudioGetPath: 保存音频并返回文件路径
"""

from __future__ import annotations

import os
import subprocess
import tempfile
import folder_paths
from fractions import Fraction
from comfy.cli_args import args
CATEGORY_TYPE = "🎈LAOGOU/Group"

class CreateAndSaveVideo:
    """
    从图片创建视频并保存到文件，返回文件路径
    """
    
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "images": ("IMAGE",),
                "fps": ("FLOAT", {"default": 30.0, "min": 1.0, "max": 120.0, "step": 1.0}),
                "filename_prefix": ("STRING", {"default": "video/segment"}),
            },
            "optional": {
                "audio": ("AUDIO",),
            },
            "hidden": {
                "prompt": "PROMPT",
                "extra_pnginfo": "EXTRA_PNGINFO"
            }
        }
    
    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("file_path",)
    FUNCTION = "create_and_save"
    CATEGORY = CATEGORY_TYPE
    DESCRIPTION = "从图片创建视频并保存，返回文件路径"

    def create_and_save(self, images, fps, filename_prefix, audio=None, prompt=None, extra_pnginfo=None):
        try:
            from comfy_api.latest._input_impl.video_types import VideoFromComponents
            from comfy_api.latest._util.video_types import VideoComponents, VideoContainer, VideoCodec
        except ImportError:
            from comfy_api.input_impl import VideoFromComponents
            from comfy_api._util.video_types import VideoComponents, VideoContainer, VideoCodec
        
        # 创建视频
        components = VideoComponents(images=images, audio=audio, frame_rate=Fraction(fps))
        video = VideoFromComponents(components)
        
        # 保存
        width, height = images.shape[2], images.shape[1]
        output_dir = folder_paths.get_output_directory()
        
        full_output_folder, filename, counter, subfolder, _ = folder_paths.get_save_image_path(
            filename_prefix, output_dir, width, height
        )
        
        saved_metadata = None
        if not args.disable_metadata:
            metadata = {}
            if extra_pnginfo is not None:
                metadata.update(extra_pnginfo)
            if prompt is not None:
                metadata["prompt"] = prompt
            if len(metadata) > 0:
                saved_metadata = metadata
        
        file = f"{filename}_{counter:05}_.mp4"
        file_path = os.path.join(full_output_folder, file)
        
        video.save_to(
            file_path,
            format=VideoContainer.MP4,
            codec=VideoCodec.H264,
            metadata=saved_metadata
        )
        
        return (file_path,)


class ConcatVideoFiles:
    """
    使用 FFmpeg 合并多个视频文件
    支持字符串列表输入或多行文本输入
    可选添加音频轨道
    """
    
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "video_paths": ("STRING", {"forceInput": True}),
                "filename_prefix": ("STRING", {"default": "video/merged"}),
            },
            "optional": {
                "reencode": ("BOOLEAN", {"default": False, 
                    "tooltip": "False=直接拼接(快)，True=重新编码(兼容性好)"}),
                "audio_path": ("STRING", {"forceInput": True,
                    "tooltip": "可选的音频文件路径，将替换或添加到合并后的视频"}),
                "audio_mode": (["replace", "mix"], {"default": "replace",
                    "tooltip": "replace=替换原音频，mix=混合原音频和新音频"}),
                "audio_volume": ("FLOAT", {"default": 1.0, "min": 0.0, "max": 2.0, "step": 0.1,
                    "tooltip": "音频音量，1.0为原始音量"}),
            }
        }
    
    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("output_path",)
    OUTPUT_NODE = True
    FUNCTION = "concat_files"
    CATEGORY = CATEGORY_TYPE
    INPUT_IS_LIST = True
    DESCRIPTION = "使用 FFmpeg 合并多个视频文件，支持列表输入，可选添加音频"

    def concat_files(self, video_paths, filename_prefix, reencode=None, audio_path=None, audio_mode=None, audio_volume=None):
        # 处理其他参数（因为 INPUT_IS_LIST=True，所有参数都是列表）
        filename_prefix = filename_prefix[0] if isinstance(filename_prefix, list) else filename_prefix
        reencode = reencode[0] if isinstance(reencode, list) and reencode else False
        audio_path = audio_path[0] if isinstance(audio_path, list) and audio_path else None
        audio_mode = audio_mode[0] if isinstance(audio_mode, list) and audio_mode else "replace"
        audio_volume = audio_volume[0] if isinstance(audio_volume, list) and audio_volume else 1.0
        
        # 展平并处理路径列表
        paths = []
        for item in video_paths:
            if isinstance(item, list):
                # 嵌套列表
                for p in item:
                    if isinstance(p, str) and p.strip():
                        paths.append(p.strip())
            elif isinstance(item, str):
                # 可能是多行文本或单个路径
                if '\n' in item:
                    paths.extend([p.strip() for p in item.split('\n') if p.strip()])
                elif item.strip():
                    paths.append(item.strip())
        
        if len(paths) == 0:
            raise ValueError("没有输入任何视频路径")
        
        # 验证文件存在
        for p in paths:
            if not os.path.exists(p):
                raise FileNotFoundError(f"视频文件不存在: {p}")
        
        # 验证音频文件存在，不存在则跳过音频处理（不报错）
        if audio_path and not os.path.exists(audio_path):
            print(f"[ConcatVideoFiles] 警告：音频文件不存在，跳过音频合并: {audio_path}")
            audio_path = None
        
        output_dir = folder_paths.get_output_directory()
        full_output_folder, filename, counter, subfolder, _ = folder_paths.get_save_image_path(
            filename_prefix, output_dir, 0, 0
        )
        output_file = os.path.join(full_output_folder, f"{filename}_{counter:05}_.mp4")
        
        # 创建 FFmpeg concat 列表
        with tempfile.NamedTemporaryFile(mode='w', suffix='.txt', delete=False) as f:
            for p in paths:
                escaped_path = p.replace("'", "'\\''")
                f.write(f"file '{escaped_path}'\n")
            concat_file = f.name
        
        try:
            if audio_path:
                # 有音频输入时，需要两步处理：先合并视频，再添加音频
                # 创建临时文件用于中间结果
                temp_video = tempfile.NamedTemporaryFile(suffix='.mp4', delete=False).name
                
                # 第一步：合并视频片段
                if reencode:
                    cmd1 = [
                        'ffmpeg', '-y', '-f', 'concat', '-safe', '0', '-i', concat_file,
                        '-c:v', 'libx264', '-preset', 'medium', '-crf', '23',
                        '-an',  # 不包含音频
                        '-movflags', '+faststart',
                        temp_video
                    ]
                else:
                    cmd1 = [
                        'ffmpeg', '-y', '-f', 'concat', '-safe', '0', '-i', concat_file,
                        '-c:v', 'copy', '-an',
                        '-movflags', '+faststart',
                        temp_video
                    ]
                
                result = subprocess.run(cmd1, capture_output=True, text=True)
                if result.returncode != 0:
                    raise RuntimeError(f"FFmpeg 合并视频错误:\n{result.stderr}")
                
                # 第二步：添加音频
                if audio_mode == "mix":
                    # 混合模式：先合并带原音频的视频，再混合新音频
                    # 重新合并带音频的视频
                    temp_video_with_audio = tempfile.NamedTemporaryFile(suffix='.mp4', delete=False).name
                    if reencode:
                        cmd_audio = [
                            'ffmpeg', '-y', '-f', 'concat', '-safe', '0', '-i', concat_file,
                            '-c:v', 'libx264', '-preset', 'medium', '-crf', '23',
                            '-c:a', 'aac', '-b:a', '128k',
                            '-movflags', '+faststart',
                            temp_video_with_audio
                        ]
                    else:
                        cmd_audio = [
                            'ffmpeg', '-y', '-f', 'concat', '-safe', '0', '-i', concat_file,
                            '-c', 'copy',
                            '-movflags', '+faststart',
                            temp_video_with_audio
                        ]
                    result = subprocess.run(cmd_audio, capture_output=True, text=True)
                    if result.returncode != 0:
                        raise RuntimeError(f"FFmpeg 合并音频错误:\n{result.stderr}")
                    
                    # 混合两个音频
                    cmd2 = [
                        'ffmpeg', '-y',
                        '-i', temp_video_with_audio,
                        '-i', audio_path,
                        '-filter_complex', f'[0:a][1:a]amix=inputs=2:duration=first:dropout_transition=2,volume={audio_volume}[a]',
                        '-map', '0:v', '-map', '[a]',
                        '-c:v', 'copy',
                        '-c:a', 'aac', '-b:a', '128k',
                        '-movflags', '+faststart',
                        '-shortest',
                        output_file
                    ]
                    try:
                        result = subprocess.run(cmd2, capture_output=True, text=True)
                        if result.returncode != 0:
                            raise RuntimeError(f"FFmpeg 混合音频错误:\n{result.stderr}")
                    finally:
                        if os.path.exists(temp_video_with_audio):
                            os.unlink(temp_video_with_audio)
                else:
                    # 替换模式：直接用新音频替换
                    volume_filter = f'volume={audio_volume}' if audio_volume != 1.0 else None
                    cmd2 = [
                        'ffmpeg', '-y',
                        '-i', temp_video,
                        '-i', audio_path,
                        '-map', '0:v', '-map', '1:a',
                        '-c:v', 'copy',
                    ]
                    if volume_filter:
                        cmd2.extend(['-af', volume_filter])
                    cmd2.extend([
                        '-c:a', 'aac', '-b:a', '128k',
                        '-movflags', '+faststart',
                        '-shortest',
                        output_file
                    ])
                    result = subprocess.run(cmd2, capture_output=True, text=True)
                    if result.returncode != 0:
                        raise RuntimeError(f"FFmpeg 添加音频错误:\n{result.stderr}")
                
                # 清理临时文件
                if os.path.exists(temp_video):
                    os.unlink(temp_video)
            else:
                # 无音频输入，原有逻辑
                if reencode:
                    cmd = [
                        'ffmpeg', '-y', '-f', 'concat', '-safe', '0', '-i', concat_file,
                        '-c:v', 'libx264', '-preset', 'medium', '-crf', '23',
                        '-c:a', 'aac', '-b:a', '128k',
                        '-movflags', '+faststart',
                        output_file
                    ]
                else:
                    cmd = [
                        'ffmpeg', '-y', '-f', 'concat', '-safe', '0', '-i', concat_file,
                        '-c', 'copy',
                        '-movflags', '+faststart',
                        output_file
                    ]
                
                result = subprocess.run(cmd, capture_output=True, text=True)
                if result.returncode != 0:
                    raise RuntimeError(f"FFmpeg 错误:\n{result.stderr}")
        finally:
            if os.path.exists(concat_file):
                os.unlink(concat_file)
        
        return {"ui": {"images": [{"filename": os.path.basename(output_file), "subfolder": subfolder, "type": "output"}], "animated": (True,)}, 
                "result": (output_file,)}


class SaveAudioGetPath:
    """
    保存音频文件并返回文件路径
    支持 FLAC、MP3、OPUS 格式
    音频为空或无效时返回空字符串，不会中断工作流
    """
    
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "filename_prefix": ("STRING", {"default": "audio/ComfyUI"}),
                "format": (["flac", "mp3", "opus"], {"default": "flac"}),
            },
            "optional": {
                "audio": ("AUDIO",),
                "quality": (["64k", "96k", "128k", "192k", "320k", "V0"], {"default": "128k",
                    "tooltip": "MP3/OPUS 比特率，FLAC 忽略此参数"}),
            },
            "hidden": {
                "prompt": "PROMPT",
                "extra_pnginfo": "EXTRA_PNGINFO"
            }
        }
    
    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("file_path",)
    OUTPUT_NODE = True
    FUNCTION = "save_audio"
    CATEGORY = CATEGORY_TYPE
    DESCRIPTION = "保存音频文件并返回文件路径，音频无效时返回空字符串"

    def save_audio(self, filename_prefix, format="flac", audio=None, quality="128k", prompt=None, extra_pnginfo=None):
        # 检查音频是否有效
        if audio is None:
            print("[SaveAudioGetPath] 警告：音频输入为空，跳过保存")
            return {"ui": {"audio": []}, "result": ("",)}
        
        # 检查音频数据是否有效
        try:
            if "waveform" not in audio or audio["waveform"] is None:
                print("[SaveAudioGetPath] 警告：音频数据无效（无 waveform），跳过保存")
                return {"ui": {"audio": []}, "result": ("",)}
            
            if audio["waveform"].numel() == 0:
                print("[SaveAudioGetPath] 警告：音频数据为空，跳过保存")
                return {"ui": {"audio": []}, "result": ("",)}
        except Exception as e:
            print(f"[SaveAudioGetPath] 警告：检查音频数据时出错 ({e})，跳过保存")
            return {"ui": {"audio": []}, "result": ("",)}
        
        import json
        from io import BytesIO
        import av
        
        try:
            import torchaudio
            TORCH_AUDIO_AVAILABLE = True
        except:
            TORCH_AUDIO_AVAILABLE = False
        
        try:
            output_dir = folder_paths.get_output_directory()
            full_output_folder, filename, counter, subfolder, _ = folder_paths.get_save_image_path(
                filename_prefix, output_dir
            )
            
            # 构建元数据
            metadata = {}
            if not args.disable_metadata:
                if prompt is not None:
                    metadata["prompt"] = json.dumps(prompt)
                if extra_pnginfo is not None:
                    for x in extra_pnginfo:
                        metadata[x] = json.dumps(extra_pnginfo[x])
            
            # Opus 支持的采样率
            OPUS_RATES = [8000, 12000, 16000, 24000, 48000]
            
            results = []
            file_paths = []
            
            for batch_number, waveform in enumerate(audio["waveform"].cpu()):
                # 检查单个 waveform 是否有效
                if waveform.numel() == 0:
                    print(f"[SaveAudioGetPath] 警告：批次 {batch_number} 的音频为空，跳过")
                    continue
                
                filename_with_batch_num = filename.replace("%batch_num%", str(batch_number))
                file = f"{filename_with_batch_num}_{counter:05}_.{format}"
                output_path = os.path.join(full_output_folder, file)
                
                sample_rate = audio["sample_rate"]
                
                # 处理 Opus 采样率要求
                if format == "opus":
                    if sample_rate > 48000:
                        sample_rate = 48000
                    elif sample_rate not in OPUS_RATES:
                        for rate in sorted(OPUS_RATES):
                            if rate > sample_rate:
                                sample_rate = rate
                                break
                        if sample_rate not in OPUS_RATES:
                            sample_rate = 48000
                    
                    # 重采样
                    if sample_rate != audio["sample_rate"]:
                        if not TORCH_AUDIO_AVAILABLE:
                            print("[SaveAudioGetPath] 警告：torchaudio 不可用，无法重采样，跳过保存")
                            return {"ui": {"audio": []}, "result": ("",)}
                        waveform = torchaudio.functional.resample(waveform, audio["sample_rate"], sample_rate)
                
                # 创建输出
                output_buffer = BytesIO()
                output_container = av.open(output_buffer, mode="w", format=format)
                
                # 设置元数据
                for key, value in metadata.items():
                    output_container.metadata[key] = value
                
                layout = "mono" if waveform.shape[0] == 1 else "stereo"
                
                # 设置输出流
                if format == "opus":
                    out_stream = output_container.add_stream("libopus", rate=sample_rate, layout=layout)
                    bit_rates = {"64k": 64000, "96k": 96000, "128k": 128000, "192k": 192000, "320k": 320000}
                    out_stream.bit_rate = bit_rates.get(quality, 128000)
                elif format == "mp3":
                    out_stream = output_container.add_stream("libmp3lame", rate=sample_rate, layout=layout)
                    if quality == "V0":
                        out_stream.codec_context.qscale = 1
                    else:
                        bit_rates = {"64k": 64000, "96k": 96000, "128k": 128000, "192k": 192000, "320k": 320000}
                        out_stream.bit_rate = bit_rates.get(quality, 128000)
                else:  # flac
                    out_stream = output_container.add_stream("flac", rate=sample_rate, layout=layout)
                
                frame = av.AudioFrame.from_ndarray(
                    waveform.movedim(0, 1).reshape(1, -1).float().numpy(),
                    format="flt",
                    layout=layout,
                )
                frame.sample_rate = sample_rate
                frame.pts = 0
                output_container.mux(out_stream.encode(frame))
                output_container.mux(out_stream.encode(None))  # Flush
                output_container.close()
                
                # 写入文件
                output_buffer.seek(0)
                with open(output_path, "wb") as f:
                    f.write(output_buffer.getbuffer())
                
                results.append({"filename": file, "subfolder": subfolder, "type": "output"})
                file_paths.append(output_path)
                counter += 1
            
            # 返回第一个文件的路径（通常只有一个）
            return {"ui": {"audio": results}, "result": (file_paths[0] if file_paths else "",)}
        
        except Exception as e:
            print(f"[SaveAudioGetPath] 警告：保存音频时出错 ({e})，返回空路径")
            return {"ui": {"audio": []}, "result": ("",)}


NODE_CLASS_MAPPINGS = {
    "LG_CreateAndSaveVideo": CreateAndSaveVideo,
    "LG_ConcatVideoFiles": ConcatVideoFiles,
    "LG_SaveAudioGetPath": SaveAudioGetPath,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "LG_CreateAndSaveVideo": "Create And Save Video With Path", 
    "LG_ConcatVideoFiles": "Concat Video Files With Path",
    "LG_SaveAudioGetPath": "Save Audio With Path",
}
