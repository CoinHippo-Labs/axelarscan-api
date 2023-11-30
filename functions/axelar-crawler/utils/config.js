const axios = require('axios');
const config = require('config-yml');
const WebSocket = require('ws');

const ENVIRONMENT = process.env.ENVIRONMENT || 'testnet';
const { api, gmp_api, ws, reindex } = { ...config?.[ENVIRONMENT] };

const getAPI = (timeout = 30000) => api && axios.create({ baseURL: api, timeout });
const getGMPAPI = (timeout = 30000) => gmp_api && axios.create({ baseURL: gmp_api, timeout });
const getWS = () => ws && new WebSocket(`${ws}/websocket`);
const getReindex = () => reindex;

module.exports = {
  ENVIRONMENT,
  getAPI,
  getGMPAPI,
  getWS,
  getReindex,
};