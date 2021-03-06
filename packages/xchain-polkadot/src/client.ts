import axios from 'axios'
import {
  Address,
  Balances,
  Fees,
  Network,
  Tx,
  TxParams,
  TxHash,
  TxHistoryParams,
  TxsPage,
  XChainClient,
  XChainClientParams,
} from '@xchainjs/xchain-client'
import { Asset, assetAmount, assetToString, assetToBase, baseAmount } from '@xchainjs/xchain-util'
import * as xchainCrypto from '@xchainjs/xchain-crypto'

import { ApiPromise, WsProvider, Keyring } from '@polkadot/api'
import { KeyringPair } from '@polkadot/keyring/types'
import { hexToU8a, isHex } from '@polkadot/util'

import { SubscanResponse, Account, AssetDOT, TransfersResult, Extrinsic, Transfer } from './types'
import { isSuccess, getDecimal } from './util'

/**
 * Interface for custom Polkadot client
 */
export interface PolkadotClient {
  getSS58Format(): number
  getWsEndpoint(): string
  estimateFees(params: TxParams): Promise<Fees>
}

/**
 * Custom Polkadot client
 */
class Client implements PolkadotClient, XChainClient {
  private network: Network
  private phrase = ''
  private address: Address = ''
  private api: ApiPromise | null = null
  private derivationPath = "44//354//0//0//0'"

  /**
   * Constructor
   * Client is initialised with network type and phrase (optional)
   *
   * @param {XChainClientParams} params
   */
  constructor({ network = 'testnet', phrase }: XChainClientParams) {
    this.network = network

    if (phrase) this.setPhrase(phrase)
  }

  /**
   * @private
   *
   * Purge Provider.
   *
   * @returns {void}
   */
  private purgeProvider = (): void => {
    this.api?.disconnect()
    this.api = null
  }

  /**
   * Purge client.
   *
   * @returns {void}
   */
  purgeClient = (): void => {
    this.purgeProvider()

    this.phrase = ''
    this.address = ''
  }

  /**
   * Set/update the current network.
   *
   * @param {Network} network `mainnet` or `testnet`.
   * @returns {XChainClient}
   *
   * @throws {"Network must be provided"}
   * Thrown if network has not been set before.
   */
  setNetwork(network: Network): XChainClient {
    if (!network) {
      throw new Error('Network must be provided')
    } else {
      if (network !== this.network) {
        this.purgeProvider()

        this.network = network
        this.address = ''
      }

      return this
    }
  }

  /**
   * Get the current network.
   *
   * @returns {Network} The current network. (`mainnet` or `testnet`)
   */
  getNetwork(): Network {
    return this.network
  }

  /**
   * Get the client url.
   *
   * @returns {string} The client url based on the network.
   */
  getClientUrl = (): string => {
    return this.network === 'testnet' ? 'https://westend.subscan.io' : 'https://polkadot.subscan.io'
  }

  /**
   * Get the client WebSocket url.
   *
   * @returns {string} The client WebSocket url based on the network.
   */
  getWsEndpoint = (): string => {
    return this.network === 'testnet' ? 'wss://westend-rpc.polkadot.io' : 'wss://rpc.polkadot.io'
  }

  /**
   * Get the explorer url.
   *
   * @returns {string} The explorer url based on the network.
   */
  getExplorerUrl = (): string => {
    return this.network === 'testnet' ? 'https://westend.subscan.io' : 'https://polkadot.subscan.io'
  }

  /**
   * Get the explorer url for the given address.
   *
   * @param {Address} address
   * @returns {string} The explorer url for the given address based on the network.
   */
  getExplorerAddressUrl = (address: Address): string => {
    return `${this.getExplorerUrl()}/account/${address}`
  }

  /**
   * Get the explorer url for the given transaction id.
   *
   * @param {string} txID The transaction id
   * @returns {string} The explorer url for the given transaction id based on the network.
   */
  getExplorerTxUrl = (txID: string): string => {
    return `${this.getExplorerUrl()}/extrinsic/${txID}`
  }

  /**
   * Get the SS58 format to be used for Polkadot Keyring.
   *
   * @returns {number} The SS58 format based on the network.
   */
  getSS58Format = (): number => {
    return this.network === 'testnet' ? 42 : 0
  }

