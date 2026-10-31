declare module 'openfilm/text-styles' {
  export interface TextStyleStroke { color: string; width: number }
  export interface TextStyleShadow { color: string; opacity: number; blur: number; x: number; y: number }
  export interface TextStyle {
    fontFamily?: string; fontPath?: string; fontSize: number; color?: string;
    bold?: boolean; italic?: boolean; underline?: boolean;
    stroke?: TextStyleStroke; shadow?: TextStyleShadow;
  }
  export interface TextStylePreset {
    id: string; version: number; name: string; description: string; style: TextStyle;
  }
  export function listTextStyles(): TextStylePreset[];
}
