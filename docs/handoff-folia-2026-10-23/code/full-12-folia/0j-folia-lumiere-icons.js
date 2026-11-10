/* Folia 绘光（lumiere）— lucide 图标桥
 *
 * 存在的理由：lumiere 的线稿层（0j-folia-lumiere-lineart.js）要从主题的 lyricsIcons
 * 取 lucide 图标的折线数据（themeIcons.ts / iconPaths.ts）。Folia 那边是
 * `import { resolveLucideIcon, resolveLucideIconNames } from 'utils/lucideIconResolver'`，
 * 直接索引 lucide-react 的全部导出；本项目没有 react / lucide-react，
 * 所以把这两个函数按同一语义桥到这里。
 *
 * 两个函数的契约（与 Folia lucideIconResolver.ts 逐条对齐）：
 *   foliaResolveLucideIcon(name)
 *     - 名字为空 / 不是字符串 → null；未知名 → null（不抛错）。
 *     - 返回值被 iconPaths.ts 的 readIconNode 这样用：
 *         icon.render({}, null) → { props: { iconNode: … } } → iconNodeToPolylines(...)
 *       所以这里返回一个「合成组件」：render 直接给出 IconNode 数据，
 *       不跑 React、不渲染 SVG 再解析 —— 与 Folia 注释里「直接调用即可拿到节点数据」同路。
 *   foliaResolveLucideIcon(names)
 *     - 大小写不敏感地归一到 PascalCase 导出名、去重、丢掉未知名；空 / 非数组 → []。
 *     - 没有回落图标：调用方（buildShotIconArts）自己决定空列表怎么办
 *       （Folia 的语义同样是「不退回默认图标」）。
 *
 * 关于 vendored 图标表：本项目只 vendored 了 Flower 一家的 IconNode。
 * 数据来源是 0g-folia-sonnet-mg.js 里那份**探针实测复刻**的 Flower 子元素 markup
 * （lucide-react@1.48.0 + react@19.3.0 的 renderToStaticMarkup 输出，属性顺序、
 * 空元素序列化、stroke-width 浮点字符串均逐字节一致）——这里是同一份数据的
 * IconNode 形态（[tag, attrs] 条目数组），d / cx / cy / r 与 markup 逐一对应，
 * 没有手绘任何几何。未知名被丢弃（与 Folia 对全量 lucide 表的行为同构，
 * 只是表里只有 Flower）；本项目主题恒不带 lyricsIcons（见 sonnet 模块同款说明），
 * 所以这个限制当前不可观察，且 themeIcons 开着也只是不画图标，不会崩。
 */
(function () {
  'use strict';

  /* Lucide Flower 的 IconNode（子元素条目数组，坐标在 24×24 viewBox 里）。
   * 与 0g-folia-sonnet-mg.js 的 SONNET_LUCIDE_FLOWER_CHILDREN 同一份几何：
   * 那边是 SVG markup，这边是 [tag, attrs] 结构 —— attrs 用字符串，
   * 线稿层的 num() 两种都吃（Number.parseFloat），折线逐点一致。 */
  var LUMIERE_LUCIDE_FLOWER_NODE = [
    ['circle', { cx: '12', cy: '12', r: '3' }],
    ['path', { d: 'M12 16.5A4.5 4.5 0 1 1 7.5 12 4.5 4.5 0 1 1 12 7.5a4.5 4.5 0 1 1 4.5 4.5 4.5 4.5 0 1 1-4.5 4.5' }],
    ['path', { d: 'M12 7.5V9' }],
    ['path', { d: 'M7.5 12H9' }],
    ['path', { d: 'M16.5 12H15' }],
    ['path', { d: 'M12 16.5V15' }],
    ['path', { d: 'm8 8 1.88 1.88' }],
    ['path', { d: 'M14.12 9.88 16 8' }],
    ['path', { d: 'm8 16 1.88-1.88' }],
    ['path', { d: 'M14.12 14.12 16 16' }],
  ];

  /* PascalCase 导出名 → IconNode。lucide 的导出名就是 PascalCase（Flower / Star / …）。 */
  var LUMIERE_LUCIDE_ICONS = {
    Flower: LUMIERE_LUCIDE_FLOWER_NODE,
  };

  /* 大小写不敏感索引（与 Folia 的 iconNamesByLowercase 同一建法：首建后常驻）。 */
  var namesByLowercase = null;
  var iconNamesByLowercase = function () {
    if (namesByLowercase) return namesByLowercase;
    namesByLowercase = new Map();
    Object.keys(LUMIERE_LUCIDE_ICONS).forEach(function (name) {
      namesByLowercase.set(name.toLowerCase(), name);
    });
    return namesByLowercase;
  };

  /* 合成 lucide 组件：只实现 readIconNode 用到的那一个方法。
   * 返回 { props: { iconNode } } —— iconPaths.ts 读的就是这个形状
   * （`element?.props?.iconNode ?? element?.props?.icon?.node`）。 */
  function foliaResolveLucideIcon(name) {
    var trimmed = typeof name === 'string' ? name.trim() : '';
    if (!trimmed) return null;
    var canonical = iconNamesByLowercase().get(trimmed.toLowerCase());
    if (!canonical) return null;
    var node = LUMIERE_LUCIDE_ICONS[canonical];
    return {
      render: function () {
        return { props: { iconNode: node } };
      },
    };
  }

  function foliaResolveLucideIconNames(names) {
    var out = [];
    if (!names || typeof names.length !== 'number') return out;
    var table = iconNamesByLowercase();
    for (var i = 0; i < names.length; i++) {
      var name = typeof names[i] === 'string' ? names[i].trim() : '';
      if (!name) continue;
      var canonical = table.get(name.toLowerCase());
      if (canonical && out.indexOf(canonical) < 0) out.push(canonical);
    }
    return out;
  }

  if (typeof window !== 'undefined') {
    window.foliaResolveLucideIcon = foliaResolveLucideIcon;
    window.foliaResolveLucideIconNames = foliaResolveLucideIconNames;
  }
})();
