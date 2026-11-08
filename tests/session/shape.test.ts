import { redactedShape } from '../../src/session/shape';

const PNG = `data:image/png;base64,iVBORw0KGgo${'A'.repeat(16_000)}`;

describe('redactedShape', () => {
  it('keeps the structure and what tells where a photo is, and nothing personal', () => {
    const answer = [
      [
        [
          [
            [['https://lh3.googleusercontent.com/a/ACg8ocLld-uVRL8rCXQ=s64-p-mo', 3], ['Sam Quill', 'Real', null, 2], ['log-7f3a9', 0.92], true],
            ['sam.quill.writes8@gmail.com'],
          ],
        ],
        [PNG, 1],
        'Sam Quill <sam.quill.writes8@gmail.com>',
        'SAPISIDHASH 1778494182_f6d92aa99139d1aad8535dc1620a1b6e4a6709b6',
        'https://lh3.googleusercontent.com/ACg8ocLld-uVRL8rCXQ/photo.jpg?sz=50&authuser=sam.quill.writes8@gmail.com',
        { 'sam.quill.writes8@gmail.com': 'x', type: 3 },
      ],
    ];
    const shape = redactedShape(answer);
    expect(shape).toBe(
      '[[[[[["<url:lh3.googleusercontent.com/a>",3],["<str:9>","<str:4>",null,2],["<str:9>",0.92],true],["<email:gmail.com>"]]],' +
        '["<data:image/png:12KB>",1],"<str:39>","<str:63>","<url:lh3.googleusercontent.com>",{"<key>":"<str:1>","type":3}]]',
    );
    for (const secret of ['sam.quill.writes8', 'Sam Quill', 'Quill', 'f6d92aa9', 'ACg8oc', 'log-7f3a9', 'authuser']) expect(shape).not.toContain(secret);
  });

  it('stops at about the size asked for', () => {
    const big = Array.from({ length: 5_000 }, (_, i) => [i, `name ${i}`]);
    const shape = redactedShape(big, 4096);
    expect(shape.length).toBeLessThanOrEqual(4097);
    expect(shape.endsWith('…')).toBe(true);
  });
});
