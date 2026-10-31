# 元素组合原生文字预览

运行：

```bash
node packages/openfilm/examples/text-style-library-preview.mjs
```

生成的 HTML 是元素组合的说明预览；每张卡片展示 `.text.json` 结构化数据。元素库只组合可映射到剪映/CapCut 原生文字的字段：字体、字号、颜色和描边。

文字背景框、圆角标签和阴影当前没有元素来源，会触发渲染回退，因此不会由元素组合生成。每次生成可以使用 seed 复现同一组元素。
