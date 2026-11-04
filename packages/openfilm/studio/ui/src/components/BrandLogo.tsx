import brandLogo from '../assets/brand-logo.png';

export function BrandLogo({ size = 18 }: { size?: number }) {
  return <img src={brandLogo} width={size} height={size} alt="GainingCut" draggable={false}
    className="block shrink-0 object-contain" />;
}
