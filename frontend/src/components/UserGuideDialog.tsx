import CloseIcon from '@mui/icons-material/Close';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import SearchOutlinedIcon from '@mui/icons-material/SearchOutlined';
import WarningAmberOutlinedIcon from '@mui/icons-material/WarningAmberOutlined';
import Accordion from '@mui/material/Accordion';
import AccordionDetails from '@mui/material/AccordionDetails';
import AccordionSummary from '@mui/material/AccordionSummary';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTheme } from '@mui/material/styles';
import { useEffect, useMemo, useState } from 'react';
import guideContentJson from '../content/userGuideContent.json';
import type { Role } from '../types';

type GuideProcedure = { title: string; steps: string[]; result: string; next: string };
type GuideSection = { title: string; paragraphs?: string[]; bullets?: string[]; procedures?: GuideProcedure[]; notes?: string[] };
type JourneyStage = { title: string; detail: string };
type RoleGuide = { label: string; intro: string; quickStart: string[]; sections: GuideSection[] };
type GuideContent = {
  title: string;
  version: string;
  updated: string;
  intro: string;
  usage: string;
  journey: JourneyStage[];
  common: GuideSection[];
  roles: Record<Role, RoleGuide>;
};
type IndexedSection = { key: string; section: GuideSection };

export const userGuideContent = guideContentJson as GuideContent;

function GuideList({ items }: { items: string[] }) {
  return (
    <Stack component="ul" spacing={0.9} sx={{ m: 0, pl: 2.5 }}>
      {items.map((item) => (
        <Typography key={item} component="li" variant="body2" sx={{ lineHeight: 1.6, overflowWrap: 'anywhere', pl: 0.25 }}>
          {item}
        </Typography>
      ))}
    </Stack>
  );
}

function ProcessJourney({ stages }: { stages: JourneyStage[] }) {
  return (
    <Box>
      <Typography variant="h6" color="primary.main" fontWeight={700} sx={{ mb: 1.25 }}>Как движется бюджет</Typography>
      <Box sx={{ overflowX: 'auto', border: 1, borderColor: 'divider' }}>
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(150px, 1fr))', minWidth: 750 }}>
          {stages.map((stage, index) => (
            <Box key={stage.title} sx={{ px: 1.25, py: 1, bgcolor: 'primary.main', color: 'primary.contrastText', borderRight: index < stages.length - 1 ? 1 : 0, borderColor: 'primary.light', fontSize: 13, fontWeight: 700, textAlign: 'center' }}>
              {index + 1}. {stage.title}
            </Box>
          ))}
          {stages.map((stage, index) => (
            <Box key={stage.detail} sx={{ minHeight: 84, px: 1.25, py: 1.25, bgcolor: 'action.hover', borderRight: index < stages.length - 1 ? 1 : 0, borderColor: 'divider', fontSize: 13, lineHeight: 1.4, textAlign: 'center' }}>
              {stage.detail}
            </Box>
          ))}
        </Box>
      </Box>
    </Box>
  );
}

function RoleWorkOrder({ steps }: { steps: string[] }) {
  return (
    <Box sx={{ border: 1, borderColor: 'divider' }}>
      <Typography variant="subtitle1" fontWeight={700} sx={{ px: 1.5, py: 1.1, bgcolor: 'primary.main', color: 'primary.contrastText' }}>Порядок работы</Typography>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(5, minmax(0, 1fr))' }, gap: 1 }}>
        {steps.map((step, index) => (
          <Stack key={step} direction="row" spacing={1} alignItems="flex-start" sx={{ minWidth: 0, p: 1.25 }}>
            <Typography variant="body2" color="primary.main" fontWeight={700}>{index + 1}.</Typography>
            <Typography variant="body2" fontWeight={600} sx={{ lineHeight: 1.45, overflowWrap: 'anywhere' }}>{step}</Typography>
          </Stack>
        ))}
      </Box>
    </Box>
  );
}

