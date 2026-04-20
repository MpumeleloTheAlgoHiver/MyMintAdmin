/******/ (() => { // webpackBootstrap
/******/ 	var __webpack_modules__ = ({

/***/ 773:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {

const crypto = __nccwpck_require__(982);

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

const jsonError = (res, status, message) => {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify({ error: message }));
};

module.exports = {
  getSumsubAuthHeaders,
  jsonError
};


/***/ }),

/***/ 246:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {

const https = __nccwpck_require__(692);
const { getSumsubAuthHeaders, jsonError } = __nccwpck_require__(773);

module.exports = (req, res) => {
  const applicantId = req.query.applicantId;
  if (!applicantId) {
    return jsonError(res, 400, 'applicantId is required');
  }

  const method = 'GET';
  const pathWithQuery = `/resources/applicants/${encodeURIComponent(applicantId)}/metadata/resources`;
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


/***/ }),

/***/ 982:
/***/ ((module) => {

"use strict";
module.exports = require("crypto");

/***/ }),

/***/ 692:
/***/ ((module) => {

"use strict";
module.exports = require("https");

/***/ })

/******/ 	});
/************************************************************************/
/******/ 	// The module cache
/******/ 	var __webpack_module_cache__ = {};
/******/ 	
/******/ 	// The require function
/******/ 	function __nccwpck_require__(moduleId) {
/******/ 		// Check if module is in cache
/******/ 		var cachedModule = __webpack_module_cache__[moduleId];
/******/ 		if (cachedModule !== undefined) {
/******/ 			return cachedModule.exports;
/******/ 		}
/******/ 		// Create a new module (and put it into the cache)
/******/ 		var module = __webpack_module_cache__[moduleId] = {
/******/ 			// no module.id needed
/******/ 			// no module.loaded needed
/******/ 			exports: {}
/******/ 		};
/******/ 	
/******/ 		// Execute the module function
/******/ 		var threw = true;
/******/ 		try {
/******/ 			__webpack_modules__[moduleId](module, module.exports, __nccwpck_require__);
/******/ 			threw = false;
/******/ 		} finally {
/******/ 			if(threw) delete __webpack_module_cache__[moduleId];
/******/ 		}
/******/ 	
/******/ 		// Return the exports of the module
/******/ 		return module.exports;
/******/ 	}
/******/ 	
/************************************************************************/
/******/ 	/* webpack/runtime/compat */
/******/ 	
/******/ 	if (typeof __nccwpck_require__ !== 'undefined') __nccwpck_require__.ab = __dirname + "/";
/******/ 	
/************************************************************************/
/******/ 	
/******/ 	// startup
/******/ 	// Load entry module and return exports
/******/ 	// This entry module is referenced by other modules so it can't be inlined
/******/ 	var __webpack_exports__ = __nccwpck_require__(246);
/******/ 	module.exports = __webpack_exports__;
/******/ 	
/******/ })()
;