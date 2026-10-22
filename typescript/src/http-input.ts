/** Bounds apply before OAuth forwarding or SDK validation, including chunked bodies. */
export class HttpInputError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

export async function readHttpBody(source: AsyncIterable<Uint8Array>): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of source) {
    bytes += chunk.byteLength;
    if (bytes > 100 * 1024) throw new HttpInputError('Request body exceeds 100 KiB', 413);
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export function parseMcpBody(body: Buffer): unknown {
  const parsed: unknown = JSON.parse(body.toString('utf8'));
  if (Array.isArray(parsed)) throw new HttpInputError('JSON-RPC batches are not supported');
  // This server uses the SDK's low-level Server, so McpServer's opt-in
  // maxToolInputElements option does not protect its dispatch path.
  if (parsed && typeof parsed === 'object' && 'method' in parsed && parsed.method === 'tools/call') {
    const pending: unknown[] = [parsed];
    let elements = 0;
    while (pending.length) {
      const value = pending.pop();
      if (value && typeof value === 'object') {
        const values = Object.values(value);
        elements += values.length;
        if (elements > 1000) throw new HttpInputError('Tool input exceeds 1000 elements');
        pending.push(...values);
      }
    }
  }
  return parsed;
}
