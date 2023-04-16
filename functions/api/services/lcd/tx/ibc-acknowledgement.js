const axios = require('axios');
const _ = require('lodash');
const moment = require('moment');
const config = require('config-yml');
const {
  read,
  write,
} = require('../../index');
const {
  save_time_spent,
} = require('../../transfers/utils');
const {
  equals_ignore_case,
  to_json,
  get_granularity,
} = require('../../../utils');

const environment =
  process.env.ENVIRONMENT ||
  config?.environment;

const evm_chains_data =
  require('../../../data')?.chains?.[environment]?.evm ||
  [];
const cosmos_chains_data =
  require('../../../data')?.chains?.[environment]?.cosmos ||
  [];
const chains_data =
  _.concat(
    evm_chains_data,
    cosmos_chains_data,
  );
const axelarnet =
  chains_data
    .find(c =>
      c?.id === 'axelarnet'
    );
const cosmos_non_axelarnet_chains_data =
  cosmos_chains_data
    .filter(c =>
      c?.id !== axelarnet.id
    );

module.exports = async (
  lcd_response = {},
) => {
  let updated = false;

  const {
    tx_response,
    tx,
  } = { ...lcd_response };

  try {
    const {
      txhash,
      logs,
    } = { ...tx_response };
    const {
      messages,
    } = { ...tx?.body };

    const ack_packets =
      (logs || [])
        .map(l => {
          const {
            events,
          } = { ...l };

          const e = (events || [])
            .find(e =>
              equals_ignore_case(
                e?.type,
                'acknowledge_packet',
              )
            );

          const {
            attributes,
          } = { ...e };

          if (attributes) {
            const transfer_event = events
              .find(e =>
                [
                  'IBCTransferCompleted',
                ].findIndex(t =>
                  equals_ignore_case(
                    t,
                    _.last(
                      (e.type || '')
                        .split('.')
                    ),
                  )
                ) > -1
              );

            const transfer_id =
              (
                (transfer_event?.attributes || [])
                  .find(a =>
                    a?.key === 'id'
                  )?.value ||
                ''
              )
              .split('"')
              .join('');

            if (transfer_id) {
              attributes
                .push(
                  {
                    key: 'transfer_id',
                    value: transfer_id,
                  }
                );
            }
          }

          return {
            ...e,
            attributes,
          };
        })
        .filter(e => e.attributes?.length > 0)
        .map(e => {
          const {
            attributes,
          } = { ...e };

          return (
            Object.fromEntries(
              attributes
                .filter(a =>
                  a?.key &&
                  a.value
                )
                .map(a => {
                  const {
                    key,
                    value,
                  } = { ...a };

                  return [
                    key,
                    to_json(value) ||
                    (typeof value === 'string' ?
                      value
                        .split('"')
                        .join('') :
                      value
                    ),
                  ];
                })
            )
          );
        })
        .filter(e => e.packet_sequence)
        .map(e => {
          return {
            ...e,
            id: txhash,
            height:
              Number(
                messages
                  .find(m =>
                    _.last(
                      (m?.['@type'] || '')
                        .split('.')
                    ) === 'MsgAcknowledgement'
                  )?.proof_height?.revision_height ||
                '0'
              ) -
              1,
          };
        });

    for (const record of ack_packets) {
      const {
        id,
        height,
        transfer_id,
        packet_timeout_height,
        packet_sequence,
        packet_src_channel,
        packet_dst_channel,
        packet_connection,
      } = { ...record };

      // cross-chain transfers
      try {
        const _response =
          await read(
            'cross_chain_transfers',
            {
              bool: {
                must: [
                  { match: { 'ibc_send.packet.packet_timeout_height': packet_timeout_height } },
                  { match: { 'ibc_send.packet.packet_sequence': packet_sequence } },
                  { match: { 'ibc_send.packet.packet_src_channel': packet_src_channel } },
                  { match: { 'ibc_send.packet.packet_dst_channel': packet_dst_channel } },
                ],
                should:
                  transfer_id ?
                    [
                      {
                        bool: {
                          should: [
                            { match: { 'confirm.transfer_id': transfer_id } },
                            { match: { 'vote.transfer_id': transfer_id } },
                            { match: { transfer_id } },
                          ],
                          minimum_should_match: 1,
                        },
                      },
                    ] :
                    [
                      { match: { 'ibc_send.ack_txhash': id } },
                      {
                        bool: {
                          must_not: [
                            { exists: { field: 'ibc_send.ack_txhash' } },
                          ],
                        },
                      },
                    ],
                minimum_should_match: 1,
              },
            },
            {
              size: 1,
              sort: [{ 'send.created_at.ms': 'desc' }],
            },
          );

        if (Array.isArray(_response?.data)) {
          const _data =
            _.head(
              _response.data
            );

          const {
            send,
            link,
          } = { ..._data };
          let {
            ibc_send,
          } = { ..._data };
          let {
            destination_chain,
          } = { ...send };
          const {
            packet_data_hex,
            packet_sequence,
          } = { ...ibc_send?.packet };

          destination_chain =
            destination_chain ||
            link?.destination_chain;

          if (
            send?.txhash &&
            send.source_chain
          ) {
            const {
              txhash,
              source_chain,
            } = { ...send };

            const _id = `${txhash}_${source_chain}`.toLowerCase();

            ibc_send = {
              ...ibc_send,
              ack_txhash: id,
              failed_txhash:
                transfer_id ?
                  null :
                  undefined,
            };

            await write(
              'cross_chain_transfers',
              _id,
              {
                ..._data,
                ibc_send,
              },
              true,
            );

            await save_time_spent(
              _id,
            );

            updated = true;

            if (
              height &&
              destination_chain &&
              packet_data_hex
            ) {
              const chain_data = cosmos_non_axelarnet_chains_data
                .find(c =>
                  equals_ignore_case(
                    c?.id,
                    destination_chain,
                  )
                );

              const {
                endpoints,
              } = { ...chain_data };
              const {
                lcds,
              } = { ...endpoints };

              const _lcds =
                _.concat(
                  lcds,
                )
                .filter(l => l);

              for (const _lcd of _lcds) {
                const lcd =
                  axios.create(
                    {
                      baseURL: _lcd,
                      timeout: 3000,
                      headers: {
                        agent: 'axelarscan',
                        'Accept-Encoding': 'gzip',
                      },
                    },
                  );

                let _response =
                  await lcd
                    .get(
                      `/cosmos/tx/v1beta1/txs?limit=5&events=${encodeURIComponent(`recv_packet.packet_data_hex='${packet_data_hex}'`)}&events=tx.height=${height}`,
                    )
                    .catch(error => {
                      return {
                        data: {
                          error,
                        },
                      };
                    });

                let {
                  tx_responses,
                  txs,
                } = { ..._response?.data };

                if (tx_responses?.length < 1) {
                  _response =
                    await lcd
                      .get(
                        `/cosmos/tx/v1beta1/txs?limit=5&events=recv_packet.packet_sequence=${packet_sequence}&events=tx.height=${height}`,
                      )
                      .catch(error => {
                        return {
                          data: {
                            error,
                          },
                        };
                      });

                  if (_response?.data) {
                    tx_responses = _response.data.tx_responses;
                    txs = _response.data.txs;
                  }
                }

                const index = (tx_responses || [])
                  .findIndex(t => {
                    const recv_packet =
                      _.head(
                        (t?.logs || [])
                          .flatMap(l =>
                            (l?.events || [])
                              .filter(e =>
                                equals_ignore_case(
                                  e?.type,
                                  'recv_packet',
                                )
                              )
                          )
                      );

                    const {
                      attributes,
                    } = { ...recv_packet };

                    return (
                      packet_sequence ===
                      (
                        (attributes || [])
                          .find(a =>
                            a?.key === 'packet_sequence'
                          )?.value
                      )
                    );
                  });

                if (index > -1) {
                  const {
                    txhash,
                    timestamp,
                  } = { ...tx_responses[index] };

                  if (txhash) {
                    const received_at =
                      moment(timestamp)
                        .utc()
                        .valueOf();

                    ibc_send = {
                      ...ibc_send,
                      ack_txhash: id,
                      recv_txhash: txhash,
                      received_at: get_granularity(received_at),
                    };

                    await write(
                      'cross_chain_transfers',
                      _id,
                      {
                        ..._data,
                        ibc_send,
                      },
                      true,
                    );

                    await save_time_spent(
                      _id,
                    );
                  }

                  break;
                }
              }
            }
          }
        }
      } catch (error) {}
    }
  } catch (error) {}

  return updated;
};