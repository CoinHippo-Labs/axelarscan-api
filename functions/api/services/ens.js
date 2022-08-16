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

  if (endpoints?.ens) {
    const ens = axios.create({ baseURL: endpoints.ens });

    const _response = await ens.get(
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