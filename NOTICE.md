# NOTICE

Mineradio 使用了以下第三方项目或服务。各项目版权归其原作者所有。

## Third-party Libraries

- Electron
- Three.js
- GSAP
- music-tempo
- NeteaseCloudMusicApi
- mpg123-decoder

## Ported Visualizers And Mods

以下内容移植自 [Folia](https://github.com/chthollyphile/folia-major)（作者 chthollyphile 等，AGPL-3.0）。
移植部分保留原项目的版权与许可证声明；本项目整体以 GPL-3.0 发布，源码随仓库完整提供。

- **隐喻（metaphor）歌词样式**：移植自 Folia 0.8.x 的 `src/components/visualizer/metaphor/`。
  代码位于 `public/js/modules/12-folia/0m-folia-*.js`，文件头记录了来源路径与逐项差异
  （渲染公式未改，差异仅在宿主能力：不用 MRT、不另起 rAF、不做 beatFx 拍对齐）。
- **歌词样式模组**：`public/folia-mods/` 下的 hanabi、machi、huajian、miside-drop、nebbia、
  visualizer52hz 等，各自在 `mod.json` 标注原作者与来源，部分附带 `LICENSE`。
- **听歌档案（listening-archive）面板模组**：`public/folia-panel-mods/`，附带 `LICENSE` 与
  `THIRD_PARTY_NOTICES.txt`。

## Third-party Services

Mineradio 可能与网易云音乐、QQ 音乐等第三方音乐服务进行用户自有账号相关的本地客户端交互。

Mineradio 不是任何音乐平台的官方客户端，也不隶属于网易云音乐、QQ 音乐或腾讯音乐娱乐集团。请用户自行遵守对应平台的服务协议、版权规则和会员权益规则。

## Original Design

Mineradio 名称、MR Logo、界面视觉设计、启动动画方向、粒子视觉体验和电影镜头系统的产品表达属于作者原创设计。

emily 作为 Mineradio 早期视觉底层想法与 `emily` 视觉预设改进方向的共创者和灵感来源之一，特此致谢。

感谢小天才e宝、应春日、锋将军、軌跡、林中、骊、风痕、花椰菜🥦在早期体验、测试反馈和发布准备中的帮助。
