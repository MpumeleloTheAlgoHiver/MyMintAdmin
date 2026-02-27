const https = require('https');
const { getSumsubAuthHeaders, jsonError } = require('../_sumsub');

module.exports = (req, res) => {
  const externalUserId = req.query.externalUserId;
  if (!externalUserId) {
    return jsonError(res, 400, 'externalUserId is required');
  }

  const method = 'GET';
  const pathWithQuery = `/resources/applicants/-;externalUserId=${encodeURIComponent(externalUserId)}/one`;
  const headers = getSumsubAuthHeaders(method, pathWithQuery);
  if (!headers) {
    return jsonError(res, 500, 'Sumsub credentials are not configured');
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
      res.statusCode = sumsubRes.statusCode || 500;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(data);
    });
  });

  sumsubReq.on('error', (err) => {
    jsonError(res, 500, `Sumsub request failed: ${err.message}`);
  });

  sumsubReq.end();
};
