// import module for http request
const axios = require('axios');
// import config
const config = require('config-yml');
// import utils
const { log } = require('../../utils');

// service name
const service_name = 'api';

// initial environment
const environment = process.env.ENVIRONMENT;
// initial request object
let api = config?.[environment]?.api && axios.create({ baseURL: config[environment].api });

// get latest event subscribed block
const getLatestEventBlock = async chain => {
  // initial output
  let output;

  if (api && chain) {
    // initial params
    const params = {
      chain,
    };

    log('info', service_name, 'get latest event block', { params });
    // request api
    const response = await api.get('/gateway/latest-event-block', { params })
      .catch(error => { return { data: { error } }; });
    output = response?.data;
    log('debug', service_name, 'latest event block', { output, chain });
  }

  return output;
};

// save data to indexer via api
const saveEvent = async (event, chain, contractAddress, _environment) => {
  // initial output
  let output;

  if (!api && _environment) {
    api = config?.[_environment]?.api && axios.create({ baseURL: config[_environment].api });
  }

  if (api && event && chain && contractAddress) {
    // initial params
    const params = {
      chain,
      contractAddress,
      event,
    };

    log('info', service_name, 'save event', { params });
    // request api
    const response = await api.post('/gateway/save-events', params)
      .catch(error => { return { data: { error } }; });
    output = response?.data;
    log('debug', service_name, 'save event result', { output, params });
  }

  return output;
};

module.exports = {
  getLatestEventBlock,
  saveEvent,
};