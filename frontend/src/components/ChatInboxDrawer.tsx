import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import CloseIcon from '@mui/icons-material/Close';
import DoneAllIcon from '@mui/icons-material/DoneAll';
import DoneIcon from '@mui/icons-material/Done';
import ForumOutlinedIcon from '@mui/icons-material/ForumOutlined';
import MarkChatUnreadOutlinedIcon from '@mui/icons-material/MarkChatUnreadOutlined';
import ReplyOutlinedIcon from '@mui/icons-material/ReplyOutlined';
import SendIcon from '@mui/icons-material/Send';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Drawer from '@mui/material/Drawer';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/client';
import { usePagedChat } from '../api/usePagedChat';
import { chatWebSocketUrl } from '../api/websocket';
import { chatDayKey, chatDayLabel } from '../utils/chat';
import { AUTH_TOKEN_KEY, AUTH_USER_KEY } from '../utils/session';
import { ChatMessageImages } from './ChatMessageImages';
import { ChatMessageText } from './ChatMessageText';
import type { FileAttachment, Profile } from '../types';

type ChatSender = { id: string; login: string; profile?: Profile | null };
type ChatMessage = {
  reply_preview?: ChatMessage;
  read_by_other?: boolean; id: string; text: string; created_at: string; is_system?: boolean; reply_to?: string | null; sender: ChatSender | null; files: FileAttachment[] };
type ChatSummary = {
  id: string;
  kind: 'module_cfo' | 'cfo_economist';
  unit_id: string;
  budget_year: number;
  unit: { id: string; name: string; type: string };
  related_cfo: { id: string; name: string } | null;
  participants: { user_id: string; last_read_message_id: string | null }[];
  unread_count: number;
  last_message: ChatMessage | null;
};
type ChatDetails = ChatSummary & { messages: ChatMessage[] };

