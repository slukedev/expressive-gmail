import { mergeProbe, probeBody, probeDom, probePath } from '../../src/session/photoProbe';

const LOGO = `data:image/png;base64,${'iVBORw0KGgo'.padEnd(120, 'A')}`;

describe('photo probe', () => {
  it("finds an inline logo in Gmail's response and names the nearest sender by domain only", () => {
    const body = JSON.stringify([[['msg-1', [1, 'news@nytimes.com', 'The New York Times'], null, [LOGO]], ['msg-2', [1, 'ana@example.org', 'Ana']]]]);
    const found = probeBody('/sync/u/0/i/fd', body);
    expect(found).toEqual([{ where: 'response /sync/u/0/i/fd', who: '*@nytimes.com', image: expect.stringMatching(/^<data:image\/png:\d+KB>$/) }]);
    expect(JSON.stringify(found)).not.toMatch(/news@|Times/);
  });

  it("finds a photo address beside a sender, but not Gmail's own interface images", () => {
    const body = `["sender@brand.example","https://lh3.googleusercontent.com/a-/ALV-UjXyz=s96","https://www.gstatic.com/images/icons/material/system/1x/star_24dp.png"]`;
    expect(probeBody('/x', body).map((r) => r.image)).toEqual(['<url:lh3.googleusercontent.com/a->']);
  });

  it('reads the avatars classic Gmail draws, by domain', () => {
    document.body.innerHTML = `<img jid="news@nytimes.com" src="${LOGO}"><img data-hovercard-id="ana@example.org" src="https://lh3.googleusercontent.com/a/ana=s40"><img src="https://ssl.gstatic.com/ui/v1/icons/mail/rfr/logo.png">`;
    expect(probeDom(document)).toEqual([
      { where: 'page avatar', who: '*@nytimes.com', image: expect.stringMatching(/^<data:image\/png:/) },
      { where: 'page avatar', who: '*@example.org', image: '<url:lh3.googleusercontent.com/a>' },
    ]);
  });

  it('keeps one record per sender and image kind, newest last, and drops ids from paths', () => {
    const a = { where: 'page avatar', who: '*@nytimes.com', image: '<data:image/png:3KB>' };
    const merged = mergeProbe([a], [{ ...a, image: '<data:image/png:4KB>' }, { ...a, who: '*@cvs.com' }]);
    expect(merged.map((r) => r.who)).toEqual(['*@nytimes.com', '*@cvs.com']);
    expect(probePath('https://mail.google.com/sync/u/0/i/fd?rt=r&pt=ji')).toBe('/sync/u/0/i/fd');
    expect(probePath('https://people-pa.clients6.google.com/v2/people/AbCdEfGhIjKlMnOpQrStUvWxYz012345')).toBe('people-pa.clients6.google.com/v2/people/…');
  });
});
