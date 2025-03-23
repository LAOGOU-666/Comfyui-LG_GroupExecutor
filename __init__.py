from .py.lgutils import *
from .py.trans import *

WEB_DIRECTORY = "web"

NODE_CLASS_MAPPINGS = {
    "GroupExecutorSingle": GroupExecutorSingle,
    "GroupExecutorSender": GroupExecutorSender,
    "GroupExecutorRepeater": GroupExecutorRepeater,
    "LG_ImageSender": LG_ImageSender,
    "LG_ImageReceiver": LG_ImageReceiver,
    "ImageListSplitter": ImageListSplitter,
    "MaskListSplitter": MaskListSplitter,
    "ImageListRepeater": ImageListRepeater,
    "MaskListRepeater": MaskListRepeater,
    "LG_FastPreview": LG_FastPreview,
    "LG_AccumulatePreview": LG_AccumulatePreview,

}
NODE_DISPLAY_NAME_MAPPINGS = {
    "GroupExecutorSingle": "🎈GroupExecutorSingle",
    "GroupExecutorSender": "🎈GroupExecutorSender",
    "GroupExecutorRepeater": "🎈GroupExecutorRepeater",
    "LG_ImageSender": "🎈LG_ImageSender",
    "LG_ImageReceiver": "🎈LG_ImageReceiver",
    "ImageListSplitter": "🎈List-Image-Splitter",
    "MaskListSplitter": "🎈List-Mask-Splitter",
    "ImageListRepeater": "🎈List-Image-Repeater",
    "MaskListRepeater": "🎈List-Mask-Repeater",
    "LG_FastPreview": "🎈LG_FastPreview",
    "LG_AccumulatePreview": "🎈LG_AccumulatePreview",
}
