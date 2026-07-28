import CloseIcon from '@mui/icons-material/Close';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import DownloadIcon from '@mui/icons-material/FileDownload';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogContent from '@mui/material/DialogContent';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';
import { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { FileAttachment } from '../types';
import { downloadBlob } from '../utils/download';

export function ChatMessageImages({ files }: { files: FileAttachment[] }) {
  const [urls, setUrls] = useState<Record<number, string>>({});
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const fileIds = files.map((file) => file.id).join(',');

  useEffect(() => {
    let disposed = false;
    const objectUrls: string[] = [];
    setUrls({});
    Promise.all(files.map(async (file) => {
      const response = await api.get(`/files/${file.id}/download`, { responseType: 'blob' });
      const url = URL.createObjectURL(response.data);
      objectUrls.push(url);
      return [file.id, url] as const;
    }))
      .then((entries) => {
        if (!disposed) setUrls(Object.fromEntries(entries));
      })
      .catch(() => {
        if (!disposed) setUrls({});
      });
    return () => {
      disposed = true;
      objectUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [fileIds]); // File ids are the stable attachment identity.

  if (!files.length) return null;
  const selectedFile = selectedIndex === null ? null : files[selectedIndex];
  const hasPrevious = selectedIndex !== null && selectedIndex > 0;
  const hasNext = selectedIndex !== null && selectedIndex < files.length - 1;
  const downloadSelected = async () => {
    if (!selectedFile || !urls[selectedFile.id]) return;
    const blob = await fetch(urls[selectedFile.id]).then((response) => response.blob());
    downloadBlob(blob, selectedFile.original_name);
  };
  return (
    <>
      <Box className="chat-image-grid">
        {files.map((file, index) => urls[file.id] && (
          <Box key={file.id} component="button" type="button" className="chat-image-button" onClick={() => setSelectedIndex(index)} aria-label={`Открыть изображение ${file.original_name}`}>
            <Box component="img" src={urls[file.id]} alt={file.original_name} className="chat-image" loading="lazy" />
          </Box>
        ))}
      </Box>
      <Dialog open={selectedIndex !== null} onClose={() => setSelectedIndex(null)} maxWidth="lg" fullWidth PaperProps={{ className: 'chat-image-gallery-paper' }}>
        <Box className="chat-gallery-header">
          <Typography noWrap>{selectedFile?.original_name}</Typography>
          <Box className="chat-gallery-controls">
            <Typography variant="body2">{selectedIndex === null ? '' : `${selectedIndex + 1} из ${files.length}`}</Typography>
            <Button size="small" startIcon={<DownloadIcon />} disabled={!selectedFile || !urls[selectedFile.id]} onClick={downloadSelected}>
              Скачать
            </Button>
            <IconButton onClick={() => setSelectedIndex(null)} aria-label="Закрыть галерею"><CloseIcon /></IconButton>
          </Box>
        </Box>
        <DialogContent className="chat-gallery-content">
          <IconButton className={`chat-gallery-navigation chat-gallery-previous ${hasPrevious ? '' : 'is-empty'}`} onClick={() => setSelectedIndex((index) => index === null ? index : index - 1)} aria-label="Предыдущее изображение"><ChevronLeftIcon /></IconButton>
          <Box className="chat-gallery-media">
            {selectedFile && urls[selectedFile.id] && <Box component="img" className="chat-gallery-image" src={urls[selectedFile.id]} alt={selectedFile.original_name} />}
          </Box>
          <IconButton className={`chat-gallery-navigation chat-gallery-next ${hasNext ? '' : 'is-empty'}`} onClick={() => setSelectedIndex((index) => index === null ? index : index + 1)} aria-label="Следующее изображение"><ChevronRightIcon /></IconButton>
        </DialogContent>
      </Dialog>
    </>
  );
}
