declare module 'openfilm/text-styles' {
  export interface TextStyleStroke { color: string; width: number }
  export interface TextStyleShadow { color: string; opacity: number; blur: number; x: number; y: number }
  export interface TextStyle {
    fontFamily?: string; fontPath?: string; fontSize?: number; color?: string;
    bold?: boolean; italic?: boolean; underline?: boolean;
    stroke?: TextStyleStroke; shadow?: TextStyleShadow;
  }
  export interface TextStylePreset {
    id: string; version: number; name: string; description: string; style: TextStyle;
  }
  export function listTextStyles(): TextStylePreset[];
}

declare module 'openfilm/text-styles' {
  export function getTextElementLibrary(): { elements: { fonts: Array<{ id: string; name: string; family: string; fontPath: string }> } };
  export function applyTextStyle<T extends { text: string; x: number; y: number; fontSize: number; width?: number }>(item: T, preset: TextStylePreset): T & TextStyle;
}

declare module 'openfilm/text-page' {
  export function mountTextPage(page: { version: 1; width: number; height: number; duration: number; texts: Array<import('openfilm/text-styles').TextStyle & { fontSize: number; text: string; x: number; y: number; width?: number }> }, root: HTMLElement): { frame(time: number): void; ready: Promise<unknown> };
}
