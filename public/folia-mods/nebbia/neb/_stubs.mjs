/* 雾笺移植的桩模块。
 *
 * 这里只剩两类「夜间雨窗」这条路径走不到的分支：
 *   1. 雪窗/结冰（putInkBead）—— glass !== 'rain' 才会调；
 *   2. 人声包络帧率（VOCAL_FPS）—— 只决定大雨点的分桶粒度，给 60 就够。
 * 真的要走雪窗/凝露/水族箱时再补实现，不要在这里塞半成品。
 *
 * lucide 图标字以前也是桩（返回 null），连带把官方的「句尾随机涂鸦」关成了 0。
 * 现在改用内嵌的 Lucide 节点表（_lucideIcons.mjs），doodle 与歌词 emoji 都能画了。
 */
export { resolveLucideIconNode } from './_lucideIcons.mjs';

/** 雪窗里让字底的水珠结冰：雨窗没有这一步。 */
export const putInkBead = () => {};

/** 人声包络的帧率（每秒几个能量桶）。 */
export const VOCAL_FPS = 60;
