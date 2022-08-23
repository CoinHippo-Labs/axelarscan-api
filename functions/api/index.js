exports.handler = async (
  event,
  context,
  callback,
) => {
  const config = require('config-yml');
  const rpc = require('./services/rpc');
  const lcd = require('./services/lcd');
  const cli = require('./services/cli');
  const {
    crud,
  } = require('./services/index');
  const assets_price = require('./services/assets-price');
  const coingecko = require('./services/coingecko');
  const ens = require('./services/ens');
  const {
    searchTransfers,
    searchTransfersStats,
    getTransfersStatus,
  } = require('./services/transfers');
  const tvl = require('./services/tvl');
  const {
    saveEvent,
    getLatestEventBlock,
    searchTokenSent,
  } = require('./services/gateway');
  const {
    equals_ignore_case,
    get_params,
  } = require('./utils');

  const environment = process.env.ENVIRONMENT || config?.environment;

  const evm_chains_data = require('./data')?.chains?.[environment]?.evm || [];
  const cosmos_chains_data = require('./data')?.chains?.[environment]?.cosmos || [];
  const assets_data = require('./data')?.assets?.[environment] || [];

  // parse function event to req
  const req = {
    body: {
      ...(event.body && JSON.parse(event.body)),
    },
    query: {
      ...event.queryStringParameters,
    },
    params: {
      ...event.pathParameters,
    },
    method: event.requestContext?.http?.method,
    url: event.routeKey?.replace('ANY ', ''),
    headers: event.headers,
  };
  const params = get_params(req);

  let response;

  switch (req.url) {
    case '/':
      const {
        collection,
      } = { ...params };
      let {
        path,
        cache,
        cache_timeout,
        no_index,
      } = { ...params };

      const _module = params.module?.trim().toLowerCase();
      path = path || '';
      cache = typeof cache === 'boolean' ?
        cache :
        typeof cache === 'string' && equals_ignore_case(cache, 'true');
      cache_timeout = !isNaN(cache_timeout) ?
        Number(cache_timeout) :
        undefined;
      no_index = typeof no_index === 'boolean' ?
        no_index :
        typeof no_index === 'string' && equals_ignore_case(no_index, 'true');

      delete params.module;
      delete params.path;
      delete params.cache;
      delete params.cache_timeout;
      delete params.no_index;

      switch (_module) {
        case 'rpc':
          try {
            response = await rpc(
              path,
              params,
            );
          } catch (error) {
            response = {
              error: true,
              code: 400,
              message: error?.message,
            };
          }
          break;
        case 'lcd':
          try {
            response = await lcd(
              path,
              params,
              cache,
              cache_timeout,
              no_index,
            );
          } catch (error) {
            response = {
              error: true,
              code: 400,
              message: error?.message,
            };
          }
          break;
        case 'cli':
          try {
            response = await cli(
              path,
              params,
              cache,
              cache_timeout,
            );
          } catch (error) {
            response = {
              error: true,
              code: 400,
              message: error?.message,
            };
          }
          break;
        case 'index':
          try {
            response = await crud(params);
          } catch (error) {
            response = {
              error: true,
              code: 400,
              message: error?.message,
            };
          }
          break;
        case 'assets':
          try {
            response = await assets_price(params);
          } catch (error) {
            response = {
              error: true,
              code: 400,
              message: error?.message,
            };
          }
          break;
        case 'coingecko':
          try {
            response = await coingecko(
              path,
              params,
            );
          } catch (error) {
            response = {
              error: true,
              code: 400,
              message: error?.message,
            };
          }
          break;
        case 'ens':
          try {
            response = await ens(
              path,
              params,
            );
          } catch (error) {
            response = {
              error: true,
              code: 400,
              message: error?.message,
            };
          }
          break;
        case 'data':
          switch (collection) {
            case 'chains':
              response = require('./data')?.chains?.[environment];
              break;
            case 'evm_chains':
              response = evm_chains_data;
              break;
            case 'cosmos_chains':
              response = cosmos_chains_data;
              break;
            case 'assets':
              response = assets_data;
              break;
          };
          break;
        default:
          break;
      }
      break;
    case '/cross-chain/{function}':
      switch (req.params.function?.toLowerCase()) {
        case 'transfers':
          try {
            response = await searchTransfers(params);
          } catch (error) {
            response = {
              error: true,
              code: 400,
              message: error?.message,
            };
          }
          break;
        case 'transfers-status':
          try {
            response = await getTransfersStatus(params);
          } catch (error) {
            response = {
              error: true,
              code: 400,
              message: error?.message,
            };
          }
          break;
          break;
        case 'transfers-stats':
          try {
            response = await searchTransfersStats(params);
          } catch (error) {
            response = {
              error: true,
              code: 400,
              message: error?.message,
            };
          }
          break;
        case 'chains':
          response = {
            ...require('./data')?.chains?.[environment],
          };
          break;
        case 'assets':
          response = assets_data
            .map(a => Object.fromEntries(
              Object.entries({ ...a })
                .filter(([k, v]) => !['coingecko_id'].includes(k))
              )
            );
          break;
        case 'tvl':
          try {
            response = await tvl(params);
          } catch (error) {
            response = {
              error: true,
              code: 400,
              message: error?.message,
            };
          }
          break;
        default:
          break;
      }
      break;
    case '/{function}':
      switch (req.params.function?.toLowerCase()) {
        case 'evm-votes':
          try {
            response = await require('./services/evm-votes')(params);
          } catch (error) {
            response = {
              error: true,
              code: 400,
              message: error?.message,
            };
          }
          break;
        case 'heartbeats':
          try {
            response = await require('./services/heartbeats')(params);
          } catch (error) {
            response = {
              error: true,
              code: 400,
              message: error?.message,
            };
          }
          break;
        default:
          break;
      }
      break;
    // internal
    case '/gateway/{function}':
      switch (req.params.function?.toLowerCase()) {
        case 'save-event':
          try {
            response = await saveEvent(params);
          } catch (error) {
            response = {
              error: true,
              code: 400,
              message: error?.message,
            };
          }
          break;
        case 'latest-event-block':
          try {
            response = await getLatestEventBlock(params);
          } catch (error) {
            response = {
              error: true,
              code: 400,
              message: error?.message,
            };
          }
          break;
        case 'token-sent':
          try {
            response = await searchTokenSent(params);
          } catch (error) {
            response = {
              error: true,
              code: 400,
              message: error?.message,
            };
          }
          break;
        default:
          break;
      }
      break;
    default:
      if (!req.url) {
        await require('./services/archiver')();
        await require('./services/tvl/updater')(context);
      }
      break;
  }

  if (response?.error?.config) {
    delete response.error.config;
  }

  return response;
};