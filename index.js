#!/usr/bin/env node

/**
 * tauri-packer-cli
 * 一键将任意 dist 目录打包为 Tauri Windows x64 exe
 */

const { parseArgs } = require('node:util');
const fs = require('node:fs');
const fsPromises = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { execSync, spawn } = require('node:child_process');

// ── 参数定义 ──────────────────────────────────────────────
const OPTIONS = {
  dist: {
    type: 'string',
    short: 'd',
    description: 'dist 目录路径 (必需)',
  },
  output: {
    type: 'string',
    short: 'o',
    description: '输出 exe 的路径 (默认: ./output/app.exe)',
  },
  name: {
    type: 'string',
    short: 'n',
    description: '应用名称 (默认: 根据 package.json 或目录名推断)',
  },
  title: {
    type: 'string',
    short: 't',
    description: '窗口标题 (默认同应用名称)',
  },
  version: {
    type: 'string',
    short: 'v',
    description: '应用版本 (默认: 0.1.0)',
  },
  identifier: {
    type: 'string',
    short: 'i',
    description: '应用标识符，如 com.example.app (默认: com.tauri.app)',
  },
  width: {
    type: 'string',
    short: 'w',
    description: '窗口宽度 (默认: 1280)',
  },
  height: {
    type: 'string',
    short: 'H',
    description: '窗口高度 (默认: 800)',
  },
  icon: {
    type: 'string',
    description: '自定义图标 .png 路径 (至少 1024x1024，会自动生成各尺寸)',
  },
  'keep-temp': {
    type: 'boolean',
    description: '保留临时构建目录 (用于调试)',
  },
  help: {
    type: 'boolean',
    short: 'h',
    description: '显示帮助信息',
  },
};

// ── 工具函数 ──────────────────────────────────────────────

function showHelp() {
  console.log(`
  ╔══════════════════════════════════════════════════════╗
  ║           Tauri Packer CLI - 一键打包工具            ║
  ╚══════════════════════════════════════════════════════╝

  用法: npx tauri-packer-cli --dist <path> [选项]

  必需:
    -d, --dist <path>        dist 目录路径 (需包含 index.html)

  可选:
    -o, --output <path>      输出 exe 路径 (默认: ./output/<name>.exe)
    -n, --name <name>        应用名称
    -t, --title <title>      窗口标题 (默认同应用名称)
    -v, --version <ver>      版本号 (默认: 0.1.0)
    -i, --identifier <id>    应用标识符 (默认: com.tauri.app)
    -w, --width <px>         窗口宽度 (默认: 1280)
    -H, --height <px>        窗口高度 (默认: 800)
        --icon <path>        自定义图标 png (≥1024x1024)
        --keep-temp          保留临时构建目录
    -h, --help               显示此帮助

  示例:
    npx tauri-packer-cli --dist ./dist --name "MyApp" --output ./MyApp.exe
    npx tauri-packer-cli -d ./build -n "工具" -v "1.0.0" -w 1024 -H 768
`);
}

function fail(msg) {
  console.error(`❌ 错误: ${msg}`);
  process.exit(1);
}

function info(msg) {
  console.log(`  📦 ${msg}`);
}

function success(msg) {
  console.log(`  ✅ ${msg}`);
}

function warn(msg) {
  console.log(`  ⚠️  ${msg}`);
}

// 递归复制目录
function copyDirSync(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

// 替换文件中的占位符
function replacePlaceholders(filePath, vars) {
  let content = fs.readFileSync(filePath, 'utf-8');
  for (const [key, value] of Object.entries(vars)) {
    content = content.replaceAll(`{{${key}}}`, value);
  }

  // 检查是否有未替换的占位符
  const remaining = content.match(/\{\{(\w+)\}\}/g);
  if (remaining) {
    warn(`文件 ${path.basename(filePath)} 中有未替换的占位符: ${remaining.join(', ')}`);
  }

  fs.writeFileSync(filePath, content, 'utf-8');
}

// 推断 cargo 包名 (小写字母+下划线)
function toCargoName(name) {
  return name.toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/^[^a-z]/, 'a');
}

// 生成图标 (通过 tauri icon 命令)
function generateIcons(iconPath, projectDir, tauriCliPath) {
  info('正在生成图标...');
  try {
    execSync(`npx @tauri-apps/cli icon "${iconPath}"`, {
      cwd: projectDir,
      stdio: 'pipe',
      timeout: 60000,
    });
    success('图标生成完成');
    return true;
  } catch (e) {
    warn(`图标生成失败: ${e.message}`);
    warn('将使用默认图标');
    return false;
  }
}

