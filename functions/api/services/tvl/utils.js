const {
  BigNumber,
  Contract,
  constants: { AddressZero },
  utils: { formatUnits },
} = require('ethers');
const cli = require('../cli');
const {
  equals_ignore_case,
  to_json,
} = require('../../utils');

const getContractSupply = async (
  contract_data,
  provider,
) => {
  let supply;

  const {
    contract_address,
    decimals,
  } = { ...contract_data };

  if (
    contract_address &&
    provider
  ) {
    try {
      const contract =
        new Contract(
          contract_address,
          [
            'function totalSupply() view returns (uint256)',
          ],
          provider,
        );

      supply =
        await contract
          .totalSupply();
    } catch (error) {}
  }

  return (
    supply &&
    Number(
      formatUnits(
        BigNumber.from(
          supply
            .toString()
        ),
        decimals ||
        18,
      )
    )
  );
};

const getEVMBalance = async (
  address,
  contract_data,
  provider,
) => {
  let balance;

  const {
    contract_address,
    decimals,
  } = { ...contract_data };

  if (
    address &&
    contract_address &&
    provider) {
    try {
      if (contract_address === AddressZero) {
        balance =
          await provider
            .getBalance(
              address,
            );
      }
      else {
        const contract =
          new Contract(
            contract_address,
            [
              'function balanceOf(address owner) view returns (uint256)',
            ],
            provider,
          );

        balance =
          await contract
            .balanceOf(
              address,
            );
      }
    } catch (error) {}
  }

  return (
    balance &&
    Number(
      formatUnits(
        BigNumber.from(
          balance
            .toString()
        ),
        decimals ||
        18,
      )
    )
  );
};

const getCosmosBalance = async (
  address,
  denom_data,
  lcds,
) => {
  let balance;

  const {
    base_denom,
    denom,
    decimals,
  } = { ...denom_data };

  const denoms =
    [
      base_denom,
      denom,
    ]
    .filter(d => d);

  lcds =
    typeof lcds === 'string' ?
      [lcds] :
      lcds;

  if (
    address &&
    denoms.length > 0 &&
    lcds
  ) {
    try {
      const paths =
        [
          '/cosmos/bank/v1beta1/balances/{address}/by_denom',
          '/cosmos/bank/v1beta1/balances/{address}/{denom}',
        ];

      let valid = false;

      for (const lcd of lcds) {
        for (const denom of denoms) {
          for (const path of paths) {
            const response =
              await lcd
                .get(
                  path
                    .replace(
                      '{address}',
                      address,
                    )
                    .replace(
                      '{denom}',
                      encodeURIComponent(denom),
                    ),
                  {
                    params: {
                      denom,
                    },
                  },
                )
                .catch(error => {
                  return {
                    data: {
                      error,
                    },
                  };
                });

            const {
              amount,
            } = { ...response?.data?.balance };

            balance = amount;

            if (
              balance &&
              balance !== '0'
            ) {
              valid = true;
              break;
            }
          }

          if (valid) {
            break;
          }
        }

        if (valid) {
          break;
        }
      }
    } catch (error) {}
  }

  return (
    balance &&
    Number(
      formatUnits(
        BigNumber.from(
          balance
            .toString()
        ),
        decimals ||
        6,
      )
    )
  );
};

const getCosmosSupply = async (
  denom_data,
  lcds,
) => {
  let supply;

  const {
    base_denom,
    denom,
    decimals,
  } = { ...denom_data };

  const denoms =
    [
      denom,
    ]
    .filter(d => d);

  lcds =
    typeof lcds === 'string' ?
      [lcds] :
      lcds;

  if (
    denoms.length > 0 &&
    lcds
  ) {
    try {
      let valid = false;

      for (const lcd of lcds) {
        for (const denom of denoms) {
          const response =
            await lcd
              .get(
                `/cosmos/bank/v1beta1/supply/${encodeURIComponent(denom)}`,
              )
              .catch(error => {
                return {
                  data: {
                    error,
                  },
                };
              });

          const {
            amount,
          } = { ...response?.data?.amount };

          supply = amount;

          if (
            supply &&
            supply !== '0'
          ) {
            valid = true;
            break;
          }
        }

        if (!valid) {
          const response =
            await lcd
              .get(
                '/cosmos/bank/v1beta1/supply',
                {
                  params: {
                    'pagination.limit': 2000,
                  },
                },
              )
              .catch(error => {
                return {
                  data: {
                    error,
                  },
                };
              });

          supply = (response?.data?.supply || [])
            .find(s =>
              equals_ignore_case(
                s?.denom,
                denom,
              )
            )?.amount;

          if (
            supply &&
            supply !== '0'
          ) {
            valid = true;
          }
          else if (response?.data?.supply) {
            supply = 0;
            valid = true;
          }
        }

        if (valid) {
          break;
        }
      }
    } catch (error) {}
  }

  return (
    supply &&
    Number(
      formatUnits(
        BigNumber.from(
          supply
            .toString()
        ),
        decimals ||
        6,
      )
    )
  );
};

const getAxelarnetSupply = async (
  denom_data,
) => {
  let supply;

  const {
    base_denom,
    denom,
    decimals,
  } = { ...denom_data };

  const denoms =
    [
      base_denom,
      denom,
    ]
    .filter(d => d);

  if (
    denoms.length > 0 &&
    cli
  ) {
    try {
      for (const denom of denoms) {
        const response =
          await cli(
            '',
            {
              cmd: `axelard q bank total --denom ${denom} -oj`,
            },
          );

        const {
          stdout,
        } = { ...response };

        const output = to_json(stdout);

        const {
          amount,
        } = { ...output };

        supply = amount;

        if (
          supply &&
          supply !== '0'
        ) {
          break;
        }
      }
    } catch (error) {}
  }

  return (
    supply &&
    Number(
      formatUnits(
        BigNumber.from(
          supply
            .toString()
        ),
        decimals ||
        6,
      )
    )
  );
};

module.exports = {
  getContractSupply,
  getEVMBalance,
  getCosmosBalance,
  getCosmosSupply,
  getAxelarnetSupply,
};