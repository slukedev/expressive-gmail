import { describe, expect, it } from 'vitest';
import { attachmentMention } from '../../src/app/features/attachreminder/mentions';

const check = (html: string, subject = '', checkSubject = true) => attachmentMention({ html, subject, checkSubject });
const div = (text: string) => `<div>${text}</div>`;

describe('attachmentMention', () => {
  // [message, the phrase the dialog quotes]
  const flagged: Record<string, [string, string][]> = {
    English: [
      ['<div>Hi Lena,</div><div>I’ve attached the signed lease.</div>', 'I’ve attached'],
      ['<p>Attaching the deck for Thursday.</p>', 'Attaching'],
      ['<div>Quick one. Attached is the invoice for March.</div>', 'Attached'],
      ['<div>Please find attached my notes</div>', 'find attached'],
      ['<div>The receipts are attached, let me know if anything is missing.</div>', 'receipts are attached'],
      ['<div>Details are in the attachment.</div>', 'in the attachment'],
      ['<div>PFA</div>', 'PFA'],
      ['<div>Thanks again! I’ve attached the photos from Saturday.</div>', 'I’ve attached'],
      ['<div>Thanks for the notes, the attached file has my changes.</div>', 'the attached'],
      ['<div>We have included two screenshots of the bug.</div>', 'We have included two screenshots'],
      ['<div>No worries. I&#700;ve attached it.</div>', 'Iʼve attached'],
      ['<div>I’ve attached to this email the signed contract.</div>', 'I’ve attached'],
      ['<div>I’ve attached the deck, can you check slide 4?</div>', 'I’ve attached'],
    ],
    Spanish: [
      [div('Hola Marta, te adjunto el presupuesto.'), 'te adjunto'],
      [div('Adjunto encontrarás la factura de marzo.'), 'Adjunto'],
      [div('Revisa el archivo adjunto cuando puedas.'), 'archivo adjunto'],
      [div('He adjuntado las fotos del viaje.'), 'He adjuntado'],
    ],
    French: [
      [div('Bonjour, je vous joins le devis signé.'), 'je vous joins'],
      [div('Merci, ci-joint le compte rendu.'), 'ci-joint'],
      [div('Vous trouverez le planning en pièce jointe.'), 'en pièce jointe'],
      [div('J’ai joint les deux versions.'), 'J’ai joint'],
    ],
    German: [
      [div('Hallo Jonas, anbei die Rechnung.'), 'anbei'],
      [div('Die Unterlagen findest du im Anhang.'), 'im Anhang'],
      [div('Ich habe dir die Präsentation angehängt.'), 'Ich habe dir die Präsentation angehängt'],
      [div('Ich hänge dir die Datei an.'), 'Ich hänge dir die Datei an'],
      [div('Details siehe Dateianhang.'), 'siehe Dateianhang'],
      [div('Die beigefügte Tabelle zeigt alles.'), 'Die beigefügte'],
      [div('IM ANHANG die Liste'), 'IM ANHANG'],
    ],
    Portuguese: [
      [div('Oi Ana, segue em anexo o contrato.'), 'segue em anexo'],
      [div('Anexei as fotos da obra.'), 'Anexei'],
      [div('O relatório está em anexo.'), 'em anexo'],
    ],
    Italian: [
      [div('Ciao Luca, ti allego il preventivo.'), 'allego'],
      [div('Trovi il programma in allegato.'), 'in allegato'],
      [div('Ho allegato il file.'), 'Ho allegato'],
    ],
    Dutch: [
      [div('Hoi Sanne, in de bijlage vind je de offerte.'), 'in de bijlage'],
      [div('Ik heb het rooster bijgevoegd.'), 'Ik heb het rooster bijgevoegd'],
      [div('Hierbij stuur ik je de factuur.'), 'Hierbij stuur'],
    ],
    Polish: [
      [div('Dzień dobry, w załączniku przesyłam umowę.'), 'w załączniku'],
      [div('Załączam fakturę za marzec.'), 'Załączam'],
      [div('w zalaczniku cennik'), 'w zalaczniku'],
    ],
    Swedish: [
      [div('Hej Erik, jag bifogar offerten.'), 'bifogar'],
      [div('Schemat finns i bilagan.'), 'i bilagan'],
      [div('Bifogat finner du protokollet.'), 'Bifogat'],
    ],
    Russian: [
      [div('Добрый день, прилагаю договор.'), 'прилагаю'],
      [div('Счёт во вложении.'), 'во вложении'],
      [div('Я прикрепил презентацию.'), 'Я прикрепил'],
    ],
    Japanese: [
      [div('お世話になっております。資料を添付いたします。'), '添付いたします'],
      [div('添付ファイルをご確認ください。'), '添付ファイル'],
      [div('見積書を添付しました。'), '添付しました'],
    ],
    Chinese: [
      [div('王经理您好，请查收附件。'), '请查收附件'],
      [div('報價單請見附件。'), '請見附件'],
      [div('随信附上合同。'), '随信附上'],
      [div('详细内容在附件中。'), '附件中'],
    ],
    Korean: [
      [div('안녕하세요, 견적서를 첨부합니다.'), '첨부합니다'],
      [div('첨부파일 확인 부탁드립니다.'), '첨부파일'],
      [div('자료를 첨부해 드립니다.'), '첨부해 드립니다'],
    ],
  };

  const quiet: Record<string, string[]> = {
    English: [
      'Thanks for the attached report, it reads well.',
      'Got your attachment, looks great.',
      'No attachment needed, the link works.',
      "I didn't attach anything this time.",
      'Honestly I’m so attached to the old logo.',
      'She is attached to her desk plant.',
      'Sounds good, see you at 3.',
      'Is the report attached to your last email?',
      'I am attached to this plan.',
      'We are attaching great importance to this.',
      'Join us at the enclosed garden.',
    ],
    Spanish: ['Gracias por el archivo adjunto.', 'No te adjunto nada, ya lo tienes.', 'Habla con el director adjunto.', 'Recibí tus archivos adjuntos.'],
    French: ['Merci pour la pièce jointe.', 'Pas de pièce jointe cette fois.', 'Je suis très attaché à ce projet.', 'Envoyé sans pièce jointe.'],
    German: ['Danke für den Anhang.', 'Kein Anhang nötig.', 'Ich habe die Datei nicht angehängt.', 'Ich hänge noch an dem Projekt.', 'Ich hänge das Bild an die Wand.', 'Wir arbeiten in der Anlage im Norden.', 'Siehe im Anhang deiner Mail.'],
    Portuguese: ['Obrigado pelo anexo.', 'Não segue anexo, está no link.', 'Recebi seus arquivos anexados.'],
    Italian: ['Grazie per l’allegato.', 'Non ho allegato niente.', 'Ho ricevuto il tuo file allegato.'],
    Dutch: ['Bedankt voor de bijlage.', 'Geen bijlage nodig.', 'Ik heb het niet bijgevoegd.'],
    Polish: ['Dziękuję za załącznik.', 'Nie załączam umowy.', 'Bez załącznika tym razem.'],
    Swedish: ['Tack för bilagan.', 'Jag har inte bifogat den.', 'Ingen bilaga behövs.'],
    Russian: ['Спасибо за вложение.', 'Я не прикрепил файл.', 'Вы прикрепили не тот файл.', 'Без вложения.', 'Я приложил все силы.', 'В приложении банка ошибка.'],
    Japanese: ['添付ファイルありがとうございます。', '添付ファイルはありません。', '送っていただいた添付資料を拝見しました。'],
    Chinese: ['谢谢你的附件。', '没有附件。', '收到附件了，谢谢。', '汽车附件很贵。'],
    Korean: ['보내주신 첨부파일 감사합니다.', '첨부파일이 없습니다.', '첨부파일 잘 받았습니다.'],
  };

  for (const [language, cases] of Object.entries(flagged)) {
    it.each(cases)(`flags ${language}: %s`, (html, phrase) => {
      expect(check(html)).toBe(phrase);
    });
  }

  for (const [language, texts] of Object.entries(quiet)) {
    it.each(texts)(`leaves ${language} alone: %s`, (text) => {
      expect(check(div(text))).toBeNull();
    });
  }

  it('ignores quoted mail and the signature', () => {
    const html =
      '<div>Works for me.</div>' +
      '<div class="gmail_signature">-- <br>Sam, see attached map for directions</div>' +
      '<div class="gmail_quote"><div class="gmail_attr">On Mon, Ana wrote:</div><blockquote>I’ve attached the plan.</blockquote></div>';
    expect(check(html)).toBeNull();
    expect(check('<div>Passt.</div><div class="gmail_quote"><blockquote>Anbei der Vertrag.</blockquote></div>')).toBeNull();
    expect(check('<div>了解しました。</div><div class="gmail_quote"><blockquote>資料を添付いたします。</blockquote></div>')).toBeNull();
  });

  it('ignores plain-text quote lines', () => {
    expect(check('<div>Sure thing.<br>&gt; I have attached the form<br>&gt; thanks</div>')).toBeNull();
    expect(check('<div>Merci.<br>&gt; Ci-joint le devis</div>')).toBeNull();
  });

  it('only reads the subject on new messages', () => {
    expect(check('<div>Here you go.</div>', 'Contract attached', true)).toBe('Contract attached');
    expect(check('<div>Thanks!</div>', 'Re: Contract attached', false)).toBeNull();
    expect(check('<div>Bitte prüfen.</div>', 'Rechnung im Anhang', true)).toBe('im Anhang');
    // A restored forward draft opens as a new message, but its subject came with the earlier mail.
    expect(check('<div>FYI</div>', 'Fwd: Contract attached', true)).toBeNull();
    expect(check('<div>Zur Info</div>', 'WG: Rechnung im Anhang', true)).toBeNull();
  });

  it('treats a shared Drive or Dropbox link as the file', () => {
    expect(check('<div>I’ve attached the cut: <a href="https://drive.google.com/file/d/abc">trailer.mov</a></div>')).toBeNull();
    expect(check('<div>Anbei der Link: <a href="https://www.dropbox.com/s/xyz">Pläne</a></div>')).toBeNull();
    // A link anywhere else doesn't count.
    expect(check('<div>I’ve attached the cut, more at <a href="https://example.com/blog">our blog</a></div>')).toBe('I’ve attached');
    // Nor does one in the quoted mail or the signature: that isn't this message's file.
    expect(
      check('<div>I’ve attached the new cut.</div><div class="gmail_quote"><blockquote><a href="https://drive.google.com/file/d/old">old cut</a></blockquote></div>'),
    ).toBe('I’ve attached');
    expect(check('<div>Anbei die Rechnung.</div><div class="gmail_signature"><a href="https://www.dropbox.com/sh/brand">Logos</a></div>')).toBe('Anbei');
  });

  it('counts a picture in the body only when the sentence is about a picture', () => {
    const img = '<img src="https://img.example.com/view.png" alt="">';
    expect(check(`<div>I’ve attached a screenshot of the error:</div><div>${img}</div>`)).toBeNull();
    expect(check(`<div>Hier im Anhang das Foto vom Lager.</div><div>${img}</div>`)).toBeNull();
    expect(check(`<div>截图在附件中。</div><div>${img}</div>`)).toBeNull();
    // Gmail's rule otherwise: an inline picture isn't the attachment.
    expect(check(`<div>I’ve attached the contract.</div><div>${img}</div>`)).toBe('I’ve attached');
    // The picture has to be the writer's own, not one in the signature.
    expect(check(`<div>I’ve attached a photo of the site.</div><div class="gmail_signature">${img}</div>`)).toBe('I’ve attached');
  });
});
