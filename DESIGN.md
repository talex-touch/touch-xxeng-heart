---
name: Lexi / 理析
description: 原位理解、自然学习的技术阅读工具
colors:
  primary: "#2f6fed"
  primary-hover: "#255fcf"
  primary-soft: "#eaf1fe"
  canvas: "#f4f6f8"
  surface: "#ffffff"
  surface-subtle: "#f5f7fa"
  ink: "#171a20"
  ink-secondary: "#5a6270"
  ink-muted: "#697384"
  border: "#e7e9ee"
  control-border: "#d4d9e2"
  control-border-hover: "#aeb6c3"
  danger: "#b9382e"
  warning: "#a85d12"
typography:
  headline:
    fontFamily: "Noto Sans SC, PingFang SC, Microsoft YaHei, system-ui, sans-serif"
    fontSize: "22px"
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: "0"
  title:
    fontFamily: "Noto Sans SC, PingFang SC, Microsoft YaHei, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 600
    lineHeight: 1.35
    letterSpacing: "0"
  body:
    fontFamily: "Noto Sans SC, PingFang SC, Microsoft YaHei, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "0"
  label:
    fontFamily: "Noto Sans SC, PingFang SC, Microsoft YaHei, system-ui, sans-serif"
    fontSize: "12.5px"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "0"
  mono:
    fontFamily: "Geist Mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: 1.5
    letterSpacing: "0"
rounded:
  control-sm: "8px"
  control: "9px"
  nav: "10px"
  surface: "12px"
  panel: "16px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "20px"
  xxl: "24px"
  workspace: "32px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.surface}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "8px 13px"
    height: "38px"
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
    textColor: "{colors.surface}"
    rounded: "{rounded.control}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink-secondary}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "8px 13px"
    height: "38px"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "9px 12px"
    height: "40px"
  panel:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.panel}"
    padding: "22px"
  nav-active:
    backgroundColor: "{colors.primary-soft}"
    textColor: "{colors.primary}"
    typography: "{typography.body}"
    rounded: "{rounded.nav}"
    padding: "0 12px"
    height: "42px"
  toggle-on:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.surface}"
    rounded: "{rounded.pill}"
    width: "44px"
    height: "26px"
---

# Design System: Lexi / 理析

## Overview

**Creative North Star: "安静的阅读透镜"**

Lexi 的界面像一层覆盖在原网页上的透明阅读透镜：平时近乎隐形，只有当用户需要理解术语、翻译选区或掌握内容时才显出必要信息。产品 UI 使用近中性浅色表面、清醒的操作蓝和适中的信息密度，保持克制、聪明、可信，不与正文争夺注意力。

设置页、弹窗和侧边栏是安静而精确的工具表面。它们依靠稳定网格、清楚标签、细边框和可预期状态建立信任；网页内卡片则更紧凑、可收起，并明确说明读取范围和缓存状态。系统明确拒绝重营销 SaaS 页面、游戏化学习应用、科幻 AI 助手和重型开发者面板。

**Key Characteristics:**
- 近中性浅色画布，单一清醒蓝只表达操作和状态。
- 平面为主、浮层抬升；常驻表面不用装饰性阴影。
- 中文系统无衬线承担产品 UI，字号紧凑但不牺牲可读性。
- 控件状态完整、反馈直接，支持键盘和 reduced motion。
- 网页内工具可收起、就近出现，不遮蔽主要阅读内容。

## Colors

这是一套“清醒蓝、雾灰、墨黑”的克制产品色系：蓝色是稀缺的交互信号，中性色承担绝大多数阅读和结构工作。

### Primary
- **清醒蓝** (`#2f6fed`)：主操作、选中导航、开关开启态和焦点反馈。它只用于可交互或当前状态，不作为装饰。
- **深清醒蓝** (`#255fcf`)：主操作 hover 状态，保持与默认蓝同一语义。
- **蓝雾底色** (`#eaf1fe`)：当前导航和低强度选中态的背景，不承载大面积品牌氛围。

### Tertiary
- **克制警示红** (`#b9382e`)：错误、删除和破坏性操作。
- **确认警示褐** (`#a85d12`)：需要用户理解风险后继续的警告操作，例如不安全端点确认。