  /**
   * Set/update a new phrase.
   *
   * @param {string} phrase A new phrase.
   * @returns {Address} The address from the given phrase
   *
   * @throws {"Invalid phrase"}
   * Thrown if the given phase is invalid.
   */
  setPhrase = (phrase: string): Address => {
    if (this.phrase !== phrase) {
      if (!xchainCrypto.validatePhrase(phrase)) {
        throw new Error('Invalid phrase')
      }

      this.phrase = phrase
      this.address = ''
    }

    return this.getAddress()
  }

  /**
   * @private
   * Private function to get Keyring pair for polkadotjs provider.
   * @see https://polkadot.js.org/docs/api/start/keyring/#creating-a-keyring-instance
   *
   * @returns {KeyringPair} The keyring pair to be used to generate wallet address.
   * */
  private getKeyringPair = (): KeyringPair => {
    const key = new Keyring({ ss58Format: this.getSS58Format(), type: 'ed25519' })

    return key.createFromUri(`${this.phrase}//${this.derivationPath}`)
  }

  /**
   * @private
   * Private function to get the polkadotjs API provider.
   *
   * @see https://polkadot.js.org/docs/api/start/create#api-instance
   *
   * @returns {ApiPromise} The polkadotjs API provider based on the network.
   * */
  private getAPI = async (): Promise<ApiPromise> => {
    try {
      if (!this.api) {
        this.api = new ApiPromise({ provider: new WsProvider(this.getWsEndpoint()) })
        await this.api.isReady
      }

      if (!this.api.isConnected) {
        await this.api.connect()
      }

      return this.api
    } catch (error) {
      return Promise.reject(error)
    }
  }

  /**
   * Validate the given address.
   * @see https://polkadot.js.org/docs/util-crypto/examples/validate-address
   *
   * @param {Address} address
   * @returns {boolean} `true` or `false`
   */
  validateAddress = (address: string): boolean => {
    try {
      const key = new Keyring({ ss58Format: this.getSS58Format(), type: 'ed25519' })
      return key.encodeAddress(isHex(address) ? hexToU8a(address) : key.decodeAddress(address)) === address
    } catch (error) {
      return false
    }
  }

  /**
   * Get the current address.
   *
   * Generates a network-specific key-pair by first converting the buffer to a Wallet-Import-Format (WIF)
   * The address is then decoded into type P2WPKH and returned.
   *
   * @returns {Address} The current address.
   *
   * @throws {"Address not defined"} Thrown if failed creating account from phrase.
   */
  getAddress = (): Address => {
    if (!this.address) {
      const address = this.getKeyringPair().address

      if (!address) {
        throw new Error('Address not defined')
      }

      this.address = address
    }

    return this.address
  }

  /**
   * Get the DOT balance of a given address.
   *
   * @param {Address} address By default, it will return the balance of the current wallet. (optional)
   * @returns {Array<Balance>} The DOT balance of the address.
   */
  getBalance = async (address?: Address, asset?: Asset): Promise<Balances> => {
    try {
      const response: SubscanResponse<Account> = await axios
        .post(`${this.getClientUrl()}/api/open/account`, { address: address || this.getAddress() })
        .then((res) => res.data)

      if (!isSuccess(response)) {
        throw new Error('Invalid address')
      }

      const account = response.data

      return account && (!asset || assetToString(asset) === assetToString(AssetDOT))
        ? [
            {
              asset: AssetDOT,
              amount: assetToBase(assetAmount(account.balance, getDecimal(this.network))),
            },
          ]
        : []
    } catch (error) {
      return Promise.reject(error)
    }
  }

  /**
   * Get transaction history of a given address with pagination options.
   * By default it will return the transaction history of the current wallet.
   *
   * @param {TxHistoryParams} params The options to get transaction history. (optional)
   * @returns {TxsPage} The transaction history.
   */
  getTransactions = async (params?: TxHistoryParams): Promise<TxsPage> => {
    const address = params?.address ?? this.getAddress()
    const limit = params?.limit ?? 10
    const offset = params?.offset ?? 0

    try {
      const response: SubscanResponse<TransfersResult> = await axios
        .post(`${this.getClientUrl()}/api/scan/transfers`, {
          address: address,
          row: limit,
          page: offset,
        })
        .then((res) => res.data)

      if (!isSuccess(response) || !response.data) {
        throw new Error('Failed to get transactions')
      }

      const transferResult: TransfersResult = response.data

      return {
        total: transferResult.count,
        txs: (transferResult.transfers || []).map((transfer) => ({
          asset: AssetDOT,
          from: [
            {
              from: transfer.from,
              amount: assetToBase(assetAmount(transfer.amount, getDecimal(this.network))),
            },
          ],
          to: [
            {
              to: transfer.to,
              amount: assetToBase(assetAmount(transfer.amount, getDecimal(this.network))),
            },
          ],
          date: new Date(transfer.block_timestamp * 1000),
          type: 'transfer',
          hash: transfer.hash,
        })),
      }
    } catch (error) {
      return Promise.reject(error)
    }
  }

