module.exports = {
  mainnet: [
    {
      id: 'uaxl',
      symbol: 'AXL',
      title: 'Axelar',
      image: '/logos/assets/axl.png',
      contract_decimals: 6,
      coingecko_id: 'axelar-network',
      is_staging: true,
      contracts: [
        {
          contract_address: '0x3eacbdc6c382ea22b78acc158581a55aaf4ef3cc',
          chain_id: 1,
          contract_decimals: 6,
        },
        {
          contract_address: '0x1b7c03bc2c25b8b5989f4bc2872cf9342cec80ae',
          chain_id: 43114,
          contract_decimals: 6,
        },
        {
          contract_address: '0x161ce0d2a3f625654abf0098b06e9eaf5f308691',
          chain_id: 137,
          contract_decimals: 6,
        },
        {
          contract_address: '0xe4619601fff110e649f68fd209080697b8c40dbc',
          chain_id: 250,
          contract_decimals: 6,
        },
        {
          contract_address: '0x3eacbdc6c382ea22b78acc158581a55aaf4ef3cc',
          chain_id: 1284,
          contract_decimals: 6,
        },
      ],
    },
    {
      id: 'uusdc',
      symbol: 'USDC',
      title: 'USD Coin',
      image: '/logos/assets/usdc.png',
      contract_decimals: 6,
      coingecko_id: 'usd-coin',
      contracts: [
        {
          contract_address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
          chain_id: 1,
          contract_decimals: 6,
          is_native: true,
        },
        {
          contract_address: '0xfab550568c688d5d8a52c7d794cb93edc26ec0ec',
          chain_id: 43114,
          contract_decimals: 6,
          symbol: 'axlUSDC',
        },
        {
          contract_address: '0x750e4c4984a9e0f12978ea6742bc1c5d248f40ed',
          chain_id: 137,
          contract_decimals: 6,
          symbol: 'axlUSDC',
        },
        {
          contract_address: '0x1b6382dbdea11d97f24495c9a90b7c88469134a4',
          chain_id: 250,
          contract_decimals: 6,
          symbol: 'axlUSDC',
        },
        {
          contract_address: '0xca01a1d0993565291051daff390892518acfad3a',
          chain_id: 1284,
          contract_decimals: 6,
          symbol: 'axlUSDC',
        },
      ],
      ibc: [
        {
          ibc_denom: 'ibc/932D6003DA334ECBC5B23A071B4287D0A5CC97331197FE9F1C0689BA002A8421',
          chain_id: 'cosmoshub',
          contract_decimals: 6,
        },
        {
          ibc_denom: 'ibc/D189335C6E4A68B513C10AB227BF1C1D38C746766278BA3EEB4FB14124F1D858',
          chain_id: 'osmosis',
          contract_decimals: 6,
        },
      ],
    },
    {
      id: 'uusdt',
      symbol: 'USDT',
      title: 'Tether',
      image: '/logos/assets/usdt.png',
      contract_decimals: 6,
      coingecko_id: 'tether',
      contracts: [
        {
          contract_address: '0xdac17f958d2ee523a2206206994597c13d831ec7',
          chain_id: 1,
          contract_decimals: 6,
          is_native: true,
        },
        {
          contract_address: '0xf976ba91b6bb3468c91e4f02e68b37bc64a57e66',
          chain_id: 43114,
          contract_decimals: 6,
          symbol: 'axlUSDT',
        },
        {
          contract_address: '0xceed2671d8634e3ee65000edbbee66139b132fbf',
          chain_id: 137,
          contract_decimals: 6,
          symbol: 'axlUSDT',
        },
        {
          contract_address: '0xd226392c23fb3476274ed6759d4a478db3197d82',
          chain_id: 250,
          contract_decimals: 6,
          symbol: 'axlUSDT',
        },
        {
          contract_address: '0xdfd74af792bc6d45d1803f425ce62dd16f8ae038',
          chain_id: 1284,
          contract_decimals: 6,
          symbol: 'axlUSDT',
        },
      ],
      ibc: [
        {
          ibc_denom: 'ibc/5662412372381F56C5F83A0404DC7209E5143ABD32EF67B5705DBE8D9C2BF001',
          chain_id: 'cosmoshub',
          contract_decimals: 6,
        },
        {
          ibc_denom: 'ibc/8242AD24008032E457D2E12D46588FD39FB54FB29680C6C7663D296B383C37C4',
          chain_id: 'osmosis',
          contract_decimals: 6,
        },
      ],
    },
    {
      id: 'dai-wei',
      symbol: 'DAI',
      title: 'Dai',
      image: '/logos/assets/dai.png',
      contract_decimals: 18,
      coingecko_id: 'dai',
      contracts: [
        {
          contract_address: '0x6b175474e89094c44da98b954eedeac495271d0f',
          chain_id: 1,
          contract_decimals: 18,
          is_native: true,
        },
        {
          contract_address: '0xc5fa5669e326da8b2c35540257cd48811f40a36b',
          chain_id: 43114,
          contract_decimals: 18,
          symbol: 'axlDAI',
        },
        {
          contract_address: '0xddc9e2891fa11a4cc5c223145e8d14b44f3077c9',
          chain_id: 137,
          contract_decimals: 18,
          symbol: 'axlDAI',
        },
        {
          contract_address: '0xd5d5350f42cb484036a1c1af5f2df77eafadcaff',
          chain_id: 250,
          contract_decimals: 18,
          symbol: 'axlDAI',
        },
        {
          contract_address: '0x14df360966a1c4582d2b18edbdae432ea0a27575',
          chain_id: 1284,
          contract_decimals: 18,
          symbol: 'axlDAI',
        },
      ],
      ibc: [
        {
          ibc_denom: 'ibc/4A98C8AC2C35498162346F28EEBF3206CBEF81F44725FE62A3DB0CC10E88E695',
          chain_id: 'cosmoshub',
          contract_decimals: 18,
        },
        {
          ibc_denom: 'ibc/0CD3A0285E1341859B5E86B6AB7682F023D03E97607CCC1DC95706411D866DF7',
          chain_id: 'osmosis',
          contract_decimals: 18,
        },
      ],
    },
    {
      id: 'weth-wei',
      symbol: 'WETH',
      title: 'Ethereum',
      image: '/logos/assets/eth.png',
      contract_decimals: 18,
      coingecko_id: 'ethereum',
      contracts: [
        {
          contract_address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
          chain_id: 1,
          contract_decimals: 18,
          is_native: true,
        },
      ],
      ibc: [
        {
          ibc_denom: 'ibc/EA1D43981D5C9A1C4AAEA9C23BB1D4FA126BA9BC7020A25E0AE4AA841EA25DC5',
          chain_id: 'osmosis',
          contract_decimals: 18,
        },
      ],
    },
    {
      id: 'wbtc-satoshi',
      symbol: 'WBTC',
      title: 'Bitcoin',
      image: '/logos/assets/wbtc.png',
      contract_decimals: 8,
      coingecko_id: 'bitcoin',
      contracts: [
        {
          contract_address: '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599',
          chain_id: 1,
          contract_decimals: 18,
          is_native: true,
        },
      ],
    },
    {
      id: 'frax-wei',
      symbol: 'FRAX',
      title: 'Frax',
      image: '/logos/assets/frax.png',
      contract_decimals: 18,
      coingecko_id: 'frax',
      contracts: [
        {
          contract_address: '0x853d955acef822db058eb8505911ed77f175b99e',
          chain_id: 1,
          contract_decimals: 18,
          is_native: true,
        },
        {
          contract_address: '0x4914886dbb8aad7a7456d471eaab10b06d42348d',
          chain_id: 43114,
          contract_decimals: 18,
          symbol: 'axlFRAX',
        },
        {
          contract_address: '0x53adc464b488be8c5d7269b9abbce8ba74195c3a',
          chain_id: 137,
          contract_decimals: 18,
          symbol: 'axlFRAX',
        },
        {
          contract_address: '0xbe71e68fb36d14565f523c9c36ab2a8be0c26d55',
          chain_id: 250,
          contract_decimals: 18,
          symbol: 'axlFRAX',
        },
        {
          contract_address: '0x61c82805453a989e99b544dfb7031902e9bac448',
          chain_id: 1284,
          contract_decimals: 18,
          symbol: 'axlFRAX',
        },
      ],
      ibc: [
        {
          ibc_denom: 'ibc/3792246C7C422C037C603C955F8383B4E32E7555D693344F9A029A67FE221C57',
          chain_id: 'cosmoshub',
          contract_decimals: 18,
        },
        {
          ibc_denom: 'ibc/0E43EDE2E2A3AFA36D0CD38BDDC0B49FECA64FA426A82E102F304E430ECF46EE',
          chain_id: 'osmosis',
          contract_decimals: 18,
        },
      ],
    },
    {
      id: 'uatom',
      symbol: 'ATOM',
      title: 'Cosmos',
      image: '/logos/assets/atom.png',
      contract_decimals: 6,
      coingecko_id: 'cosmos',
      contracts: [
        {
          contract_address: '0x27292cf0016e5df1d8b37306b2a98588acbd6fca',
          chain_id: 1,
          contract_decimals: 6,
          symbol: 'axlATOM',
        },
        {
          contract_address: '0x80d18b1c9ab0c9b5d6a6d5173575417457d00a12',
          chain_id: 43114,
          contract_decimals: 6,
          symbol: 'axlATOM',
        },
        {
          contract_address: '0x33f8a5029264bcfb66e39157af3fea3e2a8a5067',
          chain_id: 137,
          contract_decimals: 6,
          symbol: 'axlATOM',
        },
        {
          contract_address: '0x3bb68cb55fc9c22511467c18e42d14e8c959c4da',
          chain_id: 250,
          contract_decimals: 6,
          symbol: 'axlATOM',
        },
        {
          contract_address: '0x27292cf0016e5df1d8b37306b2a98588acbd6fca',
          chain_id: 1284,
          contract_decimals: 6,
          symbol: 'axlATOM',
        },
      ],
      ibc: [
        {
          ibc_denom: 'ibc/9117A26BA81E29FA4F78F57DC2BD90CD3D26848101BA880445F119B22A1E254E',
          chain_id: 'axelar',
          contract_decimals: 6,
        },
      ],
    },
    {
      id: 'ungm',
      symbol: 'NGM',
      title: 'e-Money',
      image: '/logos/assets/ngm.png',
      contract_decimals: 6,
      coingecko_id: 'e-money',
      contracts: [
        {
          contract_address: '0x08fe7a0db575c2a08d76eeca71763e48c6e60f45',
          chain_id: 1,
          contract_decimals: 6,
        },
        {
          contract_address: '0x5a44422beaaa38031f57720d88697105be6970be',
          chain_id: 43114,
          contract_decimals: 6,
        },
        {
          contract_address: '0xc8d5a4e04387ebdaa2c0fbb6858f246116431e9f',
          chain_id: 137,
          contract_decimals: 6,
        },
        {
          contract_address: '0xe549caf5f0c3e80b8738cb03ae4fbb4c15b0dd86',
          chain_id: 250,
          contract_decimals: 6,
        },
        {
          contract_address: '0x08fe7a0db575c2a08d76eeca71763e48c6e60f45',
          chain_id: 1284,
          contract_decimals: 6,
        },
      ],
    },
    {
      id: 'eeur',
      symbol: 'EEUR',
      title: 'e-Money EUR',
      image: '/logos/assets/eeur.png',
      contract_decimals: 6,
      coingecko_id: 'e-money-eur',
      contracts: [
        {
          contract_address: '0xdd26a5c8ae5b60bb14aeced892a052ca48a2e915',
          chain_id: 1,
          contract_decimals: 6,
        },
        {
          contract_address: '0xe1d70994be12b73e76889412b284a8f19b0de56d',
          chain_id: 43114,
          contract_decimals: 6,
        },
        {
          contract_address: '0x8cd51880c0a5dbde37dddfce8d5b772fc9007495',
          chain_id: 137,
          contract_decimals: 6,
        },
        {
          contract_address: '0x4000ab030f3615d1616b4c71e7129bbe3f1f9c55',
          chain_id: 250,
          contract_decimals: 6,
        },
        {
          contract_address: '0xdd26a5c8ae5b60bb14aeced892a052ca48a2e915',
          chain_id: 1284,
          contract_decimals: 6,
        },
      ],
      ibc: [
        {
          ibc_denom: 'ibc/373EF14936B38AC8F8A7E7024C0FB7099369FDDFDA3CDA9EFA73684B16249B64',
          chain_id: 'emoney',
          contract_decimals: 6,
        },
      ],
    },
    {
      id: 'uosmo',
      symbol: 'OSMO',
      title: 'Osmosis',
      image: '/logos/assets/osmo.png',
      contract_decimals: 6,
      coingecko_id: 'osmosis',
      ibc: [
        {
          ibc_denom: 'ibc/13B2C536BB057AC79D5616B8EA1B9540EC1F2170718CAFF6F0083C966FFFED0B',
          chain_id: 'axelar',
          contract_decimals: 6,
        },
      ],
    },
    {
      id: 'ujuno',
      symbol: 'JUNO',
      title: 'JUNO',
      image: '/logos/assets/juno.png',
      contract_decimals: 6,
      coingecko_id: 'juno-network',
    },
    {
      id: 'uusd',
      symbol: 'UST',
      title: 'TerraUSD',
      image: '/logos/assets/ust.png',
      contract_decimals: 6,
      coingecko_id: 'terrausd',
      contracts: [
        {
          contract_address: '0x085416975fe14c2a731a97ec38b9bf8135231f62',
          chain_id: 1,
          contract_decimals: 6,
        },
        {
          contract_address: '0x260bbf5698121eb85e7a74f2e45e16ce762ebe11',
          chain_id: 43114,
          contract_decimals: 6,
        },
        {
          contract_address: '0xeddc6ede8f3af9b4971e1fa9639314905458be87',
          chain_id: 137,
          contract_decimals: 6,
        },
        {
          contract_address: '0x2b9d3f168905067d88d93f094c938bacee02b0cb',
          chain_id: 250,
          contract_decimals: 6,
        },
        {
          contract_address: '0x085416975fe14c2a731a97ec38b9bf8135231f62',
          chain_id: 1284,
          contract_decimals: 6,
        },
      ],
      ibc: [
        {
          ibc_denom: 'ibc/6F4968A73F90CF7DE6394BF937D6DF7C7D162D74D839C13F53B41157D315E05F',
          chain_id: 'axelar',
          contract_decimals: 6,
        },
      ],
    },
    {
      id: 'uluna',
      symbol: 'LUNA',
      title: 'Terra',
      image: '/logos/assets/luna.png',
      contract_decimals: 6,
      coingecko_id: 'terra-luna',
      contracts: [
        {
          contract_address: '0x31dab3430f3081dff3ccd80f17ad98583437b213',
          chain_id: 1,
          contract_decimals: 6,
        },
        {
          contract_address: '0x120ad3e5a7c796349e591f1570d9f7980f4ea9cb',
          chain_id: 43114,
          contract_decimals: 6,
        },
        {
          contract_address: '0xa17927fb75e9faea10c08259902d0468b3dead88',
          chain_id: 137,
          contract_decimals: 6,
        },
        {
          contract_address: '0x5e3c572a97d898fe359a2cea31c7d46ba5386895',
          chain_id: 250,
          contract_decimals: 6,
        },
        {
          contract_address: '0x31dab3430f3081dff3ccd80f17ad98583437b213',
          chain_id: 1284,
          contract_decimals: 6,
        },
      ],
      ibc: [
        {
          ibc_denom: 'ibc/4627AD2524E3E0523047E35BB76CC90E37D9D57ACF14F0FCBCEB2480705F3CB8',
          chain_id: 'axelar',
          contract_decimals: 6,
        },
      ],
    },
  ],
  testnet: [
    {
      id: 'uaxl',
      symbol: 'AXL',
      title: 'Axelar',
      image: '/logos/assets/axl.png',
      contract_decimals: 6,
      coingecko_id: 'axelar-network',
      contracts: [
        {
          contract_address: '0x321c017c08b681b1a34909eb159ed128772a5bbe',
          chain_id: 3,
          contract_decimals: 6,
        },
        {
          contract_address: '0x46cc87ea84586c03bb2109ed9b33f998d40b7623',
          chain_id: 43113,
          contract_decimals: 6,
        },
        {
          contract_address: '0x6ff1fa8cfb26551aa13e3d5dbf077f0a98ecd232',
          chain_id: 80001,
          contract_decimals: 6,
        },
        {
          contract_address: '0xc1ff1364f7a263a535e3caf60d424b78bb5b7c19',
          chain_id: 4002,
          contract_decimals: 6,
        },
        {
          contract_address: '0x8a6614f33ec72fb70084b22b2effb643424e9cc9',
          chain_id: 1287,
          contract_decimals: 6,
        },
      ],
    },
    {
      id: 'uusd',
      symbol: 'UST',
      title: 'TerraUSD',
      image: '/logos/assets/ust.png',
      contract_decimals: 6,
      coingecko_id: 'terrausd',
      contracts: [
        {
          contract_address: '0x1487f3faefe78792cdc48d87ff32aac6650fd85f',
          chain_id: 3,
          contract_decimals: 6,
        },
        {
          contract_address: '0x43f4600b552089655645f8c16d86a5a9fa296bc3',
          chain_id: 43113,
          contract_decimals: 6,
        },
        {
          contract_address: '0xa32575f477fdebfa02513880d47f6515da42fb90',
          chain_id: 80001,
          contract_decimals: 6,
        },
        {
          contract_address: '0x89a1d86901d25effe5d022bdd1132827e4d7f010',
          chain_id: 4002,
          contract_decimals: 6,
        },
        {
          contract_address: '0xd34007bb8a54b2fbb1d6647c5aba04d507abd21d',
          chain_id: 1287,
          contract_decimals: 6,
        },
      ],
      ibc: [
        {
          ibc_denom: 'ibc/6F4968A73F90CF7DE6394BF937D6DF7C7D162D74D839C13F53B41157D315E05F',
          chain_id: 'axelar',
          contract_decimals: 6,
        },
      ],
    },
    {
      id: 'uluna',
      symbol: 'LUNA',
      title: 'Terra',
      image: '/logos/assets/luna.png',
      contract_decimals: 6,
      coingecko_id: 'terra-luna',
      contracts: [
        {
          contract_address: '0x7aa125543b9d4a361f58ac1ff3bea86eaf6d948b',
          chain_id: 3,
          contract_decimals: 6,
        },
        {
          contract_address: '0x50a70abb7bd6ebbcc46df7c0d033c568f563ca27',
          chain_id: 43113,
          contract_decimals: 6,
        },
        {
          contract_address: '0x6ad38dd216dc344c6b3cedc34612e1014e2aa469',
          chain_id: 80001,
          contract_decimals: 6,
        },
        {
          contract_address: '0x121286bedd58d58558a30ed2db2f4a7c6eb646a3',
          chain_id: 4002,
          contract_decimals: 6,
        },
        {
          contract_address: '0xa1cf442e73045f1ea9960499fc8771454a01019d',
          chain_id: 1287,
          contract_decimals: 6,
        },
      ],
      ibc: [
        {
          ibc_denom: 'ibc/4627AD2524E3E0523047E35BB76CC90E37D9D57ACF14F0FCBCEB2480705F3CB8',
          chain_id: 'axelar',
          contract_decimals: 6,
        },
      ],
    },
    {
      id: 'uusdc',
      symbol: 'USDC',
      title: 'USD Coin',
      image: '/logos/assets/usdc.png',
      contract_decimals: 6,
      coingecko_id: 'usd-coin',
      contracts: [
        {
          contract_address: '0x772df70ff68c8dea1863794824410e90e46cd433',
          chain_id: 3,
          contract_decimals: 6,
          symbol: 'axlUSDC',
        },
        {
          contract_address: '',
          chain_id: 97,
          contract_decimals: 6,
          symbol: 'axlUSDC',
        },
        {
          contract_address: '0x3fb643de114d5dc03dde8dfdbc06c60dcaf7d3c4',
          chain_id: 43113,
          contract_decimals: 6,
          symbol: 'axlUSDC',
        },
        {
          contract_address: '0xdd58e6c519172838f91cc9f86c5c053891346f70',
          chain_id: 80001,
          contract_decimals: 6,
          symbol: 'axlUSDC',
        },
        {
          contract_address: '0x0f09c67dbdb8bbe7e931975c38d591f0be95b4a9',
          chain_id: 4002,
          contract_decimals: 6,
          symbol: 'axlUSDC',
        },
        {
          contract_address: '0x80c65a8caf599e9630984bc53b60f886006d2860',
          chain_id: 1287,
          contract_decimals: 6,
          symbol: 'axlUSDC',
        },
      ],
    },
    {
      id: 'uatom',
      symbol: 'ATOM',
      title: 'Cosmos',
      image: '/logos/assets/atom.png',
      contract_decimals: 6,
      coingecko_id: 'cosmos',
      contracts: [
        {
          contract_address: '0xace65699f78e6d2237d087f3c6e68e22146af9ee',
          chain_id: 3,
          contract_decimals: 6,
          symbol: 'axlATOM',
        },
        {
          contract_address: '',
          chain_id: 97,
          contract_decimals: 6,
          symbol: 'axlATOM',
        },
        {
          contract_address: '0x7c2a1defa77004c7e65c396b77c9a3e429b5dd57',
          chain_id: 43113,
          contract_decimals: 6,
          symbol: 'axlATOM',
        },
        {
          contract_address: '0xe8c0f3ca0dc4dec95b7ebfe419cc5f8dd302249a',
          chain_id: 80001,
          contract_decimals: 6,
          symbol: 'axlATOM',
        },
        {
          contract_address: '0xac570e9df00c22d9ca7ef559cfe1bab7a1d8fffa',
          chain_id: 4002,
          contract_decimals: 6,
          symbol: 'axlATOM',
        },
        {
          contract_address: '0xbaf40419323acc80c2f94aa531221a9cb639d77e',
          chain_id: 1287,
          contract_decimals: 6,
          symbol: 'axlATOM',
        },
      ],
      ibc: [
        {
          ibc_denom: 'ibc/EF48E6B1A1A19F47ECAEA62F5670C37C0580E86A9E88498B7E393EB6F49F33C0',
          chain_id: 'axelar',
          contract_decimals: 6,
        },
      ],
    },
    {
      id: 'uausdc',
      symbol: 'aUSDC',
      title: 'USD Coin',
      image: '/logos/assets/usdc.png',
      contract_decimals: 6,
      coingecko_id: 'usd-coin',
      contracts: [
        {
          contract_address: '0x526f0a95edc3df4cbdb7bb37d4f7ed451db8e369',
          chain_id: 3,
          contract_decimals: 6,
        },
        {
          contract_address: '0x57f1c63497aee0be305b8852b354cec793da43bb',
          chain_id: 43113,
          contract_decimals: 6,
        },
        {
          contract_address: '0x2c852e740b62308c46dd29b982fbb650d063bd07',
          chain_id: 80001,
          contract_decimals: 6,
        },
        {
          contract_address: '0x75cc4fdf1ee3e781c1a3ee9151d5c6ce34cf5c61',
          chain_id: 4002,
          contract_decimals: 6,
        },
        {
          contract_address: '0xd1633f7fb3d716643125d6415d4177bc36b7186b',
          chain_id: 1287,
          contract_decimals: 6,
        },
      ],
      ibc: [
        {
          ibc_denom: 'ibc/3DC20E9A12C8F19A92CDEBC37116C26EADF4C65E7498193791A3DAAD0B263556',
          chain_id: 'cosmoshub',
          contract_decimals: 6,
        },
        {
          ibc_denom: 'ibc/423FB88C7D1D4FCA2F7E67F07473DB4BB14282AE6F7B1A41B220A1AD9A762254',
          chain_id: 'osmosis',
          contract_decimals: 6,
        },
      ],
    },
    {
      id: 'weth-wei',
      symbol: 'WETH',
      title: 'Ethereum',
      image: '/logos/assets/eth.png',
      contract_decimals: 18,
      coingecko_id: 'ethereum',
      contracts: [
        {
          contract_address: '0xc778417e063141139fce010982780140aa0cd5ab',
          chain_id: 3,
          contract_decimals: 18,
        },
        {
          contract_address: '',
          chain_id: 97,
          contract_decimals: 18,
        },
        {
          contract_address: '0x3613c187b3ef813619a25322595ba5e297e4c08a',
          chain_id: 43113,
          contract_decimals: 18,
        },
        {
          contract_address: '0xfba15fff35558fe2a469b96a90aed7727fe38fae',
          chain_id: 80001,
          contract_decimals: 18,
        },
        {
          contract_address: '0x930640ef299bf772f786cf7e88da951d76e33168',
          chain_id: 4002,
          contract_decimals: 18,
        },
        {
          contract_address: '0xc40fdaa2cb43c85eaa6d43856df42e7a80669fca',
          chain_id: 1287,
          contract_decimals: 18,
        },
      ],
      ibc: [
        {
          ibc_denom: 'ibc/375BC04D74C122624097D38B5D8449D2883D8EC4BB21A94F1C936EB454B02048',
          chain_id: 'axelar',
          contract_decimals: 18,
        },
        {
          ibc_denom: 'ibc/DEC3B614DEA87E77AFABE3EDA1F95A7E1A429080950AD9B0AF257FE01706CA0B',
          chain_id: 'cosmoshub',
          contract_decimals: 18,
        },
        {
          ibc_denom: 'ibc/E614301CF4F54C23FAEEBF50F33D247AC743E9F247AB094AC57F68DB3A80635C',
          chain_id: 'terra',
          contract_decimals: 18,
        },
        {
          ibc_denom: 'ibc/A8C7A5D5767DECBAF96AFDE4C2D99D95BE9FF38CA75BE3A1CD31E3D20264EFF9',
          chain_id: 'osmosis',
          contract_decimals: 18,
        },
        {
          ibc_denom: 'ibc/AAD7136DD626569C3DDE7C5F764968BB2E939875EFC568AE5712B62081850814',
          chain_id: 'crescent',
          contract_decimals: 18,
        },
      ],
    },
    {
      id: 'wavax-wei',
      symbol: 'WAVAX',
      title: 'Avalanche',
      image: '/logos/assets/avax.png',
      contract_decimals: 18,
      coingecko_id: 'avalanche-2',
      contracts: [
        {
          contract_address: '0x72af7e1e7e0d38bcf033c541598f5a0301d051a5',
          chain_id: 3,
          contract_decimals: 18,
        },
        {
          contract_address: '',
          chain_id: 97,
          contract_decimals: 18,
        },
        {
          contract_address: '0xd00ae08403b9bbb9124bb305c09058e32c39a48c',
          chain_id: 43113,
          contract_decimals: 18,
        },
        {
          contract_address: '0x6dd60c05fda1255a44ffaa9a8200b5b179a578d6',
          chain_id: 80001,
          contract_decimals: 18,
        },
        {
          contract_address: '0x8776add48553518641a589c39792cc409d4c8b84',
          chain_id: 4002,
          contract_decimals: 18,
        },
        {
          contract_address: '0x64aae6319934995bf30e67ebbba9750256e07283',
          chain_id: 1287,
          contract_decimals: 18,
        },
      ],
      ibc: [
        {
          ibc_denom: 'ibc/4786D3D8B8AC06B085F0C017742861F121F67501347149A054CAB77D24ECA49D',
          chain_id: 'axelar',
          contract_decimals: 18,
        },
        {
          ibc_denom: 'ibc/88C2DE3AE63A443385CDFE54A18B0FC48402DDF3FE5AC532A663F9C3A1144462',
          chain_id: 'cosmoshub',
          contract_decimals: 18,
        },
        {
          ibc_denom: 'ibc/0D2A39F3DF653685ED16DED245C83A51B9DD6CB8A55DE2C39D194BE44C108765',
          chain_id: 'terra',
          contract_decimals: 18,
        },
        {
          ibc_denom: 'ibc/9534907D2838E2134F21CC286A4CD0FF3CA96AA032F9F695ABF5621CC98AB17F',
          chain_id: 'osmosis',
          contract_decimals: 18,
        },
      ],
    },
    {
      id: 'wmatic-wei',
      symbol: 'WMATIC',
      title: 'Polygon',
      image: '/logos/assets/matic.png',
      contract_decimals: 18,
      coingecko_id: 'matic-network',
      contracts: [
        {
          contract_address: '0xeae61fd42a56f435a913d1570ff301a532d027b2',
          chain_id: 3,
          contract_decimals: 18,
        },
        {
          contract_address: '',
          chain_id: 97,
          contract_decimals: 18,
        },
        {
          contract_address: '0xb923e2374639d0605388d91cfedafcece03cfd8f',
          chain_id: 43113,
          contract_decimals: 18,
        },
        {
          contract_address: '0x9c3c9283d3e44854697cd22d3faa240cfb032889',
          chain_id: 80001,
          contract_decimals: 18,
        },
        {
          contract_address: '0x3c12d813bb36295a8361c4740a732bb700df6db0',
          chain_id: 4002,
          contract_decimals: 18,
        },
        {
          contract_address: '0xde3db4fd7d7a5cc7d8811b7bafa4103fd90282f3',
          chain_id: 1287,
          contract_decimals: 18,
        },
      ],
      ibc: [
        {
          ibc_denom: 'ibc/C31901B8CB873F83E5B383CABAC2133135E786BDE25380616E4B0DB5B8F08F3D',
          chain_id: 'axelar',
          contract_decimals: 18,
        },
        {
          ibc_denom: 'ibc/1BE5BF73F50D2D82C74628C6290834E66C5467F231B7FBC7DD45E217EE1D42A5',
          chain_id: 'cosmoshub',
          contract_decimals: 18,
        },
        {
          ibc_denom: 'ibc/90CC92BD6683D3D39933223D50FB678B6C2EDC4F4B048E21BF358570B2087916',
          chain_id: 'terra',
          contract_decimals: 18,
        },
        {
          ibc_denom: 'ibc/67D0DAF8D504ED1616A1886CCECB4E366DC81A8EF48BD22AEA1F44BE87ED19AE',
          chain_id: 'osmosis',
          contract_decimals: 18,
        },
      ],
    },
    {
      id: 'wftm-wei',
      symbol: 'WFTM',
      title: 'Fantom',
      image: '/logos/assets/ftm.png',
      contract_decimals: 18,
      coingecko_id: 'fantom',
      contracts: [
        {
          contract_address: '0xd9774230a31bf49c3d9372eeb55aa10df1807238',
          chain_id: 3,
          contract_decimals: 18,
        },
        {
          contract_address: '',
          chain_id: 97,
          contract_decimals: 18,
        },
        {
          contract_address: '0xef721babf08a2ee5bccfd2f2a34cbf4dc9a56959',
          chain_id: 43113,
          contract_decimals: 18,
        },
        {
          contract_address: '0x62b6f2a4ee6a4801bfcd2056d19c6d71654d2582',
          chain_id: 80001,
          contract_decimals: 18,
        },
        {
          contract_address: '0x812666209b90344ec8e528375298ab9045c2bd08',
          chain_id: 4002,
          contract_decimals: 18,
        },
        {
          contract_address: '0x40eebd34ec6cb4c0644a18494365171b1dce97eb',
          chain_id: 1287,
          contract_decimals: 18,
        },
      ],
      ibc: [
        {
          ibc_denom: 'ibc/49745E2A5A7D2F9CDB90491FB11D78B1DAE86D92404AAD6DC2DA11152A609CD0',
          chain_id: 'axelar',
          contract_decimals: 18,
        },
        {
          ibc_denom: 'ibc/947B84E653CBEC9386287883173A40D3C0A284AB554557342C50378219ECE147',
          chain_id: 'cosmoshub',
          contract_decimals: 18,
        },
        {
          ibc_denom: 'ibc/95482BCD668E74C030E1B8CE0874A447A593C144C8E9DB41BE05B7A9495ECDD7',
          chain_id: 'terra',
          contract_decimals: 18,
        },
        {
          ibc_denom: 'ibc/033C5FCE2C549920B75CC794D12BC3407F638421C982CE9B48D4E5D986F4EFCE',
          chain_id: 'osmosis',
          contract_decimals: 18,
        },
      ],
    },
    {
      id: 'wdev-wei',
      symbol: 'WDEV',
      title: 'Dev',
      image: '/logos/assets/glmr.png',
      contract_decimals: 18,
      coingecko_id: 'moonbeam',
      contracts: [
        {
          contract_address: '0xdc6b192efa7ebab24063e20c962e74c88a012d3c',
          chain_id: 3,
          contract_decimals: 18,
        },
        {
          contract_address: '',
          chain_id: 97,
          contract_decimals: 18,
        },
        {
          contract_address: '0xf58537d9061f7257e44442fb7870a094aae92b43',
          chain_id: 43113,
          contract_decimals: 18,
        },
        {
          contract_address: '0xb6a2f51c219a66866263cb18dd41ee6c51b464cb',
          chain_id: 80001,
          contract_decimals: 18,
        },
        {
          contract_address: '0xd6f858a1e75e9a06c42dcd86bb876c5e9fcca572',
          chain_id: 4002,
          contract_decimals: 18,
        },
        {
          contract_address: '0x1436ae0df0a8663f18c0ec51d7e2e46591730715',
          chain_id: 1287,
          contract_decimals: 18,
        },
      ],
      ibc: [
        {
          ibc_denom: 'ibc/FD0B436BB2E3095C04E67481D4C7F03FABC9C0A85FFC0FBA8CFCE9C8FBCBB0F3',
          chain_id: 'axelar',
          contract_decimals: 18,
        },
        {
          ibc_denom: 'ibc/12B944E03F3E2197589129CB359E1BD5FA3F06841792FFE46852EAFE31EEB20A',
          chain_id: 'cosmoshub',
          contract_decimals: 18,
        },
        {
          ibc_denom: 'ibc/2A3208A0A402373F2E3E43228FC51F298433CE1BA5EDBF246ACE5F2E5111448E',
          chain_id: 'terra',
          contract_decimals: 18,
        },
        {
          ibc_denom: 'ibc/D3AF2C7986FA1191157529F68609887103EBBD0B9CAFAD615CF19B419E2F5566',
          chain_id: 'osmosis',
          contract_decimals: 18,
        },
      ],
    },
    {
      id: 'uosmo',
      symbol: 'OSMO',
      title: 'Osmosis',
      image: '/logos/assets/osmo.png',
      contract_decimals: 6,
      coingecko_id: 'osmosis',
      ibc: [
        {
          ibc_denom: 'ibc/13B2C536BB057AC79D5616B8EA1B9540EC1F2170718CAFF6F0083C966FFFED0B',
          chain_id: 'axelar',
          contract_decimals: 6,
        },
      ],
    },
    {
      id: 'ujuno',
      symbol: 'JUNO',
      title: 'Juno',
      image: '/logos/assets/juno.png',
      contract_decimals: 6,
      coingecko_id: 'juno-network',
    },
  ],
};