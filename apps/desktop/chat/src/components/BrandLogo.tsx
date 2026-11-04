import brandLogo from 'openfilm/studio-ui/assets/brand-logo.png';

export function BrandLogo({ size = 18, className }: { size?: number; className?: string }) {
  return <img src={brandLogo} width={size} height={size} alt="GainingCut" draggable={false}
    className={`block shrink-0 object-contain ${className ?? ''}`.trim()} />;
}
