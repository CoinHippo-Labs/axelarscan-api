const axios = require('axios');
const _ = require('lodash');
const moment = require('moment');
const config = require('config-yml');
const {
  read,
} = require('../index');
const {
  sleep,
  equals_ignore_case,
} = require('../../utils');

const environment = process.env.ENVIRONMENT || config?.environment;

const data = require('../../data');
const evm_chains_data = data?.chains?.[environment]?.evm || [];
const cosmos_chains_data = data?.chains?.[environment]?.cosmos || [];
const chains_data = _.concat(
  evm_chains_data,
  cosmos_chains_data,
);
const axelarnet = chains_data.find(c => c?.id === 'axelarnet');
const cosmos_non_axelarnet_chains_data = cosmos_chains_data.filter(c => c?.id !== axelarnet.id);

const {
  endpoints,
} = { ...config?.[environment] };

module.exports = async (
  params = {},
) => {
  let response;

  const {
    txHash,
    confirmed,
    state,
    sourceChain,
    destinationChain,
    asset,
    depositAddress,
    senderAddress,
    recipientAddress,
    transferId,
    from,
    size,
    sort,
  } = { ...params };
  let {
    fromTime,
    toTime,
    query,
  } = { ...params };

  const must = [],
    should = [],
    must_not = [];

  if (txHash) {
    must.push({ match: { 'source.id': txHash } });
  }
  if (confirmed) {
    switch (confirmed) {
      case 'confirmed':
        should.push({ exists: { field: 'confirm_deposit' } });
        should.push({ exists: { field: 'vote' } });
        break;
      case 'unconfirmed':
        must_not.push({ exists: { field: 'confirm_deposit' } });
        must_not.push({ exists: { field: 'vote' } });
        break;
      default:
        break;
    }
  }
  if (state) {
    switch (state) {
      case 'completed':
        const _should = [];

        _should.push({
          bool: {
            must: [
              { exists: { field: 'sign_batch' } },
            ],
            should: evm_chains_data.map(c => {
              return { match: { 'source.recipient_chain': c?.id } };
            }) || [],
            minimum_should_match: 1,
          },
        });
        _should.push({
          bool: {
            must: [
              { exists: { field: 'ibc_send' } },
            ],
            should: cosmos_chains_data.map(c => {
              return { match: { 'source.recipient_chain': c?.id } };
            }) || [],
            minimum_should_match: 1,
          },
        });
        _should.push({
          bool: {
            must: [
              { match: { 'source.recipient_chain': axelarnet.id } },
            ],
            should: [
              { exists: { field: 'confirm_deposit' } },
              { exists: { field: 'vote' } },
            ],
            minimum_should_match: 1,
          },
        });

        must.push({
          bool: {
            should: _should,
            minimum_should_match: _should.length > 0 ? 1 : 0,
          },
        });
        break
      case 'pending':
        must_not.push({
          bool: {
            should: [
              {
                bool: {
                  must: [
                    { exists: { field: 'sign_batch' } },
                  ],
                  should: evm_chains_data.map(c => {
                    return { match: { 'source.recipient_chain': c?.id } };
                  }) || [],
                  minimum_should_match: 1,
                },
              },
              {
                bool: {
                  must: [
                    { exists: { field: 'ibc_send' } },
                  ],
                  should: cosmos_chains_data.map(c => {
                    return { match: { 'source.recipient_chain': c?.id } };
                  }) || [],
                  minimum_should_match: 1,
                },
              },
              {
                bool: {
                  must: [
                    { match: { 'source.recipient_chain': axelarnet.id } },
                  ],
                  should: [
                    { exists: { field: 'confirm_deposit' } },
                    { exists: { field: 'vote' } },
                  ],
                  minimum_should_match: 1,
                },
              },
            ],
          },
        });
        break;
      default:
        break;
    }
  }
  if (sourceChain) {
    must.push({ match: { 'source.sender_chain': sourceChain } });
  }
  if (destinationChain) {
    must.push({ match: { 'source.recipient_chain': destinationChain } });
  }
  if (asset) {
    must.push({ match_phrase: { 'source.denom': asset } });
  }
  if (depositAddress) {
    must.push({ match: { 'source.recipient_address': depositAddress } });
  }
  if (senderAddress) {
    must.push({ match: { 'source.sender_address': senderAddress } });
  }
  if (recipientAddress) {
    must.push({ match: { 'link.recipient_address': recipientAddress } });
  }
  if (transferId) {
    must.push({
      bool: {
        should: [
          { match: { 'confirm_deposit.transfer_id': transferId } },
          { match: { 'vote.transfer_id': transferId } },
          { match: { transfer_id: transferId } },
        ],
        minimum_should_match: 1,
      },
    });
  }
  if (fromTime) {
    fromTime = Number(fromTime) * 1000;
    toTime = toTime ?
      Number(toTime) * 1000 :
      moment().valueOf();
    must.push({ range: { 'source.created_at.ms': { gte: fromTime, lte: toTime } } });
  }
  if (!query) {
    query = {
      bool: {
        must,
        should,
        must_not,
        minimum_should_match: should.length > 0 ? 1 : 0,
      },
    };
  }

  const read_params = {
    from: typeof from === 'number' ?
      from :
      0,
    size: typeof size === 'number' ?
      size :
      100,
    sort: sort || [{ 'source.created_at.ms': 'desc' }],
    track_total_hits: true,
  };

  response = await read(
    'transfers',
    query,
    read_params,
  );

  if (Array.isArray(response?.data)) {
    let {
      data,
    } = { ...response };

    data = data.filter(d => {
      const {
        source,
        confirm_deposit,
        vote,
      } = { ...d };
      const {
        id,
        recipient_chain,
        amount,
        value,
      } = { ...source };

      return id && (
        !(
          recipient_chain &&
          typeof amount === 'number' &&
          typeof value === 'number'
        ) ||
        (
          cosmos_non_axelarnet_chains_data.findIndex(c => equals_ignore_case(c?.id, recipient_chain)) > -1 &&
          (vote || confirm_deposit)
        )
      );
    });

    if (data.length > 0 && endpoints?.api) {
      const api = axios.create({ baseURL: endpoints.api });

      for (const d of data) {
        const {
          source,
        } = { ...d };
        const {
          id,
          sender_chain,
        } = { ...source };

        api.post(
          '/cross-chain/transfers-status',
          {
            txHash: id,
            sourceChain: sender_chain,
          },
        ).catch(error => { return { data: { error } }; });
      }

      await sleep(5 * 1000);

      response = await read(
        'transfers',
        query,
        read_params,
      );
    }
  }

  if (Array.isArray(response?.data)) {
    response.data = response.data.map(d => {
      const {
        source,
        link,
        confirm_deposit,
        vote,
        sign_batch,
        ibc_send,
      } = { ...d };
      const {
        amount,
        value,
      } = { ...source };
      let {
        price,
      } = { ...link };

      if (
        typeof price !== 'number' &&
        typeof amount === 'number' &&
        typeof value === 'number'
      ) {
        price = value / amount;
      }

      return {
        ...d,
        link: link && {
          ...link,
          price,
        },
        status: ibc_send ?
          ibc_send.recv_txhash ?
            'executed' :
            'ibc_sent' :
          sign_batch?.executed ?
            'executed' :
             sign_batch ?
              'batch_signed' :
              vote ?
                'voted' :
                confirm_deposit ?
                  'deposit_confirmed' :
                  'asset_sent',
      };
    });
  }

  return response;
};