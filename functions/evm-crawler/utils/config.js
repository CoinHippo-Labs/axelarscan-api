const axios = require('axios');
const config = require('config-yml');

const { equalsIgnoreCase, toArray, parseRequestError } = require('./');

const ENVIRONMENT = process.env.ENVIRONMENT || 'testnet';

const getConfig = (env = ENVIRONMENT) => { return { ...config?.[env] }; };
const getDisabled = (env = ENVIRONMENT) => getConfig(env)?.disabled;
const getAPI = (timeout = 30000, env = ENVIRONMENT) => getConfig(env).api && axios.create({ baseURL: getConfig(env).api, timeout });

const getChains = async (env = ENVIRONMENT) => {
  let output;
  const api = getAPI(undefined, env);
  if (api) {
    const response = await api.get('/', { params: { method: 'getChains', for_crawler: true } }).catch(error => parseRequestError(error));
    const { data } = { ...response };
    output = toArray(data);
  }
  return output;
};

const getChainData = async (chain, chains_data, env = ENVIRONMENT) => {
  let output;
  if (chain) {
    if (!chains_data) {
      chains_data = await getChains(env);
    }
    if (chains_data) {
      output = toArray(chains_data).find(c => equalsIgnoreCase(c.id, chain));
    }
  }
  return output;
};

const getContracts = async (env = ENVIRONMENT) => {
  let output;
  const api = getAPI(undefined, env);
  if (api) {
    const response = await api.get('/', { params: { method: 'getContracts' } }).catch(error => parseRequestError(error));
    const { data } = { ...response };
    output = data;
  }
  return output;
};

const getGateway = async (chain, contracts_data, env = ENVIRONMENT) => {
  let output;
  if (chain) {
    if (!contracts_data) {
      contracts_data = await getContracts(env);
    }
    const { gateway_contracts } = { ...contracts_data };
    output = gateway_contracts?.[chain.toLowerCase()];
  }
  return output;
};

module.exports = {
  ENVIRONMENT,
  GATEWAY_EVENTS: ['TokenSent', 'Executed'],
  getConfig,
  getDisabled,
  getAPI,
  getChains,
  getChainData,
  getContracts,
  getGateway,
};