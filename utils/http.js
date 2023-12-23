const axios = require('axios');

const { isString } = require('./string');

const createInstance = (url, options) => {
  if (!url) return null;
  const { gzip } = { ...options };
  let { timeout, headers } = { ...options };
  timeout = timeout || 5000;
  if (gzip) headers = { ...headers, 'Accept-Encoding': 'gzip' };
  return axios.create({ ...options, baseURL: url, timeout, headers });
};

const parseError = error => { return { error: error?.response?.data }; };

const request = async (instance, options) => {
  if (!instance) return null;
  if (isString(instance)) instance = createInstance(instance);

  const { auth } = { ...options };
  let { method, path, params } = { ...options };
  method = method || 'get';
  path = path || '';
  params = { ...params };

  let response;
  let headers;
  try {
    switch (method) {
      case 'post':
        headers = auth ? { auth } : undefined;
        response = await instance.post(path, params, headers).catch(error => parseError(error));
        break;
      case 'put':
        headers = auth ? { auth } : undefined;
        response = await instance.put(path, params, headers).catch(error => parseError(error));
        break;
      case 'delete':
        response = await instance.delete(path, { params, auth }).catch(error => parseError(error));
        break;
      case 'get':
      default:
        response = await instance.get(path, { params, auth }).catch(error => parseError(error));
        break;
    }
  } catch (error) {}

  const { data, error } = { ...response };
  return error ? { error } : data;
};

module.exports = {
  createInstance,
  request,
};