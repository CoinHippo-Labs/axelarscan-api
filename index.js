exports.handler = async (event = {}, context, callback) => {
  const moment = require('moment');

  const METHODS = require('./methods');
  const intervalUpdate = require('./services/interval-update');
  const { parseParams, parseError, finalizeResponse } = require('./utils/io');
  const { ENVIRONMENT } = require('./utils/config');
  const { log } = require('./utils/logger');
  const { version } = require('./package.json');

  // parse event to req
  const req = {
    url: (event.routeKey || '').replace('ANY ', ''),
    method: event.requestContext?.http?.method,
    headers: event.headers,
    params: { ...event.pathParameters },
    query: { ...event.queryStringParameters },
    body: { ...(event.body && JSON.parse(event.body)) },
  };
  // create params from req
  const params = parseParams(req, 'api');
  const { method } = { ...params };

  // when not triggered by API
  if (!method && !event.requestContext && ENVIRONMENT === 'mainnet') await intervalUpdate();

  if (!method) return {
    version,
    env: { environment: ENVIRONMENT, log_level: process.env.LOG_LEVEL },
  };

  // for calculate timeSpent
  const startTime = moment();
  let response;
  switch (method) {
    default:
      if (method in METHODS) {
        try {
          response = await METHODS[method](params);
        } catch (error) {
          response = parseError(error);
        }
        break;
      }
      response = { error: true, code: 400, message: 'method not supported' };
      break;
  }

  response = finalizeResponse(response, params, startTime);
  log('debug', 'api', 'send response', response);
  return response;
};