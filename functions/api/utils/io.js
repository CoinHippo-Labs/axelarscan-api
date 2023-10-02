const moment = require('moment');

const { log } = require('./');

const getParams = (req, service_name) => {
  const { query, body } = { ...req };
  const params = { ...query, ...body };
  if (service_name) {
    log('debug', service_name, 'receive request', { params });
  }
  return params;
};

const errorOutput = error => {
  return {
    error: true,
    code: 400,
    message: error?.message,
  };
};

const finalizeOutput = (output, params, start_time = moment()) => {
  const { method } = { ...params };
  // on error, add parameters to output
  if (output?.error) {
    output = {
      ...output,
      method: output.method || method,
      params: output.params || params,
    };
  }
  // add time spent to output
  if (output && typeof output === 'object' && !Array.isArray(output) && !['getTransferDataMapping'].includes(method)) {
    output = {
      ...output,
      time_spent: moment().diff(start_time),
    };
  }
  return output;
};

module.exports = {
  getParams,
  errorOutput,
  finalizeOutput,
};