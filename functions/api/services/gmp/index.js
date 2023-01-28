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
    gmp_api,
  } = { ...config?.[env]?.endpoints };

  return (
    gmp_api &&
    axios.create(
      {
        baseURL: gmp_api,
      },
    )
  );
};

/****************************************************
 * function to save GMP event to indexer            *
 * params: event data, chain, custom env (optional) *
 * output: save result from GMP API                 *
 ****************************************************/
const saveGMP = async (
  event,
  chain,
  env = environment,
) => {
  let output;

  // create api request object
  const api = API(env);

  if (
    api &&
    event &&
    chain
  ) {
    const params = {
      method: 'saveGMP',
      {
        ...(
          typeof event === 'object' ?
            event :
            {
              event,
            }
        ),
      },
      chain,
    };

    log(
      'info',
      service_name,
      'save gmp',
      { ...params },
    );

    const response =
      await api
        .post(
          '/',
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
      'save gmp result',
      {
        output,
        params,
      },
    );
  }

  return output;
};

module.exports = {
  saveGMP,
};