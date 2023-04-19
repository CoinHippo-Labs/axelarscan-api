exports.handler = async (
  event,
  context,
  callback,
) => {
  let output;

  const config = require('config-yml');

  const rpc = require('./services/rpc');
  const lcd = require('./services/lcd');
  const {
    crud,
  } = require('./services/index');
  const assets_price = require('./services/assets-price');
  const coingecko = require('./services/coingecko');
  const {
    transfers,
    transfersStats,
    transfersStatsChart,
    cumulativeVolume,
    totalVolume,
    getTransfersStatus,
    saveDepositForWrap,
    saveWrap,
    saveDepositForUnwrap,
    saveUnwrap,
  } = require('./services/transfers');
  const tvl = require('./services/tvl');
  const {
    saveEvent,
    getLatestEventBlock,
    recoverEvents,
  } = require('./services/gateway');
  const {
    sleep,
    equals_ignore_case,
    get_params,
  } = require('./utils');

  const environment = process.env.ENVIRONMENT || config?.environment;

  const evm_chains_data = require('./data')?.chains?.[environment]?.evm || [];
  const cosmos_chains_data = require('./data')?.chains?.[environment]?.cosmos || [];
  const assets_data = require('./data')?.assets?.[environment] || [];

  // parse function event to req
  const req = {
    url:
      (event.routeKey || '')
        .replace(
          'ANY ',
          '',
        ),
    method: event.requestContext?.http?.method,
    headers: event.headers,
    params: {
      ...event.pathParameters,
    },
    query: {
      ...event.queryStringParameters,
    },
    body: {
      ...(
        event.body &&
        JSON.parse(
          event.body
        )
      ),
    },
  };

  // setup query parameters
  const params = get_params(req);

  switch (req.url) {
    case '/':
      const {
        collection,
      } = { ...params };
      let {
        path,
        cache,
        cache_timeout,
      } = { ...params };

      const _module =
        (params.module || '')
          .trim()
          .toLowerCase();

      path =
        path ||
        '';

      cache =
        typeof cache === 'boolean' ?
          cache :
          typeof cache === 'string' &&
          equals_ignore_case(
            cache,
            'true',
          );

      cache_timeout =
        !isNaN(cache_timeout) ?
          Number(cache_timeout) :
          undefined;

      delete params.module;
      delete params.path;
      delete params.cache;
      delete params.cache_timeout;

      switch (_module) {
        case 'rpc':
          try {
            output =
              await rpc(
                path,
                params,
              );
          } catch (error) {
            output = {
              error: true,
              code: 400,
              message: error?.message,
            };
          }
          break;
        case 'lcd':
          try {
            output =
              await lcd(
                path,
                params,
                cache,
                cache_timeout,
              );
          } catch (error) {
            output = {
              error: true,
              code: 400,
              message: error?.message,
            };
          }
          break;
        case 'index':
          try {
            output = await crud(params);
          } catch (error) {
            output = {
              error: true,
              code: 400,
              message: error?.message,
            };
          }
          break;
        case 'assets':
          try {
            output = await assets_price(params);
          } catch (error) {
            output = {
              error: true,
              code: 400,
              message: error?.message,
            };
          }
          break;
        case 'coingecko':
          try {
            output =
              await coingecko(
                path,
                params,
              );
          } catch (error) {
            output = {
              error: true,
              code: 400,
              message: error?.message,
            };
          }
          break;
        case 'data':
          switch (collection) {
            case 'chains':
              output = require('./data')?.chains?.[environment];
              break;
            case 'evm_chains':
              output = evm_chains_data;
              break;
            case 'cosmos_chains':
              output = cosmos_chains_data;
              break;
            case 'assets':
              output = assets_data;
              break;
          }
          break;
        default:
          break;
      }
      break;
    case '/cross-chain/{function}':
      switch (req.params.function?.toLowerCase()) {
        case 'transfers':
          try {
            output = await transfers(params);
          } catch (error) {
            output = {
              error: true,
              code: 400,
              message: error?.message,
            };
          }
          break;
        case 'transfers-status':
          try {
            output = await getTransfersStatus(params);
          } catch (error) {
            output = {
              error: true,
              code: 400,
              message: error?.message,
            };
          }
          break;
        case 'transfers-stats':
          try {
            output = await transfersStats(params);
          } catch (error) {
            output = {
              error: true,
              code: 400,
              message: error?.message,
            };
          }
          break;
        case 'transfers-chart':
          try {
            output = await transfersStatsChart(params);
          } catch (error) {
            output = {
              error: true,
              code: 400,
              message: error?.message,
            };
          }
          break;
        case 'cumulative-volume':
          try {
            output = await cumulativeVolume(params);
          } catch (error) {
            output = {
              error: true,
              code: 400,
              message: error?.message,
            };
          }
          break;
        case 'total-volume':
          try {
            output = await totalVolume(params);
          } catch (error) {
            output = {
              error: true,
              code: 400,
              message: error?.message,
            };
          }
          break;
        case 'save-deposit-for-wrap':
          try {
            output = await saveDepositForWrap(params);
          } catch (error) {
            output = {
              error: true,
              code: 400,
              message: error?.message,
            };
          }
          break;
        case 'save-wrap':
          try {
            output = await saveWrap(params);
          } catch (error) {
            output = {
              error: true,
              code: 400,
              message: error?.message,
            };
          }
          break;
        case 'save-deposit-for-unwrap':
          try {
            output = await saveDepositForUnwrap(params);
          } catch (error) {
            output = {
              error: true,
              code: 400,
              message: error?.message,
            };
          }
          break;
        case 'save-unwrap':
          try {
            output = await saveUnwrap(params);
          } catch (error) {
            output = {
              error: true,
              code: 400,
              message: error?.message,
            };
          }
          break;
        case 'chains':
          output = {
            ...require('./data')?.chains?.[environment],
          };
          break;
        case 'assets':
          output =
            assets_data
              .map(a =>
                Object.fromEntries(
                  Object.entries({ ...a })
                    .filter(([k, v]) =>
                      !['coingecko_id'].includes(k)
                    )
                )
              );
          break;
        case 'tvl':
          try {
            output = await tvl(params);
          } catch (error) {
            output = {
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
        case 'evm-polls':
          try {
            output = await require('./services/evm-polls')(params);
          } catch (error) {
            output = {
              error: true,
              code: 400,
              message: error?.message,
            };
          }
          break;
        case 'validators-evm-votes':
          try {
            output = await require('./services/validators-evm-votes')(params);
          } catch (error) {
            output = {
              error: true,
              code: 400,
              message: error?.message,
            };
          }
          break;
        case 'heartbeats':
          try {
            output = await require('./services/heartbeats')(params);
          } catch (error) {
            output = {
              error: true,
              code: 400,
              message: error?.message,
            };
          }
          break;
        case 'inflation':
          try {
            output = await require('./services/inflation')(params);
          } catch (error) {
            output = {
              error: true,
              code: 400,
              message: error?.message,
            };
          }
          break;
        case 'batches':
          try {
            output = await require('./services/batches')(params);
          } catch (error) {
            output = {
              error: true,
              code: 400,
              message: error?.message,
            };
          }
          break;
        case 'chain-maintainers':
          try {
            output = await require('./services/chain-maintainers')(params);
          } catch (error) {
            output = {
              error: true,
              code: 400,
              message: error?.message,
            };
          }
          break;
        case 'wraps':
          try {
            output = await require('./services/wraps')(params);
          } catch (error) {
            output = {
              error: true,
              code: 400,
              message: error?.message,
            };
          }
          break;
        case 'unwraps':
          try {
            output = await require('./services/unwraps')(params);
          } catch (error) {
            output = {
              error: true,
              code: 400,
              message: error?.message,
            };
          }
          break;
        case 'addresses':
          try {
            output = await require('./services/addresses')(params);
          } catch (error) {
            output = {
              error: true,
              code: 400,
              message: error?.message,
            };
          }
          break;
        case 'escrow-addresses':
          try {
            output = await require('./services/escrow-addresses')(params);
          } catch (error) {
            output = {
              error: true,
              code: 400,
              message: error?.message,
            };
          }
          break;
        case 'circulating-supply':
          try {
            output = await require('./services/circulating-supply')(params);
          } catch (error) {
            output = {
              error: true,
              code: 400,
              message: error?.message,
            };
          }
          break;
        case 'total-supply':
          try {
            output = await require('./services/total-supply')(params);
          } catch (error) {
            output = {
              error: true,
              code: 400,
              message: error?.message,
            };
          }
          break;
        case 'tvl-alert':
          try {
            output = await require('./services/tvl/alert')(params);
          } catch (error) {
            output = {
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
            output = await saveEvent(params);
          } catch (error) {
            output = {
              error: true,
              code: 400,
              message: error?.message,
            };
          }
          break;
        case 'latest-event-block':
          try {
            output = await getLatestEventBlock(params);
          } catch (error) {
            output = {
              error: true,
              code: 400,
              message: error?.message,
            };
          }
          break;
        case 'recover-events':
          try {
            const {
              chain,
              txHash,
              blockNumber,
              toBlockNumber,
            } = { ...params };

            const chains_config = {
              ...config?.[environment]?.gateway?.chains,
            };

            const contracts_config = {
              ...config?.[environment]?.gateway?.contracts,
            };

            output =
              await recoverEvents(
                chains_config,
                contracts_config,
                chain,
                txHash,
                blockNumber,
                toBlockNumber,
              );
          } catch (error) {
            output = {
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
        const remain_ms_to_exit =
          (
            (
              [
                'mainnet',
              ].includes(environment) ?
                60 :
                0
            ) +
            2
          ) *
          1000;

        // archive data from indexer
        require('./services/archiver')();

        // update tvl cache
        output = await require('./services/tvl/updater')(context);

        // hold lambda function to not exit before timeout
        while (context.getRemainingTimeInMillis() > remain_ms_to_exit) {
          await sleep(1 * 1000);
        }
      }
      break;
  }

  if (output?.error?.config) {
    delete output.error.config;
  }

  return output;
};