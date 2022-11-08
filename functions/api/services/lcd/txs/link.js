const _ = require('lodash');
const moment = require('moment');
const config = require('config-yml');
const {
  get,
  read,
  write,
} = require('../../index');
const assets_price = require('../../assets-price');
const {
  equals_ignore_case,
  get_granularity,
  normalize_original_chain,
  normalize_chain,
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
  const {
    tx_responses,
  } = { ...lcd_response };

  try {
    const records = tx_responses
      .filter(t =>
        !t?.code &&
        [
          'LinkRequest',
        ].findIndex(s =>
          (t?.tx?.body?.messages || [])
            .findIndex(m =>
              m?.['@type']?.includes(s)
            ) > -1
        ) > -1
      );

    for (let i = 0; i < records.length; i++) {
      const t = records[i];

      const {
        txhash,
        timestamp,
        tx,
        logs,
      } = { ...t };
      let {
        height,
      } = { ...t };
      const {
        messages,
      } = { ...tx?.body };

      height = Number(height);

      const event =
        _.head(
          (logs || [])
            .flatMap(l =>
              (l?.events || [])
                .filter(e =>
                  equals_ignore_case(
                    e?.type,
                    'link',
                  )
                )
            )
        );

      const {
        attributes,
      } = { ...event };

      const created_at =
        moment(timestamp)
          .utc()
          .valueOf();

      let sender_chain = (attributes || [])
        .find(a =>
          a?.key === 'sourceChain'
        )?.value;

      const deposit_address = (attributes || [])
        .find(a =>
          a?.key === 'depositAddress'
        )?.value;

      const record = {
        ..._.head(messages),
        txhash,
        height,
        created_at: get_granularity(created_at),
        sender_chain,
        deposit_address,
      };

      const {
        sender,
        chain,
        recipient_addr,
        asset,
      } = { ...record };
      let {
        id,
        type,
        original_sender_chain,
        original_recipient_chain,
        recipient_chain,
        sender_address,
        recipient_address,
        denom,
        price,
      } = { ...record };

      sender_address = sender;
      recipient_address = recipient_addr;

      if (
        equals_ignore_case(
          sender_chain,
          axelarnet.id,
        )
      ) {
        const chain_data = cosmos_non_axelarnet_chains_data
          .find(c =>
            sender_address?.startsWith(c?.prefix_address)
          );

        const {
          id,
          overrides,
        } = { ...chain_data };

        sender_chain =
          _.last(
            Object.keys({ ...overrides })
          ) ||
          id ||
          sender_chain;
      }

      id =
        deposit_address ||
        txhash;

      type =
        _.head(
          (record['@type'] || '')
            .split('.')
        )
        .replace(
          '/',
          '',
        );

      if (
        sender_address?.startsWith(axelarnet.prefix_address) &&
        chains_data
          .findIndex(c =>
            equals_ignore_case(
              c?.id,
              sender_chain,
            )
          ) > -1
      ) {
        const _response =
          await read(
            'transfers',
            {
              bool: {
                must: [
                  { match: { 'source.recipient_address': deposit_address } },
                  { match: { 'source.sender_chain': sender_chain } },
                ],
              },
            },
            {
              size: 1,
            },
          );

        const {
          source,
          link,
        } = { ..._.head(_response?.data) };

        if (source?.sender_address) {
          sender_address = source.sender_address;
        }
      }

      sender_chain =
        normalize_chain(
          cosmos_non_axelarnet_chains_data
            .find(c =>
              sender_address?.startsWith(c?.prefix_address)
            )?.id ||
          sender_chain ||
          chain
        );

      original_sender_chain = normalize_original_chain(sender_chain);

      if (!original_sender_chain?.startsWith(sender_chain)) {
        original_sender_chain = sender_chain;
      }
      
      recipient_chain = normalize_chain(recipient_chain);

      original_recipient_chain = normalize_original_chain(recipient_chain);

      if (!original_recipient_chain?.startsWith(recipient_chain)) {
        original_recipient_chain = recipient_chain;
      }

      denom =
        asset ||
        denom;

      delete record['@type'];
      delete record.sender;
      delete record.chain;
      delete record.recipient_addr;

      if (
        typeof price !== 'number' &&
        denom
      ) {
        let _response =
          await assets_price(
            {
              chain: original_sender_chain,
              denom,
              timestamp:
                moment(timestamp)
                  .utc()
                  .valueOf(),
            },
          );

        if (typeof _.head(_response)?.price !== 'number') {
          _response =
            await get(
              'deposit_addresses',
              id,
            );
        }

        const _price = _.head(_response)?.price;

        if (typeof _price === 'number') {
          price = _price;
        }
      }

      records[i] = {
        ...record,
        id,
        type,
        original_sender_chain,
        original_recipient_chain,
        sender_chain,
        recipient_chain,
        sender_address,
        deposit_address,
        recipient_address,
        denom,
        price,
      };
    }

    for (let i = 0; i < records.length; i++) {
      const record = records[i];

      const {
        id,
      } = { ...record };

      if (
        i === 0 ||
        i === records.length - 1
      ) {
        await write(
          'deposit_addresses',
          id,
          record,
        );
      }
      else {
        write(
          'deposit_addresses',
          id,
          record,
        );
      }
    }
  } catch (error) {}
};