(function (global) {
  'use strict';

  // ====================================================================
  //  桌宠动作映射表（纯数据 + 纯函数，无 DOM 依赖，可在 node 里单测）
  //
  //  petdex 精灵表每行一个动作。行序与行帧数来自站点 State Viewer（2026-11-13 截图取证），
  //  并与 Electron 探针实测的 rowFrames 完全吻合：
  //    Row0 Idle·6 / Row1 Run Right·8 / Row2 Run Left·8 / Row3 Waving·4 /
  //    Row4 Jumping·5 / Row5 Failed·8 / Row6 Waiting·6 / Row7 Running·6 / Row8 Review·6
  //  （v2 网格是 8×11，前 9 行同序，末尾多 2 个未公开动作）
  //
  //  为什么要这张表：第一版只映射了 idle 与 walk，其余状态（sleep/yawn/stretch）
  //  都因为没有对应键而**落回 row 0**，观感就是「只有一个动作」。
  // ====================================================================

  var ANIM_TO_ROW = {
    idle: 0,
    walkRight: 1,
    walkLeft: 2,
    waving: 3,
    jumping: 4,
    failed: 5,
    waiting: 6,
    running: 7,
    review: 8
  };

  // 本项目桌宠状态 → petdex 动作。
  // review（审视/专注）接成「沉浸聆听」：在陪着听歌的语境里说得通，也正好补足白天
  // 能看到的待机变化（第一版只有 yawn/stretch，白天看不到 sleep，观感就是没动作）。
  // running（原地跑）仍不接：纯位移语义，和「安静陪你」冲突。
  var STATE_TO_ANIM = {
    idle: 'idle',
    walk: 'walk',       // 再按朝向分 walkLeft / walkRight
    sleep: 'waiting',   // 打盹最接近「安静待机」
    yawn: 'waiting',
    stretch: 'waving',  // 伸懒腰 ≈ 挥手伸展
    wave: 'waving',
    review: 'review',   // 沉浸聆听
    jump: 'jumping'
  };

  // 每个动作的帧间隔（毫秒）。idle 要慢才像呼吸；跑和跳要快才有速度感。
  var ANIM_FRAME_MS = {
    idle: 170,
    walk: 95,
    waving: 150,
    jumping: 85,
    waiting: 230,
    failed: 200,
    running: 95,
    review: 170
  };

  var DEFAULT_FRAME_MS = 170;

  // 待机能轮换的原地动作。白天看不到 sleep 时，靠近这些提供变化；
  // 每个都必须在 STATE_TO_ANIM 里有映射，否则会静默落回 idle（有单测盯这条）。
  var IDLE_ACTS = ['yawn', 'stretch', 'wave', 'review'];

  /**
   * 桌宠状态 → 精灵表行号。
   * @param {string} state  idel / walk / sleep / yawn / stretch / wave / jump
   * @param {number} dir    朝向，<0 为左
   * @returns {number} 行号（未知状态回落 idle 行）
   */
  function rowForAnim(state, dir) {
    var anim = STATE_TO_ANIM[state] || 'idle';
    if (anim === 'walk') return dir < 0 ? ANIM_TO_ROW.walkLeft : ANIM_TO_ROW.walkRight;
    var row = ANIM_TO_ROW[anim];
    return typeof row === 'number' ? row : ANIM_TO_ROW.idle;
  }

  /** 该状态的帧间隔（ms）。 */
  function frameMsFor(state) {
    var anim = STATE_TO_ANIM[state] || 'idle';
    return ANIM_FRAME_MS[anim] || DEFAULT_FRAME_MS;
  }

  /**
   * 选出实际要播的行：越界或该行没有任何可见帧时回落到 idle 行。
   *
   * 为什么需要：不同提交者的精灵表可能缺行（比如没画 failed 那一排）。
   * 第一版把空行的帧数当成 cols（8），于是播的是 8 帧全透明 —— 宠物看起来直接消失。
   *
   * @param {string} state      桌宠状态
   * @param {number} dir        朝向
   * @param {number} rows       这张表实际有几行
   * @param {number[]} rowFrames 每行实测帧数（0 表示该行没有可见内容）
   */
  function pickRow(state, dir, rows, rowFrames) {
    var total = Math.max(1, Number(rows) || 1);
    var row = rowForAnim(state, dir);
    if (row >= total) row = 0;
    if (!rowFrames || !rowFrames[row]) row = 0;
    return row;
  }

  var api = {
    ANIM_TO_ROW: ANIM_TO_ROW,
    STATE_TO_ANIM: STATE_TO_ANIM,
    ANIM_FRAME_MS: ANIM_FRAME_MS,
    IDLE_ACTS: IDLE_ACTS,
    rowForAnim: rowForAnim,
    frameMsFor: frameMsFor,
    pickRow: pickRow
  };

  global.HomePetPetdexMap = api;
  // node 下（单测）也要能拿到
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
