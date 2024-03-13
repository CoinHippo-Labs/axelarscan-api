const axios = require('axios');
const config = require('config-yml');
const WebSocket = require('ws');

const ENVIRONMENT = process.env.ENVIRONMENT || 'testnet';
const { disabled, api, gmp_api, ws, reindex } = { ...config?.[ENVIRONMENT] };

const getDisabled = () => disabled;
const getAPI = (timeout = 30000) => api && axios.create({ baseURL: api, timeout });
const getGMPAPI = (timeout = 30000) => gmp_api && axios.create({ baseURL: gmp_api, timeout });
const getWS = () => ws && new WebSocket(`${ws}/websocket`);
const getReindex = () => reindex;

module.exports = {
  ENVIRONMENT,
  getDisabled,
  getAPI,
  getGMPAPI,
  getWS,
  getReindex,
};