import Box from '@mui/material/Box';
import Link from '@mui/material/Link';
import { useEffect, useRef, useState } from 'react';
import bitrixLogo from '../assets/bitrix24-logo.png';
import maxLogo from '../assets/max-logo-2025.png';

const BITRIX_LINK = 'https://team.alabuga.ru/company/structure.php?set_filter_structure=Y&structure_UF_DEPARTMENT=8304&filter=Y&set_filter=Y';
const MAX_CONTACT_LINK = 'https://max.ru/u/f9LHodD0cOIA4s2RhH3dW5NoCLRn88NF67UYfQe_rOnnM6Y1a7VW_vOUt5I';
const NARROW_FOOTER_QUERY = '(max-width: 640px)';

const iconLinkSx = {
  width: 34,
  height: 34,
  flex: '0 0 auto',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: '20px',
  border: '1px solid',
  borderColor: 'divider',
  backgroundColor: 'rgba(255, 255, 255, 0.86)',
  transition: 'transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease, background-color 0.2s ease',
  '&:hover': {
    borderColor: 'primary.main',
    backgroundColor: '#fff',
    transform: 'translateY(-1px) scale(1.02)',
    boxShadow: '0 8px 16px rgba(15, 35, 75, 0.16)',
  },
};

const iconImageSx = {
  display: 'block',
  width: 24,
  height: 24,
  objectFit: 'cover' as const,
  borderRadius: '16px',
};

const CREATED_BY_LABEL = 'Created by «Цифровизация проектных задач»';
const SUPPORT_LABEL = 'По вопросам системы писать сюда';
const BITRIX_ARIA_LABEL = 'Перейти в Битрикс';
const MAX_ARIA_LABEL = 'Открыть MAX';

const sectionSx = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '10px',
  minWidth: 0,
};

const captionSx = {
  color: '#4a5875',
  fontFamily: 'Inter, "Segoe UI", sans-serif',
  fontSize: '12px',
  fontWeight: 500,
  lineHeight: 1.55,
};

const brandSx = {
  justifySelf: 'center',
  color: '#1f2a44',
  fontFamily: 'Inter, "Segoe UI", sans-serif',
  fontSize: '14px',
  fontWeight: 550,
  letterSpacing: '0.1px',
  lineHeight: 1.55,
  whiteSpace: 'nowrap',
};

export function AppFooter() {
  const layoutRef = useRef<HTMLDivElement | null>(null);
  const requiredRowWidthRef = useRef(0);
  const [shouldUseMobileLayout, setShouldUseMobileLayout] = useState(false);

  useEffect(() => {
    const element = layoutRef.current;
    if (!element) return undefined;

    const media = window.matchMedia?.(NARROW_FOOTER_QUERY) ?? {
      matches: false,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    };
    const recoverLayoutGap = 28;

    const updateLayout = () => {
      if (media.matches) {
        setShouldUseMobileLayout(true);
        return;
      }

      setShouldUseMobileLayout((previous) => {
        if (!previous) {
          const hasOverflow = element.scrollWidth > element.clientWidth + 1;
          if (hasOverflow) {
            requiredRowWidthRef.current = Math.max(requiredRowWidthRef.current, element.scrollWidth);
            return true;
          }
          return false;
        }

        const requiredRowWidth = requiredRowWidthRef.current;
        if (requiredRowWidth <= 0) return false;
        return element.clientWidth < requiredRowWidth + recoverLayoutGap;
      });
    };

    updateLayout();
    media.addEventListener('change', updateLayout);

    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(updateLayout);
      observer.observe(element);
      return () => {
        observer.disconnect();
        media.removeEventListener('change', updateLayout);
      };
    }

    window.addEventListener('resize', updateLayout);
    return () => {
      window.removeEventListener('resize', updateLayout);
      media.removeEventListener('change', updateLayout);
    };
  }, []);

  return (
    <Box
      component="footer"
      sx={{
        width: '100%',
        p: '6px 20px 18px',
        boxSizing: 'border-box',
        [NARROW_FOOTER_QUERY]: {
          p: '0 12px 12px',
        },
      }}
    >
      <Box
        ref={layoutRef}
        sx={{
          maxWidth: 1200,
          mx: 'auto',
          px: '14px',
          py: '8px',
          borderRadius: '28px',
          backgroundColor: 'rgba(255, 255, 255, 0.82)',
          boxShadow: '0 4px 14px rgba(15, 35, 75, 0.06)',
          display: 'grid',
          gridTemplateColumns: shouldUseMobileLayout ? '1fr' : 'minmax(0, 1fr) auto minmax(0, 1fr)',
          gap: '12px',
          alignItems: 'center',
          [NARROW_FOOTER_QUERY]: {
            px: '12px',
            py: '10px',
            borderRadius: '22px',
            textAlign: 'center',
          },
        }}
      >
        <Box sx={{ ...sectionSx, justifySelf: shouldUseMobileLayout ? 'center' : 'start' }}>
          <Box component="span" sx={{ ...captionSx, whiteSpace: shouldUseMobileLayout ? 'normal' : 'nowrap' }}>
            {CREATED_BY_LABEL}
          </Box>
          <Link href={BITRIX_LINK} target="_blank" rel="noreferrer" aria-label={BITRIX_ARIA_LABEL} sx={iconLinkSx}>
            <Box component="img" src={bitrixLogo} alt="Bitrix24" sx={iconImageSx} />
          </Link>
        </Box>

        <Box component="span" sx={brandSx}>
          BudgetBasket
        </Box>

        <Box sx={{ ...sectionSx, justifySelf: shouldUseMobileLayout ? 'center' : 'end' }}>
          <Box component="span" sx={{ ...captionSx, whiteSpace: shouldUseMobileLayout ? 'normal' : 'nowrap' }}>
            {SUPPORT_LABEL}
          </Box>
          <Link href={MAX_CONTACT_LINK} target="_blank" rel="noreferrer" aria-label={MAX_ARIA_LABEL} sx={iconLinkSx}>
            <Box component="img" src={maxLogo} alt="MAX" sx={iconImageSx} />
          </Link>
        </Box>
      </Box>
    </Box>
  );
}