### Neutral
- **雾灰画布** (`#f4f6f8`)：设置工作区的页面背景，提供轻微层次但不染色。
- **清晰白面** (`#ffffff`)：面板、输入框和按钮的标准表面。
- **浅雾分组** (`#f5f7fa`)：设置子分组、hover 和次级状态背景。
- **墨黑正文** (`#171a20`)：标题、正文和关键数值。
- **石墨次文** (`#5a6270`)：说明、次级按钮和非当前导航。
- **可读灰** (`#697384`)：提示、占位符和元信息；不得继续变浅。
- **雾线** (`#e7e9ee`)：面板与页面结构边界。
- **控件线** (`#d4d9e2`)：输入框和可操作控件边界；hover 提升到 `#aeb6c3`。

**The Quiet Signal Rule.** 清醒蓝在任何产品屏幕中都不得成为大面积底色；它的稀缺性就是状态清晰度。

**The Meaningful Color Rule.** 红色只表示错误或破坏，褐色只表示风险确认，领域色只表示术语领域；禁止互相借用。

## Typography

**Display Font:** 产品 UI 不使用独立展示字体；标题沿用中文系统无衬线。
**Body Font:** Noto Sans SC / PingFang SC / Microsoft YaHei / system-ui。
**Label/Mono Font:** Geist Mono 仅用于端点、代码、键值和技术标识。

**Character:** 单一中文系统无衬线让扩展在 Chrome、Firefox 和操作系统界面中保持熟悉、可靠。层级通过字号、字重和留白建立，不依赖紧缩字距或夸张标题。官网可使用 Inter 作为品牌表面正文，并仅在“理析”字标使用 Ma Shan Zheng；这些不是扩展产品 UI 的默认字体。

### Hierarchy
- **Headline**（700，22px，1.25）：设置页页面标题；每个工作区只出现一次。
- **Title**（600，16px，1.35）：面板标题、重要分组和对话标题。
- **Body**（400，14px，1.5）：产品正文和设置说明，长说明限制在 65–72ch。
- **Label**（600，12.5px，1.25）：按钮、字段标签、状态和紧凑命令。
- **Meta**（400–500，11–12px，1.5）：缓存时间、帮助提示和辅助信息，颜色不得低于可读灰。
- **Mono**（500，12px，1.5）：API Endpoint、模型名、Regex、代码和不可本地化的技术标识。

**The Reading Scale Rule.** 产品面板内禁止 hero 级字体和 viewport 流体字号；固定字号保证侧边栏、弹窗和设置页在一致 DPI 下保持稳定密度。

**The Zero Tracking Rule.** 产品 UI 的字距始终为 `0`；仅官网品牌字标允许经过确认的专用字距。

## Elevation

Lexi 采用“平面为主，浮层抬升”的层级哲学。设置页、侧边栏、弹窗内分组和常驻卡片通过画布色、白色表面、浅雾分组和 1px 边框表达层级；阴影只授予真正脱离文档流的对话框、菜单和网页悬浮摘要。

### Shadow Vocabulary
- **对话抬升** (`0 18px 48px rgba(32, 42, 61, 0.20)`)：仅用于原生 dialog 或需要压住工作区的安全确认。
- **网页浮层** (`0 12px 34px rgba(15, 23, 42, 0.16)`)：仅用于注入第三方页面的摘要卡片，确保它从未知背景中分离。
- **控件触点** (`0 1px 3px rgba(23, 26, 32, 0.20)`)：仅用于开关滑块或分段控件的选中项，提示可操作层级。

**The Flat-by-Default Rule.** 常驻表面禁止阴影。若一个设置分组需要阴影才能被理解，说明它的边框、背景层或信息结构设计错误。

## Components

组件整体触感是“安静而精确”：轮廓清楚、密度适中、状态完整，视觉存在感低于用户正在处理的内容。

### Buttons
- **Shape:** 中等按钮使用轻微圆角（9px）和稳定高度（38px）；小按钮使用 8px 圆角和 32px 高度。
- **Primary:** 清醒蓝背景、白色文字、600 字重，内边距 8px 13px。一个局部操作组只允许一个主按钮。
- **Hover / Focus:** hover 切换到深清醒蓝；focus-visible 使用 2px 清醒蓝轮廓并外移 2px；active 仅下移 1px。
- **Secondary / Ghost:** 次按钮是白面、雾线和石墨文字；ghost 只在低风险工具命令中使用透明背景。
- **Danger / Warning:** 破坏性操作使用克制警示红；风险确认使用确认警示褐。两者禁止替代普通主操作。