function ProcedureCard({ procedure }: { procedure: GuideProcedure }) {
  return (
    <Box sx={{ overflow: 'hidden', border: 1, borderColor: 'divider', borderRadius: 1 }}>
      <Box sx={{ px: { xs: 1.5, sm: 2 }, py: 1.25, bgcolor: 'action.hover', borderBottom: 1, borderColor: 'divider' }}>
        <Typography variant="subtitle1" fontWeight={700}>{procedure.title}</Typography>
      </Box>
      <Stack spacing={1.25} sx={{ p: { xs: 1.5, sm: 2 } }}>
        {procedure.steps.map((step, index) => (
          <Stack key={step} direction="row" spacing={1.25} alignItems="flex-start">
            <Box sx={{ display: 'grid', placeItems: 'center', width: 26, height: 26, flex: '0 0 26px', borderRadius: 1, bgcolor: 'action.selected', color: 'text.primary', fontSize: 12, fontWeight: 700 }}>{index + 1}</Box>
            <Typography variant="body2" sx={{ pt: 0.2, lineHeight: 1.55, overflowWrap: 'anywhere' }}>{step}</Typography>
          </Stack>
        ))}
      </Stack>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, borderTop: 1, borderColor: 'divider' }}>
        <Box sx={{ p: 1.5, bgcolor: 'background.default' }}>
          <Typography variant="caption" color="text.secondary" fontWeight={700}>Результат</Typography>
          <Typography variant="body2" sx={{ mt: 0.25, lineHeight: 1.5 }}>{procedure.result}</Typography>
        </Box>
        <Box sx={{ p: 1.5, bgcolor: 'background.default', borderLeft: { sm: 1 }, borderColor: 'divider' }}>
          <Typography variant="caption" color="text.secondary" fontWeight={700}>Что дальше</Typography>
          <Typography variant="body2" sx={{ mt: 0.25, lineHeight: 1.5 }}>{procedure.next}</Typography>
        </Box>
      </Box>
    </Box>
  );
}

function GuideSectionContent({ section }: { section: GuideSection }) {
  return (
    <Stack spacing={1.75}>
      {section.paragraphs?.map((paragraph) => <Typography key={paragraph} variant="body2" sx={{ lineHeight: 1.7, overflowWrap: 'anywhere', textAlign: 'justify' }}>{paragraph}</Typography>)}
      {!!section.bullets?.length && <GuideList items={section.bullets} />}
      {section.procedures?.map((procedure) => <ProcedureCard key={procedure.title} procedure={procedure} />)}
      {!!section.notes?.length && (
        <Stack direction="row" spacing={1.25} alignItems="flex-start" sx={{ p: { xs: 1.5, sm: 2 }, border: 1, borderColor: 'warning.light', bgcolor: 'warning.light', borderRadius: 1 }}>
          <WarningAmberOutlinedIcon color="warning" sx={{ mt: 0.15, flexShrink: 0 }} />
          <Box>
            <Typography variant="subtitle2" fontWeight={800} sx={{ mb: 0.75 }}>Важно</Typography>
            <GuideList items={section.notes} />
          </Box>
        </Stack>
      )}
    </Stack>
  );
}

function SectionAccordion({ item, expanded, onToggle }: { item: IndexedSection; expanded: boolean; onToggle: () => void }) {
  return (
    <Accordion id={`guide-${item.key}`} expanded={expanded} onChange={onToggle} disableGutters elevation={0} sx={{ scrollMarginTop: 12, border: 1, borderColor: expanded ? 'primary.light' : 'divider', borderRadius: '12px !important', overflow: 'hidden', '&:before': { display: 'none' } }}>
      <AccordionSummary expandIcon={<ExpandMoreIcon />} aria-controls={`${item.key}-content`} id={`${item.key}-header`} sx={{ px: { xs: 1.5, sm: 2 }, bgcolor: expanded ? 'action.hover' : 'background.paper' }}>
        <Typography variant="h6" sx={{ fontSize: { xs: 15, sm: 17 }, fontWeight: 720, overflowWrap: 'anywhere', pr: 1 }}>{item.section.title}</Typography>
      </AccordionSummary>
      <AccordionDetails id={`${item.key}-content`} sx={{ px: { xs: 1.5, sm: 2 }, pt: 1.5, pb: 2 }}>
        <GuideSectionContent section={item.section} />
      </AccordionDetails>
    </Accordion>
  );
}

