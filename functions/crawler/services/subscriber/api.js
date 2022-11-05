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

const getLatestEventBlock = async chain => {
  let output;

  // create api request object
  const api = API();

  if (
    api &&
    chain
  ) {
    const params = {
      chain,
    };

    log(
      'info',
      service_name,
      'get latest event block',
      {
        ...params,
      },
    );

    const response = await api.get(
      '/gateway/latest-event-block',
      { params },
    ).catch(error => { return { data: { error } }; });

    output = response?.data;

    log(
      'debug',
      service_name,
      'latest event block',
      {
        output,
        ...params,
      },
    );
  }

  return output;
};

const saveEvent = async (
  event,
  chain,
  contractAddress,
  env = environment,
) => {
  let output;

  // create api request object
  const api = API(env);

  if (
    api &&
    event &&
    chain &&
    contractAddress
  ) {
    const params = {
      chain,
      contractAddress,
      event,
    };

    log(
      'info',
      service_name,
      'save event',
      {
        ...params,
      },
    );

    const response = await api.post(
      '/gateway/save-event',
      params,
    ).catch(error => { return { data: { error } }; });

    output = response?.data;

    log(
      'debug',
      service_name,
      'save event result',
      {
        output,
        params,
      },
    );
  }

  return output;
};

module.exports = {
  getLatestEventBlock,
  saveEvent,
};