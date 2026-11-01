# kiko

一款基于 **Vue 3 + Tiptap 3 + Tauri 2** 的桌面日记应用，界面清爽、支持富文本编辑、图片插入、标签分类与全文搜索。数据以纯 JSON 文件保存在本地，无需数据库，方便备份与迁移。

## 功能特性

- **富文本编辑**：基于 Tiptap 3 的 Notion 风格编辑器，支持标题、列表、引用、代码块、表格、任务列表、图片、分割线等
- **图片支持**：粘贴/拖拽/选择插入图片，编辑区可缩放图片、设置对齐与图注；图片按内容哈希去重
- **标签系统**：为日记添加标签，按标签筛选，标签可重命名/删除
- **全文搜索**：按标题与正文搜索，支持防抖
- **日期管理**：内置日历选择器，支持日/月/年/年代视图
- **排序**：按日期 + 创建时间戳升/降序
- **主题**：应用浅色/深色主题；编辑器可独立切换深色模式
- **数据管理**：
  - 导出数据到用户指定位置（系统「另存为」对话框）
  - 从 JSON 文件导入
  - 数据目录可自定义，切换时智能检测目录内容
  - 一键扫描并清理空目录
- **本地优先**：所有数据以 JSON 文件保存在本地，不上传云端

## 技术栈

| 层 | 技术 |
|---|---|
| 前端框架 | Vue 3（`<script setup>`） |
| 构建工具 | Vite 6 |
| 富文本编辑器 | Tiptap 3（`@tiptap/*`） |
| 桌面容器 | Tauri 2（Rust） |
| 后端存储 | Rust `std::fs`（JSON 文件） |
| 系统对话框 | `@tauri-apps/plugin-dialog` |

## 环境要求

- Node.js 18+
- Rust 工具链（stable）+ MSVC 构建工具（Windows）
- Windows 10/11 + WebView2 Runtime（Windows 11 自带）

## 快速开始

```bash
# 安装依赖
npm install

# 启动开发模式（同时启动 Vite + Tauri 窗口）
npm run tauri:dev
```

## 构建发布

```bash
# 打包为 NSIS 安装程序（产物在 src-tauri/target/release/bundle/nsis/）
npm run tauri:build
```

> **构建说明**
> - `build` 脚本会把 `TEMP`/`TMP` 重定向到项目内的 `.tmp` 目录，避免部分环境下 esbuild 无法删除系统临时文件导致构建失败。
> - 首次打包 NSIS 需要从 GitHub 下载 `nsis-3.13` 与 `nsis_tauri_utils`，网络受限时可能超时。可先手动下载并解压到 `%LOCALAPPDATA%\tauri\NSIS` 后再构建。

## 数据存储

### 数据目录

默认在**运行目录**下的 `data/kiko/`，可在「设置 → 数据目录」中通过目录选择器修改。

配置文件：运行目录下的 `kiko.config.json`。

**切换目录时的行为**：

| 目标目录状态 | 行为 |
|---|---|
| 空目录 | 迁移当前数据过去 |
| 已有 kiko 数据 | 弹窗询问：覆盖（用当前数据替换）/ 取消（直接使用目标目录数据） |
| 非 kiko 数据 | 拒绝切换并提示 |

- 选择「覆盖」后，会再询问一次**是否删除原数据目录**
- 目录判定会校验 `meta.json` 内容结构（必须是含 `id`/`date`/`dirName` 字段的数组）与 `diaries/` 目录，避免误判
- 兼容两种布局：所选目录下套 `kiko/`，或所选目录本身就是数据目录

### 目录结构

```
data/kiko/
├── meta.json                 # 元数据索引（id/标题/日期/标签/字数/摘要/时间戳）
├── search.json               # 搜索索引（id → 纯文本）
├── config.json               # 应用配置（主题/用户信息/标签列表）
└── diaries/
    └── {年}/{月}/{日期}/      # 按日记归属日期分层，如 2026/10/2026-10-20
        └── {创建时间戳}/       # 每个日记一个目录
            ├── {创建时间戳}.json    # 正文（Tiptap JSON）
            └── imageFiles_{创建时间戳}/   # 图片（仅在有图片时创建）
                └── {创建时间戳}_{哈希}.{ext}
```

### 设计要点

- **元数据与正文分离**：启动时只加载 `meta.json`（轻量），正文按需读取，支持懒加载
- **图片按内容哈希去重**：相同图片只保存一份，正文中多处引用同一文件
- **编辑不改变创建时间戳**：日记创建后目录名固定，修改日期会整体迁移目录
- **无图片不建目录**：正文没有图片时不会生成 `imageFiles_*` 目录
- **可清理空目录**：删除日记后残留的空文件夹可在设置中一键扫描清理

## 项目结构

```
├── src/                      # 前端源码
│   ├── main.js               # 入口
│   ├── App.vue               # 根组件
│   ├── store.js              # 全局状态（Vue reactive）
│   ├── api.js                # Tauri 命令封装
│   ├── data/seed.js          # 初始示例数据
│   ├── lib/                  # 编辑器扩展（image/slash/indent/blockHandle…）
│   ├── components/           # 组件（编辑器、侧栏、弹窗等）
│   ├── views/                # 页面（首页/日记/编辑/标签/设置）
│   ├── utils/                # 工具函数与图标
│   └── styles/               # 样式（main.css / tiptap.css）
├── src-tauri/                # 桌面端（Rust）
│   ├── src/db.rs             # 数据层与全部 Tauri 命令
│   ├── src/lib.rs            # 应用入口与命令注册
│   ├── tauri.conf.json       # Tauri 配置
│   └── capabilities/         # 权限声明
└── package.json
```

## Tauri 命令

**日记数据**

| 命令 | 说明 |
|---|---|
| `load_meta` | 加载全部日记元数据 |
| `get_body` | 按 id 读取正文 |
| `save_diary` | 保存日记（返回 id + 创建时间戳） |
| `delete_diary` | 删除日记及其目录 |
| `search_diaries` | 全文搜索（标题 + 正文） |

**配置与数据目录**

| 命令 | 说明 |
|---|---|
| `load_config` / `save_config` | 读写应用配置 |
| `get_data_dir` | 获取当前数据目录 |
| `inspect_data_dir` | 检查目录状态：空 / kiko 数据 / 其他 |
| `set_data_dir` | 切换数据目录（migrate / overwrite / keep） |
| `remove_data_dir` | 删除原数据目录（确认清理时） |
| `list_empty_dirs` | 列出空目录 |
| `remove_empty_dirs` | 清理空目录 |

**文件**

| 命令 | 说明 |
|---|---|
| `write_text_file` | 把文本写入指定路径（导出数据用） |

## 注意事项

- **安全软件拦截**：若 Windows 上杀毒软件（如 360 安全卫士）拦截文件写入或内存映射，可能导致启动或保存失败。建议将程序目录加入信任区；本项目已从 redb 迁移到 JSON 文件存储以规避该问题。
- **数据备份**：直接复制 `data/kiko/` 目录即可完整备份；也可用「设置 → 导出数据」导出 JSON 到指定位置。

## 许可

MIT
