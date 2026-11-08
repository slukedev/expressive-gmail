/** A scripted fetch: each route matches method + URL and returns a Response. Records every call. */
export interface Call {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string;
}

type Handler = (call: Call, nth: number) => Response | Promise<Response>;

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(body === undefined ? '' : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=UTF-8', ...headers },
  });
}

export function fakeFetch() {
  const routes: { method: string; match: RegExp; handler: Handler; hits: number }[] = [];
  const calls: Call[] = [];
  const fetchImpl = async (input: string, init: RequestInit = {}): Promise<Response> => {
    const call: Call = {
      method: (init.method ?? 'GET').toUpperCase(),
      url: input,
      headers: (init.headers ?? {}) as Record<string, string>,
      body: typeof init.body === 'string' ? init.body : '',
    };
    calls.push(call);
    const route = routes.find((r) => r.method === call.method && r.match.test(call.url));
    if (!route) throw new Error(`Unrouted request: ${call.method} ${call.url}`);
    return route.handler(call, route.hits++);
  };
  return {
    fetchImpl,
    calls,
    on(method: string, match: RegExp, handler: Handler) {
      routes.push({ method, match, handler, hits: 0 });
      return this;
    },
  };
}

/** Pulls the inner request lines out of a batch request body. */
export function batchRequestLines(body: string): string[] {
  return [...body.matchAll(/^(GET|POST|PUT|PATCH|DELETE) (\S+) HTTP\/1\.1$/gm)].map((m) => `${m[1]} ${m[2]}`);
}

export function boundaryOf(call: Call): string {
  return /boundary=([^;\s]+)/.exec(call.headers['Content-Type'] ?? '')![1];
}
