exports.handler = async (event, context, callback) => {
  const moment = require('moment');

  const {
    crud,
    rpc,
    lcd,
    getTokensPrice,
    getCirculatingSupply,
    getTotalSupply,
    getInflation,
    getChainMaintainers,
    getEscrowAddresses,
    searchBlocks,
    searchTransactions,
    getBalances,
    getDelegations,
    getRedelegations,
    getUnbondings,
    searchPolls,
    searchUptimes,
    searchHeartbeats,
    getValidators,
    getValidatorsVotes,
    getProposals,
    getProposal,
    searchBatches,
    searchDepositAddresses,
    transfersStats,
    transfersChart,
    transfersCumulativeVolume,
    transfersTotalVolume,
    searchTransfers,
    resolveTransfer,
    getTVL,
    getTVLAlert,
    saveDepositForWrap,
    saveWrap,
    saveDepositForUnwrap,
    saveUnwrap,
    saveDepositForERC20Transfer,
    saveERC20Transfer,
    getLatestEventBlock,
    archive,
    updatePolls,
    updateTVL,
    updateWraps,
    updateUnwraps,
    updateERC20Transfers,
  } = require('./methods');
  const { getParams, errorOutput, finalizeOutput } = require('./utils/io');
  const { getContracts, getChainsList, getAssetsList } = require('./utils/config');
  const { log } = require('./utils');

  const service_name = 'api';
  // parse function event to req
  const req = {
    url: (event.routeKey || '').replace('ANY ', ''),
    method: event.requestContext?.http?.method,
    headers: event.headers,
    params: { ...event.pathParameters },
    query: { ...event.queryStringParameters },
    body: { ...(event.body && JSON.parse(event.body)) },
  };

  let output;
  // create params from req
  const params = getParams(req, service_name);
  const { collection } = { ...params };
  let { method } = { ...params };

  switch(req.url) {
    case '/':
      switch (params.module) {
        case 'index':
          method = 'crud';
          break;
        case 'assets':
          method = 'getTokensPrice';
          break;
        case 'data':
          switch (collection) {
            case 'chains':
              method = 'getChains';
              break;
            case 'evm_chains':
              method = 'getEVMChains';
              break;
            case 'cosmos_chains':
              method = 'getCosmosChains';
              break;
            case 'assets':
              method = 'getAssets';
              break;
            default:
              break;
          }
          break;
        default:
          method = method || params.module;
          break;
      }
      break;
    case '/cross-chain/{function}':
    case '/{function}':
      switch (req.params.function) {
        case 'circulating-supply':
          method = 'getCirculatingSupply';
          break;
        case 'total-supply':
          method = 'getTotalSupply';
          break;
        case 'inflation':
          method = 'getInflation';
          break;
        case 'chain-maintainers':
          method = 'getChainMaintainers';
          break;
        case 'escrow-addresses':
          method = 'getEscrowAddresses';
          break;
        case 'heartbeats':
          method = 'getHeartbeats';
          break;
        case 'evm-polls':
          method = 'getPolls';
          break;
        case 'validators-evm-votes':
          method = 'getValidatorsVotes';
          break;
        case 'batches':
          method = 'searchBatches';
          break;
        case 'transfers-stats':
          method = 'transfersStats';
          break;
        case 'transfers-chart':
          method = 'transfersChart';
          break;
        case 'cumulative-volume':
          method = 'transfersCumulativeVolume';
          break;
        case 'total-volume':
          method = 'transfersTotalVolume';
          break;
        case 'transfers':
          method = 'searchTransfers';
          break;
        case 'transfers-status':
          method = 'resolveTransfer';
          break;
        case 'tvl':
          method = 'getTVL';
          break;
        case 'chains':
          method = 'getChains';
          break;
        case 'assets':
          method = 'getAssets';
          break;
        case 'save-deposit-for-wrap':
          method = 'saveDepositForWrap';
          break;
        case 'save-wrap':
          method = 'saveWrap';
          break;
        case 'save-deposit-for-unwrap':
          method = 'saveDepositForUnwrap';
          break;
        case 'save-unwrap':
          method = 'saveUnwrap';
          break;
        case 'save-deposit-for-erc20-transfer':
          method = 'saveDepositForERC20Transfer';
          break;
        case 'save-erc20-transfer':
          method = 'saveERC20Transfer';
          break;
        case 'tvl-alert':
          method = 'getTVLAlert';
          break;
        default:
          break;
      }
      break;
    default:
      break;
  }

  if (method) {
    // for calculate time spent
    const start_time = moment();
    if (!['crud'].includes(method)) {
      delete params.method;
    }

    switch (method) {
      case 'crud':
        try {
          output = await crud(params);
        } catch (error) {
          output = errorOutput(error);
        }
        break;
      case 'rpc':
        try {
          const { path } = { ...params };
          delete params.path;
          output = await rpc(path, params);
        } catch (error) {
          output = errorOutput(error);
        }
        break;
      case 'lcd':
        try {
          const { path } = { ...params };
          delete params.path;
          output = await lcd(path, params);
        } catch (error) {
          output = errorOutput(error);
        }
        break;
      case 'getTokensPrice':
        try {
          const { symbols, timestamp } = { ...params };
          output = await getTokensPrice(symbols, timestamp);
        } catch (error) {
          output = errorOutput(error);
        }
        break;
      case 'getContracts':
        output = getContracts();
        break;
      case 'getChains':
        output = getChainsList([], undefined, params?.for_crawler);
        break;
      case 'getEVMChains':
        output = getChainsList('evm');
        break;
      case 'getCosmosChains':
        output = getChainsList('cosmos');
        break;
      case 'getAssets':
        output = getAssetsList();
        break;
      case 'getCirculatingSupply':
        try {
          output = await getCirculatingSupply(params);
        } catch (error) {
          output = errorOutput(error);
        }
        break;
      case 'getTotalSupply':
        try {
          output = await getTotalSupply(params);
        } catch (error) {
          output = errorOutput(error);
        }
        break;
      case 'getInflation':
        try {
          output = await getInflation(params);
        } catch (error) {
          output = errorOutput(error);
        }
        break;
      case 'getChainMaintainers':
        try {
          output = await getChainMaintainers(params);
        } catch (error) {
          output = errorOutput(error);
        }
        break;
      case 'getEscrowAddresses':
        try {
          output = await getEscrowAddresses(params);
        } catch (error) {
          output = errorOutput(error);
        }
        break;
      case 'getBlocks':
      case 'searchBlocks':
        try {
          output = await searchBlocks(params);
        } catch (error) {
          output = errorOutput(error);
        }
        break;
      case 'getTransactions':
      case 'searchTransactions':
        try {
          output = await searchTransactions(params);
        } catch (error) {
          output = errorOutput(error);
        }
        break;
      case 'getUptimes':
      case 'searchUptimes':
        try {
          output = await searchUptimes(params);
        } catch (error) {
          output = errorOutput(error);
        }
        break;
      case 'getHeartbeats':
      case 'searchHeartbeats':
        try {
          output = await searchHeartbeats(params);
        } catch (error) {
          output = errorOutput(error);
        }
        break;
      case 'getBalances':
        try {
          output = await getBalances(params);
        } catch (error) {
          output = errorOutput(error);
        }
        break;
      case 'getDelegations':
        try {
          output = await getDelegations(params);
        } catch (error) {
          output = errorOutput(error);
        }
        break;
      case 'getRedelegations':
        try {
          output = await getRedelegations(params);
        } catch (error) {
          output = errorOutput(error);
        }
        break;
      case 'getUnbondings':
        try {
          output = await getUnbondings(params);
        } catch (error) {
          output = errorOutput(error);
        }
        break;
      case 'getPolls':
      case 'searchPolls':
        try {
          output = await searchPolls(params);
        } catch (error) {
          output = errorOutput(error);
        }
        break;
      case 'getValidators':
        try {
          output = await getValidators(params);
        } catch (error) {
          output = errorOutput(error);
        }
        break;
      case 'getValidatorsVotes':
        try {
          output = await getValidatorsVotes(params);
        } catch (error) {
          output = errorOutput(error);
        }
        break;
      case 'getProposals':
        try {
          output = await getProposals();
        } catch (error) {
          output = errorOutput(error);
        }
        break;
      case 'getProposal':
        try {
          output = await getProposal(params);
        } catch (error) {
          output = errorOutput(error);
        }
        break;
      case 'getBatches':
      case 'searchBatches':
        try {
          output = await searchBatches(params);
        } catch (error) {
          output = errorOutput(error);
        }
        break;
      case 'transfersStats':
        try {
          output = await transfersStats(params);
        } catch (error) {
          output = errorOutput(error);
        }
        break;
      case 'transfersChart':
        try {
          output = await transfersChart(params);
        } catch (error) {
          output = errorOutput(error);
        }
        break;
      case 'transfersCumulativeVolume':
        try {
          output = await transfersCumulativeVolume(params);
        } catch (error) {
          output = errorOutput(error);
        }
        break;
      case 'transfersTotalVolume':
        try {
          output = await transfersTotalVolume(params);
        } catch (error) {
          output = errorOutput(error);
        }
        break;
      case 'searchTransfers':
        try {
          output = await searchTransfers(params);
        } catch (error) {
          output = errorOutput(error);
        }
        break;
      case 'resolveTransfer':
        try {
          output = await resolveTransfer(params);
        } catch (error) {
          output = errorOutput(error);
        }
        break;
      case 'getDepositAddresses':
      case 'searchDepositAddresses':
        try {
          output = await searchDepositAddresses(params);
        } catch (error) {
          output = errorOutput(error);
        }
        break;
      case 'getTVL':
        try {
          output = await getTVL(params);
        } catch (error) {
          output = errorOutput(error);
        }
        break;
      case 'saveDepositForWrap':
        try {
          output = await saveDepositForWrap(params);
        } catch (error) {
          output = errorOutput(error);
        }
        break;
      case 'saveWrap':
        try {
          output = await saveWrap(params);
        } catch (error) {
          output = errorOutput(error);
        }
        break;
      case 'saveDepositForUnwrap':
        try {
          output = await saveDepositForUnwrap(params);
        } catch (error) {
          output = errorOutput(error);
        }
        break;
      case 'saveUnwrap':
        try {
          output = await saveUnwrap(params);
        } catch (error) {
          output = errorOutput(error);
        }
        break;
      case 'saveDepositForERC20Transfer':
        try {
          output = await saveDepositForERC20Transfer(params);
        } catch (error) {
          output = errorOutput(error);
        }
        break;
      case 'saveERC20Transfer':
        try {
          output = await saveERC20Transfer(params);
        } catch (error) {
          output = errorOutput(error);
        }
        break;
      case 'getLatestEventBlock':
        try {
          const { chain } = { ...params };
          output = await getLatestEventBlock(chain);
        } catch (error) {
          output = errorOutput(error);
        }
        break;
      case 'getTVLAlert':
        try {
          output = await getTVLAlert(params);
        } catch (error) {
          output = errorOutput(error);
        }
        break;
      case 'archive':
        try {
          await archive();
        } catch (error) {
          output = errorOutput(error);
        }
        break;
      case 'updatePolls':
        try {
          await updatePolls();
        } catch (error) {
          output = errorOutput(error);
        }
        break;
      case 'updateTVL':
        try {
          await updateTVL(params);
        } catch (error) {
          output = errorOutput(error);
        }
        break;
      case 'updateWraps':
        try {
          await updateWraps();
        } catch (error) {
          output = errorOutput(error);
        }
        break;
      case 'updateUnwraps':
        try {
          await updateUnwraps();
        } catch (error) {
          output = errorOutput(error);
        }
        break;
      case 'updateERC20Transfers':
        try {
          await updateERC20Transfers();
        } catch (error) {
          output = errorOutput(error);
        }
        break;
      default:
        break;
    }

    output = finalizeOutput(output, { ...params, method }, start_time);
  }

  // log result
  if (['search', 'update'].findIndex(s => method?.startsWith(s)) < 0) {
    log('debug', service_name, 'send output', output);
  }

  return output;
};