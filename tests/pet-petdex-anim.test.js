'use strict';

// 桌宠 Petdex 动作映射表的单测。
//
// 守的是什么：第一版映射表缺 sleep/yawn/stretch 键，这些状态全部**静默回落到 row 0**，
// 结果就是「9 个动作只看到 1 个」。这类漏键不会报错，只会让动作变少，
// 所以这里专门断言「状态表里的每个键都能映射到合法行号」。

const test = require('node:test');
const assert = require('node:assert/strict');
const map = require('../public/js/modules/05-playback/16a-pet-petdex-map');

test('行号与 petdex State Viewer 一致（Row0 Idle … Row8 Review）', () => {
  assert.equal(map.ANIM_TO_ROW.idle, 0);
  assert.equal(map.ANIM_TO_ROW.walkRight, 1);
  assert.equal(map.ANIM_TO_ROW.walkLeft, 2);
  assert.equal(map.ANIM_TO_ROW.waving, 3);
  assert.equal(map.ANIM_TO_ROW.jumping, 4);
  assert.equal(map.ANIM_TO_ROW.failed, 5);
  assert.equal(map.ANIM_TO_ROW.waiting, 6);
  assert.equal(map.ANIM_TO_ROW.running, 7);
  assert.equal(map.ANIM_TO_ROW.review, 8);
});

test('状态映射：每个键都能落到合法行号，不许静默回落', () => {
  Object.keys(map.STATE_TO_ANIM).forEach(state => {
    const anim = map.STATE_TO_ANIM[state];
    if (anim === 'walk') {
      // walk 是唯一按朝向分左右的动作，不直接出现在行号表里，单独校验两侧
      assert.equal(map.rowForAnim(state, 1), map.ANIM_TO_ROW.walkRight, state + ' 向右应走 Run Right');
      assert.equal(map.rowForAnim(state, -1), map.ANIM_TO_ROW.walkLeft, state + ' 向左应走 Run Left');
      return;
    }
    assert.ok(anim in map.ANIM_TO_ROW, state + ' → ' + anim + ' 不在动作表里');
    const row = map.rowForAnim(state, 1);
    assert.ok(Number.isInteger(row) && row >= 0 && row <= 8, state + ' 的行号越界: ' + row);
  });
});

test('走路按朝向分左右（这是唯一要看 dir 的动作）', () => {
  assert.equal(map.rowForAnim('walk', 1), 1, '向右走 → Run Right');
  assert.equal(map.rowForAnim('walk', -1), 2, '向左走 → Run Left');
  // 其他状态不受朝向影响
  assert.equal(map.rowForAnim('sleep', -1), 6);
  assert.equal(map.rowForAnim('idle', -1), 0);
});

test('睡觉不再是 idle（第一版漏键的回归点）', () => {
  assert.equal(map.rowForAnim('sleep', 1), 6, '睡觉应播 Waiting 行，而不是回落 idle');
  assert.notEqual(map.rowForAnim('sleep', 1), map.ANIM_TO_ROW.idle);
});

test('未知状态回落 idle 行，不抛错', () => {
  assert.equal(map.rowForAnim('nonexistent', 1), 0);
  assert.equal(map.rowForAnim('', 1), 0);
  assert.equal(map.rowForAnim(undefined, 1), 0);
});

test('帧间隔按动作区分：idle 慢、跑跳快', () => {
  assert.equal(map.frameMsFor('idle'), 170);
  assert.equal(map.frameMsFor('walk'), 95);
  assert.equal(map.frameMsFor('jump'), 85);
  assert.equal(map.frameMsFor('sleep'), 230, '睡觉对应的 waiting 应该最慢');
  assert.ok(map.frameMsFor('idle') > map.frameMsFor('walk'), 'idle 必须比走路慢');
  assert.ok(map.frameMsFor('walk') > map.frameMsFor('jump'), '走路比跳慢一档');
});

test('未接的动作如实标出：running 仍不接，review 已接成沉浸聆听', () => {
  const used = Object.values(map.STATE_TO_ANIM);
  assert.ok(!used.includes('running'), 'running 是纯位移语义，不该被映射');
  assert.ok(used.includes('review'), 'review 已接成「沉浸聆听」，应被映射');
  // 表里都要保留行号，方便以后调整
  assert.equal(map.ANIM_TO_ROW.running, 7);
  assert.equal(map.ANIM_TO_ROW.review, 8);
  assert.equal(map.rowForAnim('review', 1), 8);
});

test('待机动作池：每个动作都能映射，且覆盖至少 3 个不同行（否则又只剩 idle）', () => {
  assert.ok(Array.isArray(map.IDLE_ACTS) && map.IDLE_ACTS.length >= 3, '待机池至少 3 个动作');
  map.IDLE_ACTS.forEach(act => {
    assert.ok(act in map.STATE_TO_ANIM, act + ' 不在状态映射里，会静默落回 idle');
    assert.ok(map.rowForAnim(act, 1) !== undefined);
  });
  const rows = new Set(map.IDLE_ACTS.map(a => map.rowForAnim(a, 1)));
  assert.ok(rows.size >= 3, '待机动作应覆盖 ≥3 个不同行，实际: ' + [...rows].join(','));
  // 且不能全是 idle 行
  assert.ok(![...rows].every(r => r === map.ANIM_TO_ROW.idle), '待机池不能只落在 idle 行');
});

test('某行没有可见帧时回落 idle，不许播空白（不同提交者的表可能缺行）', () => {
  // hachiware-2 实测 9 行都在
  const full = [6, 8, 8, 4, 5, 8, 6, 6, 6];
  assert.equal(map.pickRow('sleep', 1, 9, full), 6);
  assert.equal(map.pickRow('review', 1, 9, full), 8);

  // Waiting(6) 那行空 → 回 idle 行，不能播全透明帧
  assert.equal(map.pickRow('sleep', 1, 9, [6, 8, 8, 4, 5, 8, 0, 6, 6]), 0);
  // Review(8) 那行空 → 回 idle
  assert.equal(map.pickRow('review', 1, 9, [6, 8, 8, 4, 5, 8, 6, 6, 0]), 0);
  // 行数不足（只有 8 行却要第 9 行）→ 回 idle
  assert.equal(map.pickRow('review', 1, 8, [6, 8, 8, 4, 5, 8, 6, 6]), 0);
  // rowFrames 缺失也要安全
  assert.equal(map.pickRow('jump', 1, 9, null), 0);
});

test('空闲行不改变正常动作：只在目标行真的空时才回落', () => {
  const full = [6, 8, 8, 4, 5, 8, 6, 6, 6];
  assert.equal(map.pickRow('jump', 1, 9, full), 4, 'jumping 行有内容就别回 idle');
  assert.equal(map.pickRow('wave', 1, 9, full), 3);
  assert.equal(map.pickRow('walk', 1, 9, full), 1);
  assert.equal(map.pickRow('walk', -1, 9, full), 2);
});
