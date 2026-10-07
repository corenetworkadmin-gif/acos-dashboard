import { describe, it, before, after, mock } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import { NetworkProvider } from './providers.ts'; // Adjust path if needed

describe('NetworkProvider Live Integration', () => {
  let server: http.Server;
  let port: number;
  let allowedOrigin: string;
  let networkProvider: NetworkProvider;

  before(async () => {
    // 1. Spin up a minimal local HTTP server
    server = http.createServer((req, res) => {
      if (req.url === '/api/test') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'success', message: 'Live fetch works' }));
      } else {
        res.writeHead(404);
        res.end('Not Found');
      }
    });

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const address = server.address() as http.AddressInfo;
        port = address.port;
        allowedOrigin = `http://127.0.0.1:${port}`;
        resolve();
      });
    });

    // 2. Initialize the provider with the live server in the allowlist
    networkProvider = new NetworkProvider({
      allowedHosts: [`127.0.0.1:${port}`],
      maxResponseBytes: 1024 * 1024, // 1MB
      timeoutMs: 5000,
    });
  });

  after(() => {
    server.closeAllConnections();
    server.close();
  });

  it('should successfully fetch from an allowlisted local host', async () => {
    const operationId = 'op-live-network-001';
    
    // Simulate the tool call payload
    const result = await networkProvider.executeRequest(operationId, {
      method: 'GET',
      url: `${allowedOrigin}/api/test`,
      headers: { 'Accept': 'application/json' },
      body: null,
    });

    assert.strictEqual(result.status, 200);
    assert.deepStrictEqual(result.data, { status: 'success', message: 'Live fetch works' });
  });

  it('should still reject non-allowlisted ports on localhost', async () => {
    const operationId = 'op-live-network-002';
    const badPort = port + 1;
    
    await assert.rejects(
      async () => {
        await networkProvider.executeRequest(operationId, {
          method: 'GET',
          url: `http://127.0.0.1:${badPort}/api/test`,
          headers: {},
          body: null,
        });
      },
      (err: any) => {
        assert.strictEqual(err.code, 'NETWORK_TARGET_DENIED');
        return true;
      }
    );
  });
});
