import DownloadIcon from '@mui/icons-material/FileDownload';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import CloseIcon from '@mui/icons-material/Close';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';
import { useEffect, useRef, useState } from 'react';
import '@js-preview/excel/lib/index.css';
import type { JsExcelPreview } from '@js-preview/excel';
import type { JsPdfPreview } from '@js-preview/pdf';
import { api } from '../api/client';
import type { FileAttachment } from '../types';
import { downloadAuthorized } from '../utils/download';

type PreviewKind = 'image' | 'pdf' | 'docx' | 'xlsx' | 'unsupported';
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function previewKind(fileName: string, contentType?: string): PreviewKind {
  if (contentType?.startsWith('image/') || /\.(png|jpe?g)$/i.test(fileName)) return 'image';
  if (contentType === 'application/pdf' || /\.pdf$/i.test(fileName)) return 'pdf';
  if (/\.docx$/i.test(fileName)) return 'docx';
  if (contentType === XLSX_MIME || /\.xlsx$/i.test(fileName)) return 'xlsx';
  return 'unsupported';
}

const REMOVED_LABELS: Record<string, string> = {
  vba_macros: 'макросы', active_x: 'элементы ActiveX', ole: 'встроенные объекты',
  external_links: 'внешние связи', formulas: 'активные формулы', images: 'изображения', charts: 'диаграммы',
};

