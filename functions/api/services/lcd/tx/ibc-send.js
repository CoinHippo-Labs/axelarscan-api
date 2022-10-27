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
  saveTimeSpent,
} = require('../../transfers/utils');
const rpc = require('../../rpc');
const {
  equals_ignore_case,
  to_json,
  get_granularity,
} = require('../../../utils');

const environment = process.env.ENVIRONMENT ||
  config?.environment;

const evm_chains_data = require('../../../data')?.chains?.[environment]?.evm ||
  [];
const cosmos_chains_data = require('../../../data')?.chains?.[environment]?.cosmos ||
  [];
const chains_data = _.concat(
  evm_chains_data,
  cosmos_chains_data,
);
const axelarnet = chains_data.find(c => c?.id === 'axelarnet');
const assets_data = require('../../../data')?.assets?.[environment] ||
  [];

module.exports = async (
  lcd_response = {},
) => {
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
      const _response = await rpc(
        '/block_results',
        {
          height,
        },
      );

      const {
        end_block_events,
      } = { ..._response };

      if (
        logs.findIndex(l =>
          l?.events?.findIndex(e =>
            equals_ignore_case(e?.type, 'send_packet')
          ) > -1
        ) < 0
      ) {
        const events = (end_block_events || [])
          .filter(e =>
            equals_ignore_case(e?.type, 'send_packet') &&
            e.attributes?.length > 0
          );

        for (const event of events) {
          const {
            attributes,
          } = { ...event };

          const packet_data = to_json(
            attributes?.find(a =>
              a?.key === 'packet_data'
            )?.value
          );

          const {
            sender,
          } = { ...packet_data };

          if (
            sender &&
            logs.findIndex(l =>
              l?.events?.findIndex(e =>
                e?.attributes?.findIndex(a =>
                  [
                    'minter',
                    'receiver',
                  ].includes(a?.key) &&
                  equals_ignore_case(a.value, sender)
                ) > -1  ||
                (
                  e?.attributes?.findIndex(a =>
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

      transfer_events = (end_block_events || [])
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

          return Object.fromEntries(
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
          );
        });
    }

    const send_packets = (logs || [])
      .flatMap(l =>
        (l?.events || [])
          .filter(e =>
            equals_ignore_case(e?.type, 'send_packet')
          )
      )
      .filter(e => e.attributes?.length > 0)
      .flatMap(e => {
        let {
          attributes,
        } = { ...e };

        attributes = attributes
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
              [key]: ['packet_data'].includes(key) ?
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

        const created_at = moment(timestamp)
          .utc()
          .valueOf();

        const asset_data = assets_data.find(a =>
          equals_ignore_case(a?.id, denom) ||
          a?.ibc?.findIndex(i =>
            i?.chain_id === axelarnet.id &&
            equals_ignore_case(i?.ibc_denom, denom)
          ) > -1
        );

        const {
          ibc,
        } = { ...asset_data };
        let {
          decimals,
        } = { ...asset_data };

        decimals =
          ibc?.find(i =>
            i?.chain_id === axelarnet.id
          )?.decimals ||
          decimals ||
          6;

        const transfer_id =
          (transfer_events || [])
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
          type: 'RouteIBCTransfersRequest',
          status_code: code,
          status: code ?
            'failed' :
            'success',
          height,
          created_at: get_granularity(created_at),
          sender_address: sender,
          recipient_address: receiver,
          amount: Number(
            formatUnits(
              BigNumber.from(amount)
                .toString(),
              decimals,
            )
          ),
          denom,
          packet: e,
          transfer_id,
        };

        return record;
      });

    for (const record of send_packets) {
      const {
        id,
        created_at,
        recipient_address,
        amount,
        denom,
        transfer_id,
      } = { ...record };
      const {
        ms,
      } = { ...created_at };

      const _response = await read(
        'transfers',
        {
          bool: {
            must: transfer_id ?
              [
                {
                  bool: {
                    should: [
                      { match: { 'confirm_deposit.transfer_id': transfer_id } },
                      { match: { 'vote.transfer_id': transfer_id } },
                      { match: { transfer_id } },
                    ],
                    minimum_should_match: 1,
                  },
                },
              ] :
              [
                { match: { 'ibc_send.id': id } },
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
            typeof d?.source?.amount_received === 'number'
          )
          .length < 1
      ) {
        const _response = await read(
          'transfers',
          {
            bool: {
              must: [
                { match: { 'source.status_code': 0 } },
                { match: { 'link.recipient_address': recipient_address } },
                {
                  range: {
                    'source.created_at.ms': {
                      lte: ms,
                      gte: moment(ms)
                        .subtract(
                          24,
                          'hours',
                        )
                        .valueOf(),
                    },
                  },
                },
                { range: { 'source.amount': { gte: Math.floor(amount) } } },
                {
                  bool: {
                    should: [
                      { match: { 'source.amount_received': amount } },
                      {
                        bool: {
                          must: [
                            {
                              range: {
                                'source.amount': {
                                  lte: Math.ceil(amount * 1.2),
                                },
                              },
                            },
                          ],
                          must_not: [
                            { exists: { field: 'source.amount_received' } },
                          ],
                        },
                      },
                    ],
                    minimum_should_match: 1,
                  },
                },
                { match: { 'source.denom': denom } },
              ],
              should: [
                { exists: { field: 'confirm_deposit' } },
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
            sort: [{ 'source.created_at.ms': 'desc' }],
          },
        );

        const transfer_data = _.head(_response?.data);
        let token_sent_data;

        if (!transfer_data) {
          const _response = await read(
            'token_sent_events',
            {
              bool: {
                must: [
                  { match: { 'event.returnValues.destinationAddress': recipient_address } },
                  {
                    range: {
                      'event.created_at.ms': {
                        lte: ms,
                        gte: moment(ms)
                          .subtract(
                            24,
                            'hours',
                          )
                          .valueOf(),
                      },
                    },
                  },
                  { range: { 'event.amount': { gte: Math.floor(amount) } } },
                  {
                    bool: {
                      should: [
                        { match: { 'event.amount_received': amount } },
                        {
                          bool: {
                            must: [
                              {
                                range: {
                                  'event.amount': {
                                    lte: Math.ceil(amount * 1.2),
                                  },
                                },
                              },
                            ],
                            must_not: [
                              { exists: { field: 'event.amount_received' } },
                            ],
                          },
                        },
                      ],
                      minimum_should_match: 1,
                    },
                  },
                  { match: { 'event.denom': denom } },
                ],
                should: [
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
              sort: [{ 'event.created_at.ms': 'desc' }],
            },
          );

          token_sent_data = _.head(_response?.data);
        }

        const data =
          transfer_data ||
          token_sent_data;

        if (data) {
          const {
            source,
            event,
          } = { ...data };
          const {
            recipient_address,
          } = { ...source };

          const id =
            (
              source ||
              event
            )?.id;

          const _id = recipient_address ?
            `${id}_${recipient_address}`.toLowerCase() :
            id;

          if (_id) {
            await write(
              event ?
                'token_sent_events' :
                'transfers',
              _id,
              {
                ibc_send: record,
              },
              true,
            );

            await saveTimeSpent(
              _id,
              null,
              event ?
                'token_sent_events' :
                undefined,
            );
          }
        }
      }
      else {
        const data = _.head(_response?.data);
        const {
          source,
          ibc_send,
        } = { ...data };
        const {
          id,
          recipient_address,
        } = { ...source };

        if (
          data &&
          recipient_address &&
          !_.isEqual(
            ibc_send,
            record,
          )
        ) {
          const _id = `${id}_${recipient_address}`.toLowerCase();

          await write(
            'transfers',
            _id,
            {
              ibc_send: record,
            },
            true,
          );

          await saveTimeSpent(
            _id,
          );
        }
      }
    }
  } catch (error) {}

  return logs;
};