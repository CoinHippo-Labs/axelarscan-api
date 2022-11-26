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

const getWraps = async params => {
  let output;

  const api = API();

  if (api) {
    log(
      'info',
      service_name,
      'get wraps',
      {
        ...params,
      },
    );

    const response =
      await api
        .get(
          '/wraps',
          { params },
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
      'wraps',
      {
        output,
        ...params,
      },
    );
  }

  return output;
};

const getUnwraps = async params => {
  let output;

  const api = API();

  if (api) {
    log(
      'info',
      service_name,
      'get unwraps',
      {
        ...params,
      },
    );

    const response =
      await api
        .get(
          '/unwraps',
          { params },
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
      'unwraps',
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
  getWraps,
  getUnwraps,
};