### Chips
- **Style:** 6–8px 圆角或 pill，仅用于短标签、状态和有限选项；背景使用浅雾或语义浅色。
- **State:** 分段控件外层为浅雾底，选中项为白面并带极轻控件触点；未选中项只改变文字颜色。

### Cards / Containers
- **Corner Style:** 设置面板 16px，内部色块分组 12px，网页内摘要 8–12px。
- **Background:** 一级面板使用清晰白面；内部逻辑分组使用浅雾分组，不再叠加边框和阴影。
- **Shadow Strategy:** 常驻卡片无阴影；只有浮层按 Elevation 规则抬升。
- **Border:** 一级面板使用 1px 雾线。禁止以粗左边框作为装饰性强调。
- **Internal Padding:** 设置面板 22px，内部逻辑分组 15–16px，紧凑网页卡片 12px。

### Inputs / Fields
- **Style:** 白色背景、1px 控件线、9px 圆角、40px 标准高度；标签和 hint 由统一 FormField 管理。
- **Focus:** 边框切换为清醒蓝，并使用 3px、14% 混合透明度的焦点环。
- **Error / Disabled:** 错误边框使用警示红；禁用态使用浅雾背景、可读灰文字和降低但仍清楚的透明度。

### Navigation
- **Style:** 设置页使用 42px 高侧导航，默认石墨文字；hover 使用浅雾分组；当前项使用蓝雾底色、清醒蓝文字和 600 字重。
- **Responsive:** 860px 以下转为横向可滚动 tab；640px 以下收紧工作区边距，不缩放字体。
- **Keyboard:** tab、方向键、Home/End 和 focus-visible 必须完整可用。

### Toggle Switch
- **Shape:** 44×26px pill，20px 白色滑块，3px 内边距。
- **State:** 关闭使用中性灰轨道和内描边；开启只使用清醒蓝轨道。必须同时提供 `role="switch"`、可访问名称和 `aria-checked`。

### Inline Digest Card
- **Character:** 这是“安静的阅读透镜”的签名组件。它固定宽度、可收起、标题紧凑，并把一句话摘要、读取范围、缓存状态和重试操作放在稳定区域。
- **Behavior:** 内容变化和加载状态不得改变外层宽度；动画限制在 180ms 的 opacity/transform，并在 reduced motion 下关闭。

## Do's and Don'ts

### Do:
- **Do** 让清醒蓝只表达操作、选中、焦点和运行状态，控制在屏幕视觉面积的约 10% 以内。
- **Do** 使用 1px 边框、白面和浅雾分组建立常驻层级，把阴影留给真正浮起的界面。
- **Do** 使用共享 BaseButton、FormField、BaseInput、ToggleSwitch、SegmentedControl 和 TabBar，保持状态与尺寸一致。
- **Do** 在窄弹窗、侧边栏和网页卡片中固定控件尺寸，让动态文本换行而不推动布局。
- **Do** 为键盘焦点、错误、禁用、加载和 reduced motion 提供完整状态，并达到 WCAG 2.2 AA。
- **Do** 保持 Crystal Jellyfish 图标的透明背景、完整轮廓和原始比例，不添加底板、描边、发光或品牌色覆盖。

### Don't:
- **Don't** 做重营销 SaaS 页面：产品界面禁止巨大宣传标题、装饰性区块和无处不在的功能推销。
- **Don't** 做游戏化学习应用：禁止连续打卡、积分、彩带和制造学习焦虑的反馈。
- **Don't** 做科幻 AI 助手：禁止紫蓝渐变、发光效果，以及把所有功能包装成聊天机器人。
- **Don't** 做重型开发者面板：禁止终端式黑底、过密指标和只面向资深工程师的压迫感。
- **Don't** 在常驻卡片上叠加阴影、玻璃模糊或卡片内卡片；内部层级只能使用浅雾色块和留白。
- **Don't** 使用超过 1px 的彩色侧边条、渐变文字、装饰性光球或纯氛围背景。
- **Don't** 让提示文字浅于可读灰 `#697384`，也不要只依靠颜色传达错误、选中或掌握状态。
- **Don't** 在产品 UI 使用负字距、viewport 流体字号或 hero 级标题；官网专用品牌排版不得泄漏到扩展工具表面。
