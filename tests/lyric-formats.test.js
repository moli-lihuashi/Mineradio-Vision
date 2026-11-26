/* 多格式歌词解析：TTML / WebVTT / LDDC 增强 LRC
 *
 * 这些函数住在合并 script 里（00-lyrics-fetch-parse.js），不能直接 require。
 * 用括号匹配把需要的函数体抽出来，在 vm 沙箱里跑，避免为了测试去模拟整个渲染环境。 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const appRoot = path.resolve(__dirname, '..');
const SRC = fs.readFileSync(path.join(appRoot, 'public/js/modules/06-lyrics/00-lyrics-fetch-parse.js'), 'utf8');

function extractFn(name) {
  const marker = 'function ' + name + '(';
  const start = SRC.indexOf(marker);
  if (start < 0) throw new Error('源码里找不到函数 ' + name);
  let depth = 0;
  for (let i = SRC.indexOf('{', start); i < SRC.length; i++) {
    if (SRC[i] === '{') depth++;
    else if (SRC[i] === '}') {
      depth--;
      if (depth === 0) return SRC.slice(start, i + 1);
    }
  }
  throw new Error('函数体括号不配对: ' + name);
}

const NAMES = [
  'finalizeLyricLineDurations',
  'lyricTimeToSeconds',
  'decodeLyricEntities',
  'stripLyricMarkup',
  'detectLyricFormat',
  'parseTtmlText',
  'parseVttText',
  'parseEnhancedLrcText',
  'reindexWordRanges'
];

function loadParsers() {
  const code = NAMES.map(extractFn).join('\n\n') +
    '\nmodule.exports = { lyricTimeToSeconds, detectLyricFormat, parseTtmlText, parseVttText, parseEnhancedLrcText };';
  const sandbox = { module: { exports: {} }, console };
  vm.runInNewContext(code, sandbox, { timeout: 5000 });
  return sandbox.module.exports;
}

const F = loadParsers();

test('时间值归一：hh:mm:ss.mmm / mm:ss.mmm / 纯秒', () => {
  assert.equal(F.lyricTimeToSeconds('00:01:02.500'), 62.5);
  assert.equal(F.lyricTimeToSeconds('01:02.500'), 62.5);
  assert.equal(F.lyricTimeToSeconds('12.345'), 12.345);
  assert.ok(Number.isNaN(F.lyricTimeToSeconds('')));
});

test('TTML：逐字 span 解析出行与字的时间轴', () => {
  const ttml = `<?xml version="1.0" encoding="UTF-8"?>
<tt xmlns="http://www.w3.org/ns/ttml"><body><div>
  <p begin="00:00:12.000" end="00:00:15.500"><span begin="00:00:12.000" end="00:00:12.600">夜</span><span begin="00:00:12.600" end="00:00:13.200">に</span><span begin="00:00:13.200" end="00:00:14.000">溶</span></p>
  <p begin="00:00:15.500" end="00:00:18.000">只有一行字</p>
</div></body></tt>`;
  const lines = F.parseTtmlText(ttml);
  assert.equal(lines.length, 2);
  assert.equal(lines[0].text, '夜に溶');
  assert.equal(lines[0].t, 12);
  assert.equal(lines[0].duration, 3.5);
  assert.equal(lines[0].words.length, 3);
  assert.equal(lines[0].words[1].text, 'に');
  assert.equal(lines[0].words[1].t, 12.6);
  assert.equal(lines[0].source, 'ttml-word');
  assert.equal(lines[1].text, '只有一行字');
  assert.equal(lines[1].words.length, 0);
  assert.equal(lines[1].source, 'ttml-line');
});

test('TTML：字符区间必须落在 fullText 范围内（逐字动效按 c0/c1 取子串）', () => {
  const ttml = '<tt><body><div><p begin="1" end="3"><span begin="1" end="1.5"> 前 </span><span begin="1.5" end="2"> 后 </span></p></div></body></tt>';
  const lines = F.parseTtmlText(ttml);
  assert.equal(lines.length, 1);
  const line = lines[0];
  assert.equal(line.text, '前 后');
  line.words.forEach((w) => {
    assert.ok(w.c0 >= 0 && w.c0 <= line.text.length, 'c0 越界: ' + w.c0);
    assert.ok(w.c1 >= w.c0 && w.c1 <= line.text.length, 'c1 越界: ' + w.c1);
    assert.equal(line.text.slice(w.c0, w.c1), w.text);
  });
});

test('WebVTT：基本 cue 与实体解码', () => {
  const vtt = `WEBVTT

00:00:03.000 --> 00:00:06.500
第一句 &amp; 第二句

00:00:06.500 --> 00:00:09.000
<b>加粗</b>不算内容
`;
  const lines = F.parseVttText(vtt);
  assert.equal(lines.length, 2);
  assert.equal(lines[0].t, 3);
  assert.equal(lines[0].duration, 3.5);
  assert.equal(lines[0].text, '第一句 & 第二句');
  assert.equal(lines[1].text, '加粗不算内容');
  assert.equal(lines[1].source, 'vtt-line');
});

test('WebVTT：行内时间戳转成逐字', () => {
  const vtt = `WEBVTT

00:00:10.000 --> 00:00:14.000
<00:00:10.000>流 <00:00:11.500>光 <00:00:13.000>逝
`;
  const lines = F.parseVttText(vtt);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].words.length, 3);
  assert.equal(lines[0].words[1].t, 11.5);
  assert.ok(lines[0].words[0].d > 0, '逐字时长要补齐');
  assert.equal(lines[0].source, 'vtt-word');
});

test('LDDC 增强 LRC：角括号逐字，相对值与绝对值都吃得下', () => {
  const lddc = `[00:12.000]<00:12.000>夜<00:12.600>に<00:13.200>溶
[00:15.500]<0,500>相<500,600>对<1100,600>值`;
  const lines = F.parseEnhancedLrcText(lddc);
  assert.equal(lines.length, 2);
  assert.equal(lines[0].text, '夜に溶');
  assert.equal(lines[0].t, 12);
  assert.equal(lines[0].words[1].t, 12.6);
  assert.equal(lines[1].text, '相对值');
  assert.equal(lines[1].words[0].t, 15.5, '小于行起点的数值按毫秒相对偏移');
  assert.equal(lines[1].words[1].t, 16);
});

test('格式探测：四种格式各自命中，普通 LRC 不误判', () => {
  assert.equal(F.detectLyricFormat('WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n词'), 'vtt');
  assert.equal(F.detectLyricFormat('<tt><body><p begin="1">词</p></body></tt>'), 'ttml');
  assert.equal(F.detectLyricFormat('[00:12.00]<00:12.00>夜'), 'lddc');
  assert.equal(F.detectLyricFormat('[00:12.34]普通一行'), 'lrc');
  assert.equal(F.detectLyricFormat('[ti:标题]\n[00:12.34]词'), 'lrc');
  assert.equal(F.detectLyricFormat(''), 'lrc');
  assert.equal(F.detectLyricFormat('第一行没有时间标签'), 'lrc');
});

test('格式探测：翻译歌词（tlyric）这类纯 LRC 不会被当成结构化格式', () => {
  const tlyric = '[00:12.00]translated line\n[00:15.50]another one';
  assert.equal(F.detectLyricFormat(tlyric), 'lrc');
});

test('两种新格式都能产出升序且时长合法的时间轴', () => {
  const ttml = '<tt><body><div><p begin="5" end="8"><span begin="5" end="6">b</span></p><p begin="1" end="4"><span begin="1" end="2">a</span></p></div></body></tt>';
  const lines = F.parseTtmlText(ttml);
  assert.equal(lines[0].text, 'a', '必须按时间升序，不是文档顺序');
  assert.ok(lines.every((l) => l.duration >= 0.45 && l.duration <= 12), '时长要落在 0.45~12s');
  assert.ok(lines.every((l) => Number.isFinite(l.t) && Number.isFinite(l.duration)));
});
