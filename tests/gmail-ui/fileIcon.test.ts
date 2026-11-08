import { fileIcon, fileKind } from '../../src/app/features/attachments/fileIcon';
import iconNames from '../../src/app/ui/icon-names.json';

const CASES: [string, string, ReturnType<typeof fileKind>][] = [
  ['application/pdf', 'invoice.pdf', 'pdf'],
  ['image/png', 'screenshot.png', 'image'],
  ['image/jpeg', 'IMG_2041.JPG', 'image'],
  ['image/heic', 'IMG_2042.HEIC', 'image'],
  ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'budget.xlsx', 'sheet'],
  ['text/csv', 'export.csv', 'sheet'],
  ['application/vnd.google-apps.spreadsheet', 'Budget', 'sheet'],
  ['text/calendar', 'invite.ics', 'event'],
  ['application/ics', 'invite.ics', 'event'],
  ['video/mp4', 'demo.mp4', 'media'],
  ['audio/mpeg', 'voicemail.mp3', 'media'],
  ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'contract.docx', 'doc'],
  ['text/plain', 'notes.txt', 'doc'],
  // Mail clients often send octet-stream; Gmail goes by the extension then.
  ['application/octet-stream', 'scan.PDF', 'pdf'],
  ['application/octet-stream', 'photo.jpeg', 'image'],
  ['application/octet-stream', 'q4.xlsx', 'sheet'],
  ['application/octet-stream', 'meeting.ics', 'event'],
];

describe('fileKind', () => {
  it.each(CASES)('%s %s -> %s', (mime, name, kind) => {
    expect(fileKind(mime, name)).toBe(kind);
  });
});

describe('fileIcon', () => {
  it.each(CASES)('%s %s has an icon in the subset font', (mime, name) => {
    expect(iconNames as string[]).toContain(fileIcon(mime, name));
  });

  it('gives PDFs, images and spreadsheets different icons', () => {
    const icons = new Set([fileIcon('application/pdf', 'a.pdf'), fileIcon('image/png', 'a.png'), fileIcon('text/csv', 'a.csv')]);
    expect(icons.size).toBe(3);
  });
});
