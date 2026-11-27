'use strict';

// =============================================================================
// 生成 Release 正文。溯源行与随包的 build/build-provenance.json 用同一份数据，
// 杜绝「正文写一个 sha、包里是另一个」。
//
// 用法：node scripts/make-release-notes.js [输出文件]
//   依赖：先跑 npm run build:win（会写 build-provenance.json 与 dist 资产）
// =============================================================================

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const STAMP = path.join(ROOT, 'build', 'build-provenance.json');
const OUT = process.argv[2] && !process.argv[2].startsWith('--')
  ? process.argv[2]
  : path.join(ROOT, 'dist', 'RELEASE-NOTES.md');

// --supersedes "<旧 Setup SHA256>,<旧 portable SHA256>"：版本号不变、重建替换资产时，
// 把上一次的校验值写进正文，避免「资产被悄悄换掉」无法追溯。
function readSupersedes() {
  const i = process.argv.indexOf('--supersedes');
  if (i < 0 || !process.argv[i + 1]) return null;
  const parts = String(process.argv[i + 1]).split(',').map(s => s.trim()).filter(Boolean);
  return parts.length ? parts : null;
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function main() {
  if (!fs.existsSync(STAMP)) {
    console.error('缺少 build/build-provenance.json，先跑 npm run build:win');
    process.exit(1);
  }
  const b = JSON.parse(fs.readFileSync(STAMP, 'utf8'));
  const version = b.version;
  const assets = [
    { name: 'Mineradio-' + version + '-Setup.exe', file: path.join(ROOT, 'dist', 'Mineradio-' + version + '-Setup.exe') },
    { name: 'Mineradio-Vision-v' + version + '-portable-win-x64.zip', file: path.join(ROOT, 'dist', 'Mineradio-Vision-v' + version + '-portable-win-x64.zip') },
  ];

  const lines = [];
  // 固定第一行：构建自 commit <sha> · <构建时间>
  lines.push('构建自 commit ' + b.commit + ' · ' + b.builtAt);
  lines.push('');
  lines.push('## 校验值（SHA256）');
  lines.push('');
  lines.push('| 资产 | SHA256 |');
  lines.push('| --- | --- |');
  let missing = 0;
  for (const a of assets) {
    if (!fs.existsSync(a.file)) {
      lines.push('| ' + a.name + ' | 缺失 |');
      missing++;
      continue;
    }
    lines.push('| ' + a.name + ' | `' + sha256(a.file) + '` |');
  }
  lines.push('');
  lines.push('安装前请核对：`Get-FileHash .\\' + assets[0].name + ' -Algorithm SHA256`。');
  lines.push('若数值与上表不符，说明文件不是本次构建产物。');

  // 版本号未变但资产被重建时，必须留痕：写明替换了哪些旧校验值。
  const supersedes = readSupersedes();
  if (supersedes) {
    lines.push('');
    lines.push('## 资产替换说明');
    lines.push('');
    // 日期取本次构建时间，不写死：同一个脚本会反复用于「不升版本、就地替换资产」
    lines.push('本版**未升级版本号**，同名资产已被 ' + b.builtAt.slice(0, 10) + ' 的重新构建替换。');
    lines.push('此前的校验值为：');
    lines.push('');
    supersedes.forEach((sha, idx) => {
      lines.push('- ' + (assets[idx] ? assets[idx].name : '资产 ' + (idx + 1)) + '：`' + sha + '`');
    });
    lines.push('');
    lines.push('若你手里的文件是上表中的旧值，说明拿到的是替换前的构建；');
    lines.push('要使用本次内容，请重新下载并核对上方的 SHA256。');
  }
  lines.push('');
  lines.push('## 本版内容');
  lines.push('');
  lines.push('详见 [CHANGELOG.md](https://github.com/moli-lihuashi/Mineradio-Vision/blob/main/CHANGELOG.md) 的 v' + version + ' 段落。');
  lines.push('应用内「播放选项 → 关于本版本」可查看版本、构建 commit 与构建时间。');
  if (!b.treeClean) {
    lines.push('');
    lines.push('> 注意：构建时工作区含未提交改动（treeClean=false），请以本页 commit 为基线核对。');
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, lines.join('\n') + '\n');
  console.log('written', path.relative(ROOT, OUT));
  console.log(lines[0]);
  for (const l of lines.filter((x) => x.startsWith('| Mineradio'))) console.log(' ', l);
  if (missing) {
    console.error('有 ' + missing + ' 个资产缺失，正文已标注「缺失」，请补齐后重跑');
    process.exit(2);
  }
}

main();
