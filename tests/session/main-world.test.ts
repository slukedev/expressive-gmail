import { ISOLATED_SOURCE, MAIN_SOURCE, PROTOCOL_VERSION, type SessionTokensMessage } from '../../src/session/protocol';

describe('main-world capture script', () => {
  const posted: SessionTokensMessage[] = [];
  const nativeFetch = vi.fn(async () => new Response('{}'));
  const nativeSend = vi.fn();
  const latest = () => posted[posted.length - 1]!.tokens;

  beforeAll(async () => {
    vi.useFakeTimers();
    // The hooks must wrap these stubs, not jsdom's real network stack.
    XMLHttpRequest.prototype.send = nativeSend;
    window.fetch = nativeFetch as unknown as typeof fetch;
    vi.spyOn(window, 'postMessage').mockImplementation((message: unknown) => {
      posted.push(message as SessionTokensMessage);
    });
    const script = (await import('../../src/entrypoints/gmail-main.content')).default;
    expect(script).toMatchObject({ world: 'MAIN', runAt: 'document_start', matches: ['https://mail.google.com/*'] });
    script.main(undefined as never);
  });

  afterAll(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('publishes ik and the address once Gmail defines GLOBALS', async () => {
    const globals: unknown[] = new Array(20).fill(null);
    globals[9] = 'ik-7f3a';
    globals[10] = 'ada@example.com';
    (window as unknown as { GLOBALS: unknown[] }).GLOBALS = globals;
    await vi.advanceTimersByTimeAsync(300);
    expect(posted.at(-1)).toMatchObject({ source: MAIN_SOURCE, version: PROTOCOL_VERSION, type: 'session-tokens' });
    expect(latest()).toMatchObject({ ik: 'ik-7f3a', email: 'ada@example.com' });
  });

  it('copies the headers of Gmail\'s own sync XHR and still sends it', async () => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/sync/u/2/i/bv?hl=de&c=3&rt=r&pt=ji');
    xhr.setRequestHeader('X-Framework-Xsrf-Token', 'AKone:1760000000000');
    xhr.setRequestHeader('X-Gmail-BTAI', '[null,null,[1]]');
    xhr.setRequestHeader('X-Google-BTD', '1');
    xhr.send('[]');
    await vi.advanceTimersByTimeAsync(0);
    expect(nativeSend).toHaveBeenCalledWith('[]');
    expect(latest()).toMatchObject({ syncPath: '/sync/u/2', hl: 'de', xsrf: 'AKone:1760000000000', btai: '[null,null,[1]]', btd: '1' });
  });

  it('copies a rotated token from a sync fetch and passes the call through', async () => {
    const init = { method: 'POST', headers: { 'x-framework-xsrf-token': 'AKtwo:1760000005000' } };
    await window.fetch('/sync/u/2/i/fd?hl=de&c=4&rt=r&pt=ji', init);
    await vi.advanceTimersByTimeAsync(0);
    expect(nativeFetch).toHaveBeenLastCalledWith('/sync/u/2/i/fd?hl=de&c=4&rt=r&pt=ji', init);
    expect(latest().xsrf).toBe('AKtwo:1760000005000');
  });

  it('ignores the same header on non-sync URLs', async () => {
    const before = posted.length;
    await window.fetch('/mail/u/2/?ui=2&view=om', { headers: { 'X-Framework-Xsrf-Token': 'AKnot-this-one:1' } });
    await vi.advanceTimersByTimeAsync(0);
    expect(posted).toHaveLength(before);
  });

  it('picks up the Google API key Gmail sends to Google APIs', async () => {
    await window.fetch(new Request('https://people-pa.clients6.google.com/v2/people', { headers: { 'X-Goog-Api-Key': 'AIzaTestKey' } }));
    await vi.advanceTimersByTimeAsync(0);
    expect(latest().apiKey).toBe('AIzaTestKey');
  });

  it("keeps People Stack's key apart, so another API's key can't replace it", async () => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', 'https://peoplestack-pa.clients6.google.com/$rpc/peoplestack.PeopleStackAutocompleteService/Autocomplete');
    xhr.setRequestHeader('X-Goog-Api-Key', 'AIzaPeopleStack');
    xhr.send('[]');
    // Some Google APIs take the key as a query parameter instead.
    await window.fetch('https://addons-pa.clients6.google.com/v1/thing?key=AIzaAddons');
    await vi.advanceTimersByTimeAsync(0);
    expect(latest()).toMatchObject({ peopleApiKey: 'AIzaPeopleStack', apiKey: 'AIzaAddons' });
  });

  it("copies the shape of Gmail's own Lookup and Autocomplete, never who they asked about", async () => {
    await window.fetch('https://peoplestack-pa.clients6.google.com/$rpc/peoplestack.PeopleStackAutocompleteService/Lookup', {
      method: 'POST',
      body: JSON.stringify([134, [1, 2], [['someone@example.com']]]),
    });
    const xhr = new XMLHttpRequest();
    xhr.open('POST', 'https://peoplestack-pa.clients6.google.com/$rpc/peoplestack.PeopleStackAutocompleteService/Autocomplete');
    xhr.send(JSON.stringify([134, 'ada', [1, 2], 500]));
    await vi.advanceTimersByTimeAsync(0);
    const shape = latest().peopleStack!;
    expect(JSON.parse(shape)).toEqual({ Lookup: { client: 134, flags: [1, 2] }, Autocomplete: { client: 134, flags: [1, 2] } });
    expect(shape).not.toMatch(/someone|ada/);
  });

  it('never breaks a request it cannot inspect', async () => {
    await expect(window.fetch('/sync/u/2/i/s', { headers: [['bad header\n', 'x']] as unknown as HeadersInit })).resolves.toBeInstanceOf(Response);
  });

  it('re-sends everything it knows when the isolated world asks', async () => {
    const before = posted.length;
    window.dispatchEvent(
      new MessageEvent('message', { data: { source: ISOLATED_SOURCE, version: PROTOCOL_VERSION, type: 'request-tokens' }, source: window }),
    );
    expect(posted).toHaveLength(before + 1);
    expect(latest()).toMatchObject({ ik: 'ik-7f3a', syncPath: '/sync/u/2', xsrf: 'AKtwo:1760000005000', apiKey: 'AIzaAddons', peopleApiKey: 'AIzaPeopleStack' });
  });
});
