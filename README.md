# Comfyui-LG_GroupExecutor

ComfyUI的组执行器扩展，用于控制和管理节点组的执行流程。

![组执行器示例](1.png)

## 更新说明
- 2025.4.25 修复取消bug，图片发送器增加rgba/rgb预览开关
## 功能特点

- 支持节点组的单次或多次执行
- 可设置执行延迟时间
- 支持执行信号的链式传递
- 提供执行列表的重复处理功能

## 节点说明

### 1. GroupExecutorSingle (单组执行节点)
- 功能：创建单个组的执行信号
- 参数：
  - group_name: 组名称
  - repeat_count: 重复执行次数 (1-100)
  - delay_seconds: 延迟时间 (0-60秒)
  - signal: 可选的输入信号

### 2. GroupExecutorSender (执行信号发送节点)
- 功能：发送执行信号到指定节点组
- 参数：
  - signal: 执行信号输入

### 3. GroupExecutorRepeater (执行列表重复处理节点)
- 功能：对执行列表进行重复处理
- 参数：
  - signal: 执行信号输入
  - repeat_count: 重复次数 (1-100)
  - group_delay: 组间延迟时间 (0-300秒)

## 使用示例

1. 创建基本执行流程：
   - 使用GroupExecutorSingle设置要执行的节点组
   - 连接到GroupExecutorSender发送执行信号

2. 创建复杂执行流程：
   - 多个GroupExecutorSingle节点串联
   - 使用GroupExecutorRepeater进行重复处理
   - 最后连接到GroupExecutorSender执行

## 注意事项

- 确保group_name正确对应目标节点组名称
- delay_seconds可用于控制执行间隔
- 可以通过signal接口实现复杂的执行链

## 安装

1. 将本扩展复制到ComfyUI的`custom_nodes`目录下
2. 重启ComfyUI


# 如果您受益于本项目，不妨请作者喝杯咖啡，您的支持是我最大的动力

<div style="display: flex; justify-content: left; gap: 20px;">
    <img src="https://raw.githubusercontent.com/LAOGOU-666/Comfyui-Transform/9ac1266765b53fb1d666f9c8a1d61212f2603a92/assets/alipay.jpg" width="300" alt="支付宝收款码">
    <img src="https://raw.githubusercontent.com/LAOGOU-666/Comfyui-Transform/9ac1266765b53fb1d666f9c8a1d61212f2603a92/assets/wechat.jpg" width="300" alt="微信收款码">
</div>

# 商务合作
如果您有定制工作流/节点的需求，或者想要学习插件制作的相关课程，请联系我
wechat:wenrulaogou2033