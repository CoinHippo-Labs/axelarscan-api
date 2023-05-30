const axios = require('axios');
const _ = require('lodash');

const { getChainData } = require('../config');
const { toArray } = require('../');

const environment = process.env.ENVIRONMENT || 'testnet';

const getLCDs = chain => {
  const { deprecated, endpoints } = { ...getChainData(chain, 'cosmos') };
  const { lcd, timeout } = { ...endpoints };
  const lcds = toArray(lcd);

  if (lcds.length > 0 && !deprecated) {
    try {
      return {
        query: async (path = '', params = {}) => {
          let output;
          if (path) {
            for (const lcd of lcds) {
              const provider = axios.create({ baseURL: lcd, timeout: timeout?.lcd || 5000, headers: { agent: 'axelarscan', 'Accept-Encoding': 'gzip' } });
              const response = await provider.get(path, { params }).catch(error => { return { error: error?.response?.data }; });
              const { data, error } = { ...response };
              if (data && !error) {
                output = data;
                break;
              }
            }
          }
          return output;
        },
      };
    } catch (error) {}
  }
  return null;
};

const getAssetsData = async (env = environment) => {
  const config = axios.create({ baseURL: `https://axelar-${env}.s3.us-east-2.amazonaws.com/${env}-asset-config.json` });
  const response = await config.get('').catch(error => { return { error: error?.response?.data }; });
  return response?.data;
};

const getSymbol = async (denom, chain, assetsData, env = environment) => {
  if (denom && chain && env) {
    if (!assetsData) {
      assetsData = await getAssetsData(env);
    }
    return assetsData?.[denom]?.chain_aliases?.[_.head(toArray(chain, 'lower', '-'))]?.assetSymbol;
  }
  return null;
};

module.exports = {
  getLCDs,
  getAssetsData,
  getSymbol,
};