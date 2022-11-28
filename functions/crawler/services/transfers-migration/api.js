const axios = require('axios');
const config = require('config-yml');
const {
  log,
} = require('../../utils');

const environment = process.env.ENVIRONMENT;

const service_name = 'api';

// create request object from environment
const API = (env = environment) => {
  const {
    api,
  } = { ...config?.[env] };

  return api &&
    axios.create(
      {
        baseURL: api,
      },
    );
};

const getTransfers = async params => {
  let output;

  const api = API();

  if (api) {
    log(
      'info',
      service_name,
      'get transfers',
      {
        ...params,
      },
    );

    const response =
      await api
        .post(
          '/cross-chain/transfers',
          params,
        )
        .catch(error => {
          return {
            data: {
              error,
            },
          };
        });

    output = response?.data;

    log(
      'debug',
      service_name,
      'transfers',
      {
        output,
        ...params,
      },
    );
  }

  return output;
};

module.exports = {
  API,
  getTransfers,
};