export function FilePreviewDialog({
  file,
  open,
  onClose,
  fullScreen = false,
  showOpenInNewWindow = true,
}: {
  file: FileAttachment | null;
  open: boolean;
  onClose: () => void;
  fullScreen?: boolean;
  showOpenInNewWindow?: boolean;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [kind, setKind] = useState<PreviewKind>('unsupported');
  const [error, setError] = useState(false);
  const [processing, setProcessing] = useState(false);
  const excelPreviewRef = useRef<HTMLDivElement>(null);
  const docxPreviewRef = useRef<HTMLDivElement>(null);
  const pdfPreviewRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || !file) return undefined;

    const controller = new AbortController();
    let objectUrl: string | null = null;
    setUrl(null);
    setError(false);
    setProcessing(false);

    api.get(`/files/${file.id}/download`, { responseType: 'blob', signal: controller.signal })
      .then(async (response) => {
        const contentType = response.headers['content-type'];
        const detectedKind = previewKind(file.original_name, typeof contentType === 'string' ? contentType : undefined);
        if (controller.signal.aborted) return;
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(response.data);
        setKind(detectedKind);
        setUrl(objectUrl);
      })
      .catch((requestError: { code?: string }) => {
        if (requestError.code !== 'ERR_CANCELED') setError(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setProcessing(false);
      });

    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [file, open]);

  useEffect(() => {
    if (kind !== 'xlsx' || !url || !excelPreviewRef.current) return undefined;

    let disposed = false;
    let previewer: JsExcelPreview | null = null;
    const container = excelPreviewRef.current;
    setProcessing(true);
    import('@js-preview/excel')
      .then(({ default: excelPreview }) => {
        if (disposed) return undefined;
        previewer = excelPreview.init(container, { minColLength: 0, minRowLength: 0, showContextmenu: false });
        return previewer.preview(url);
      })
      .then(() => {
        if (!disposed) setProcessing(false);
      })
      .catch(() => {
        if (!disposed) {
          setProcessing(false);
          setError(true);
        }
      });

    return () => {
      disposed = true;
      previewer?.destroy();
      container.replaceChildren();
    };
  }, [kind, url]);

  useEffect(() => {
    if (kind !== 'docx' || !url || !docxPreviewRef.current) return undefined;

    let disposed = false;
    const container = docxPreviewRef.current;
    setProcessing(true);
    import('docx-preview')
      .then(async ({ renderAsync }) => {
        if (disposed) return undefined;
        const documentBlob = await fetch(url).then((response) => response.blob());
        if (disposed) return undefined;
        return renderAsync(documentBlob, container, container, { renderHeaders: true, renderFooters: true, renderFootnotes: true, renderEndnotes: true });
      })
      .then(() => {
        if (!disposed) setProcessing(false);
      })
      .catch(() => {
        if (!disposed) {
          setProcessing(false);
          setError(true);
        }
      });

    return () => {
      disposed = true;
      container.replaceChildren();
    };
  }, [kind, url]);

  useEffect(() => {
    if (kind !== 'pdf' || !url || !pdfPreviewRef.current) return undefined;

    let disposed = false;
    let previewer: JsPdfPreview | null = null;
    const container = pdfPreviewRef.current;
    setProcessing(true);
    import('@js-preview/pdf')
      .then(({ default: pdfPreview }) => {
        if (disposed) return undefined;
        previewer = pdfPreview.init(container, { width: container.clientWidth, useSystemFonts: true });
        return previewer.preview(url);
      })
      .then(() => {
        if (!disposed) setProcessing(false);
      })
      .catch(() => {
        if (!disposed) {
          setProcessing(false);
          setError(true);
        }
      });

    return () => {
      disposed = true;
      previewer?.destroy();
      container.replaceChildren();
    };
  }, [kind, url]);

  const openInNewWindow = () => {
    if (!file) return;
    const fileName = encodeURIComponent(file.original_name);
    window.open(`/file-preview/${file.id}?name=${fileName}`, '_blank', 'noopener,noreferrer');
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="lg" fullScreen={fullScreen || ['xlsx', 'docx', 'pdf'].includes(kind)} aria-labelledby="file-preview-title">
      <DialogTitle id="file-preview-title" sx={{ position: 'relative', pr: 7, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {file?.original_name || 'Предпросмотр файла'}
        <IconButton aria-label="Закрыть предпросмотр" onClick={onClose} sx={{ position: 'absolute', top: 10, right: 16 }}>
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers sx={{ minHeight: { xs: 260, sm: 520 }, display: 'flex', flexDirection: 'column', alignItems: 'stretch', justifyContent: 'center', p: 0 }}>
        {file?.is_sanitized && (
          <Alert severity="info" sx={{ flex: '0 0 auto', m: 1.5 }}>
            Файл обработан системой безопасности. Для просмотра используется безопасная копия.
            {(file.sanitization_report?.removed?.length ?? 0) > 0 && (
              <Typography component="div" variant="body2">Удалено: {file.sanitization_report!.removed!.map((item) => REMOVED_LABELS[item] || item).join(', ')}.</Typography>
            )}
          </Alert>
        )}
        {(!url || processing) && !error && <CircularProgress aria-label="Загрузка файла" />}
        {error && <Alert severity="error" sx={{ m: 3 }}>Не удалось загрузить файл для предпросмотра.</Alert>}
        {url && !processing && kind === 'image' && (
          <Box component="img" src={url} alt={file?.original_name || ''} sx={{ display: 'block', maxWidth: '100%', maxHeight: '70vh', objectFit: 'contain' }} />
        )}
        {url && kind === 'pdf' && (
          <Box ref={pdfPreviewRef} sx={{ width: '100%', height: 'calc(100vh - 140px)', overflow: 'auto' }} />
        )}
        {url && kind === 'docx' && (
          <Box ref={docxPreviewRef} sx={{ width: '100%', height: 'calc(100vh - 140px)', overflow: 'auto', p: { xs: 1, sm: 3 } }} />
        )}
        {url && kind === 'xlsx' && (
          <Box ref={excelPreviewRef} sx={{ width: '100%', height: 'calc(100vh - 140px)', minWidth: 0, overflow: 'hidden' }} />
        )}
        {url && !processing && kind === 'unsupported' && (
          <Typography color="text.secondary" sx={{ p: 3, textAlign: 'center' }}>
            Для этого формата предпросмотр в браузере недоступен. Скачайте файл или откройте его в отдельном окне.
          </Typography>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button startIcon={<DownloadIcon />} onClick={() => file && downloadAuthorized(`/files/${file.id}/download`, file.stored_name || file.original_name)} disabled={!file}>
          Скачать
        </Button>
        {showOpenInNewWindow && kind !== 'unsupported' && (
          <Button variant="contained" startIcon={<OpenInNewIcon />} onClick={openInNewWindow} disabled={!url}>
            Открыть в окне
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
