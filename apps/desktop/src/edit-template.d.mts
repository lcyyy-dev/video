export type TemplateKind = 'ad' | 'talk' | 'copy' | 'live';
export interface EditTemplateConfig {
  kind: TemplateKind; adMode: string; title: boolean; titleText: string;
  subtitles: boolean; subtitleTexts: string[]; body: boolean; bodyText: string;
  reveal: string; highlight: boolean; location: boolean; locationText: string;
  opening: boolean; pip: boolean; cover: boolean; coverText: string; scenes: boolean;
  source: string; rewrite: string; logic: string; notes: string;
}
export const TEMPLATE_TYPES: ReadonlyArray<{ id: TemplateKind; name: string; hint: string; skill: string | null }>;
export const AD_MODES: string[];
export function initialTemplate(): EditTemplateConfig;
export function normalizeTemplate(raw: unknown): EditTemplateConfig;
export function titleFontSize(text: string, options?: { maxWidth?: number; max?: number; min?: number }): number;
export function templateRoute(kind: string): typeof TEMPLATE_TYPES[number] & { skill: string };
export function templateSummary(config: EditTemplateConfig): string;
