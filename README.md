# tauri-packer-cli

一键将任意前端 `dist` 目录打包为 Tauri Windows x64 可执行文件 (`.exe`)。

## 前置依赖

- **Node.js** >= 20.0.0
- **Rust** (通过 [rustup](https://rustup.rs) 安装，需要 `stable-x86_64-pc-windows-msvc` 工具链)

## 快速开始

```bash
# 直接使用 npx（无需安装）
npx tauri-packer-cli --dist ./dist

# 或全局安装后使用
npm install -g tauri-packer-cli
tauri-pack --dist ./dist --name "MyApp"
```

## 参数

| 参数 | 简写 | 必需 | 说明 | 默认值 |
|------|------|------|------|--------|
| `--dist` | `-d` | ✅ | dist 目录路径（需包含 `index.html`） | - |
| `--output` | `-o` | | 输出 `.exe` 路径 | `./output/<name>.exe` |
| `--name` | `-n` | | 应用名称 | 自动从 package.json 推断 |
| `--title` | `-t` | | 窗口标题 | 同应用名称 |
| `--version` | `-v` | | 版本号 | `0.1.0` |
| `--identifier` | `-i` | | 应用标识符，如 `com.example.app` | `com.<name>.app` |
| `--width` | `-w` | | 窗口宽度 (px) | `1280` |
| `--height` | `-H` | | 窗口高度 (px) | `800` |
| `--icon` | | | 自定义图标 png，建议 ≥1024×1024 | 内置默认图标 |
| `--keep-temp` | | | 保留临时构建目录（调试用） | `false` |
| `--help` | `-h` | | 显示帮助信息 | - |

## 示例

```bash
# 基本用法
npx tauri-packer-cli -d ./dist -n "MyApp" -o ./MyApp.exe

# 完整参数
npx tauri-packer-cli \
  --dist ./dist \
  --name "MyApp" \
  --title "我的应用" \
  --version "1.0.0" \
  --identifier "com.example.myapp" \
  --width 1280 \
  --height 800 \
  --icon ./icon.png \
  --output ./MyApp.exe

# 小窗口工具
npx tauri-packer-cli -d ./dist -n "小工具" -t "实用工具" -w 400 -H 300

# 调试模式 — 保留构建目录查看详情
npx tauri-packer-cli -d ./dist --keep-temp
```

## 原理

1. 解析 CLI 参数，验证 dist 目录存在且包含 `index.html`
2. 创建临时构建目录，复制 Tauri 模板 (`src-tauri/`) 和 dist 文件
3. 将参数值写入模板占位符（应用名、版本、窗口大小等）
4. 调用 `npx @tauri-apps/cli build` 编译 Rust 代码并嵌入前端资源
5. 将生成的 exe 复制到指定输出路径，清理临时文件

## 输出

除了 `.exe` 文件，Tauri 构建过程还会在临时目录生成：
- **MSI 安装包** — `bundle/msi/`
- **NSIS 安装包** — `bundle/nsis/`

如需保留这些文件，使用 `--keep-temp` 参数。

## 许可证

MIT
