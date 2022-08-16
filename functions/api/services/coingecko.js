const axios = require('axios');
const config = require('config-yml');

const {
  endpoints,
} = { ...config?.external_api };

module.exports = async (
  path = '',
  params = {},
) => {
  let response;

  if (endpoints?.coingecko) {
    const coingecko = axios.create({ baseURL: endpoints.coingecko });

    const _response = await coingecko.get(
      path,
      { params },
    ).catch(error => { return { data: { error } }; });

    const {
      data,
    } = { ..._response };

    response = data;
  }

  return response;
};