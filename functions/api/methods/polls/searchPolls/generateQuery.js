const _ = require('lodash');

const { read } = require('../../../services/index');
const { getOthersChainIds } = require('../../../utils/chain');
const { TX_COLLECTION } = require('../../../utils/config');
const { toArray } = require('../../../utils');

module.exports = async params => {
  const { query, voter } = { ...params };
  if (voter) {
    params.voter = voter.toLowerCase();
    const response = await read(
      TX_COLLECTION,
      {
        bool: {
          must: [
            { match: { types: 'RegisterProxyRequest' } },
            { match: { 'tx.body.messages.proxy_addr': params.voter } },
          ],
        },
      },
      { size: 1 },
    );
    const transaction_data = _.head(response?.data);
    params.height = params.height || transaction_data?.height;
    params.operator_address = params.operator_address || _.head(toArray(transaction_data?.tx?.body?.messages).map(m => m.sender));
  }
  return {
    bool: {
      must: toArray(
        Object.entries(params)
          .filter(([k, v]) =>
            ![
              'method',
              'query',
              'aggs',
              'fields',
              '_source',
              'from',
              'size',
              'sort',
            ]
            .includes(k)
          )
          .map(([k, v]) => {
            let obj;
            switch (k) {
              case 'pollId':
                if (v) {
                  obj = { match: { _id: v } };
                }
                break;
              case 'event':
                if (v) {
                  obj = { match: { event: v } };
                }
                break;
              case 'chain':
                if (v) {
                  v = toArray(v);
                  obj = {
                    bool: {
                      should: v.map(c => {
                        return {
                          bool: {
                            must: [
                              { match_phrase: { sender_chain: c } },
                            ],
                            must_not: getOthersChainIds(c).map(_c => { return { match_phrase: { sender_chain: _c } } }),
                          },
                        };
                      }),
                      minimum_should_match: 1,
                    },
                  };
                }
                break;
              case 'transactionId':
                if (v) {
                  obj = { match: { transaction_id: v } };
                }
                break;
              case 'transferId':
                if (v) {
                  obj = { match: { transfer_id: v } };
                }
                break;
              case 'depositAddress':
                if (v) {
                  obj = { match: { deposit_address: v } };
                }
                break;
              case 'voter':
                if (v) {
                  obj = {
                    bool: {
                      must: toArray([
                        { range: { height: { gte: params.height } } },
                        params.vote === 'yes' ?
                          { match: { [`${v}.vote`]: true } } :
                          params.vote === 'no' ?
                            { match: { [`${v}.vote`]: false } } :
                            params.vote === 'unsubmitted' ?
                              {
                                bool: {
                                  must: [
                                    {
                                      bool: {
                                        should: [
                                          { match: { confirmation: true } },
                                          { match: { success: true } },
                                          { match: { failed: true } },
                                        ],
                                      },
                                    },
                                  ],
                                  should: [
                                    { match: { participants: params.operator_address } },
                                    {
                                      bool: {
                                        must_not: [
                                          { exists: { field: 'participants' } },
                                        ],
                                      },
                                    },
                                  ],
                                  minimum_should_match: 1,
                                  must_not: [
                                    { exists: { field: v } },
                                  ],
                                },
                              } :
                              null,
                      ]),
                      should: toArray([
                        { exists: { field: v } },
                        { match: { participants: params.operator_address } },
                        params.vote === 'unsubmitted' && {
                          bool: {
                            should: [
                              { match: { success: true } },
                              { match: { failed: true } },
                            ],
                            minimum_should_match: 1,
                            must_not: [
                              { exists: { field: 'participants' } },
                            ],
                          },
                        },
                      ]),
                      minimum_should_match: 1,
                    },
                  };
                }
                break;
              case 'status':
                switch (v) {
                  case 'success':
                  case 'completed':
                    obj = { match: { success: true } };
                    break;
                  case 'failed':
                    obj = {
                      bool: {
                        must: [
                          { match: { failed: true } },
                        ],
                        must_not: [
                          { match: { success: true } },
                        ],
                      },
                    };
                    break;
                  case 'confirmed':
                    obj = {
                      bool: {
                        must: [
                          { match: { confirmation: true } },
                        ],
                        must_not: [
                          { match: { success: true } },
                          { match: { failed: true } },
                        ],
                      },
                    };
                    break;
                  case 'pending':
                    obj = {
                      bool: {
                        must_not: [
                          { match: { confirmation: true } },
                          { match: { success: true } },
                          { match: { failed: true } },
                        ],
                      },
                    };
                    break;
                  case 'not_pending':
                    obj = {
                      bool: {
                        should: [
                          { match: { confirmation: true } },
                          { match: { success: true } },
                          { match: { failed: true } },
                        ],
                        minimum_should_match: 1,
                      },
                    };
                    break;
                  case 'to_recover':
                    obj = {
                      bool: {
                        must: [
                          { exists: { field: 'height' } },
                          {
                            bool: {
                              should: [
                                {
                                  bool: {
                                    must_not: [
                                      { exists: { field: 'num_recover_time' } },
                                    ],
                                  },
                                },
                                { range: { num_recover_time: { lt: 5 } } },
                              ],
                              minimum_should_match: 1,
                            },
                          },
                          {
                            bool: {
                              should: [
                                {
                                  bool: {
                                    must_not: [
                                      { match: { confirmation: true } },
                                      { match: { success: true } },
                                      { match: { failed: true } },
                                    ],
                                  },
                                },
                                {
                                  bool: {
                                    must_not: [
                                      { exists: { field: 'participants' } },
                                    ],
                                  },
                                },
                                {
                                  bool: {
                                    must_not: [
                                      { exists: { field: 'event' } },
                                    ],
                                  },
                                },
                              ],
                              minimum_should_match: 1,
                            },
                          },
                        ],
                      },
                    };
                    break;
                  default:
                    break;
                }
                break;
              case 'fromBlock':
                if (v) {
                  obj = { range: { height: { gte: Number(v) } } };
                }
                break;
              case 'toBlock':
                if (v) {
                  obj = { range: { height: { lte: Number(v) } } };
                }
                break;
              case 'fromTime':
                if (v) {
                  obj = { range: { 'created_at.ms': { gte: Number(v) * 1000 } } };
                }
                break;
              case 'toTime':
                if (v) {
                  obj = { range: { 'created_at.ms': { lte: Number(v) * 1000 } } };
                }
                break;
              default:
                break;
            }
            return obj;
          })
      ),
      ...query?.bool,
    },
  };
};