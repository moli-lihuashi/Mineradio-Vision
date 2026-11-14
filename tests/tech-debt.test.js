'use strict';

// 未收口技术债的强制检查。
//
// 为什么需要它：技术债只写在 CHANGELOG 里就会变成「永久」——没人会在读到它时正好有空。
// 这里把它变成会红的东西：
//   · open 项必须有复核期限，过期直接判红（不想处理就重定日期并写清原因）
//   · open 项必须有 why + nextStep（「以后再说」不算下一步）
//   · closed 项的证据文件必须存在且仍含指定标记（防止收口后被人改回去）
//   · accepted 项必须写明谁裁定的、为什么接受
//   · CHANGELOG 的「仍未收口」小节不许再列已收口项（防止文档漂移）

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { TECH_DEBT, CLOSED_KEYWORDS } = require('./tech-debt-registry');

const ROOT = path.resolve(__dirname, '..');
const CHANGELOG = path.join(ROOT, 'CHANGELOG.md');

function read(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }
function today() { return new Date().toISOString().slice(0, 10); }

test('登记表：id 唯一、状态合法、必要字段齐全', () => {
  const ids = new Set();
  TECH_DEBT.forEach(item => {
    assert.ok(item.id && /^[a-z0-9-]+$/.test(item.id), 'id 必须是小写连字符：' + item.id);
    assert.ok(!ids.has(item.id), 'id 重复：' + item.id);
    ids.add(item.id);
    assert.ok(item.title && item.title.length > 4, item.id + ' 缺 title');
    assert.ok(item.where, item.id + ' 缺 where');
    assert.ok(['open', 'closed', 'accepted'].includes(item.status), item.id + ' 状态非法：' + item.status);
  });
});

test('open 项：必须有复核期限、未过期，且有 why 与可执行的 nextStep', () => {
  const open = TECH_DEBT.filter(d => d.status === 'open');
  const now = today();
  open.forEach(item => {
    assert.match(String(item.reviewBy || ''), /^\d{4}-\d{2}-\d{2}$/, item.id + ' 缺 reviewBy（YYYY-MM-DD）');
    assert.ok(item.reviewBy >= now,
      item.id + ' 已过复核期限 ' + item.reviewBy + '（今天 ' + now + '）。' +
      '要么现在处理，要么重新定日期并在 why 里写清为什么还不能动。');
    assert.ok(item.why && item.why.length > 20, item.id + ' 的 why 太短，说明不清为什么要留');
    assert.ok(item.nextStep && item.nextStep.length > 20, item.id + ' 缺可执行的 nextStep');
    assert.ok(!/以后再说|后续再|暂不处理|回头再/.test(item.nextStep), item.id + ' 的 nextStep 不是可执行动作');
  });
});

test('closed 项：必须有收口日期，且证据文件仍存在并包含指定标记', () => {
  const closed = TECH_DEBT.filter(d => d.status === 'closed');
  assert.ok(closed.length > 0, '登记表至少应记录已收口项');
  closed.forEach(item => {
    assert.match(String(item.closedAt || ''), /^\d{4}-\d{2}-\d{2}$/, item.id + ' 缺 closedAt');
    assert.ok(Array.isArray(item.evidence) && item.evidence.length > 0, item.id + ' 缺 evidence');
    item.evidence.forEach(ev => {
      assert.ok(fs.existsSync(path.join(ROOT, ev.file)), item.id + ' 的证据文件不存在：' + ev.file);
      if (ev.mustContain) {
        assert.ok(read(ev.file).includes(ev.mustContain),
          item.id + ' 的证据 ' + ev.file + ' 不再包含 "' + ev.mustContain + '" —— 可能被改回去了');
      }
    });
    assert.ok(item.note && item.note.length > 10, item.id + ' 缺收口说明');
  });
});

test('accepted 项：必须写明谁裁定、为什么接受（不能拿它当「拖欠」的挡箭牌）', () => {
  TECH_DEBT.filter(d => d.status === 'accepted').forEach(item => {
    assert.ok(item.acceptedBy && item.acceptedBy.length > 4, item.id + ' 缺 acceptedBy');
    assert.ok(item.reason && item.reason.length > 10, item.id + ' 缺 reason');
  });
});

test('文档漂移：CHANGELOG 的「仍未收口」小节不许再列已收口项', () => {
  const text = fs.readFileSync(CHANGELOG, 'utf8');
  const start = text.indexOf('### 仍未收口');
  assert.ok(start > 0, 'CHANGELOG 里找不到「仍未收口」小节');
  const next = text.indexOf('\n## ', start);
  const section = text.slice(start, next > 0 ? next : start + 4000);
  CLOSED_KEYWORDS.forEach(kw => {
    assert.ok(!section.includes(kw),
      '「仍未收口」里还在提 "' + kw + '"，但它已经收口了（见 tech-debt-registry.js 的 closed 项）');
  });
});

test('报告：打印当前全部未收口项（跑一次就能看到还剩什么）', () => {
  const open = TECH_DEBT.filter(d => d.status === 'open');
  const closed = TECH_DEBT.filter(d => d.status === 'closed');
  const accepted = TECH_DEBT.filter(d => d.status === 'accepted');
  const lines = [
    '',
    '未收口技术债：open ' + open.length + ' · closed ' + closed.length + ' · accepted ' + accepted.length,
  ];
  open.sort((a, b) => String(a.reviewBy).localeCompare(String(b.reviewBy))).forEach(item => {
    lines.push('  [ ] ' + item.id + '  复核期限 ' + item.reviewBy + '  ' + item.title);
    lines.push('      ' + item.nextStep);
  });
  closed.forEach(item => lines.push('  [x] ' + item.id + '  ' + item.closedAt + '  ' + item.title));
  accepted.forEach(item => lines.push('  [=] ' + item.id + '  ' + item.acceptedBy));
  lines.push('');
  console.log(lines.join('\n'));
  assert.ok(open.length + closed.length + accepted.length === TECH_DEBT.length);
});
