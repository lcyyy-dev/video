export type TemplateKind = 'ad' | 'talk' | 'copy' | 'live';
export interface EditTemplateConfig {
  kind: TemplateKind; narration: boolean; title: boolean; titleText: string;
  subtitles: boolean; subtitleTexts: string[]; body: boolean; bodyText: string;
  reveal: string; highlight: boolean; location: boolean; locationText: string;
  source: string; notes: string;
  textStyleIds: string[];
}
export const TEMPLATE_TYPES: ReadonlyArray<{ id: TemplateKind; name: string; hint: string; skill: string | null }>;
export function initialTemplate(): EditTemplateConfig;
export function normalizeTemplate(raw: unknown): EditTemplateConfig;
export function titleFontSize(text: string, options?: { maxWidth?: number; max?: number; min?: number }): number;
export function templateRoute(kind: string): typeof TEMPLATE_TYPES[number] & { skill: string };
export function templateSummary(config: EditTemplateConfig): string;
