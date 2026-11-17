/**
 * What people write when a file goes with their message, one table per language.
 * Every table runs on every message: most of these mails are a line or two, too short to tell the language reliably,
 * and the phrases are specific enough that one language's never shows up as another's.
 *
 * Patterns are written for lowercase-insensitive Unicode matching (`giu`), with `\b` meaning a Unicode word edge
 * so it works next to letters like é, ł or я. Apostrophes are already plain `'`. CJK patterns use no `\b`: those
 * scripts don't put spaces between words.
 */

export interface Language {
  name: string;
  /** The writer says they're attaching it, so "thanks" or "your" nearby doesn't change that. */
  attaching: RegExp[];
  /** Could be about mail that came in, so the received filters apply. */
  mentions: RegExp[];
  /** Tested on the clause before the phrase, and after it. */
  negatedBefore: RegExp;
  negatedAfter?: RegExp;
  receivedBefore: RegExp;
  receivedAfter?: RegExp;
  /** Tested around the phrase: uses of the word that aren't about files. */
  ignore?: RegExp;
}

const EDGE = String.raw`(?:(?<=[\p{L}\p{N}_])(?![\p{L}\p{N}_])|(?<![\p{L}\p{N}_])(?=[\p{L}\p{N}_]))`;
const unicodeEdges = (re: RegExp) => re.source.replaceAll(String.raw`\b`, EDGE);

const pattern = (re: RegExp) => new RegExp(unicodeEdges(re), 'giu');
const test = (re: RegExp) => new RegExp(unicodeEdges(re), 'iu');

/** One of `words`, then at most `gap` more words, ending where the phrase starts. */
function wordsBefore(words: string, gap: number) {
  return test(new RegExp(String.raw`\b(?:${words})\s+(?:[\p{L}\p{N}'-]+\s+){0,${gap}}$`, 'u'));
}

/** At the start of the text, a line or a sentence. */
const START = String.raw`(?<=(?:^|[\n.!?:;]\s)\s*)`;

const EN_NOUNS =
  'file|files|pdf|pdfs|doc|docs|document|documents|copy|copies|photo|photos|picture|pictures|image|images|screenshot|screenshots|scan|scans|invoice|invoices|receipt|receipts|resume|cv|spreadsheet|sheet|deck|slides|contract|form|forms|report|draft|agenda|itinerary|zip';