export function UserGuideDialog({ role, open, onClose }: { role: Role; open: boolean; onClose: () => void }) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const roleGuide = userGuideContent.roles[role];
  const commonSections = useMemo(() => userGuideContent.common.map((section, index) => ({ key: `common-${index}`, section })), []);
  const roleSections = useMemo(() => roleGuide.sections.map((section, index) => ({ key: `role-${index}`, section })), [roleGuide]);
  const [query, setQuery] = useState('');
  const [expandedSection, setExpandedSection] = useState('common-0');
  const normalizedQuery = query.trim().toLocaleLowerCase('ru');
  const matches = (item: IndexedSection) => JSON.stringify(item.section).toLocaleLowerCase('ru').includes(normalizedQuery);
  const visibleCommon = normalizedQuery ? commonSections.filter(matches) : commonSections;
  const visibleRole = normalizedQuery ? roleSections.filter(matches) : roleSections;

  useEffect(() => {
    if (open) {
      setQuery('');
      setExpandedSection('common-0');
    }
  }, [open, role]);

  const renderGroup = (items: IndexedSection[]) => items.length > 0 && (
    <Stack spacing={1.25}>
      {items.map((item) => (
        <SectionAccordion key={item.key} item={item} expanded={Boolean(normalizedQuery) || expandedSection === item.key} onToggle={() => setExpandedSection(expandedSection === item.key ? '' : item.key)} />
      ))}
    </Stack>
  );

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="lg" fullScreen={fullScreen} aria-labelledby="user-guide-title" PaperProps={{ sx: { position: 'relative', maxHeight: fullScreen ? '100%' : 'calc(100% - 48px)' } }}>
      <DialogTitle id="user-guide-title" sx={{ pr: 7, pb: 1.5 }}>
        <Typography component="span" variant="h6" fontWeight={700}>{userGuideContent.title}</Typography>
        <IconButton aria-label="Закрыть руководство" onClick={onClose} sx={{ position: 'absolute', right: 12, top: 12, color: 'text.secondary' }}><CloseIcon /></IconButton>
      </DialogTitle>
      <DialogContent dividers sx={{ position: 'relative', overflowY: 'auto', overflowX: 'hidden', px: { xs: 1.5, sm: 5 }, py: { xs: 2.5, sm: 4 } }}>
        <Stack spacing={2.75} sx={{ width: '100%', maxWidth: 1120, mx: 'auto' }}>
          <Box sx={{ px: { xs: 0, sm: 1 } }}>
            <Typography variant="body2" sx={{ lineHeight: 1.6, textAlign: 'justify' }}>{userGuideContent.intro}</Typography>
            <Typography variant="body2" sx={{ mt: 2, lineHeight: 1.6, textAlign: 'justify' }}><Box component="strong">Как пользоваться. </Box>{userGuideContent.usage}</Typography>
          </Box>
          <ProcessJourney stages={userGuideContent.journey} />
          <Stack spacing={2} sx={{ minWidth: 0 }}>
              <Typography variant="h5" color="primary.main" fontWeight={700}>Общая часть</Typography>
              <TextField value={query} onChange={(event) => setQuery(event.target.value)} label="Поиск по руководству" placeholder="Например: файл, возврат, статус" size="small" fullWidth InputProps={{ startAdornment: <InputAdornment position="start"><SearchOutlinedIcon fontSize="small" /></InputAdornment> }} />
              {normalizedQuery && <Typography variant="caption" color="text.secondary">Найдено разделов: {visibleCommon.length + visibleRole.length}. Совпавшие разделы раскрыты полностью.</Typography>}
              {renderGroup(visibleCommon)}
              <Box sx={{ pt: 1, borderTop: 1, borderColor: 'divider' }}>
                <Typography variant="h5" color="primary.main" fontWeight={700}>Работа в роли: {roleGuide.label}</Typography>
                <Typography variant="body2" sx={{ mt: 1, lineHeight: 1.6 }}>{roleGuide.intro}</Typography>
              </Box>
              <RoleWorkOrder steps={roleGuide.quickStart} />
              {renderGroup(visibleRole)}
              {visibleCommon.length + visibleRole.length === 0 && (
                <Box sx={{ py: 5, px: 2, textAlign: 'center', border: 1, borderStyle: 'dashed', borderColor: 'divider', borderRadius: 2 }}>
                  <SearchOutlinedIcon color="disabled" sx={{ fontSize: 40 }} />
                  <Typography variant="subtitle1" fontWeight={750} sx={{ mt: 1 }}>Ничего не найдено</Typography>
                  <Typography variant="body2" color="text.secondary">Попробуйте другое слово или очистите строку поиска.</Typography>
                </Box>
              )}
          </Stack>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: { xs: 2, sm: 3 }, py: 1.5 }}><Button onClick={onClose}>Закрыть</Button></DialogActions>
    </Dialog>
  );
}
