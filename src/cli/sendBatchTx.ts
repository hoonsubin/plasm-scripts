import { PlmTransaction } from '../model/AffiliateReward';
import _ from 'lodash';
import * as PolkadotUtils from '@polkadot/util';
import * as PolkadotCryptoUtils from '@polkadot/util-crypto';
import { Utils, PlasmUtils } from '../helper';
import { ApiPromise, WsProvider, Keyring } from '@polkadot/api';
import { AddressOrPair } from '@polkadot/api/types';
import path from 'path';
import BN from 'bn.js';
import * as plasmDefinitions from '@plasm/types/interfaces/definitions';
import { NodeEndpoint } from '../helper/plasmUtils';

const createPlasmInstance = async (network?: NodeEndpoint) => {
    const types = Object.values(plasmDefinitions).reduce((res, { types }): object => ({ ...res, ...types }), {});
    let endpoint = '';
    switch (network) {
        case 'Local':
            endpoint = 'ws://127.0.0.1:9944';
            break;
        case 'Dusty':
            endpoint = 'wss://rpc.dusty.plasmnet.io/';
            break;
        case 'Main': // main net endpoint will be the default value
        default:
            endpoint = 'wss://rpc.plasmnet.io';
            break;
    }

    const wsProvider = new WsProvider(endpoint, 10 * 1000);

    const api = await ApiPromise.create({
        provider: wsProvider,
        types: {
            ...types,
        },
    });

    return await api.isReady;
};

const sendBatchTransaction = async (api: ApiPromise, transactionList: PlmTransaction[], origin: AddressOrPair) => {
    const validAddr = _.filter(transactionList, (tx) => {
        return PolkadotCryptoUtils.checkAddress(tx.receiverAddress, 5)[0];
    });

    const txVec = _.map(validAddr, (dest) => {
        const account = dest.receiverAddress;
        const amount = new BN(dest.sendAmount.replace('0x', ''), 'hex');

        return api.tx.balances.transfer(account, amount);
    });

    //const txHash = await plasmApi.api.tx.balances.
    const hash = await api.tx.utility.batch(txVec).signAndSend(origin, { nonce: 32 });

    return hash;
};

// script entry point
export default async () => {
    const network: PlasmUtils.NodeEndpoint = 'Main';
    const keyring = new Keyring({ ss58Format: 5, type: 'sr25519' });

    const api = await createPlasmInstance(network);

    // import address from seed
    const reserveSeed = process.env.PLM_SEED;
    if (!reserveSeed) throw new Error('Sender seed was not provided');
    const sender = keyring.addFromUri(reserveSeed);

    const funds = (await api.query.system.account(sender.address)).data;
    console.log(`${sender.address} has ${funds.toString()} tokens`);

    const recipientList = (
        await Utils.loadCsv(path.join(process.cwd(), 'src', 'data', '.temp', 'test-address.csv'))
    ).map((i) => i.address);

    const transactionList = recipientList.map((addr, index) => {
        const sendAmount = new BN(index + 1).mul(PolkadotUtils.BN_TEN).pow(new BN(15));
        return {
            receiverAddress: addr,
            sendAmount: PolkadotUtils.bnToHex(sendAmount),
        } as PlmTransaction;
    });

    // const alice = keyring.addFromUri('//Alice', { name: 'Alice default' });
    // const txHash = await api.tx.balances
    //     .transfer('5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty', 12345)
    //     .signAndSend(alice);
    // console.log(txHash);
    await sendBatchTransaction(api, transactionList, sender);

    console.log('finished');
};
