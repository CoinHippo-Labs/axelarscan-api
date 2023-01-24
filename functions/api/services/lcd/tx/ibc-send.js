const {
  BigNumber,
  utils: { formatUnits },
} = require('ethers');
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
const rpc = require('../../rpc');
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
const assets_data =
  require('../../../data')?.assets?.[environment] ||
  [];

module.exports = async (
  lcd_response = {},
) => {
  let updated = false;

  const {
    tx_response,
    tx,
  } = { ...lcd_response };
  const {
    txhash,
    code,
    height,
    timestamp,
    logs,
  } = { ...tx_response };

  try {
    const {
      messages,
    } = { ...tx?.body };

    let transfer_events;

    if (
      logs?.length > 0 &&
      height
    ) {
      const _response =
        await rpc(
          '/block_results',
          {
            height,
          },
        );

      const {
        end_block_events,
      } = { ..._response };

      if (
        logs
          .findIndex(l =>
            (l?.events || [])
              .findIndex(e =>
                equals_ignore_case(
                  e?.type,
                  'send_packet',
                )
              ) > -1
          ) < 0
      ) {
        const events =
          (end_block_events || [])
            .filter(e =>
              equals_ignore_case(
                e?.type,
                'send_packet',
              ) &&
              e.attributes?.length > 0
            );

        for (const event of events) {
          const {
            attributes,
          } = { ...event };

          const packet_data =
            to_json(
              (attributes || [])
                .find(a =>
                  a?.key === 'packet_data'
                )?.value
            );

          const {
            sender,
          } = { ...packet_data };

          if (
            sender &&
            logs
              .findIndex(l =>
                (l?.events || [])
                  .findIndex(e =>
                    (e?.attributes || [])
                      .findIndex(a =>
                        [
                          'minter',
                          'receiver',
                        ].includes(a?.key) &&
                        equals_ignore_case(
                          a.value,
                          sender,
                        )
                      ) > -1  ||
                    (
                      (e?.attributes || [])
                        .findIndex(a =>
                          a?.value === 'RouteIBCTransfers'
                        ) > -1 &&
                      events.length === 1
                    )
                  ) > -1
              ) > -1
          ) {
            logs[0] = {
              ..._.head(logs),
              events:
                _.concat(
                  _.head(logs).events,
                  event,
                )
                .filter(e => e),
            };
          }
        }
      }

      transfer_events =
        (end_block_events || [])
          .filter(e =>
            e?.attributes &&
            [
              'IBCTransferSent',
            ].findIndex(t =>
              equals_ignore_case(
                t,
                _.last(
                  (e.type || '')
                    .split('.')
                ),
              )
            ) > -1
          )
          .map(e => {
            const {
              attributes,
            } = { ...e }

            return (
              Object.fromEntries(
                attributes
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
          });
    }

    const send_packets =
      (logs || [])
        .flatMap(l =>
          (l?.events || [])
            .filter(e =>
              equals_ignore_case(
                e?.type,
                'send_packet',
              )
            )
        )
        .filter(e => e.attributes?.length > 0)
        .flatMap(e => {
          let {
            attributes,
          } = { ...e };

          attributes =
            attributes
              .filter(a =>
                a?.key &&
                a.value
              );

          const events = [];
          let event;

          attributes
            .forEach((a, i) => {
              const {
                key,
                value,
              } = { ...a };

              if (
                ['packet_data'].includes(key) ||
                i === attributes.length - 1
              ) {
                if (event) {
                  events.push(event);
                }

                event = {};
              }

              event = {
                ...event,
                [key]:
                  ['packet_data'].includes(key) ?
                    to_json(value) :
                    value,
              };
            });

          return events;
        })
        .filter(e => e.packet_data?.amount)
        .map(e => {
          const {
            packet_data,
          } = { ...e };
          const {
            sender,
            receiver,
            amount,
            denom,
          } = { ...packet_data };

          const created_at =
            moment(timestamp)
              .utc()
              .valueOf();

          const asset_data = assets_data
            .find(a =>
              equals_ignore_case(
                a?.id,
                denom,
              ) ||
              (a?.ibc || [])
                .findIndex(i =>
                  i?.chain_id === axelarnet.id &&
                  equals_ignore_case(
                    i?.ibc_denom,
                    denom,
                  )
                ) > -1
            );

          const {
            ibc,
          } = { ...asset_data };
          let {
            decimals,
          } = { ...asset_data };

          decimals =
            (ibc || [])
              .find(i =>
                i?.chain_id === axelarnet.id
              )?.decimals ||
            decimals ||
            6;

          const transfer_id = (transfer_events || [])
            .find(e =>
              equals_ignore_case(
                (
                  e?.recipient ||
                  e?.receipient ||
                  ''
                )
                  .split('"')
                  .join(''),
                receiver,
              ) &&
              equals_ignore_case(
                e?.asset?.denom,
                denom,
              ) &&
              equals_ignore_case(
                e?.asset?.amount,
                amount,
              )
            )?.id;

          const record = {
            id: txhash,
            height,
            status:
              code ?
                'failed' :
                'success',
            status_code: code,
            type: 'RouteIBCTransfersRequest',
            created_at: get_granularity(created_at),
            sender_address: sender,
            recipient_address: receiver,
            denom,
            amount:
              Number(
                formatUnits(
                  BigNumber.from(
                    amount
                  )
                  .toString(),
                  decimals,
                )
              ),
            transfer_id,
            packet: e,
          };

          return record;
        });

    for (const record of send_packets) {
      const {
        id,
        height,
        status,
        type,
        created_at,
        sender_address,
        recipient_address,
        denom,
        amount,
        transfer_id,
        packet,
      } = { ...record };
      const {
        ms,
      } = { ...created_at };

      // cross-chain transfers
      try {
        const _record = {
          txhash: id,
          height,
          status,
          type,
          created_at,
          sender_address,
          recipient_address,
          denom,
          amount,
          transfer_id,
          packet,
        };

        const _response =
          await read(
            'cross_chain_transfers',
            {
              bool: {
                must:
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
                      { match: { 'ibc_send.txhash': id } },
                      { match: { 'ibc_send.recipient_address': recipient_address } },
                      { match: { 'ibc_send.denom': denom } },
                    ],
              },
            },
            {
              size: 1,
            },
          );

        if (
          (_response?.data || [])
            .filter(d =>
              typeof d?.send?.amount_received === 'number'
            )
            .length < 1
        ) {
          const _response =
            await read(
              'cross_chain_transfers',
              {
                bool: {
                  must: [
                    { match: { 'send.status': 'success' } },
                    { match: { 'link.recipient_address': recipient_address } },
                    {
                      range: {
                        'send.created_at.ms': {
                          lte: ms,
                          gte:
                            moment(ms)
                              .subtract(
                                4,
                                'hours',
                              )
                              .valueOf(),
                        },
                      },
                    },
                    { match: { 'send.denom': denom } },
                    { range: { 'send.amount': { gte: Math.floor(amount) } } },
                    {
                      bool: {
                        should: [
                          { match: { 'send.amount_received': amount } },
                          {
                            bool: {
                              must: [
                                { range: { 'send.amount': { lte: Math.ceil(amount * 1.2) } } },
                              ],
                              must_not: [
                                { exists: { field: 'send.amount_received' } },
                              ],
                            },
                          },
                        ],
                        minimum_should_match: 1,
                      },
                    },
                  ],
                  should: [
                    { exists: { field: 'confirm' } },
                    { exists: { field: 'vote' } },
                  ],
                  minimum_should_match: 1,
                  must_not: [
                    { exists: { field: 'ibc_send' } },
                  ],
                },
              },
              {
                size: 1,
                sort: [{ 'send.created_at.ms': 'desc' }],
              },
            );

          const _data =
            _.head(
              _response?.data
            );

          const {
            send,
          } = { ..._data };

          if (
            send?.txhash &&
            send.source_chain
          ) {
            const {
              txhash,
              source_chain,
            } = { ...send };

            const _id = `${txhash}_${source_chain}`.toLowerCase();

            await write(
              'cross_chain_transfers',
              _id,
              {
                ..._data,
                ibc_send: _record,
              },
              true,
            );

            await save_time_spent(
              _id,
            );

            updated = true;
          }
        }
        else {
          const _data =
            _.head(
              _response?.data
            );

          const {
            send,
            ibc_send,
          } = { ..._data };

          if (
            send?.txhash &&
            send.source_chain &&
            !_.isEqual(
              ibc_send,
              _record,
            )
          ) {
            const {
              txhash,
              source_chain,
            } = { ...send };

            const _id = `${txhash}_${source_chain}`.toLowerCase();

            await write(
              'cross_chain_transfers',
              _id,
              {
                ..._data,
                ibc_send: _record,
              },
              true,
            );

            await save_time_spent(
              _id,
            );

            updated = true;
          }
        }
      } catch (error) {}
    }
  } catch (error) {}

  return {
    logs,
    updated,
  };
};