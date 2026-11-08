export function fileIcon(mimeType: string, filename = ''): string {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  // Mail clients often send octet-stream; then the extension is all there is.
  const generic = !mimeType || mimeType === 'application/octet-stream';
  if (mimeType.startsWith('image/') || (generic && ['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif', 'bmp', 'svg', 'tif', 'tiff'].includes(ext))) return 'image';
  if (mimeType === 'application/pdf' || ext === 'pdf') return 'picture_as_pdf';
  if (mimeType.includes('spreadsheet') || mimeType.includes('excel') || ['csv', 'xlsx', 'xls', 'numbers'].includes(ext)) return 'table_chart';
  if (mimeType === 'text/calendar' || ext === 'ics') return 'event';
  if (mimeType.startsWith('video/') || mimeType.startsWith('audio/') || (generic && ['mp4', 'mov', 'webm', 'mkv', 'avi', 'mp3', 'm4a', 'wav', 'aac', 'ogg', 'flac'].includes(ext))) return 'play_arrow';
  if (mimeType.includes('zip') || ['zip', 'gz', 'tar', '7z'].includes(ext)) return 'folder';
  return 'description';
}

/** Mirrors Drive's type colors. */
export function fileKind(mimeType: string, filename = ''): 'image' | 'pdf' | 'sheet' | 'event' | 'media' | 'doc' {
  const icon = fileIcon(mimeType, filename);
  return icon === 'image'
    ? 'image'
    : icon === 'picture_as_pdf'
      ? 'pdf'
      : icon === 'table_chart'
        ? 'sheet'
        : icon === 'event'
          ? 'event'
          : icon === 'play_arrow'
            ? 'media'
            : 'doc';
}
