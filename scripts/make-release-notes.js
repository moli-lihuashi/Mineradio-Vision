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
const OUT = process.argv[2] || path.join(ROOT, 'dist', 'RELEASE-NOTES.md');

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
  lines.push('');
  lines.push('## 本版内容');
  lines.push('');
  lines.push('详见 [CHANGELOG.md](../blob/main/CHANGELOG.md) 的 v' + version + ' 段落。');
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
