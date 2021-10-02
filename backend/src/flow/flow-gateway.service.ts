import { Injectable } from '@nestjs/common';
import { GatewayConfiguration } from '../projects/dto/gateway-configuration';
const fcl = require("@onflow/fcl");

// TODO: add FlowGatewayService types later

@Injectable()
export class FlowGatewayService {
    private configuration: GatewayConfiguration;

    constructor () {
        // TODO: init default configuration just for development
        this.configureDataSourceGateway({
            port: 8080,
            network: "emulator",
            address: "http://host.docker.internal" // same as 127.0.0.1 on host
        })
    }


    public configureDataSourceGateway(configuration: GatewayConfiguration) {
        console.info('FlowGatewayService configuration changed', configuration);
        this.configuration = configuration;
        const accessNodeApi = `${configuration.address}:${configuration.port}`;
        fcl.config().put("accessNode.api", accessNodeApi)
    }

    public async getLatestBlock (): Promise<any> {
        return fcl.latestBlock();
    }

    public async getBlockByHeight (height: number): Promise<any> {
        return fcl.send([
            fcl.getBlock(),
            fcl.atBlockHeight(height)
        ]).then(fcl.decode);
    }

    public async getCollectionById (id: string): Promise<any> {
        return fcl.send([
            fcl.getCollection(id)
        ]).then(fcl.decode)
    }

    public async getTransactionById (id: string): Promise<any> {
        const [data, status] = await Promise.all([
            fcl.send([fcl.getTransaction(id)]).then(fcl.decode),
            fcl.send([fcl.getTransactionStatus(id)]).then(fcl.decode)
        ])
        return {...data, status}
    }

    public async getAccount (address: string): Promise<any> {
        return fcl.send([
            fcl.getAccount(address)
        ]).then(fcl.decode)
    }

    public async getBlockData (height) {
        const block = await this.getBlockByHeight(height);
        const collections = await Promise.all(
          block.collectionGuarantees.map(async guarantee => ({
              blockId: block.id,
              ...await this.getCollectionById(guarantee.collectionId)
          }))
        )
        const transactionsWithDetails = (await Promise.all(collections.map((collection: any) =>
          Promise.all(collection.transactionIds.map(async txId => ({
              id: txId,
              ...await this.getTransactionById(txId)
          })))
        ))).flat()
        // find all account addresses that are related to some transaction
        // account can be either a payer, authorizer or both
        // therefore we need to remove duplicate account addresses
        const accountAddresses = Object.keys(transactionsWithDetails
          .map((tx: any) => [...tx.authorizers, tx.payer])
          .flat()
          .reduce((p, c) => ({...p, [c]: true}), {}))
        const accounts = await Promise.all(accountAddresses.map(this.getAccount));
        const transactions = transactionsWithDetails.map((tx: any) => {
            const {events, ...status} = tx.status;
            return {
                ...tx,
                status: {...status, eventsCount: tx.status.events.length}
            }
        })
        const events = transactionsWithDetails.map((tx: any) =>
          tx.status.events.map(event => ({transactionId: tx.id, ...event}))
        )
        return {
            block,
            collections,
            transactions,
            accounts,
            events
        }
    }

    public async getBlockDataWithinHeightRange(fromHeight, toHeight) {
        if (fromHeight === toHeight) return [];
        return Promise.all(
          Array.from({length: toHeight - fromHeight + 1})
            .map((_, i) => this.getBlockData(fromHeight + i))
        )
    }

    private isConnectedToGateway(): boolean {
        return !!this.configuration;
    }
}
