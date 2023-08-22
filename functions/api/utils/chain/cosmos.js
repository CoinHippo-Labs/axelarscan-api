const axios = require('axios');

const { getChainData } = require('../config');
const { toArray, parseRequestError } = require('../');

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
              const response = await provider.get(path, { params }).catch(error => parseRequestError(error));
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

module.exports = {
  getLCDs,
};