  /**
   * Get the transaction details of a given transaction id.
   *
   * @param {string} txId The transaction id.
   * @returns {Tx} The transaction details of the given transaction id.
   */
  getTransactionData = async (txId: string): Promise<Tx> => {
    try {
      const response: SubscanResponse<Extrinsic> = await axios
        .post(`${this.getClientUrl()}/api/scan/extrinsic`, {
          hash: txId,
        })
        .then((res) => res.data)

      if (!isSuccess(response) || !response.data) {
        throw new Error('Failed to get transactions')
      }

      const extrinsic: Extrinsic = response.data
      const transfer: Transfer = extrinsic.transfer

      return {
        asset: AssetDOT,
        from: [
          {
            from: transfer.from,
            amount: assetToBase(assetAmount(transfer.amount, getDecimal(this.network))),
          },
        ],
        to: [
          {
            to: transfer.to,
            amount: assetToBase(assetAmount(transfer.amount, getDecimal(this.network))),
          },
        ],
        date: new Date(extrinsic.block_timestamp * 1000),
        type: 'transfer',
        hash: extrinsic.extrinsic_hash,
      }
    } catch (error) {
      return Promise.reject(error)
    }
  }

  /**
   * Transfer DOT.
   *
   * @param {TxParams} params The transfer options.
   * @returns {TxHash} The transaction hash.
   */
  transfer = async (params: TxParams): Promise<TxHash> => {
    try {
      const api = await this.getAPI()
      let transaction = null

      // Createing a transfer
      const transfer = api.tx.balances.transfer(params.recipient, params.amount.amount().toString())
      if (!params.memo) {
        // Send a simple transfer
        transaction = transfer
      } else {
        // Send a `utility.batch` with two Calls: i) Balance.Transfer ii) System.Remark

        // Creating a remark
        const remark = api.tx.system.remark(params.memo)

        // Send the Batch Transaction
        transaction = api.tx.utility.batch([transfer, remark])
      }

      // Check balances
      const paymentInfo = await transaction.paymentInfo(this.getKeyringPair())
      const fee = baseAmount(paymentInfo.partialFee.toString(), getDecimal(this.network))
      const balances = await this.getBalance(this.getAddress(), AssetDOT)

      if (!balances || params.amount.amount().plus(fee.amount()).isGreaterThan(balances[0].amount.amount())) {
        throw new Error('insufficient balance')
      }

      const txHash = await transaction.signAndSend(this.getKeyringPair())
      return txHash.toString()
    } catch (error) {
      return Promise.reject(error)
    }
  }

  /**
   * Get the current fee with transfer options.
   *
   * @see https://polkadot.js.org/docs/api/cookbook/tx/#how-do-i-estimate-the-transaction-fees
   *
   * @param {TxParams} params The transfer options.
   * @returns {Fees} The estimated fees with the transfer options.
   */
  estimateFees = async (params: TxParams): Promise<Fees> => {
    try {
      const api = await this.getAPI()
      const info = await api.tx.balances
        .transfer(params.recipient, params.amount.amount().toNumber())
        .paymentInfo(this.getKeyringPair())

      const fee = baseAmount(info.partialFee.toString(), getDecimal(this.network))

      return {
        type: 'byte',
        average: fee,
        fast: fee,
        fastest: fee,
      }
    } catch (error) {
      return Promise.reject(error)
    }
  }

  /**
   * Get the current fee.
   *
   * @returns {Fees} The current fee.
   */
  getFees = async (): Promise<Fees> => {
    return await this.estimateFees({
      recipient: this.getAddress(),
      amount: baseAmount(0, getDecimal(this.network)),
    })
  }
}

export { Client }
