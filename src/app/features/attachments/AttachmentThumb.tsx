import { useRef } from 'react';
import { useImageReady } from '../../ui/imageReady';
import { Icon, type IconName } from '../../ui/Icon';
import { fileIcon } from './fileIcon';
import { useThumbnail, type ThumbFile } from './thumbs';

/** The type icon until a preview has decoded, then the preview fades in over it. */
export function AttachmentThumb({ file, iconSize }: { file: ThumbFile; iconSize: 32 | 36 }) {
  const ref = useRef<HTMLSpanElement>(null);
  const preview = useThumbnail(file, ref);
  const image = useImageReady(preview?.kind === 'image' ? preview.url : undefined);
  const shown = preview?.kind === 'text' || (preview?.kind === 'image' && image.ready);
  return (
    <span className="att-card__thumb" ref={ref} data-loaded={shown || undefined} data-preview={preview?.kind}>
      <Icon name={fileIcon(file.mimeType, file.filename) as IconName} size={iconSize} className="att-card__thumb-icon" />
      {preview?.kind === 'image' && (
        <img key={preview.url} src={preview.url} alt="" decoding={image.instant ? 'sync' : 'async'} data-instant={image.instant || undefined} />
      )}
      {preview?.kind === 'text' && <pre className="att-card__text">{preview.text}</pre>}
    </span>
  );
}
