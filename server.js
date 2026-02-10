require('dotenv').config();
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const port = process.env.PORT || 3000;
const publicDir = path.join(__dirname, 'public');
const indexPath = path.join(publicDir, 'index.html');

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

const getSumsubAuthHeaders = (method, pathWithQuery) => {
  const appToken = process.env.SUMSUB_APP_TOKEN;
  const appSecret = process.env.SUMSUB_APP_SECRET;
  if (!appToken || !appSecret) {
    return null;
  }
  const ts = Math.floor(Date.now() / 1000).toString();
  const signaturePayload = ts + method + pathWithQuery;
  const signature = crypto
    .createHmac('sha256', appSecret)
    .update(signaturePayload)
    .digest('hex');

  return {
    'Accept': 'application/json',
    'X-App-Token': appToken,
    'X-App-Access-Sig': signature,
    'X-App-Access-Ts': ts
  };
};

const server = http.createServer((req, res) => {
  if (req.url.startsWith('/api/sumsub/applicant')) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const externalUserId = url.searchParams.get('externalUserId');
    if (!externalUserId) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'externalUserId is required' }));
      return;
    }

    const method = 'GET';
    const pathWithQuery = `/resources/applicants/-;externalUserId=${encodeURIComponent(externalUserId)}/one`;
    const headers = getSumsubAuthHeaders(method, pathWithQuery);
    if (!headers) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'Sumsub credentials are not configured' }));
      return;
    }

    const options = {
      hostname: 'api.sumsub.com',
      path: pathWithQuery,
      method,
      headers: {
        ...headers
      }
    };

    const sumsubReq = https.request(options, (sumsubRes) => {
      let data = '';
      sumsubRes.on('data', (chunk) => {
        data += chunk;
      });
      sumsubRes.on('end', () => {
        res.writeHead(sumsubRes.statusCode || 500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(data);
      });
    });

    sumsubReq.on('error', (err) => {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'Sumsub request failed', details: err.message }));
    });

    sumsubReq.end();
    return;
  }

  if (req.url.startsWith('/api/sumsub/metadata')) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const applicantId = url.searchParams.get('applicantId');
    if (!applicantId) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'applicantId is required' }));
      return;
    }

    const method = 'GET';
    const pathWithQuery = `/resources/applicants/${encodeURIComponent(applicantId)}/metadata/resources`;
    const headers = getSumsubAuthHeaders(method, pathWithQuery);
    if (!headers) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'Sumsub credentials are not configured' }));
      return;
    }

    const options = {
      hostname: 'api.sumsub.com',
      path: pathWithQuery,
      method,
      headers
    };

    const sumsubReq = https.request(options, (sumsubRes) => {
      let data = '';
      sumsubRes.on('data', (chunk) => {
        data += chunk;
      });
      sumsubRes.on('end', () => {
        res.writeHead(sumsubRes.statusCode || 500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(data);
      });
    });

    sumsubReq.on('error', (err) => {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'Sumsub request failed', details: err.message }));
    });

    sumsubReq.end();
    return;
  }

  if (req.url.startsWith('/api/sumsub/image')) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const inspectionId = url.searchParams.get('inspectionId');
    const imageId = url.searchParams.get('imageId');
    if (!inspectionId || !imageId) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'inspectionId and imageId are required' }));
      return;
    }

    const method = 'GET';
    const pathWithQuery = `/resources/inspections/${encodeURIComponent(inspectionId)}/resources/${encodeURIComponent(imageId)}`;
    const headers = getSumsubAuthHeaders(method, pathWithQuery);
    if (!headers) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'Sumsub credentials are not configured' }));
      return;
    }

    const options = {
      hostname: 'api.sumsub.com',
      path: pathWithQuery,
      method,
      headers
    };

    const sumsubReq = https.request(options, (sumsubRes) => {
      res.writeHead(sumsubRes.statusCode || 500, {
        'Content-Type': sumsubRes.headers['content-type'] || 'application/octet-stream'
      });
      sumsubRes.pipe(res);
    });

    sumsubReq.on('error', (err) => {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'Sumsub request failed', details: err.message }));
    });

    sumsubReq.end();
    return;
  }

  const requestPath = req.url === '/' ? '/index.html' : req.url;
  const safePath = path.normalize(requestPath).replace(/^([/\\])+/, '');
  const filePath = path.join(publicDir, safePath);

  if (!filePath.startsWith(publicDir)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Not Found');
        return;
      }
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Internal Server Error');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = mimeTypes[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
});

server.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
