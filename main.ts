import { BigNumber, ethers } from "ethers";
import { TransactionRequest } from "@ethersproject/abstract-provider";
import axios, { AxiosResponse } from 'axios';
import dotenv from 'dotenv';

dotenv.config()

////////// CONFIGURABLES /////////////
var minProfit = BigNumber.from("3") // Nominal value
const maxGasPrice = BigNumber.from("2000000")
const maxGas = BigNumber.from("5000000")
const slippage = '0.5' // percentage, eg. 0.5%
const pollingTime = 15_000 // ms
const formattingDecimalPlaces = 2 // How many decimal places after '.' we will show when formatting currencies
const maximumL1Fee = BigNumber.from("1000000000000000") // How much Eth we are willing to pay for L1 calldata, wei denominated.
//////////////////////////////////////

const CHAIN_ID = 10
const apiBaseUrl = `https://api.1inch.io/v4.0/${CHAIN_ID}`;
const fromTokenAddress = process.env.FROM_TOKEN!
const toTokenAddress = process.env.TO_TOKEN!
const privateKey = process.env.PRIVATE_KEY!
const RPC = process.env.RPC_URL!

const provider = new ethers.providers.JsonRpcProvider(RPC)
const wallet = new ethers.Wallet(privateKey, provider)
const l1FeeOracleAddress = "0x420000000000000000000000000000000000000F"
const l1FeeOracleABI = [
    "function getL1Fee(bytes _data) view returns (uint256)"
]
const l1FeeOracleContract = new ethers.Contract(l1FeeOracleAddress, l1FeeOracleABI, provider)
const erc20minABI = [
    "function balanceOf(address owner) view returns (uint256)",
    "function decimals() view returns (uint8)",
    "function symbol() view returns (string)",
]
const fromTokenContract = new ethers.Contract(fromTokenAddress, erc20minABI, provider)
const toTokenContract = new ethers.Contract(toTokenAddress, erc20minABI, provider)
const address = wallet.address
var balance: BigNumber

function customFormatted(value: string, decimals: number, decimalPlaces: number): string {
    value = value.padStart(decimals + 1, "0")
    const integerPart = value.slice(0, value.length - decimals)
    const fractionPart = value.slice(value.length - decimals, value.length - decimals + decimalPlaces)
    return `${integerPart}.${fractionPart}`
}

function formatted(value: string, decimals: number): string {
    value = value.padStart(decimals + 1, "0")
    const integerPart = value.slice(0, value.length - decimals)
    const fractionPart = value.slice(value.length - decimals, value.length - decimals + formattingDecimalPlaces)
    return `${integerPart}.${fractionPart}`
}

function apiRequestUrl(methodName: string, queryParams: any) {
    return apiBaseUrl + methodName + '?' + (new URLSearchParams(queryParams)).toString();
}

function quote(fromTokenAddress: string, toTokenAddress: string, amount: BigNumber): Promise<BigNumber> {
    return axios.get(apiRequestUrl('/quote', {fromTokenAddress, toTokenAddress, amount: amount.toString()}))
        .then((value: AxiosResponse<any, any>) => {
            if (BigNumber.from(value.data.estimatedGas).gt(maxGas)) {
                console.error(`Gas: ${value.data.estimatedGas}`)
                throw `Estimated gas is too high`
            }
            return BigNumber.from(value.data.toTokenAmount)
        })
        .catch((reason) => { 
            console.error(`Quote failed with: ${reason}`)
            return BigNumber.from('0') 
        })
}

function allowance(token: string, address: string): Promise<BigNumber> {
    return axios.get(apiRequestUrl('/approve/allowance', {tokenAddress: token, walletAddress: address}))
        .then((value: AxiosResponse<any, any>) => {
            return BigNumber.from(value.data.allowance)
        })
}

function approve(token: string): Promise<TransactionRequest> {
    return axios.get(apiRequestUrl('/approve/transaction', {tokenAddress: token}))
        .then((value: AxiosResponse<TransactionRequest, any>) => { 
            value.data.gasPrice = BigNumber.from(value.data.gasPrice)
            value.data.value = BigNumber.from(value.data.value)
            if (value.data.gasPrice.gt(maxGasPrice)) {
                throw "Max gas price reached"
            }
            return value.data 
        })
}

interface SwapTransaction {
    from: string
    to: string
    data: string
    value: string
    gas: number
    gasPrice: string
}

interface Swap {
    tx: SwapTransaction
    toTokenAmount: string
    fromTokenAmount: string
    ethersTx: TransactionRequest
}

function swap(fromTokenAddress: string, toTokenAddress: string, amount: string, fromAddress: string): Promise<Swap> {
    return axios.get(apiRequestUrl('/swap', {fromTokenAddress, toTokenAddress, amount, fromAddress, slippage}))
        .then((value: AxiosResponse<Swap, any>) => {
            value.data.ethersTx = {
                from: value.data.tx.from,
                to: value.data.tx.to,
                data: value.data.tx.data,
                value: BigNumber.from(value.data.tx.value),
                gasPrice: BigNumber.from(value.data.tx.gasPrice),
                gasLimit: BigNumber.from(value.data.tx.gas)
            }
            if (maxGasPrice.lte(value.data.ethersTx.gasPrice || maxGasPrice)) {
                throw "Max gas price reached"
            }
            if (maxGas.lte(value.data.ethersTx.gasLimit || maxGas)) {
                throw "Max gas reached"
            }
            return value.data
        })
}

