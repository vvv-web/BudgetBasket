export function downloadBlob(data: Blob, filename: string) {
  const url = window.URL.createObjectURL(data);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}

export async function downloadAuthorized(path: string, filename: string) {
  const { api } = await import('../api/client');
  const response = await api.get(path, { responseType: 'blob' });
  downloadBlob(response.data, filename);
}
