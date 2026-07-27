import ArrowBackIcon from '@mui/icons-material/ArrowBack';
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
import Link from '@mui/material/Link';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { chatDayKey, chatDayLabel } from '../utils/chat';
import { AUTH_USER_KEY } from '../utils/session';
import { RequestStatusBadge } from './StatusBadge';
import type { Profile, RequestStatus } from '../types';

type ChatSender = {
  id: string;
  login: string;
  profile?: Profile | null;
};

type ChatMessage = {
  id: string;
  text: string;
  created_at: string;
  is_system?: boolean;
  reply_to?: string | null;
  sender: ChatSender | null;
};

type ChatSummary = {
  id: string;
  request_id: string;
  request_status: RequestStatus;
  unit_name: string;
  unread_count: number;
  last_message: ChatMessage | null;
};

type RequestChat = {
  participants: { user_id: string; last_read_message_id: string | null }[];
  messages: ChatMessage[];
};

function senderName(sender: ChatSender | null) {
  if (!sender) return 'Система';
  const profile = sender.profile;
  return [profile?.last_name, profile?.name].filter(Boolean).join(' ') || sender.login;
}

function messageTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('ru-RU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function chatTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

export function ChatInboxDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [selectedChat, setSelectedChat] = useState<ChatSummary | null>(null);
  const [messageText, setMessageText] = useState('');
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const lastMarkedReadRef = useRef('');
  const currentUserId = useMemo(() => {
    try {
      return (JSON.parse(localStorage.getItem(AUTH_USER_KEY) || '{}') as { id?: string }).id || '';
    } catch {
      return '';
    }
  }, []);
  const lastChatStorageKey = currentUserId ? `budgetbasket_last_chat_${currentUserId}` : '';
  const { data: chats = [] } = useQuery({
    queryKey: ['chats'],
    queryFn: async () => (await api.get<ChatSummary[]>('/chats')).data,
  });
  const { data: requestChat } = useQuery({
    queryKey: ['request-details', selectedChat?.request_id, 'chat'],
    queryFn: async () => (await api.get<RequestChat>(`/requests/${selectedChat!.request_id}/chat`)).data,
    enabled: !!selectedChat,
  });

  const markRead = useMutation({
    mutationFn: async ({ requestId, messageId }: { requestId: string; messageId: string }) =>
      api.patch(`/requests/${requestId}/chat/read`, { last_read_message_id: messageId }),
    onSuccess: async (_response, { requestId }) => {
      await queryClient.invalidateQueries({ queryKey: ['chats'] });
      await queryClient.invalidateQueries({ queryKey: ['request-details', requestId, 'chat'] });
    },
  });
  const sendMessage = useMutation({
    mutationFn: async () => api.post(`/requests/${selectedChat!.request_id}/chat/messages`, {
      text: messageText.trim(),
      reply_to: replyTo?.id || null,
    }),
    onSuccess: async () => {
      setMessageText('');
      setReplyTo(null);
      await queryClient.invalidateQueries({ queryKey: ['chats'] });
      await queryClient.invalidateQueries({ queryKey: ['request-details', selectedChat?.request_id, 'chat'] });
    },
  });

  useEffect(() => {
    if (!open) setMessageText('');
  }, [open]);

  useEffect(() => {
    if (!selectedChat || !lastChatStorageKey) return;
    localStorage.setItem(lastChatStorageKey, selectedChat.request_id);
  }, [lastChatStorageKey, selectedChat]);

  useEffect(() => {
    if (selectedChat || !chats.length || !lastChatStorageKey) return;
    const lastRequestId = localStorage.getItem(lastChatStorageKey);
    const lastChat = chats.find((chat) => chat.request_id === lastRequestId);
    if (lastChat) setSelectedChat(lastChat);
  }, [chats, lastChatStorageKey, selectedChat]);

  useEffect(() => {
    if (!selectedChat || !requestChat?.messages.length) return;
    const latestMessage = requestChat.messages.at(-1)!;
    const currentParticipant = requestChat.participants.find((participant) => participant.user_id === currentUserId);
    const marker = `${selectedChat.request_id}:${latestMessage.id}`;
    if (currentParticipant?.last_read_message_id === latestMessage.id || lastMarkedReadRef.current === marker) return;
    lastMarkedReadRef.current = marker;
    markRead.mutate(
      { requestId: selectedChat.request_id, messageId: latestMessage.id },
      { onError: () => { lastMarkedReadRef.current = ''; } },
    );
  }, [currentUserId, markRead, requestChat, selectedChat]);

  useEffect(() => {
    if (selectedChat) messagesRef.current?.scrollTo({ top: messagesRef.current.scrollHeight, behavior: 'smooth' });
  }, [requestChat?.messages.length, selectedChat]);

  const openRequest = () => {
    if (!selectedChat) return;
    onClose();
    navigate(`/requests/${selectedChat.request_id}`);
  };

  return (
    <>
      <Drawer anchor="right" open={open} onClose={onClose} PaperProps={{ className: 'chat-inbox-drawer' }}>
      {selectedChat ? (
        <>
          <Stack className="chat-inbox-thread-header" direction="row" alignItems="center" spacing={1.25}>
            <IconButton
              onClick={() => {
                setSelectedChat(null);
                if (lastChatStorageKey) localStorage.removeItem(lastChatStorageKey);
              }}
              aria-label="Вернуться к списку чатов"
            >
              <ArrowBackIcon />
            </IconButton>
            <Stack minWidth={0} flex={1} spacing={0.35}>
              <Stack direction="row" alignItems="center" spacing={0.75} minWidth={0}>
                <Typography fontWeight={700} noWrap>{selectedChat.unit_name}</Typography>
                <RequestStatusBadge status={selectedChat.request_status} />
              </Stack>
              <Link component="button" type="button" className="chat-inbox-request-link" underline="hover" onClick={openRequest}>
                Заявка {selectedChat.request_id.slice(0, 8)}
              </Link>
            </Stack>
            <IconButton onClick={onClose} aria-label="Закрыть чат"><CloseIcon /></IconButton>
          </Stack>

          <Box ref={messagesRef} className="chat-inbox-messages" aria-live="polite">
            {!requestChat?.messages.length && (
              <Box className="request-chat-empty">
                <ForumOutlinedIcon color="primary" fontSize="large" />
                <Typography fontWeight={700}>Начните обсуждение</Typography>
                <Typography variant="body2" color="text.secondary">Уточняйте детали заявки прямо здесь.</Typography>
              </Box>
            )}
            {requestChat?.messages.map((message, index) => {
              const isSystem = !!message.is_system;
              const isOwn = !isSystem && message.sender?.id === currentUserId;
              const previousMessage = requestChat.messages[index - 1];
              const startsNewDay = !previousMessage || chatDayKey(previousMessage.created_at) !== chatDayKey(message.created_at);
              const reply = message.reply_to ? requestChat.messages.find((item) => item.id === message.reply_to) : undefined;
              const messageIndex = requestChat.messages.findIndex((item) => item.id === message.id);
              const isReadByRecipient = isOwn && requestChat.participants
                .filter((participant) => participant.user_id !== currentUserId)
                .some((participant) => requestChat.messages.findIndex((item) => item.id === participant.last_read_message_id) >= messageIndex);
              return (
                <Fragment key={message.id}>
                  {startsNewDay && <Box className="chat-day-divider">{chatDayLabel(message.created_at)}</Box>}
                  <Box className={`request-chat-message ${isOwn ? 'request-chat-message-own' : ''} ${isSystem ? 'request-chat-message-system' : ''}`}>
                  <Box className="request-chat-bubble">
                    {!isOwn && !isSystem && <Typography className="request-chat-sender" variant="caption">{senderName(message.sender)}</Typography>}
                    {isSystem && <Typography className="request-chat-system-label" variant="caption">Системное сообщение</Typography>}
                    {reply && (
                      <Box className="chat-reply-reference">
                        <Typography variant="caption" fontWeight={700}>{senderName(reply.sender)}</Typography>
                        <Typography variant="caption" noWrap>{reply.text}</Typography>
                      </Box>
                    )}
                    <Stack className="chat-message-content" direction="row" alignItems="flex-end" spacing={0.55}>
                      <Typography className="request-chat-text">{message.text}</Typography>
                      <Stack className="chat-message-meta" direction="row" alignItems="center" spacing={0.3}>
                        <Typography className="request-chat-time" variant="caption">{chatTime(message.created_at)}</Typography>
                        {isOwn && (isReadByRecipient ? (
                          <Tooltip title="Прочитано"><DoneAllIcon className="chat-message-status read" fontSize="inherit" /></Tooltip>
                        ) : (
                          <Tooltip title="Доставлено, но ещё не прочитано"><DoneIcon className="chat-message-status" fontSize="inherit" /></Tooltip>
                        ))}
                      </Stack>
                    </Stack>
                  </Box>
                  {!isSystem && <Tooltip title="Ответить">
                    <IconButton className="chat-message-forward" size="small" onClick={() => setReplyTo(message)} aria-label="Ответить на сообщение">
                      <ReplyOutlinedIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>}
                  </Box>
                </Fragment>
              );
            })}
          </Box>

          <Box
            component="form"
            className="request-chat-composer"
            onSubmit={(event) => {
              event.preventDefault();
              if (messageText.trim() && !sendMessage.isPending) sendMessage.mutate();
            }}
          >
            {replyTo && (
              <Stack className="chat-reply-composer" direction="row" alignItems="center" spacing={1}>
                <Box minWidth={0} flex={1}>
                  <Typography variant="caption" fontWeight={700}>Ответ {senderName(replyTo.sender)}</Typography>
                  <Typography variant="caption" noWrap display="block">{replyTo.text}</Typography>
                </Box>
                <IconButton size="small" onClick={() => setReplyTo(null)} aria-label="Отменить ответ"><CloseIcon fontSize="small" /></IconButton>
              </Stack>
            )}
            <TextField
              fullWidth
              size="small"
              placeholder="Напишите сообщение..."
              value={messageText}
              onChange={(event) => setMessageText(event.target.value)}
              multiline
              minRows={1}
              maxRows={4}
            />
            <Button type="submit" className="request-chat-send" variant="contained" endIcon={<SendIcon />} disabled={!messageText.trim() || sendMessage.isPending}>
              Отправить
            </Button>
          </Box>
        </>
      ) : (
        <>
          <Stack className="chat-inbox-header" direction="row" alignItems="center" justifyContent="space-between">
            <Box>
              <Typography variant="h6">Чаты</Typography>
              <Typography variant="body2" color="text.secondary">Сообщения по заявкам</Typography>
            </Box>
            <IconButton onClick={onClose} aria-label="Закрыть список чатов"><CloseIcon /></IconButton>
          </Stack>
          {chats.length ? (
            <Stack className="chat-inbox-list" spacing={0}>
              {chats.map((chat) => (
                <Box
                  key={chat.id}
                  component="button"
                  type="button"
                  className={`chat-list-row ${chat.unread_count ? 'has-unread' : ''}`}
                  onClick={() => setSelectedChat(chat)}
                >
                  <Box className="chat-list-icon"><ForumOutlinedIcon /></Box>
                  <Stack spacing={0.35} minWidth={0} flex={1} alignItems="flex-start">
                    <Stack direction="row" spacing={1} alignItems="center" width="100%" minWidth={0}>
                      <Typography className="chat-list-title" noWrap>{chat.unit_name}</Typography>
                      <RequestStatusBadge status={chat.request_status} />
                      {chat.unread_count > 0 && <Chip size="small" color="primary" label={chat.unread_count} />}
                    </Stack>
                    <Typography className="chat-list-request" noWrap>Заявка {chat.request_id.slice(0, 8)}</Typography>
                    {chat.last_message ? (
                      <Typography className="chat-list-preview" noWrap>
                        {!chat.last_message.is_system && <><strong>{senderName(chat.last_message.sender)}:</strong> </>}{chat.last_message.text}
                      </Typography>
                    ) : (
                      <Typography className="chat-list-preview" color="text.secondary">Сообщений пока нет</Typography>
                    )}
                  </Stack>
                  {chat.last_message && <Typography className="chat-list-time" color="text.secondary">{messageTime(chat.last_message.created_at)}</Typography>}
                </Box>
              ))}
            </Stack>
          ) : (
            <Stack className="chats-empty" alignItems="center" spacing={1.25}>
              <MarkChatUnreadOutlinedIcon color="disabled" fontSize="large" />
              <Typography color="text.secondary">Нет доступных чатов.</Typography>
            </Stack>
          )}
        </>
      )}
      </Drawer>
    </>
  );
}