// ── 主流程 ────────────────────────────────────────────────

async function main() {
  // 解析参数
  let args;
  try {
    args = parseArgs({ options: OPTIONS, allowPositionals: false });
  } catch (e) {
    fail(e.message);
  }

  if (args.values.help) {
    showHelp();
    process.exit(0);
  }

  // 验证必需参数
  if (!args.values.dist) {
    showHelp();
    fail('请指定 --dist <path> (dist 目录路径)');
  }

  // ── 解析路径 ──
  const distDir = path.resolve(args.values.dist);
  if (!fs.existsSync(distDir)) {
    fail(`dist 目录不存在: ${distDir}`);
  }
  if (!fs.existsSync(path.join(distDir, 'index.html'))) {
    fail(`dist 目录中缺少 index.html: ${distDir}`);
  }

  // 尝试从 dist 目录的 package.json 读取信息
  let pkgInfo = {};
  const pkgPath = path.join(distDir, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      pkgInfo = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    } catch { /* ignore */ }
  }
  // 也尝试从父目录 (项目根目录) 读取
  const parentPkgPath = path.join(distDir, '..', 'package.json');
  if (!pkgInfo.name && fs.existsSync(parentPkgPath)) {
    try {
      const parentPkg = JSON.parse(fs.readFileSync(parentPkgPath, 'utf-8'));
      pkgInfo = { ...parentPkg, ...pkgInfo };
    } catch { /* ignore */ }
  }

  // ── 确定参数值 ──
  const appName = args.values.name || pkgInfo.name || path.basename(path.resolve(distDir, '..'));
  const cargoName = toCargoName(appName);
  const appVersion = args.values.version || pkgInfo.version || '0.1.0';
  const windowTitle = args.values.title || appName;
  const identifier = args.values.identifier || `com.${cargoName}.app`;
  const windowWidth = parseInt(args.values.width || '1280', 10);
  const windowHeight = parseInt(args.values.height || '800', 10);
  const outputPath = path.resolve(args.values.output || `./output/${appName}.exe`);
  const keepTemp = args.values['keep-temp'] || false;
  const customIcon = args.values.icon ? path.resolve(args.values.icon) : null;

  console.log('');
  console.log('  ╔══════════════════════════════════════════╗');
  console.log('  ║     Tauri Packer CLI - 开始打包          ║');
  console.log('  ╚══════════════════════════════════════════╝');
  console.log('');
  info(`应用名称:   ${appName}`);
  info(`窗口标题:   ${windowTitle}`);
  info(`版本:       ${appVersion}`);
  info(`标识符:     ${identifier}`);
  info(`窗口大小:   ${windowWidth}x${windowHeight}`);
  info(`dist 目录:  ${distDir}`);
  info(`输出路径:   ${outputPath}`);
  if (customIcon) info(`自定义图标: ${customIcon}`);
  console.log('');

  // ── 检查依赖 ──
  info('检查构建环境...');
  try {
    execSync('cargo --version', { stdio: 'pipe' });
    success('cargo 已就绪');
  } catch {
    fail('未找到 cargo，请先安装 Rust: https://rustup.rs');
  }

  // 检查 tauri CLI
  try {
    execSync('npx @tauri-apps/cli --version', { stdio: 'pipe' });
    success('tauri CLI 已就绪');
  } catch {
    warn('tauri CLI 未找到，将尝试自动安装...');
  }

  // ── 创建临时构建目录 ──
  const templateDir = path.resolve(__dirname, 'templates');
  if (!fs.existsSync(templateDir)) {
    fail(`模板目录不存在: ${templateDir}`);
  }

  const buildDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tauri-pack-'));
  info(`构建目录: ${buildDir}`);

  try {
    // 复制模板 src-tauri
    info('准备项目文件...');
    copyDirSync(templateDir, path.join(buildDir, 'src-tauri'));

    // 复制 dist
    info('复制 dist 文件...');
    copyDirSync(distDir, path.join(buildDir, 'dist'));

    // 创建最小 package.json (pnpm tauri 需要)
    const buildPkg = {
      name: cargoName,
      version: appVersion,
      private: true,
      scripts: {
        tauri: 'tauri',
      },
    };
    fs.writeFileSync(
      path.join(buildDir, 'package.json'),
      JSON.stringify(buildPkg, null, 2),
      'utf-8',
    );

    // ── 替换占位符 ──
    info('写入配置...');
    const vars = {
      APP_NAME: appName,
      APP_VERSION: appVersion,
      APP_IDENTIFIER: identifier,
      WINDOW_TITLE: windowTitle,
      WINDOW_WIDTH: String(windowWidth),
      WINDOW_HEIGHT: String(windowHeight),
      APP_DESCRIPTION: pkgInfo.description || appName,
      APP_AUTHOR: (pkgInfo.author && pkgInfo.author.name) || pkgInfo.author || '',
      CARGO_NAME: cargoName,
    };

    replacePlaceholders(path.join(buildDir, 'src-tauri', 'tauri.conf.json'), vars);
    replacePlaceholders(path.join(buildDir, 'src-tauri', 'Cargo.toml'), vars);

    // ── 处理自定义图标 ──
    if (customIcon) {
      if (!fs.existsSync(customIcon)) {
        warn(`图标文件不存在: ${customIcon}，使用默认图标`);
      } else {
        // 为 tauri icon 命令准备: 图标需要放到项目目录中
        const iconTarget = path.join(buildDir, 'app-icon.png');
        fs.copyFileSync(customIcon, iconTarget);
        // 使用 tauri icon 生成所需尺寸
        try {
          info('生成图标...');
          execSync(`npx @tauri-apps/cli icon "${iconTarget}"`, {
            cwd: buildDir,
            stdio: 'pipe',
            timeout: 60000,
          });
          // tauri icon 生成到了 src-tauri/icons/，但我们需要确认
          success('图标生成完成');
        } catch (e) {
          warn(`图标自动生成失败: ${e.message}`);
          warn('将使用默认图标，请手动准备图标文件');
        }
      }
    }

    // ── 构建 ──
    info('开始 Tauri 构建 (这可能需要几分钟)...');
    console.log('');
    console.log('  ─── 构建输出 ───');
    console.log('');

    const tauriBuild = spawn('npx', ['@tauri-apps/cli', 'build'], {
      cwd: buildDir,
      stdio: 'inherit',
      shell: true,
      // 不设 timeout，构建可能很久
    });

    await new Promise((resolve, reject) => {
      tauriBuild.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`构建失败，退出码: ${code}`));
      });
      tauriBuild.on('error', reject);
    });

    console.log('');
    success('构建完成!');

    // ── 查找生成的 exe ──
    const releaseDir = path.join(buildDir, 'src-tauri', 'target', 'release');
    const exeName = `${cargoName}.exe`;
    const builtExe = path.join(releaseDir, exeName);

    if (!fs.existsSync(builtExe)) {
      // 尝试不带 .exe 后缀或其他名称
      const files = fs.readdirSync(releaseDir);
      const exeFiles = files.filter(f => f.endsWith('.exe') && !f.includes('msi'));
      if (exeFiles.length === 0) {
        fail(`未找到生成的 exe，请检查构建输出。查找路径: ${releaseDir}`);
      }
      const foundExe = path.join(releaseDir, exeFiles[0]);
      info(`找到 exe: ${foundExe}`);
      // 复制输出
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.copyFileSync(foundExe, outputPath);
    } else {
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.copyFileSync(builtExe, outputPath);
    }

    success(`输出: ${outputPath}`);

    // 显示文件大小
    const stat = fs.statSync(outputPath);
    const sizeMB = (stat.size / (1024 * 1024)).toFixed(1);
    info(`文件大小: ${sizeMB} MB`);

    console.log('');
    console.log('  ╔══════════════════════════════════════════╗');
    console.log('  ║         打包完成! 🎉                     ║');
    console.log('  ╚══════════════════════════════════════════╝');
    console.log('');
  } finally {
    // ── 清理 ──
    if (keepTemp) {
      info(`临时目录已保留: ${buildDir}`);
    } else {
      info('清理临时文件...');
      try {
        fs.rmSync(buildDir, { recursive: true, force: true });
        success('清理完成');
      } catch (e) {
        warn(`无法清理临时目录: ${buildDir}`);
        warn(e.message);
      }
    }
  }
}

main().catch((e) => {
  console.error(`\n❌ 未捕获的错误: ${e.message}`);
  if (process.env.DEBUG) console.error(e.stack);
  process.exit(1);
});