var reference: any = {}

async function run() {
    try {
        const quoteAmount = await quote(fromTokenAddress, toTokenAddress, balance)
        if (quoteAmount.isZero()) return;
        const returnAmount = await quote(toTokenAddress, fromTokenAddress, quoteAmount)
        if (returnAmount.isZero()) return;
        if (balance.add(minProfit).lte(returnAmount)) {
            reference.maxProfit = null
            console.log(`Found possible arb at ${new Date()} for ${formatted(returnAmount.sub(balance).toString(), reference.fromToken.decimals)} ${reference.fromToken.symbol}`)
            const firstLeg = await swap(fromTokenAddress, toTokenAddress, balance.toString(), address)
            if (BigNumber.from(firstLeg.toTokenAmount).lt(quoteAmount)) {
                throw `${reference.toToken.symbol} amount on swap was less than quoted, difference: ${formatted(quoteAmount.sub(firstLeg.toTokenAmount).toString(), reference.toToken.decimals)} ${reference.toToken.symbol}`
            }
            const l1Fee = await l1FeeOracleContract.getL1Fee(firstLeg.ethersTx.data)
            if (maximumL1Fee.lt(l1Fee)) {
                throw `Transaction would be too expensive to store in L1: ${customFormatted(l1Fee.toString(), 18, 8)} ETH`
            }
            const firstLegResponse = await wallet.sendTransaction(firstLeg.ethersTx)
            await firstLegResponse.wait()
            console.log('First leg complete')
            const firstLegBalance = await toTokenContract.balanceOf(address)
            console.log(`First leg balance ${formatted(firstLegBalance.toString(), reference.toToken.decimals)} ${reference.toToken.symbol}`)
            const secondLeg = await swap(toTokenAddress, fromTokenAddress, firstLegBalance.toString(), address)
            const secondLegResponse = await wallet.sendTransaction(secondLeg.ethersTx)
            await secondLegResponse.wait()
            console.log('Second leg complete')
            const finalBalance = await fromTokenContract.balanceOf(address)
            console.log(`Second leg balance ${formatted(finalBalance.toString(), reference.fromToken.decimals)} ${reference.fromToken.symbol}`)
            if (BigNumber.from(finalBalance).lt(balance)) {
                throw `Arb was not favorable, lost ${formatted(balance.sub(finalBalance).toString(), reference.fromToken.decimals)} ${reference.fromToken.symbol}`
            } else {
                console.log(`Arb was successful, profit ${formatted(BigNumber.from(finalBalance).sub(balance).toString(), reference.fromToken.decimals)} ${reference.fromToken.symbol}`)
                balance = BigNumber.from(finalBalance)
                console.log(`New balance ${formatted(balance.toString(), reference.fromToken.decimals)} ${reference.fromToken.symbol}`)
            }
        } else {
            const profit = returnAmount.sub(balance)
            const currentMaxProfit = reference.maxProfit || BigNumber.from(0)
            if (profit.gt(currentMaxProfit)) {
                reference.maxProfit = profit
                console.log(`Arb wouldn't suffice requirements, max profit so far would be: ${formatted(profit.toString(), reference.fromToken.decimals)} ${reference.fromToken.symbol}`)
            }
        }
    } catch (error) {
        console.error(`Failed at ${new Date()}`)
        console.error(error)
        if (typeof error == "string" && (error as string)?.includes('Arb was not favorable') == true) {
            clearInterval(reference.interval)
        }
    }
}

async function setup() {
    try {
        balance = await fromTokenContract.balanceOf(address)
        const fromTokenSymbol = await fromTokenContract.symbol()
        const fromTokenDecimals = await fromTokenContract.decimals()
        minProfit = minProfit.mul(BigNumber.from(10).pow(fromTokenDecimals))
        reference.fromToken = {
            symbol: fromTokenSymbol,
            decimals: fromTokenDecimals
        }
        const toTokenSymbol = await toTokenContract.symbol()
        const toTokenDecimals = await toTokenContract.decimals()
        reference.toToken = {
            symbol: toTokenSymbol,
            decimals: toTokenDecimals
        }
        console.log(`Initial balance: ${formatted(balance.toString(), fromTokenDecimals)} ${fromTokenSymbol}`,)
        const fromTokenAllowance = await allowance(fromTokenAddress, address)
        if (fromTokenAllowance.isZero()) {
            const trx = await approve(fromTokenAddress)
            const response = await wallet.sendTransaction(trx)
            await response.wait()
            console.log(`Approved ${fromTokenSymbol}`)
        }
        const toTokenAllowance = await allowance(toTokenAddress, address)
        if (toTokenAllowance.isZero()) {
            const trx = await approve(toTokenAddress)
            const response = await wallet.sendTransaction(trx)
            await response.wait()
            console.log(`Approved ${toTokenSymbol}`)
        }
        reference.interval = setInterval(run, pollingTime)
    } catch (error) {
        console.error('Failed setup')
        console.error(error)
    }
}

console.log(`Running script... (${new Date()})`)
setup()