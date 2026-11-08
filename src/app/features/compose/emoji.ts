/** A compact emoji set for mail, with words to find them by. */
export interface EmojiGroup {
  name: string;
  items: [emoji: string, words: string][];
}

export const EMOJI: EmojiGroup[] = [
  {
    name: 'Smileys',
    items: [
      ['😀', 'grinning smile happy'],
      ['😃', 'smile happy joy'],
      ['😄', 'smile laugh happy'],
      ['😁', 'grin beam teeth'],
      ['😆', 'laugh squint'],
      ['😅', 'sweat smile relief phew'],
      ['😂', 'joy tears laugh lol'],
      ['🙂', 'slight smile'],
      ['😉', 'wink'],
      ['😊', 'blush smile happy'],
      ['😇', 'halo innocent angel'],
      ['🥰', 'love hearts adore'],
      ['😍', 'heart eyes love'],
      ['🤩', 'star struck wow'],
      ['😘', 'kiss'],
      ['😋', 'yum tasty delicious'],
      ['😎', 'cool sunglasses'],
      ['🤓', 'nerd glasses'],
      ['🤔', 'thinking hmm wonder'],
      ['🤨', 'raised eyebrow skeptical'],
      ['😐', 'neutral meh'],
      ['😶', 'speechless no mouth'],
      ['🙄', 'eye roll'],
      ['😏', 'smirk'],
      ['😬', 'grimace awkward yikes'],
      ['😌', 'relieved calm'],
      ['😴', 'sleep tired zzz'],
      ['🤒', 'sick ill thermometer'],
      ['🤧', 'sneeze cold tissue'],
      ['🥳', 'party celebrate birthday'],
      ['🥺', 'pleading puppy eyes please'],
      ['😢', 'cry sad tear'],
      ['😭', 'sob cry loud'],
      ['😤', 'triumph huff'],
      ['😡', 'angry mad'],
      ['😱', 'scream shock fear'],
      ['🤯', 'mind blown explode'],
      ['😳', 'flushed embarrassed'],
      ['🫠', 'melting'],
      ['🤗', 'hug hugging'],
      ['🫡', 'salute'],
      ['🤫', 'shush quiet secret'],
    ],
  },
  {
    name: 'Gestures',
    items: [
      ['👍', 'thumbs up yes ok approve'],
      ['👎', 'thumbs down no'],
      ['👌', 'ok perfect'],
      ['✌️', 'peace victory'],
      ['🤞', 'fingers crossed luck hope'],
      ['🤝', 'handshake deal agree'],
      ['👏', 'clap applause bravo'],
      ['🙌', 'raised hands hooray celebrate'],
      ['🙏', 'pray please thanks thank you'],
      ['👋', 'wave hello hi bye'],
      ['💪', 'strong muscle flex'],
      ['👀', 'eyes look see'],
      ['🫶', 'heart hands love'],
      ['☝️', 'point up one'],
      ['👉', 'point right'],
      ['🤷', 'shrug dunno'],
      ['🤦', 'facepalm'],
      ['🙋', 'raise hand me question'],
    ],
  },
  {
    name: 'Hearts',
    items: [
      ['❤️', 'red heart love'],
      ['🧡', 'orange heart'],
      ['💛', 'yellow heart'],
      ['💚', 'green heart'],
      ['💙', 'blue heart'],
      ['💜', 'purple heart'],
      ['🖤', 'black heart'],
      ['🤍', 'white heart'],
      ['💔', 'broken heart'],
      ['💕', 'two hearts'],
      ['💯', 'hundred perfect score'],
      ['✨', 'sparkles shine new'],
    ],
  },
  {
    name: 'Things',
    items: [
      ['🎉', 'tada party congratulations celebrate'],
      ['🎂', 'cake birthday'],
      ['🎁', 'gift present'],
      ['☕', 'coffee tea'],
      ['🍕', 'pizza'],
      ['🍻', 'cheers beer drinks'],
      ['🥂', 'cheers champagne toast'],
      ['🌟', 'star glow'],
      ['🔥', 'fire lit hot'],
      ['🌈', 'rainbow'],
      ['☀️', 'sun sunny'],
      ['🌧️', 'rain cloud'],
      ['❄️', 'snow cold'],
      ['🌸', 'blossom flower spring'],
      ['🌻', 'sunflower'],
      ['🐶', 'dog puppy'],
      ['🐱', 'cat kitten'],
      ['🚀', 'rocket launch ship'],
      ['✈️', 'plane flight travel'],
      ['🏖️', 'beach vacation holiday'],
      ['🏠', 'house home'],
      ['💼', 'briefcase work job'],
      ['📅', 'calendar date'],
      ['⏰', 'alarm clock time'],
      ['📎', 'paperclip attachment'],
      ['📌', 'pin pushpin'],
      ['📝', 'memo note write'],
      ['📈', 'chart up growth'],
      ['💡', 'idea bulb'],
      ['🔗', 'link chain'],
      ['📦', 'package box delivery'],
      ['💰', 'money bag'],
    ],
  },
  {
    name: 'Symbols',
    items: [
      ['✅', 'check done yes complete'],
      ['☑️', 'ballot check box'],
      ['✔️', 'check mark'],
      ['❌', 'cross no wrong'],
      ['⚠️', 'warning caution'],
      ['❗', 'exclamation important'],
      ['❓', 'question'],
      ['➡️', 'arrow right next'],
      ['⬅️', 'arrow left back'],
      ['🔴', 'red circle'],
      ['🟢', 'green circle'],
      ['🟡', 'yellow circle'],
      ['⭐', 'star favorite'],
      ['🆗', 'ok button'],
      ['🆕', 'new button'],
      ['🔔', 'bell notification'],
    ],
  },
];

const ALL = EMOJI.flatMap((g) => g.items);

/** Words must start with every word typed; best first. */
export function searchEmoji(query: string): string[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  return ALL.filter(([, w]) => {
    const own = w.split(' ');
    return words.every((q) => own.some((x) => x.startsWith(q)));
  }).map(([e]) => e);
}

export function emojiName(emoji: string): string {
  return ALL.find(([e]) => e === emoji)?.[1].split(' ').slice(0, 2).join(' ') ?? emoji;
}
