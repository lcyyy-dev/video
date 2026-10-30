# 剪映兼容结构化文字样式预览

打开 `structured-douyin-style-preview.html` 可以查看 6 组竖屏短视频文字样式。样式数据保存在同目录的 `structured-douyin-style-preview.json`，全部使用 `openfilm-text` 结构化字段生成。

重新生成：

```bash
node packages/openfilm/examples/structured-douyin-style-preview.mjs
```

示例只使用字体、字号、颜色、描边、阴影、对齐、行宽和富文本 runs 等可映射字段，没有使用背景条、圆角标签或透明度动画，因此满足原生文字导出的基本条件。把页面放进与电影画布一致的文字轨道后，再通过剪映/CapCut 导出流程检查 `native-text-report.json`。
