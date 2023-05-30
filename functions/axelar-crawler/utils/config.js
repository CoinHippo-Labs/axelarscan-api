const axios = require('axios');
const config = require('config-yml');
const WebSocket = require('ws');

const ENVIRONMENT = process.env.ENVIRONMENT || 'testnet';

const { api, ws, reindex } = { ...config?.[ENVIRONMENT] };

const getAPI = (timeout = 30000) => api && axios.create({ baseURL: api, timeout });
const getWS = () => ws && new WebSocket(`${ws}/websocket`);
const getReindex = () => reindex;

module.exports = {
  getAPI,
  getWS,
  getReindex,
};