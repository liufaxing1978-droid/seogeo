import http from 'node:http';
import https from 'node:https';
import zlib from 'node:zlib';

const listenHost = '127.0.0.1';
const listenPort = Number.parseInt(process.env.NPM_AUDIT_PROXY_PORT ?? '8099', 10);
const upstream = new URL(process.env.NPM_AUDIT_UPSTREAM ?? 'https://registry.npmjs.org');

if (upstream.protocol !== 'https:') {
  throw new Error('NPM_AUDIT_UPSTREAM must use https');
}

function isUnlabelledGzip(headers, body) {
  return (
    headers['content-encoding'] === undefined &&
    body.length >= 2 &&
    body[0] === 0x1f &&
    body[1] === 0x8b
  );
}

const server = http.createServer((request, response) => {
  if (request.url === '/__health') {
    response.writeHead(200, { 'content-type': 'text/plain' });
    response.end('ok');
    return;
  }

  const requestChunks = [];
  request.on('data', (chunk) => requestChunks.push(chunk));
  request.on('end', () => {
    const requestBody = Buffer.concat(requestChunks);
    const requestHeaders = { ...request.headers, host: upstream.host };
    delete requestHeaders['content-length'];
    delete requestHeaders['accept-encoding'];
    if (requestBody.length > 0) {
      requestHeaders['content-length'] = String(requestBody.length);
    }

    const upstreamRequest = https.request(
      {
        protocol: upstream.protocol,
        hostname: upstream.hostname,
        port: upstream.port || 443,
        path: request.url,
        method: request.method,
        headers: requestHeaders,
      },
      (upstreamResponse) => {
        const responseChunks = [];
        upstreamResponse.on('data', (chunk) => responseChunks.push(chunk));
        upstreamResponse.on('end', () => {
          let responseBody = Buffer.concat(responseChunks);
          const responseHeaders = { ...upstreamResponse.headers };

          if (isUnlabelledGzip(responseHeaders, responseBody)) {
            responseBody = zlib.gunzipSync(responseBody);
            delete responseHeaders['content-encoding'];
            delete responseHeaders['transfer-encoding'];
            responseHeaders['content-length'] = String(responseBody.length);
            responseHeaders['content-type'] ??= 'application/json';
          }

          response.writeHead(upstreamResponse.statusCode ?? 502, responseHeaders);
          response.end(responseBody);
        });
      },
    );

    upstreamRequest.on('error', (error) => {
      response.writeHead(502, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: error.message }));
    });

    if (requestBody.length > 0) {
      upstreamRequest.write(requestBody);
    }
    upstreamRequest.end();
  });
});

server.listen(listenPort, listenHost, () => {
  console.error(`npm audit registry proxy listening on http://${listenHost}:${listenPort}`);
});

function shutdown() {
  server.close(() => process.exit(0));
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
