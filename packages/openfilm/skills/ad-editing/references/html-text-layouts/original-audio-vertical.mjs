import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { textPageHtml } from '../../../../src/text-page.mjs';

const page = {
  version: 1,
  width: 1080,
  height: 1920,
  duration: 15,
  texts: [
    {
      text: '济南最新的运动训练', x: 540, y: 150, width: 900, fontSize: 88, color: '#FFFFFF', bold: true,
      align: 'center', backgroundColor: '#1267C8', backgroundOpacity: 0.94, borderRadius: 18,
      stroke: { color: '#082B55', width: 4 }, shadow: { color: '#000000', opacity: 0.55, blur: 8, x: 0, y: 5 },
    },
    {
      text: '专业教练1对1定制训练计划', x: 540, y: 285, width: 930, fontSize: 76, color: '#123E86', bold: true,
      align: 'center', backgroundColor: '#FFFFFF', backgroundOpacity: 0.94, borderRadius: 12,
      stroke: { color: '#FFFFFF', width: 2 }, shadow: { color: '#000000', opacity: 0.4, blur: 6, x: 0, y: 4 },
    },
    {
      text: '每天一小时带孩子科学运动', x: 540, y: 410, width: 930, fontSize: 72, color: '#FFEA00', bold: true,
      align: 'center', stroke: { color: '#1A1A1A', width: 5 }, shadow: { color: '#000000', opacity: 0.55, blur: 7, x: 0, y: 4 },
    },
    {
      text: '专业设备实时监测运动数据', x: 540, y: 525, width: 930, fontSize: 62, color: '#FFFFFF', bold: true,
      align: 'center', stroke: { color: '#202020', width: 4 }, shadow: { color: '#000000', opacity: 0.65, blur: 8, x: 0, y: 4 },
    },
    {
      text: '家长：孩子体能越来越好', x: 540, y: 635, width: 900, fontSize: 56, color: '#FF344D', bold: true,
      align: 'center', stroke: { color: '#FFFFFF', width: 3 }, shadow: { color: '#000000', opacity: 0.45, blur: 6, x: 0, y: 3 },
    },
    {
      text: '山东\n济南', x: 900, y: 1660, width: 230, fontSize: 70, color: '#FFFFFF', bold: true,
      align: 'center', lineHeight: 1.05, stroke: { color: '#123E86', width: 5 }, shadow: { color: '#000000', opacity: 0.7, blur: 7, x: 0, y: 4 },
    },
  ],
};

const output = join(dirname(fileURLToPath(import.meta.url)), 'original-audio-vertical.html');
writeFileSync(output, textPageHtml(page));
console.log(output);