const english: Language = {
  name: 'English',
  attaching: [
    // "I've attached", "we're enclosing", "I also attached"
    /\b(?:i've|i have|we've|we have|i'm|i am|we're|we are|i|we)\s+(?:also\s+|just\s+|now\s+)?(?:attach(?:ed|ing)|enclos(?:ed|ing))\b/u,
    // "I've included the file", "including the slides"
    new RegExp(String.raw`\b(?:i've|i have|we've|we have|i|we|i'm|we're)\s+(?:also\s+)?includ(?:ed|ing)\s+(?:(?:a|an|the|my|our|both|all|two|three)\s+)?(?:${EN_NOUNS})\b`, 'u'),
    // "Attached is", "Attaching the deck", "Enclosed please find"
    new RegExp(String.raw`${START}(?:attach(?:ed|ing)|enclosed(?=\s+(?:please|is|are|you|herewith|find|the|an?|my|our)\b))\b`, 'u'),
    /\bforgot\s+(?:to\s+attach|the\s+attachment)\b/u,
    /\bpfa\b/u,
  ],
  mentions: [
    // "please find attached", "see the attachment"
    /\b(?:find|see|check|review|open)\s+(?:the\s+)?(?:attached|enclosed|attachments?)\b/u,
    /\battached\s+(?:is|are|you'll find|please find|herewith|here|below)\b/u,
    // "the attached file", "an attached copy"
    new RegExp(String.raw`\b(?:the|an?|my|our|both|two|three)\s+(?:attached|enclosed(?=\s+(?:${EN_NOUNS})\b))\b`, 'u'),
    // "in the attachment", "as an attachment", "attachment below"
    /\b(?:in|see|as|via|by)\s+(?:the\s+|an?\s+)?attachments?\b/u,
    /\battachments?\s+(?:below|here|included|contains?|has|have)\b/u,
    // "receipts are attached", and subject lines like "Contract attached"
    new RegExp(String.raw`\b(?:${EN_NOUNS})\s+(?:(?:is|are)\s+)?attached\b`, 'u'),
  ],
  negatedBefore: wordsBefore(String.raw`no|not|\p{L}*n't|without|never`, 2),
  receivedBefore: wordsBefore('thanks?|thank you|got|received|saw|read|opened|reviewed|looked at|your|his|her|their', 3),
  // Fond of something, fixed to it, or "attaching importance": "attached to" anything but the mail itself.
  ignore: test(
    /\b(?:(?:so|very|really|pretty|quite|too|grown|getting|got|become|became|deeply|emotionally)\s+attached|attached\s+to\s+(?!(?:this|the|my|our|that)\s+(?:e-?mail|message|mail|note|thread)\b)|attach(?:ed|ing|es)?\s+(?:(?:great|much|little|no|more|less|any)\s+)?(?:importance|significance|weight|value|strings|conditions))\b/u,
  ),
};

const spanish: Language = {
  name: 'Spanish',
  attaching: [
    // "te adjunto", "le envío adjunta la factura"
    /\b(?:te|le|les|os)\s+(?:adjunt(?:o|amos)|(?:env[íi]o|enviamos|mando|mandamos|remito)\s+adjunt[oa]s?)\b/u,
    /\b(?:he|hemos)\s+adjuntado\b/u,
    /\b(?:adjunt[ée]|estoy\s+adjuntando|olvid[ée]\s+adjuntar)\b/u,
    // "Adjunto el informe", "Adjunta va la factura"
    new RegExp(String.raw`${START}adjunt(?:o|a|os|as|amos)\b`, 'u'),
    /\bvan?\s+adjunt[oa]s?\b/u,
  ],
  mentions: [
    /\b(?:en\s+(?:el|los)\s+)?(?:archivos?|documentos?|datos)\s+adjuntos?\b/u,
    /\b(?:en\s+(?:el|los)|como)\s+adjuntos?\b/u,
    /\b(?:encontrar[áa]s?|encontrar[áa]n|encuentras?|ver|vea|veas|revisa|revise)\s+(?:el\s+|la\s+)?adjunt[oa]s?\b/u,
  ],
  negatedBefore: wordsBefore('no|sin|ning[úu]n|ninguna|nunca', 2),
  receivedBefore: wordsBefore('gracias|recib[íi]|recibido|recibimos|vi|le[íi]|tu|tus|su|sus|vuestro|vuestra', 3),
};

const french: Language = {
  name: 'French',
  attaching: [
    // "je vous joins", "je t'ai joint", "nous avons joint"
    /\b(?:je\s+|j'|nous\s+)(?:(?:vous|te|lui|leur)\s+|t')?(?:joins|joignons|ai\s+joint|avons\s+joint)\b/u,
    /\boubli[ée]\s+de\s+joindre\b/u,
  ],
  mentions: [
    /\bci[\s-]?joint(?:e|s|es)?\b/u,
    /\b(?:en\s+)?pi[èe]ces?[\s-]+jointes?\b/u,
    /\ben\s+pj\b/u,
    new RegExp(String.raw`${START}pj\s*:`, 'u'),
  ],
  negatedBefore: wordsBefore("pas|sans|aucune?|jamais|ni|n'", 2),
  ignore: test(/\bjoin\p{L}*\s+(?:nos|vos|leurs|ses|mes|tes)\s+(?:forces|efforts)\b/u),
  receivedBefore: wordsBefore('merci|re[çc]u|re[çc]ue|vu|lu|ta|ton|tes|votre|vos|sa|son|ses', 3),
};

// "nicht" or "kein" between the verb and its participle undoes it: "ich habe die Datei nicht angehängt".
const DE_GAP = String.raw`(?:(?!nicht\b|kein)[\p{L}\p{N}]+\s+){0,4}?`;
const DE_PARTICIPLE = String.raw`(?:angeh[äa]ngt|angehaengt|beigef[üu]gt|beigefuegt)`;

const german: Language = {
  name: 'German',
  attaching: [
    /\banbei\b/u,
    new RegExp(String.raw`\b(?:(?:ich|wir)\s+(?:habe|hab|haben)|(?:habe|hab|haben)\s+(?:ich|wir))\s+${DE_GAP}${DE_PARTICIPLE}\b`, 'u'),
    // "Ich hänge dir die Datei an." The particle ends the clause, so "ich hänge noch an dem Projekt" stays out.
    new RegExp(String.raw`\b(?:(?:ich|wir)\s+(?:h[äa]nge|haenge|h[äa]ngen|haengen)|(?:h[äa]nge|haenge)\s+ich|(?:h[äa]ngen|haengen)\s+wir)\s+${DE_GAP}an(?=\s*(?:[.!,;:]|$))`, 'u'),
    /\bvergessen,?\s+(?:\p{L}+\s+){0,3}?anzuh[äa]ngen\b/u,
  ],
  mentions: [
    // "im Anhang", "im Dateianhang", "siehe Anhang", "als Anhang"
    /\b(?:im|in\s+dem|als|siehe|s\.)\s+\p{L}*anhang\b/u,
    /\b(?:als|siehe)\s+anlage\b/u,
    // "Anlage" is also a plant or facility, so only the letter-writing forms.
    /\bin\s+der\s+anlage\s+(?:finden|findest|findet|sende|senden|schicke|schicken|erh[äa]ltst|erhalten|ist|sind)\b/u,
    /\banliegend\s+(?:erh[äa]ltst|erhalten|finden|findest|sende|senden|schicke|schicken|die|der|das|den)\b/u,
    new RegExp(String.raw`\b(?:der|die|das|den|dem)\s+(?:angeh[äa]ngte|angehaengte|beigef[üu]gte|beigefuegte)[nmrs]?\b`, 'u'),
    new RegExp(String.raw`\b(?:ist|sind)\s+(?:[\p{L}\p{N}]+\s+){0,2}?${DE_PARTICIPLE}\b`, 'u'),
  ],
  negatedBefore: wordsBefore(String.raw`kein\p{L}*|nicht|ohne|nie`, 2),
  receivedBefore: wordsBefore(String.raw`danke|dank|erhalten|bekommen|gesehen|gelesen|dein\p{L}*|ihre[mnrs]?|eure[mnrs]?|euer|seine[mnrs]?`, 3),
  receivedAfter: test(/^\s*(?:deine[rmns]?|ihre[rmns]?|eure[rmns]?|seine[rmns]?|von)\b/u),
};

const portuguese: Language = {
  name: 'Portuguese',
  attaching: [
    /\bsegue(?:m)?\s+(?:em\s+)?anexos?\b/u,
    /\b(?:anexei|anexamos|estou\s+anexando|estamos\s+anexando|esqueci\s+de\s+anexar)\b/u,
    /\b(?:envio|enviamos|mando)\s+(?:em\s+)?anexo\b/u,
    new RegExp(String.raw`${START}anexo\s+(?:o|a|os|as|aqui)\b`, 'u'),
  ],
  mentions: [
    /\b(?:em|nos)\s+anexos?\b/u,
    /\b(?:veja|ver|vide|confira|consulte)\s+(?:o\s+|os\s+)?anexos?\b/u,
    /\b(?:arquivos?|ficheiros?|documentos?)\s+(?:em\s+)?anexad?[oa]s?\b/u,
  ],
  negatedBefore: wordsBefore('n[ãa]o|sem|nenhum|nenhuma|nunca', 2),
  receivedBefore: wordsBefore('obrigad[oa]|valeu|recebi|recebemos|vi|li|seu|sua|seus|suas|teu|tua', 3),
};

const italian: Language = {
  name: 'Italian',
  attaching: [/\b(?:allego|alleghiamo|allegando|ho\s+allegato|abbiamo\s+allegato|dimenticato\s+di\s+allegare)\b/u],
  mentions: [
    /\bin\s+allegato\b/u,
    /\b(?:l'|gli\s+)allegat[oi]\b/u,
    /\b(?:file|documenti?|pdf)\s+allegat[oiae]\b/u,
    /\b(?:vedi|trovi|troverai|trova|troverete)\s+(?:in\s+)?allegat[oiae]\b/u,
  ],
  negatedBefore: wordsBefore('non|senza|nessun|nessuna|nessuno|mai', 2),
  receivedBefore: wordsBefore('grazie|ricevuto|ricevuta|visto|letto|tuo|tua|tuoi|tue|vostro|vostra|suo|sua', 3),
};

const dutch: Language = {
  name: 'Dutch',
  attaching: [
    /\b(?:(?:ik|wij|we)\s+(?:heb|hebben)|(?:heb|hebben)\s+(?:ik|wij|we))\s+(?:(?!niet\b|geen\b)[\p{L}\p{N}]+\s+){0,4}?bijgevoegd\b/u,
    /\bhierbij\s+(?:stuur|zend|ontvang|ontvangt|ontvangen)\b/u,
    /\bbijgaand\b/u,
  ],
  mentions: [/\b(?:in\s+de|als|zie|zie\s+de)\s+bijlagen?\b/u, /\bbijgevoegde?\b/u],
  negatedBefore: wordsBefore('geen|niet|zonder|nooit', 2),
  receivedBefore: wordsBefore('bedankt|dank|dankjewel|ontvangen|gezien|gelezen|jouw|uw|zijn|haar', 3),
};

const polish: Language = {
  name: 'Polish',
  attaching: [/\b(?:za[łl][ąa]czam|za[łl][ąa]czamy|za[łl][ąa]czy[łl](?:em|am)|zapomnia[łl](?:em|am)\s+za[łl][ąa]czy[ćc])\b/u],
  mentions: [
    /\bw\s+za[łl][ąa]cz(?:niku|nikach|eniu)\b/u,
    /\bza[łl][ąa]czon(?:y|a|e|ych|ym)\b/u,
    /\b(?:zobacz|patrz|sprawd[źz])\s+za[łl][ąa]cznik(?:i)?\b/u,
  ],
  negatedBefore: wordsBefore(String.raw`nie|bez|brak|[żz]adn\p{L}*|nigdy`, 2),
  receivedBefore: wordsBefore(String.raw`dzi[ęe]kuj[ęe]|dzi[ęe]ki|otrzyma[łl](?:em|am)|dosta[łl](?:em|am)|tw[óo]j|twoim|twojego|twoje|pana|pani|pa[ńn]stwa|wasz\p{L}*`, 3),
};

const russian: Language = {
  name: 'Russian',
  attaching: [/\b(?:прилагаю|прикрепляю|прикладываю|отправляю\s+во\s+вложении|высылаю\s+во\s+вложении|забыл[аи]?\s+прикрепить)\b/u],
  mentions: [
    /\bво\s+вложени(?:и|ях)\b/u,
    /\b(?:см\.?|смотрите|смотри)\s+(?:во\s+)?вложени[еия]\b/u,
    /\bвложенн(?:ый|ом|ые|ых|ую)\s+(?:файл|документ)\p{L}*/u,
    /\bприкрепл[её]нн(?:ый|ом|ые|ых|ую|ая)\b/u,
    /\b(?:я\s+)?(?:прикрепил|приложил)[аи]?\b/u,
  ],
  negatedBefore: wordsBefore(String.raw`не|нет|без|никак\p{L}*|ни`, 2),
  // "Приложил все силы", "приложил руку": effort, not a file.
  ignore: test(/\b(?:приложил|прикрепил)\p{L}*\s+(?:\p{L}+\s+)?(?:сил|усили|рук|старани)\p{L}*/u),
  receivedBefore: wordsBefore(String.raw`спасибо|получил\p{L}*|видел\p{L}*|ваш\p{L}*|тво[йеёия]\p{L}*|вы|ты|он|она|они`, 3),
};

const swedish: Language = {
  name: 'Swedish',
  attaching: [
    /\bbifogar\b/u,
    /\b(?:(?:jag|vi)\s+har|har\s+(?:jag|vi))\s+(?:(?!inte\b)[\p{L}\p{N}]+\s+){0,3}?bifogat\b/u,
    new RegExp(String.raw`${START}bifogat\b`, 'u'),
  ],
  mentions: [
    /\b(?:i|se|som)\s+(?:bifogad\s+)?bilaga(?:n|or|orna)?\b/u,
    /\bbifogade?\s+(?:fil|filen|filer|filerna|dokument|dokumentet|pdf)\b/u,
    /\bbifogas\b/u,
  ],
  negatedBefore: wordsBefore('inte|ej|ingen|inga|utan|aldrig', 2),
  receivedBefore: wordsBefore('tack|fick|f[åa]tt|mottagit|sett|l[äa]st|din|ditt|dina|er|ert|era|hans|hennes', 3),
};

const japanese: Language = {
  name: 'Japanese',
  attaching: [/添付(?:いた)?し(?:ます|ました|ております|ています|てあります|ておきます)/u, /添付させていただ(?:きます|きました)/u],
  mentions: [/添付(?:ファイル|資料|書類|の(?:ファイル|資料|書類|通り|とおり))/u, /別添の(?:通り|とおり)/u],
  negatedBefore: test(/(?:未|無)$/u),
  negatedAfter: test(/^.{0,4}?(?:は|が|も)?(?:ありません|ない|無い|なし|無し|ございません)/u),
  receivedBefore: test(/(?:いただいた|頂いた|いただきました|頂きました|くださった|下さった|ご送付の|送ってくれた|もらった).{0,6}$/u),
  receivedAfter: test(/^.{0,6}?(?:ありがとう|拝見|確認しました|受け取りました|受領しました|いただきました|頂きました)/u),
};

const chinese: Language = {
  name: 'Chinese',
  attaching: [/(?:附上|随附|隨附|一并附上|一併附上|随信附上|隨信附上)/u],
  mentions: [
    /(?:请|請)?(?:查收|参阅|參閱|参见|參見|详见|詳見|见|見|查看)(?:一下)?(?:附件|附档|附檔)/u,
    /(?:附件|附档|附檔)(?:是|为|為|中|里|裡|内|內|包含|里面|裡面)/u,
    /(?:在|于|於)(?:附件|附档|附檔)/u,
  ],
  negatedBefore: test(/(?:没有|沒有|没|沒|无|無|未|不用|不需要|不必|并无|並無).{0,2}$/u),
  negatedAfter: test(/^.{0,3}?(?:没有|沒有|没|沒|无|無)/u),
  receivedBefore: test(/(?:收到|谢谢|謝謝|感谢|感謝|多谢|多謝|你的|您的|你发的|您发的|你發的|您發的|你寄的|您寄的|他的|她的).{0,4}$/u),
};

const korean: Language = {
  name: 'Korean',
  attaching: [/첨부\s?(?:합니다|했습니다|하였습니다|해\s?드립니다|해\s?드렸습니다|드립니다|드려요|했어요|해요|하여\s?드립니다)/u],
  mentions: [/첨부\s?(?:파일|자료|문서|된|한|드린|해\s?드린)/u],
  negatedBefore: test(/(?:안|못)\s?$/u),
  negatedAfter: test(/^.{0,6}?(?:없|않|못)/u),
  receivedBefore: test(/(?:보내\s?주신|보내주셔서|주신|받은|보내준|감사).{0,4}$/u),
  receivedAfter: test(/^.{0,8}?(?:감사|고맙|잘\s?받았|받았습니다|확인했습니다|확인하였습니다)/u),
};

export const LANGUAGES: Language[] = [english, spanish, french, german, portuguese, italian, dutch, polish, russian, swedish, japanese, chinese, korean].map((l) => ({
  ...l,
  attaching: l.attaching.map(pattern),
  mentions: l.mentions.map(pattern),
}));

/** Words for a picture, in any of these languages: with an image in the body, that can be what the message meant. */
export const IMAGE_WORDS = test(
  /\b(?:photos?|pictures?|pics?|images?|screenshots?|screen\s?shots?|fotos?|imagen(?:es)?|im[áa]genes|imagens?|captura|capture|bild(?:er)?|immagin[ei]|afbeeldingen?|zdj[ęe]ci[ae]|obraz(?:ek|ki)?|фото\p{L}*|изображени\p{L}*|скриншот\p{L}*|картинк\p{L}*|png|jpe?g|gif|heic)\b|写真|画像|スクリーンショット|スクショ|图片|圖片|照片|截图|截圖|사진|이미지|스크린샷|캡처/u,
);
