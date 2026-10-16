# 开发与构建指南

本文档面向在本仓库基础上做二次开发与本地编译打包。项目基于上游 [halo-sigs/plugin-text-diagram](https://github.com/halo-sigs/plugin-text-diagram)（GPL-3.0），在其基础上新增**前台点击放大预览（lightbox）**。

使用说明（安装、编辑器用法、插件设置）见 [README.md](../README.md)。

## 功能概览

| 功能 | 来源 |
|---|---|
| 默认编辑器插入 Mermaid / PlantUML 绘图块 | 上游 |
| 前台文章渲染文本绘图 | 上游 |
| 点击绘图块弹出放大预览（lightbox） | 本仓库新增 |

lightbox 行为：初始完整显示（fit）→ 滚轮 / 双指以指针为中心缩放（0.5–8×）→ 按住拖拽平移 → 双击（桌面）或"重置"按钮还原 → Esc / 点击遮罩空白 / 右上角 ✕ 关闭；触屏设备显示底部工具条；底色跟随暗黑模式。可在插件设置中通过 **启用点击放大预览**（`lightbox_enabled`，默认开启）关闭。

## 目录结构

```
src/main/java/run/halo/plugin/textdiagram/
  StarterPlugin.java              插件入口（BasePlugin）
  DefaultPostContentHandler.java  文章渲染扩展点：向前台内容注入脚本
  JSInjector.java                 生成注入内容（mermaid 初始化脚本 + lightbox 资源引用）
  BasicConfig.java                设置项 POJO（对应 settings.yaml 的 basic 组）
src/main/resources/
  plugin.yaml                     插件描述（requires >=2.11.0）
  extensions/settings.yaml        插件设置表单
  extensions/reverseProxy.yaml    静态资源反代规则 /static/**
  static/lightbox.js|css          前台点击放大预览源码（无依赖原生 JS/CSS，随 JAR 分发）
  static/mermaid.min.js           构建时由 rsbuild 复制生成（不入库）
console/                          管理端与编辑器扩展（Vue3 + rsbuild + pnpm）
  src/editor/text-diagram/        默认编辑器 TipTap 扩展、PlantUML URL 编码器
docs/                             开发文档
```

## 环境要求

- JDK 17+（本项目在 Corretto 20 上构建验证）
- Node 18+（本项目在 24 上验证）、pnpm 10.x（在 10.31 上验证）
- Gradle 8.x：优先 wrapper，也可用本地发行版（本项目在 8.11.1 上验证）

## 构建与打包

```powershell
# 完整构建：pnpm install → 前端 rsbuild build → compileJava → jar
.\gradlew.bat build

# 产物
build\libs\plugin-text-diagram-<version>.jar
```

说明：

- `build` 任务前置 `buildFrontend`（`pnpm install` + `pnpm build`）；rsbuild 生产产物写入 `src/main/resources/console/`，并把 `console/node_modules/mermaid/dist/mermaid.min.js` 复制到 `src/main/resources/static/`，两者均在 `.gitignore` 中，不入库
- 前端单独构建：`cd console; pnpm install; pnpm build`
- Java 侧仅编译 4 个类，依赖 `run.halo.app:api`（provided），无其他运行时依赖

### Windows 本机构建的已知问题

**1. Gradle wrapper 下载发行版失败（SSL 证书校验）**

`gradlew.bat` 从 `services.gradle.org` 下载 `gradle-8.0-bin.zip` 时，重定向后的 CDN 证书可能无法通过 JDK 信任链校验（`PKIX path building failed`）。两种处理方式：

- 方案 A（推荐，一劳永逸）：编辑 `gradle/wrapper/gradle-wrapper.properties`，将 `distributionUrl` 换成国内镜像：

  ```properties
  distributionUrl=https\://mirrors.cloud.tencent.com/gradle/gradle-8.0-bin.zip
  # 或 https://mirrors.huaweicloud.com/gradle/gradle-8.0-bin.zip
  ```

- 方案 B（不改项目文件）：使用本机 `~/.gradle/wrapper/dists/` 下已有的 Gradle 发行版直接构建：

  ```powershell
  # hash 目录名因下载 URL 而异，取本地实际存在的
  & "$env:USERPROFILE\.gradle\wrapper\dists\gradle-8.11.1-all\<hash>\gradle-8.11.1\bin\gradle.bat" build
  ```

**2. 上游 `platform 2.11.0-SNAPSHOT` 依赖已失效**

上游模板的 `implementation platform('run.halo.tools.platform:plugin:2.11.0-SNAPSHOT')` 所指的 SNAPSHOT 构件已被从 Maven Central / sonatype 清理，`run.halo.app:api` 在 Central 上最早仅剩 2.20.11。本仓库已改为：

```groovy
implementation platform('run.halo.tools.platform:plugin:2.20.11')
```

本插件仅使用 Halo 2.x 全系稳定 API（`BasePlugin` / `ReactiveSettingFetcher` / `ReactivePostContentHandler`），用 2.20.11 编译的产物仍兼容 `plugin.yaml` 声明的 `requires ">=2.11.0"`。

## 本地开发模式

编辑器扩展（console）热更新：

```powershell
cd console
pnpm dev    # rsbuild watch，产物写入 build/resources/main/console
```

配合 Halo 开发模式运行（`halo.runtime-mode: development`，配置方法见 README「开发环境」一节），Java 类路径指向 `build/classes` 与 `build/resources`。

lightbox（`src/main/resources/static/lightbox.js|css`）是无需构建的源码，修改后重新 `gradlew build`（或单独 `gradlew processResources`）并重启插件即可生效。

## 注入与静态资源机制

- `reverseProxy.yaml` 将 `/static/**` 挂到插件资源目录，实际 URL 前缀为 `/plugins/text-diagram/assets/static/`
- 文章页渲染时 `DefaultPostContentHandler` 在内容前注入：
  1. `mermaid.min.js` + 初始化脚本（按 `dark_class_selector` 检测暗黑模式 → `mermaid.run` 渲染 `mermaid_selector` 匹配的块，同时在 `<html>` 上打 `td-lb-dark` 标记供 lightbox 切换底色）
  2. `lightbox.css` + `lightbox.js`（受 `lightbox_enabled` 开关控制；关闭后前台不注入，绘图块点击无弹窗）
- lightbox 通过 document 级事件委托命中 `text-diagram[data-type]`：mermaid 克隆渲染后的 `<svg>`，PlantUML 克隆 `<img>`（`/svg/` 端点同为矢量）

## 安装与升级

1. Halo 控制台 → 插件 → 安装 / 升级 JAR
2. **升级后前台页面需强制刷新**（`lightbox.js` 的 URL 无版本号，浏览器缓存旧文件会掩盖新版本效果）；移动端浏览器清缓存或用无痕窗口验证
3. 已有安装升级后无需改动配置：`lightbox_enabled` 缺省视为开启