function senderName(sender: ChatSender | null) {
  if (!sender) return 'Система';
  return [sender.profile?.last_name, sender.profile?.name].filter(Boolean).join(' ') || sender.login;
}
function messageTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('ru-RU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}
function chatTitle(chat: ChatSummary) {
  return chat.kind === 'module_cfo' ? chat.unit.name : chat.unit.name;
}
function chatSubtitle(chat: ChatSummary) {
  return chat.kind === 'module_cfo'
    ? `${chat.related_cfo?.name || 'ЦФО не указан'} · ${chat.budget_year}`
    : `Чат с экономистом · ${chat.budget_year}`;
}

export function ChatInboxDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [selectedChat, setSelectedChat] = useState<ChatSummary | null>(null);
  const [requestedChatId, setRequestedChatId] = useState('');
  const [messageText, setMessageText] = useState('');
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [pendingImages, setPendingImages] = useState<File[]>([]);
  const messagesRef = useRef<HTMLDivElement>(null);
  const lastMarkedReadRef = useRef('');
  const currentUser = useMemo(() => {
    try { return JSON.parse(localStorage.getItem(AUTH_USER_KEY) || '{}') as { id?: string; role?: string }; } catch { return {}; }
  }, []);
  const currentUserId = currentUser.id || '';
  const lastChatStorageKey = currentUserId ? `budgetbasket_last_chat_${currentUserId}` : '';
  const { data: chats = [] } = useQuery({
    queryKey: ['chats'],
    queryFn: async () => (await api.get<ChatSummary[]>('/chats')).data,
    enabled: open,
  });
  const { data: chat, hasOlder, loadOlder, loadingOlder, olderError } = usePagedChat<ChatDetails>({
    queryKey: ['chats', selectedChat?.id],
    url: `/chats/${selectedChat?.id || ''}`,
    enabled: open && !!selectedChat,
  });
  const markRead = useMutation({
    mutationFn: ({ chatId, messageId }: { chatId: string; messageId: string }) => api.patch(`/chats/${chatId}/read`, { last_read_message_id: messageId }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['chats'] }),
  });
  const sendMessage = useMutation({
    mutationFn: () => {
      const chatId = selectedChat!.id;
      if (!pendingImages.length) return api.post(`/chats/${chatId}/messages`, { text: messageText.trim(), reply_to: replyTo?.id || null });
      const form = new FormData();
      form.append('text', messageText.trim());
      if (replyTo) form.append('reply_to', replyTo.id);
      pendingImages.forEach((image) => form.append('images', image));
      return api.post(`/chats/${chatId}/messages/images`, form);
    },
    onSuccess: () => {
      setMessageText(''); setPendingImages([]); setReplyTo(null);
      queryClient.invalidateQueries({ queryKey: ['chats'] });
      queryClient.invalidateQueries({ queryKey: ['chats', selectedChat?.id] });
    },
  });

  useEffect(() => {
    const openChat = (event: Event) => {
      const chatId = (event as CustomEvent<{ chatId?: string }>).detail?.chatId;
      const target = chats.find((item) => item.id === chatId);
      if (chatId) setRequestedChatId(chatId);
      if (target) setSelectedChat(target);
      queryClient.invalidateQueries({ queryKey: ['chats'] });
    };
    window.addEventListener('budgetbasket:open-chat', openChat);
    return () => window.removeEventListener('budgetbasket:open-chat', openChat);
  }, [chats, queryClient]);
  useEffect(() => {
    const target = chats.find((item) => item.id === requestedChatId);
    if (target) {
      setSelectedChat(target);
      setRequestedChatId('');
    }
  }, [chats, requestedChatId]);
  useEffect(() => {
    if (!open || !selectedChat || !lastChatStorageKey) return;
    localStorage.setItem(lastChatStorageKey, selectedChat.id);
  }, [lastChatStorageKey, open, selectedChat]);
  useEffect(() => {
    if (!open || selectedChat || !lastChatStorageKey) return;
    const saved = localStorage.getItem(lastChatStorageKey);
    const target = chats.find((item) => item.id === saved);
    if (target) setSelectedChat(target);
  }, [chats, lastChatStorageKey, open, selectedChat]);
  useEffect(() => {
    if (!open || !selectedChat) return;
    const token = localStorage.getItem(AUTH_TOKEN_KEY);
    if (!token) return;
    let socket: WebSocket | null = new WebSocket(chatWebSocketUrl(selectedChat.id, token));
    socket.onmessage = () => {
      queryClient.invalidateQueries({ queryKey: ['chats'] });
      queryClient.invalidateQueries({ queryKey: ['chats', selectedChat.id] });
    };
    return () => { socket?.close(); socket = null; };
  }, [open, queryClient, selectedChat]);
  useEffect(() => {
    const latest = chat?.messages.at(-1);
    if (!open || !selectedChat || !chat || !latest) return;
    const participant = chat.participants.find((item) => item.user_id === currentUserId);
    const marker = `${selectedChat.id}:${latest.id}`;
    if (participant?.last_read_message_id === latest.id || lastMarkedReadRef.current === marker) return;
    lastMarkedReadRef.current = marker;
    markRead.mutate({ chatId: selectedChat.id, messageId: latest.id }, { onError: () => { lastMarkedReadRef.current = ''; } });
  }, [chat, currentUserId, markRead, open, selectedChat]);
  useEffect(() => { messagesRef.current?.scrollTo({ top: messagesRef.current.scrollHeight, behavior: 'smooth' }); }, [chat?.messages.at(-1)?.id]);

  const grouped = [
    { kind: 'module_cfo' as const, label: 'Модуль — ЦФО' },
    { kind: 'cfo_economist' as const, label: 'ЦФО — экономист' },
  ];
  const writable = currentUser.role !== 'admin';
  return <Drawer anchor="right" open={open} onClose={onClose} PaperProps={{ className: 'chat-inbox-drawer' }}>
    {selectedChat ? <>
      <Stack className="chat-inbox-thread-header" direction="row" alignItems="center" spacing={1.25}>
        <IconButton onClick={() => { setSelectedChat(null); if (lastChatStorageKey) localStorage.removeItem(lastChatStorageKey); }} aria-label="Вернуться к списку чатов"><ArrowBackIcon /></IconButton>
        <Stack minWidth={0} flex={1} spacing={0.35}><Typography fontWeight={700} noWrap>{chatTitle(selectedChat)}</Typography><Typography variant="body2" color="text.secondary" noWrap>{chatSubtitle(selectedChat)}</Typography></Stack>
        <IconButton onClick={onClose} aria-label="Закрыть чат"><CloseIcon /></IconButton>
      </Stack>
      <Box ref={messagesRef} className="chat-inbox-messages" aria-live="polite">
        {hasOlder && <Button size="small" disabled={loadingOlder} onClick={() => void loadOlder(messagesRef.current)}>{olderError ? 'Повторить загрузку сообщений' : 'Предыдущие сообщения'}</Button>}
        {!chat?.messages.length && <Box className="request-chat-empty"><ForumOutlinedIcon color="primary" fontSize="large" /><Typography fontWeight={700}>Начните обсуждение</Typography></Box>}
        {chat?.messages.map((message, index) => {
          const isSystem = !!message.is_system; const isOwn = !isSystem && message.sender?.id === currentUserId;
          const previous = chat.messages[index - 1]; const startsNewDay = !previous || chatDayKey(previous.created_at) !== chatDayKey(message.created_at);
          const reply = message.reply_preview || (message.reply_to ? chat.messages.find((item) => item.id === message.reply_to) : undefined);
          const messageIndex = chat.messages.findIndex((item) => item.id === message.id);
          const read = isOwn && (message.read_by_other ?? chat.participants.filter((item) => item.user_id !== currentUserId).some((item) => chat.messages.findIndex((entry) => entry.id === item.last_read_message_id) >= messageIndex));
          return <Fragment key={message.id}>{startsNewDay && <Box className="chat-day-divider">{chatDayLabel(message.created_at)}</Box>}<Box className={`request-chat-message ${isOwn ? 'request-chat-message-own' : ''} ${isSystem ? 'request-chat-message-system' : ''}`}><Box className="request-chat-bubble">
            {!isOwn && !isSystem && <Typography className="request-chat-sender" variant="caption">{senderName(message.sender)}</Typography>}
            {isSystem && <Typography className="request-chat-system-label" variant="caption">Системное сообщение</Typography>}
            {reply && <Box className="chat-reply-reference"><Typography variant="caption" fontWeight={700}>{senderName(reply.sender)}</Typography><Typography variant="caption" noWrap>{reply.text}</Typography></Box>}
            <ChatMessageImages files={message.files || []} /><Stack className="chat-message-content" direction="row" alignItems="flex-end" spacing={0.55}><ChatMessageText text={message.text} /><Stack className="chat-message-meta" direction="row" alignItems="center" spacing={0.3}><Typography className="request-chat-time" variant="caption">{messageTime(message.created_at)}</Typography>{isOwn && (read ? <DoneAllIcon className="chat-message-status read" fontSize="inherit" /> : <DoneIcon className="chat-message-status" fontSize="inherit" />)}</Stack></Stack>
          </Box>{!isSystem && writable && <Tooltip title="Ответить"><IconButton className="chat-message-forward" size="small" onClick={() => setReplyTo(message)} aria-label="Ответить"><ReplyOutlinedIcon fontSize="small" /></IconButton></Tooltip>}</Box></Fragment>;
        })}
      </Box>
      {writable && <Box component="form" className="request-chat-composer" onSubmit={(event) => { event.preventDefault(); if ((messageText.trim() || pendingImages.length) && !sendMessage.isPending) sendMessage.mutate(); }}>
        {replyTo && <Stack className="chat-reply-composer" direction="row" alignItems="center" spacing={1}><Box minWidth={0} flex={1}><Typography variant="caption" fontWeight={700}>Ответ {senderName(replyTo.sender)}</Typography><Typography variant="caption" noWrap display="block">{replyTo.text}</Typography></Box><IconButton size="small" onClick={() => setReplyTo(null)} aria-label="Отменить ответ"><CloseIcon fontSize="small" /></IconButton></Stack>}
        <TextField fullWidth size="small" placeholder="Напишите сообщение..." value={messageText} onChange={(event) => setMessageText(event.target.value)} multiline minRows={1} maxRows={4} />
        <IconButton component="label" aria-label="Прикрепить изображения" disabled={sendMessage.isPending}><AttachFileIcon /><input hidden type="file" accept="image/png,image/jpeg,image/gif,image/webp" multiple onChange={(event) => { const images = Array.from(event.target.files || []); setPendingImages((current) => [...current, ...images.filter((file) => !current.some((item) => item.name === file.name && item.size === file.size && item.lastModified === file.lastModified))]); event.currentTarget.value = ''; }} /></IconButton>
        {!!pendingImages.length && <Box className="chat-pending-images">{pendingImages.map((image) => <Chip key={`${image.name}-${image.lastModified}`} size="small" label={image.name} onDelete={() => setPendingImages((current) => current.filter((item) => item !== image))} />)}</Box>}
        <Button type="submit" className="request-chat-send" variant="contained" endIcon={<SendIcon />} disabled={(!messageText.trim() && !pendingImages.length) || sendMessage.isPending}>Отправить</Button>
      </Box>}
    </> : <>
      <Stack className="chat-inbox-header" direction="row" alignItems="center" justifyContent="space-between"><Box><Typography variant="h6">Чаты</Typography><Typography variant="body2" color="text.secondary">Обсуждения по модулям и ЦФО</Typography></Box><IconButton onClick={onClose} aria-label="Закрыть список чатов"><CloseIcon /></IconButton></Stack>
      {chats.length ? (
        <Stack className="chat-inbox-list" spacing={0}>
          {grouped.map((group) => {
            const rows = chats.filter((item) => item.kind === group.kind);
            if (!rows.length) return null;
            return <Fragment key={group.kind}>
              <Typography variant="overline" color="text.secondary" sx={{ px: 2, pt: 1.5 }}>{group.label}</Typography>
              {rows.map((item) => <Box key={item.id} component="button" type="button" className={`chat-list-row ${item.unread_count ? 'has-unread' : ''}`} onClick={() => setSelectedChat(item)}>
                <Box className="chat-list-icon"><ForumOutlinedIcon /></Box>
                <Stack spacing={0.35} minWidth={0} flex={1} alignItems="flex-start">
                  <Stack direction="row" spacing={1} alignItems="center" width="100%" minWidth={0}>
                    <Typography className="chat-list-title">{chatTitle(item)}</Typography>
                    {item.unread_count > 0 && <Chip size="small" color="primary" label={item.unread_count} />}
                  </Stack>
                  <Typography className="chat-list-request">{chatSubtitle(item)}</Typography>
                  <Typography className="chat-list-preview" color={item.last_message ? undefined : 'text.secondary'}>
                    {item.last_message ? <>{!item.last_message.is_system && <><strong>{senderName(item.last_message.sender)}:</strong>{' '}</>}{item.last_message.text}</> : 'Сообщений пока нет'}
                  </Typography>
                </Stack>
                {item.last_message && <Typography className="chat-list-time" color="text.secondary">{messageTime(item.last_message.created_at)}</Typography>}
              </Box>)}
            </Fragment>;
          })}
        </Stack>
      ) : <Stack className="chats-empty" alignItems="center" spacing={1.25}><MarkChatUnreadOutlinedIcon color="disabled" fontSize="large" /><Typography color="text.secondary">Нет доступных чатов.</Typography></Stack>}
    </>}
  </Drawer>;
}
