import { sizedPhoto } from '../../src/session/account';
import { isImageData, parseAutocomplete, parseLookup, senderImages } from '../../src/session/contacts';
import { fixture } from './helpers';

// The documented layout is covered through SessionBackend.searchContacts in backend.test.ts.
describe('parseAutocomplete', () => {
  it("reads every person in Google's order, each address with that person's name and photo", () => {
    expect(parseAutocomplete(fixture('autocomplete-people.json'))).toEqual([
      { email: 'ada@example.com', name: 'Ada Lovelace', photoUrl: 'https://lh3.googleusercontent.com/a/ada=s128-c' },
      // An address with no display info of its own is the same person's.
      { email: 'ada.l@example.org', name: 'Ada Lovelace', photoUrl: 'https://lh3.googleusercontent.com/a/ada=s128-c' },
      // Google's letter avatar is kept, as Gmail shows it, marked so the avatar shows it as is.
      { email: 'bea.park@example.net', name: 'Bea Park', photoUrl: 'https://lh3.googleusercontent.com/a/monogram-b#monogram' },
      { email: 'cy@example.com', name: 'Cy Ward', photoUrl: 'https://lh3.googleusercontent.com/a/cy' },
    ]);
  });

  it("finds a person's photo kept beside their addresses rather than on one of them", () => {
    const person = [[[[[null], ['Dee Moss']], ['dee@example.com']]], ['log-1', 0.8], [['https://lh3.googleusercontent.com/a/dee=s64', 3]]];
    expect(parseAutocomplete([[[person]]])).toEqual([{ email: 'dee@example.com', name: 'Dee Moss', photoUrl: 'https://lh3.googleusercontent.com/a/dee=s128' }]);
  });

  it('still finds people when Google moves the fields around', () => {
    expect(parseAutocomplete(fixture('autocomplete-reshuffled.json'))).toEqual([
      { email: 'grace@example.org', name: 'Grace Hopper', photoUrl: 'https://lh3.googleusercontent.com/a/photo1=s128-c' },
      { email: 'linus@example.net', name: 'Linus' },
      { email: 'evil@example.com', name: 'Evil' },
    ]);
  });

  it.each([
    ['an error body', [3, 'The caller does not have permission', [['type.googleapis.com/google.rpc.ErrorInfo', 'API_KEY_SERVICE_BLOCKED']]]],
    ['an empty answer', [[[[]]]]],
    ['not an array', { error: 'x' }],
  ])('returns nothing for %s', (_name, body) => {
    expect(parseAutocomplete(body)).toEqual([]);
  });
});

describe('parseLookup', () => {
  const person = (email: string, photo: string | null) => [[email], [[[[[[photo, 3], ['Name']], [email]]]]]];

  it('gives each asked address its photo, null for someone without one, and leaves out what it did not mention', () => {
    const answer = [[person('ada@example.com', 'https://lh3.googleusercontent.com/a/ada'), person('bea@example.net', null)]];
    expect(parseLookup(answer, ['Ada@example.com', 'bea@example.net', 'cy@example.com'])).toEqual(
      new Map([
        ['ada@example.com', 'https://lh3.googleusercontent.com/a/ada'],
        ['bea@example.net', null],
      ]),
    );
  });

  it('never hands one address the photo of someone it did not ask about', () => {
    expect(parseLookup([[person('other@example.com', 'https://lh3.googleusercontent.com/a/o')]], ['ada@example.com'])).toEqual(new Map());
  });
});

describe('sizedPhoto', () => {
  it.each([
    ['https://lh3.googleusercontent.com/ogw/AF2bZy=s32-c-mo', 'https://lh3.googleusercontent.com/ogw/AF2bZy=s128-c-mo'],
    ['https://lh3.googleusercontent.com/a/ACg8oc=s64', 'https://lh3.googleusercontent.com/a/ACg8oc=s128'],
    ['https://lh3.googleusercontent.com/a/photo1', 'https://lh3.googleusercontent.com/a/photo1'],
    ['https://example.com/me=s32', 'https://example.com/me=s32'],
  ])('%s', (input, output) => {
    expect(sizedPhoto(input)).toBe(output);
  });
});

// A 1x1 PNG, standing in for the inline logo Gmail sends for a verified sender.
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

describe('isImageData', () => {
  it.each([
    [PNG, true],
    ['data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD', true],
    // Says PNG, isn't one.
    ['data:image/png;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=', false],
    ['data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=', false],
    [`data:image/png;base64,iVBORw0K${'A'.repeat(300_000)}`, false],
    ['https://lh3.googleusercontent.com/a/x', false],
  ])('%#', (url, ok) => {
    expect(isImageData(url)).toBe(ok);
  });
});

describe('senderImages', () => {
  it("pairs a sender with the inline logo or profile photo beside them, and ignores pictures inside message bodies", () => {
    const message: unknown[] = new Array(56).fill(null);
    message[1] = [1, 'ExtraCare@e.pharmaco.io', 'Pharmaco ExtraCare', null, [PNG]];
    message[2] = [[1, 'ada@example.com', 'Ada']];
    message[3] = [[1, 'grace@example.org', 'Grace', 'https://lh3.googleusercontent.com/a/grace=s40-p']];
    message[8] = [null, [[0, '<img src="https://ci3.googleusercontent.com/proxy/abc"> write to bo@example.net']]];
    const found = senderImages([[['thread-f:1', [message]]]]);
    expect(found).toEqual(
      new Map([
        ['extracare@e.pharmaco.io', PNG],
        ['grace@example.org', 'https://lh3.googleusercontent.com/a/grace=s128-p'],
      ]),
    );
  });

  it('reads an inline logo out of a Lookup answer', () => {
    const answer = [[[['news@pharmaco.io'], [[[[[[PNG, 3], ['Pharmaco']], ['news@pharmaco.io']]]]]]]];
    expect(parseLookup(answer, ['news@pharmaco.io'])).toEqual(new Map([['news@pharmaco.io', PNG]]));
  });
});
