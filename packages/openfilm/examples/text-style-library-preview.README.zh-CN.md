# 30 种原生文字样式预览

运行：

```bash
node packages/openfilm/examples/text-style-library-preview.mjs
```

生成的 HTML 是样式库的说明预览；每张卡片展示 `.text.json` 结构化数据。样式库只包含可映射到剪映/CapCut 原生文字的字段：字体、字号、颜色、描边、阴影、对齐和字距。

文字背景框、圆角标签和花字资源当前会触发渲染回退，因此没有放进这 30 个预设。`block-outline-*` 用粗描边和阴影提供接近参考图的块面感，同时保持文字可编辑。
