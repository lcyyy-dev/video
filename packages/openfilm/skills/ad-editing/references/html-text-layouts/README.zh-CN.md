# 原声无朗读 HTML 文字样式

`original-audio-vertical.html` 是一个 1080×1920、15 秒的 OpenFilm 结构化文字页面样例，包含：

- 顶部蓝底白字标题
- 白底蓝字核心卖点
- 黄色强调句
- 白色说明句
- 红色结论句
- 右下角两行地点

重新生成样例：

```bash
node packages/openfilm/skills/ad-editing/references/html-text-layouts/original-audio-vertical.mjs
```

将 HTML 复制到项目目录后，可以作为 `film.html` 的文字页面片段使用。OpenFilm 会识别其中的
`openfilm-text` JSON 数据，并在剪映导出时转换文字样式；带背景条和圆角标签的部分会按兼容性规则以渲染片段保留视觉效果。

这个文件是样式参考和可复用模板，生成时必须替换为模板中的真实文案，不能沿用示例文字，也不能新增模板没有提供的事实。
