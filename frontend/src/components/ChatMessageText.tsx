import Typography from '@mui/material/Typography';

export function ChatMessageText({ text }: { text: string }) {
  const lines = text.split('\n');

  return (
    <Typography className="request-chat-text">
      {lines.map((line, index) => {
        const isListItem = line.trimStart().startsWith('•');
        const isGeneralComment = line.startsWith('Общий комментарий:');
        const separatorIndex = isListItem || isGeneralComment ? line.indexOf(':') : -1;
        const content = separatorIndex >= 0 ? (
          <>
            {line.slice(0, separatorIndex + 1)}
            <strong>{line.slice(separatorIndex + 1)}</strong>
          </>
        ) : line;

        return (
          <span
            key={`${index}-${line}`}
            className={isListItem ? 'request-chat-list-item' : undefined}
          >
            {content}
            {index < lines.length - 1 && <br />}
          </span>
        );
      })}
    </Typography>
  );
}
