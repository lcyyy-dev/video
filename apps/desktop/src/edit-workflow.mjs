/** Native project persistence and deterministic template → skill → prompt preparation. */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { initialTemplate, normalizeTemplate, templateRoute, templateSummary } from './edit-template.mjs';

const packageRoot = dirname(createRequire(import.meta.url).resolve('openfilm/package.json'));

export const templateFile = project => join(project, '.film', 'edit-template.json');
export function loadTemplate(project) {
  let raw;
  try { raw = JSON.parse(readFileSync(templateFile(project), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return initialTemplate(); throw new Error('剪辑模板读取失败，请重新保存模板配置。', { cause: error }); }
  if (!raw || raw.version !== 1) throw new Error('剪辑模板版本不受支持，请重新保存模板配置。');
  return normalizeTemplate(raw.config);
}
export function saveTemplate(project, raw) {
  const config = normalizeTemplate(raw);
  const file = templateFile(project);
  mkdirSync(join(project, '.film'), { recursive: true });
  const temp = `${file}.${randomUUID()}.tmp`;
  writeFileSync(temp, `${JSON.stringify({ version: 1, config }, null, 2)}\n`);
  renameSync(temp, file);
  return config;
}

/** Add project context to a native Codex turn. The model decides whether to answer, inspect, or edit. */
export function prepareEditPrompt(project, text, { config } = {}) {
  let warning = '';
  if (!config) {
    try { config = loadTemplate(project); }
    catch (error) { config = initialTemplate(); warning = `模板配置无法读取，以下为默认配置。可继续处理用户要求，必要时检查 .film/edit-template.json。原因：${error.message}`; }
  }
  config = normalizeTemplate(config);
  const route = templateRoute(config.kind);
  const skillText = readFileSync(join(packageRoot, 'skills', route.skill, 'SKILL.zh-CN.md'), 'utf8');
  const workflow = { skill: route.skill, source: 'bundled', config };
  if (config.kind === 'copy') return { workflow, text: [
    '<openfilm-project-context>',
    '文案二创是纯文字润色，不剪辑视频、不修改工程、不分析素材、不创建文件。只在对话中返回完整润色文案，正常保留标点和段落；不应用广告排版、配音、时长或去标点规则。',
    templateSummary(config), warning,
    `已选择并加载工作流：openfilm skill ${route.skill}。只执行文字润色。`,
    `<selected-workflow name="${route.skill}">`, skillText, '</selected-workflow>',
    '</openfilm-project-context>',
    '\n用户本次需求：', String(text),
  ].join('\n') };

  const styleInstruction = config.textStyleIds.length
    ? `模板已勾选文字样式 ${config.textStyleIds.join('、')}。生成所有结构化文字时，只能从这些样式 ID 中选择；不要使用未勾选的样式，也不要临时创建样式。多个样式可按文字角色或画面可读性分配，但每个文字角色内部保持一致。`
    : '模板未勾选固定文字样式。生成结构化文字时，从元素库自动组合原生兼容样式，并在同一文字角色内保持组合一致。';
  return { workflow, text: [
    '<openfilm-project-context>',
    '这是当前 OpenFilm 项目的工作流背景；用户本次自然语言指令优先。模板文案仍按原文处理，具体约束见会话指令。',
    templateSummary(config),
    styleInstruction,
    config.kind==='ad'&&config.body&&config.narration
      ? '当前已勾选文案朗读：会话提供了本机原生旁白能力，请先在工程目录执行 openfilm narrate，再读取 .film/narration.json。只有命令真实失败才可报告旁白未完成；不得根据旧会话或通用 Provider 状态声称 TTS 未连接，不得跳过已勾选旁白或以纯文字视频代替。'
      : '当前未启用广告正文朗读，不调用 openfilm narrate，保留视频原声。',
    '只有广告模板开启文案朗读时，调用会话提供的本机原生 TTS 接口生成完整正文；按真实音频时长编排独立旁白音轨与字幕。默认压低视频原声至 0.15；失败明确报告，不静默跳过、不使用其他配音服务。固定时长放不下完整朗读时报告冲突，不删字、不截断、不擅自延长。其他模板不生成旁白。',
    '文字颜色与行宽规则：标题、多个副标题和正文文案应使用不同的文字填充色；同屏各文字块不要全部同色，应按角色和语义分配清晰可辨的不同颜色，并保证与画面对比度。优先选用用户所选样式中不同颜色的样式；若已选样式全同色，保留字体、描边等设置，允许调整填充色以满足分色要求，不因此停下询问。横向排版优先每个文字块单独占一行，按实际字体、组内最长句和画布可用宽度计算正文统一绝对像素字号，使每行尽量铺满可用宽度；正文按组内最长句计算统一字号，短句不单独放大，正文不得超过主标题字号。左右保留安全边距，不贴边、不裁字、不通过拉伸字形填满。允许同屏多句、多行，但不要把不同句子挤在同一行；保持完整文案和可读性。',
    '文字实际行宽与人物避让规则：以渲染字体加载后的实际文字笔画宽度（包含描边、阴影）计算字号，不以 JSON 文本框宽度代替文字宽度，也不能只把文本框拉宽。无人物占用时，每行文字目标接近画布宽度的 90%，左右各留约 5% 安全边距；短标题应继续放大到接近目标行宽。正文优先在句间拆成多个独立文字块，每句各占一行，同组使用统一字号，避免一整个小字号段落只占画面局部。地点信息必须作为独立地点标签，控制在视频左下角或右下角的安全区域内，优先选择人物较少的一侧，不放在画面中部或上方。所有文字包括标题、副标题、正文、地点标签，其笔画、描边和阴影均不得覆盖人物的头部、身体、手脚和动作区域。位置根据所选镜头整个区间内人物活动范围决定，不只看首帧，不默认顶部或底部安全；先复用已有素材分析和帧缓存。人物避让优先于铺满行宽；没有足够横向空白时重新分组、调整位置或换用相关镜头，不为填满一行压住人物，也不缩成不可读的小字。此处是生成时布局依据，不追加生成后的完整预览检查。',
    '独立小句排版规则：文案包含多个小句时，按逗号、分号、句号、问号、感叹号等自然停顿划分，保留词句和原文字序，画面文字去掉语句标点。每个小句必须是结构化文字 JSON 的独立 texts 元素，拥有独立 text、x、y、width、fontSize；不得将多个小句塞入一个 text 字符串或用换行符堆在同一个文本框里。每个小句只占一行，同组按最长句计算相同字号。相关小句可以在同一时间段内同屏纵向分层排列，位置和行间距按人物之外的空白区域独立设置，不必都挤在同一横向长条或固定底部区域。每行文字与描边不重叠，相邻小句使用可区分的颜色。人物避让优先；空白不足时将小句分成连续的同屏组呈现，完整使用全部文案并保持指定总时长，不删文案、不询问。',
    '视频满画布优先规则：主视频画面必须铺满画布，不得为了给标题、地点或正文腾空间而缩小视频、把视频放在中间小窗口、增加黑底边框或上下留出文字专用黑区。保持原视频比例，用等比 cover 填充画布；必要时调整裁切位置以保留人物和完整动作，禁止非等比拉伸。文字必须叠加在满画布的视频上，通过移动位置、分别调整字号、拆分独立小句和分时分组展示来避开人物。任何文字排版规则都不能成为缩小主视频的理由。可用空间不足时减少同屏小句数量，在指定总时长内继续呈现全部文案；不得改为缩小视频的海报式布局。',
    '画面文案去标点规则：原始输入和模板配置原样保存；生成标题、副标题、正文的 JSON texts[].text 时，先按原文标点划分小句，再移除用于语句表达的标点（逗号、句号、顿号、分号、冒号、问号、感叹号、引号、括号、书名号、省略号、破折号及对应英文标点），不在画面显示。词句和先后顺序完整保留，不得借去标点删减或改写内容。不同小句仍使用独立文字元素，不因去标点合成一个文字框。数值小数点、百分号、正负号、日期、网址、型号和专名中的必要符号按语义保留，避免改变事实。去标点后的文字用于测量字号、编辑预览和剪映导出，源 JSON 内不保留待显示的语句标点。此规则是全文保留规则的明确展示例外，优先于逐字保留标点的旧要求。',
    '正文层级与间距规则：同组正文小句使用完全相同的 fontSize，以组内最长一行和可用区域计算统一字号，短句不得单独放大。所有副标题和正文的字号不得大于主标题；正文不为铺满宽度超过标题字号。按实际渲染后的文字、描边和阴影外接边界安排位置，正文相邻行之间保留统一字号约 8%–12% 的紧凑空白（按包含描边、阴影的实际边界计算），不留过大的段间空隙；标题、副标题、正文之间也不得相互覆盖。空间不足时减少同屏句数并分组分时展示，不叠字、不删文案、不缩小主视频。正文填充色必须与标题明显不同，避免同色和相近色，例如标题黄色时正文不得再选黄色、金色或相近橙色；优先选对比明确的白色、青色或其他不同色相，并结合视频背景保持清晰。此规则优先于每行单独放大铺满的旧要求。',
    '同屏文案规则：同一画面允许同时展示两句或多句文案，按语义分组、多行或多个文字块排布；不强制一句一屏，也不要求每句话独占时间段。短时长且文案较多时，优先让相关句子同屏呈现并为每组分配展示时间，完整保留文案和指定时长，避免遮挡主体。单行标题规则只限制单个标题，不限制同屏正文句数。',
    '全文案执行规则：用户提供的标题、正文等成品文案必须完整保留，逐字呈现，不删字、不精简、不只用标题，也不询问是否保留全文或改用标题。给定时长时，按全文案分配文字片段、调整排布和节奏；未开启朗读时，文字展示时长不受朗读时长约束；开启广告朗读时以真实旁白时长为依据，不因字数多而暂停要求用户在删文案、仅标题、延长时长之间选择。保持用户指定时长，实际可读性局限在执行完成后如实汇报，不擅自延长时长。',
    '原声轨道规则：导入的视频保留内嵌音频，生成和修改影片时默认直接使用带原声的原视频片段，裁剪时间、速度和音量随视频片段保存；不得自动将原声拆成独立 audio 片段或音轨，也不得用无声预览视频搭配单独原声。用户明确要求分离音频或独立剪辑原声时才拆分。独立旁白、音乐和音效仍使用各自音轨。此规则适用于所有模板。',
    '字号是生成时的布局参数，不是样式锁定项。根据画布尺寸、文字长度、位置和可读性设置每个文字元素的绝对像素字号；使用已选样式时允许单独调整 fontSize，不改变选定的字体、颜色、描边等外观。',
    '执行链路：接收命令 → 执行命令 → 汇报结果。执行完成后直接汇报，不自动运行快速预览、完整检查、重复帧渲染或混音检测；只有用户本次明确要求预览或检查时才执行相应命令。不得把未执行的预览或检查报告为已通过。',
    '当前模板配置（可被用户本次指令调整）：', JSON.stringify(config),
    warning,
    `已选择并加载工作流：openfilm skill ${route.skill}。生成或剪辑时必须执行以下 skill；普通问答不触发影片修改。`,
    `<selected-workflow name="${route.skill}">`, skillText, '</selected-workflow>',
    '</openfilm-project-context>',
    '\n用户本次需求（含附件与编辑器引用）：', String(text),
  ].join('\n') };
}
