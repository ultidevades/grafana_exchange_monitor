import axios from 'axios';
import crypto from 'crypto';
import { config } from '../config';
import { Position, AccountSummary, ExchangeData } from '../models/position.model';

export enum BinanceAccountType {
    FUTURES = 'futures',
    PORTFOLIO_MARGIN = 'portfolioMargin'
}

export class BinanceClient {
    private apiKey: string;
    private apiSecret: string;
    private accountType: BinanceAccountType;
    private baseUrl: string;
    private recvWindow: number = 60000;
    private timeOffset: number = 0;
    private lastValidData: ExchangeData;

    constructor(accountType: BinanceAccountType) {
        this.accountType = accountType;

        if (accountType === BinanceAccountType.FUTURES) {
            this.apiKey = config.exchanges.binance.futures.apiKey;
            this.apiSecret = config.exchanges.binance.futures.apiSecret;
            this.baseUrl = 'https://fapi.binance.com';  // USDT-M Futures
        } else {
            this.apiKey = config.exchanges.binance.portfolioMargin.apiKey;
            this.apiSecret = config.exchanges.binance.portfolioMargin.apiSecret;
            this.baseUrl = 'https://papi.binance.com';   // Portfolio Margin uses papi
        }

        this.lastValidData = {
            positions: [],
            accountSummary: {
                exchange: 'binance',
                accountId: accountType,
                baseCurrency: 'USDT',
                baseBalance: 0,
                totalNotionalValue: 0,
                accountLeverage: 0,
                openPositionsCount: 0,
                openOrdersCount: 0,
                accountMarginRatio: 0,
                liquidationBuffer: 0
            }
        };
    }

    public async initialize(): Promise<void> {
        try {
            await this.syncTime();
            await this.getAccountInfo();
            console.log(`Successfully initialized Binance ${this.accountType} client`);
        } catch (error) {
            console.error(`Failed to initialize Binance ${this.accountType} client:`, error);
            throw error;
        }
    }

    private async syncTime(): Promise<void> {
        try {
            // Use the appropriate API for time sync based on account type
            const timeSyncUrl = this.accountType === BinanceAccountType.FUTURES ?
                'https://fapi.binance.com/fapi/v1/time' :
                'https://papi.binance.com/papi/v1/time';

            const response = await axios.get(timeSyncUrl);
            const serverTime = response.data.serverTime;
            const localTime = Date.now();
            this.timeOffset = serverTime - localTime;
            // console.log(`Time synchronized for ${this.accountType}, offset: ${this.timeOffset}ms`);
        } catch (error) {
            console.error(`Error synchronizing time with Binance for ${this.accountType}:`, error);
            this.timeOffset = 0;
        }
    }

    private getServerTime(): number {
        return Date.now() + this.timeOffset;
    }

    private generateSignature(queryString: string): string {
        // console.log('Generating signature for query:', queryString);
        const signature = crypto
            .createHmac('sha256', this.apiSecret)
            .update(queryString)
            .digest('hex');
        console.log('Generated signature:', signature);
        return signature;
    }

    private async makeSignedRequest(endpoint: string, params: any = {}, baseUrlOverride?: string): Promise<any> {
        // Always sync time before making a signed request
        await this.syncTime();

        const timestamp = this.getServerTime();
        const queryParams = new URLSearchParams({
            ...params,
            timestamp: timestamp.toString(),
            recvWindow: this.recvWindow.toString()
        }).toString();

        const signature = this.generateSignature(queryParams);
        const url = `${baseUrlOverride || this.baseUrl}${endpoint}?${queryParams}&signature=${signature}`;

        // console.log(url);

        try {
            const response = await axios.get(url, {
                headers: {
                    'X-MBX-APIKEY': this.apiKey,
                },
            });
            return response.data;
        } catch (error: any) {
            if (error.response && error.response.data) {
                const errorMsg = error.response.data.msg || JSON.stringify(error.response.data);
                console.error(`Binance API error for ${this.accountType}: ${errorMsg}`);
                throw new Error(`Binance API error: ${errorMsg}`);
            }
            throw error;
        }
    }

    public async getAccountInfo(): Promise<any> {
        if (this.accountType === BinanceAccountType.FUTURES) {
            return this.makeSignedRequest('/fapi/v2/account');
        } else {
            return this.makeSignedRequest('/papi/v1/account');
        }
    }

    public async getPositions(): Promise<any> {
        if (this.accountType === BinanceAccountType.FUTURES) {
            return this.makeSignedRequest('/fapi/v2/positionRisk');
        } else {
            return this.makeSignedRequest('/papi/v1/cm/positionRisk');
        }
    }

    public async getOpenOrders(): Promise<any> {
        if (this.accountType === BinanceAccountType.FUTURES) {
            return this.makeSignedRequest('/fapi/v1/openOrders');
        } else {
            return this.makeSignedRequest('/papi/v1/cm/openOrders');
        }
    }

    public async getFundingRates(): Promise<any> {
        try {
            // Get current funding rates from USDT-M futures
            const currentRatesResponse = await axios.get('https://fapi.binance.com/fapi/v1/premiumIndex');
            const currentRates = currentRatesResponse.data;

            // Get historical funding rates for each symbol
            const historicalRatesPromises = currentRates.map(async (rate: any) => {
                try {
                    const response = await axios.get('https://fapi.binance.com/fapi/v1/fundingRate', {
                        params: {
                            symbol: rate.symbol,
                            limit: 30 // Get last 30 funding rates
                        }
                    });

                    const historicalRates = response.data;
                    const sum = historicalRates.reduce((acc: number, hr: any) =>
                        acc + parseFloat(hr.fundingRate), 0
                    );
                    const avgRate = historicalRates.length > 0 ?
                        sum / historicalRates.length :
                        parseFloat(rate.lastFundingRate);

                    return {
                        ...rate,
                        nextFundingRate: avgRate.toString()
                    };
                } catch (error) {
                    console.error(`Error fetching historical rates for ${rate.symbol}:`, error);
                    return rate;
                }
            });

            const ratesWithNextFunding = await Promise.all(historicalRatesPromises);
            return ratesWithNextFunding;
        } catch (error) {
            console.error(`Error fetching funding rates:`, error);
            return [];
        }
    }

    private async getAssetPrice(symbol: string): Promise<number> {
        try {
            // Always use the public API for market data
            const response = await axios.get('https://api.binance.com/api/v3/ticker/price', {
                params: { symbol }
            });
            return parseFloat(response.data.price);
        } catch (error) {
            console.error(`Error fetching ${symbol} price:`, error);
            return 0;
        }
    }

    public async getExchangeData(): Promise<ExchangeData> {
        try {
            await this.syncTime();

            const [accountInfo, positionsData, openOrders] = await Promise.all([
                this.getAccountInfo(),
                this.getPositions(),
                this.getOpenOrders(),
            ]);

            // Get funding rates separately to handle potential failures
            let fundingRates = [];
            try {
                fundingRates = await this.getFundingRates();
            } catch (error) {
                console.warn(`Failed to fetch funding rates for ${this.accountType}, continuing with empty rates:`, error);
            }

            // Process positions based on account type
            const positions: Position[] = await this.processPositions(positionsData, fundingRates);

            // Process account summary based on account type
            const accountSummary = await this.processAccountSummary(accountInfo, positions, openOrders);

            const data = {
                positions,
                accountSummary
            };

            this.lastValidData = data;
            return data;
        } catch (error) {
            console.error(`Error fetching exchange data for ${this.accountType}:`, error);
            return this.lastValidData;
        }
    }

    private async processPositions(positionsData: any, fundingRates: any[]): Promise<Position[]> {
        try {
            if (this.accountType === BinanceAccountType.PORTFOLIO_MARGIN) {
                const positionPromises = positionsData.map(async (pos: any) => {
                    // Common fields for all position types
                    const symbol = pos.symbol;
                    const positionAmt = parseFloat(pos.positionAmt || pos.position);
                    const entryPrice = parseFloat(pos.entryPrice || pos.avgEntryPrice);
                    const markPrice = parseFloat(pos.markPrice || pos.markPrice);
                    const leverage = parseFloat(pos.leverage || 1);
                    const unrealizedProfit = parseFloat(pos.unRealizedProfit || pos.unrealizedPnl || 0);
                    let liquidationPrice = parseFloat(pos.liquidationPrice || 0);
                    const marginType = pos.marginType || 'cross';
                    const isCoinM = symbol.includes('_') || symbol.includes('USD_');

                    // // Debug logging for position data
                    // console.log(`Processing position for ${symbol}:`, {
                    //     positionAmt,
                    //     entryPrice,
                    //     markPrice,
                    //     leverage,
                    //     liquidationPrice,
                    //     isCoinM
                    // });

                    // Calculate liquidation price if not provided
                    if (liquidationPrice === 0 || liquidationPrice < 0.001) {
                        const maintenanceMarginRatio = 0.013;                        
                        if (isCoinM) {
                            if (positionAmt < 0) { // Short position
                                // For shorts in portfolio margin:
                                // 1. Start with base maintenance margin (3%)
                                // 2. Add leverage impact (1/leverage)
                                // 3. Add buffer for portfolio margin (0.5%)
                                const totalMarginRatio = maintenanceMarginRatio + (1 / leverage) + 0.005;
                                liquidationPrice = markPrice * (1 + totalMarginRatio);
                            } else { // Long position
                                // For longs, use standard calculation
                                liquidationPrice = markPrice * (1 - maintenanceMarginRatio);
                            }
                            
                            // console.log(`Calculated COIN-M liquidation price for ${symbol}:`, {
                            //     originalPrice: liquidationPrice,
                            //     positionAmt,
                            //     markPrice,
                            //     maintenanceMarginRatio,
                            //     leverage,
                            //     totalMarginRatio: positionAmt < 0 ? maintenanceMarginRatio + (1 / leverage) + 0.005 : maintenanceMarginRatio,
                            //     isShort: positionAmt < 0
                            // });
                        } else {
                            // USDT-M calculation
                            liquidationPrice = positionAmt < 0
                                ? markPrice * (1 + (1 / leverage) + maintenanceMarginRatio)
                                : markPrice * (1 - (1 / leverage) - maintenanceMarginRatio);
                        }
                    }

                    const liquidationDistance = this.calculateLiquidationDistance(markPrice, liquidationPrice);


                    if (isCoinM) {
                        const positionSizeUSDT = positionAmt * markPrice;
                        const notionalValue = Number(positionSizeUSDT.toFixed(2));

                        // // Debug logging for final COIN-M position
                        // console.log(`Final COIN-M position data for ${symbol}:`, {
                        //     liquidationPrice,
                        //     liquidationDistance,
                        //     notionalValue,
                        //     positionSizeUSDT
                        // });

                        return {
                            symbol,
                            side: positionAmt > 0 ? 'LONG' : 'SHORT',
                            size: Math.abs(positionAmt),
                            notionalValue,
                            entryPrice: Number(entryPrice.toFixed(2)),
                            markPrice: Number(markPrice.toFixed(2)),
                            liquidationPrice: Number(liquidationPrice.toFixed(2)),
                            liquidationPriceChangePercent: Number(liquidationDistance.toFixed(2)),
                            currentFundingRate: 0, // COIN-M doesn't use funding rates
                            nextFundingRate: 0,
                            leverage: Number(leverage.toFixed(2)),
                            unrealizedPnl: Number(unrealizedProfit.toFixed(2)),
                            realizedPnl: 0,
                            marginMode: marginType.toLowerCase() === 'cross' ? 'CROSS' : 'ISOLATED',
                            exchange: 'binance'
                        };
                    } else {
                        // Handle USDT-M positions
                        const fundingRate = fundingRates.find((fr: any) => fr.symbol === symbol);
                        const positionSize = Number(positionAmt.toFixed(2));
                        const notionalValue = Number((Math.abs(positionSize * markPrice)).toFixed(2));
                        const currentFundingRate = Number((fundingRate ? parseFloat(fundingRate.lastFundingRate) * 100 : 0).toFixed(2));
                        const nextFundingRate = Number((fundingRate ? parseFloat(fundingRate.nextFundingRate) * 100 : 0).toFixed(2));

                        return {
                            symbol,
                            side: positionSize > 0 ? 'LONG' : 'SHORT',
                            size: Math.abs(positionSize),
                            notionalValue,
                            entryPrice: Number(entryPrice.toFixed(2)),
                            markPrice: Number(markPrice.toFixed(2)),
                            liquidationPrice: Number(liquidationPrice.toFixed(2)),
                            liquidationPriceChangePercent: liquidationDistance,
                            currentFundingRate,
                            nextFundingRate,
                            leverage: Number(leverage.toFixed(2)),
                            unrealizedPnl: Number(unrealizedProfit.toFixed(2)),
                            realizedPnl: 0,
                            marginMode: marginType.toLowerCase() === 'cross' ? 'CROSS' : 'ISOLATED',
                            exchange: 'binance'
                        };
                    }
                });

                return Promise.all(positionPromises);
            } else {
                // Original futures handling (non-portfolio margin)
                const positionPromises = positionsData
                    .filter((pos: any) => Math.abs(parseFloat(pos.positionAmt)) > 0)
                    .map(async (pos: any) => {
                        const fundingRate = fundingRates.find(fr => fr.symbol === pos.symbol);
                        const positionSize = Number(parseFloat(pos.positionAmt).toFixed(2));
                        const entryPrice = Number(parseFloat(pos.entryPrice).toFixed(2));
                        const markPrice = Number(parseFloat(pos.markPrice).toFixed(2));
                        const leverage = Number(parseFloat(pos.leverage).toFixed(2));
                        const unrealizedPnl = Number(parseFloat(pos.unRealizedProfit).toFixed(2));
                        const liquidationPrice = Number(parseFloat(pos.liquidationPrice).toFixed(2));
                        const notionalValue = Number((Math.abs(positionSize * markPrice)).toFixed(2));
                        const liquidationDistance = Number(this.calculateLiquidationDistance(markPrice, liquidationPrice).toFixed(2));
                        const currentFundingRate = Number((fundingRate ? parseFloat(fundingRate.lastFundingRate) * 100 : 0).toFixed(2));
                        const nextFundingRate = Number((fundingRate ? parseFloat(fundingRate.nextFundingRate) * 100 : 0).toFixed(2));

                        return {
                            symbol: pos.symbol,
                            side: positionSize > 0 ? 'LONG' : 'SHORT',
                            size: Math.abs(positionSize),
                            notionalValue,
                            entryPrice,
                            markPrice,
                            liquidationPrice,
                            liquidationPriceChangePercent: liquidationDistance,
                            currentFundingRate,
                            nextFundingRate,
                            leverage,
                            unrealizedPnl,
                            realizedPnl: 0,
                            marginMode: pos.marginType.toLowerCase() === 'cross' ? 'CROSS' : 'ISOLATED',
                            exchange: 'binance'
                        };
                    });

                return Promise.all(positionPromises);
            }
        } catch (error) {
            console.error(`Error processing positions for ${this.accountType}:`, error);
            console.error('Positions data:', JSON.stringify(positionsData, null, 2));
            return [];
        }
    }
    
    private calculateLiquidationDistance(markPrice: number, liquidationPrice: number): number {
        if (liquidationPrice === 0) return 0;
        return Number(((Math.abs(markPrice - liquidationPrice) / markPrice) * 100).toFixed(2));
    }    

    private async getUSDTPrice(asset: string): Promise<number> {
        if (asset === 'USDT') return 1;

        try {
            // Try direct USDT pair first
            const usdtPair = `${asset}USDT`;
            try {
                const price = await this.getAssetPrice(usdtPair);
                if (price > 0) return price;
            } catch (e) {   
                // If direct USDT pair fails, continue to try BTC pair
            }

            // If no direct USDT pair, try through BTC
            const btcPair = `${asset}BTC`;
            const btcPrice = await this.getAssetPrice(btcPair);
            const btcUsdt = await this.getAssetPrice('BTCUSDT');

            return btcPrice * btcUsdt;
        } catch (error) {
            console.error(`Failed to get USDT price for ${asset}:`, error);
            return 0;
        }
    }

    private async calculateTotalUSDTBalance(): Promise<number> {
        let totalUsdt = 0;

        try {
            // Get USDT-M Futures balance
            const usdtFuturesAccount = await this.makeSignedRequest('/fapi/v2/account');
            const usdtAssets = usdtFuturesAccount.assets || [];
            for (const asset of usdtAssets) {
                const balance = parseFloat(asset.walletBalance);
                if (balance <= 0) continue;

                if (asset.asset === 'USDT') {
                    totalUsdt += balance;
                } else {
                    const usdtPrice = await this.getUSDTPrice(asset.asset);
                    totalUsdt += balance * usdtPrice;
                }
            }

            // Get COIN-M Futures balance from the correct endpoint
            try {
                const coinFuturesAccount = await axios.get('https://dapi.binance.com/dapi/v1/account', {
                    headers: {
                        'X-MBX-APIKEY': this.apiKey,
                    },
                    params: {
                        timestamp: this.getServerTime(),
                        recvWindow: this.recvWindow,
                        signature: this.generateSignature(`timestamp=${this.getServerTime()}&recvWindow=${this.recvWindow}`)
                    }
                });

                const coinAssets = coinFuturesAccount.data.assets || [];
                for (const asset of coinAssets) {
                    const balance = parseFloat(asset.walletBalance);
                    if (balance <= 0) continue;

                    const usdtPrice = await this.getUSDTPrice(asset.asset);
                    totalUsdt += balance * usdtPrice;
                }
            } catch (error) {
                console.warn('Error fetching COIN-M futures balance:', error);
            }

            // console.log('Total USDT Balance calculated:', totalUsdt);
        } catch (error) {
            console.error('Error calculating total USDT balance:', error);
        }

        return Number(totalUsdt.toFixed(2));
    }

    private async processAccountSummary(accountInfo: any, positions: Position[], openOrders: any[]): Promise<AccountSummary> {
        console.log('Starting processAccountSummary with account type:', this.accountType);
        // console.log('Initial accountInfo:', accountInfo);

        let baseBalance = 0;
        let totalNotionalValue = 0;
        let accountLeverage = 0;
        let marginRatio = 0;
        let liquidationBuffer = 0;

        // Calculate total notional value and average leverage from all positions
        totalNotionalValue = positions.reduce((sum, position) => sum + position.notionalValue, 0);

        // Calculate average leverage from all positions
        const totalLeverage = positions.reduce((sum, position) => sum + position.leverage, 0);
        accountLeverage = positions.length > 0 ? Number((totalLeverage / positions.length).toFixed(2)) : 0;

        if (this.accountType === BinanceAccountType.FUTURES) {
            console.log('Processing FUTURES account');
            const totalMarginBalance = Number(parseFloat(accountInfo.totalMarginBalance).toFixed(2));
            const totalMaintenanceMargin = Number(parseFloat(accountInfo.totalMaintMargin).toFixed(2));

            // Get total balance including both USDT-M and COIN-M
            baseBalance = await this.calculateTotalUSDTBalance();
            // console.log('Base balance after calculateTotalUSDTBalance:', baseBalance);


            marginRatio = Number((totalMaintenanceMargin / totalMarginBalance * 100).toFixed(2));
            let calculatedBuffer = totalMaintenanceMargin > 0 ?
                Number((((totalMarginBalance - totalMaintenanceMargin) / totalMaintenanceMargin) * 100).toFixed(2)) : 0;
            liquidationBuffer = Math.min(calculatedBuffer, 100);
        } else {
            console.log('Processing PORTFOLIO MARGIN account');
            try {
                // console.log('Raw Portfolio Account Info:', JSON.stringify(accountInfo, null, 2));

                // Use the correct fields from the portfolio margin account response
                const totalBalance = Number(parseFloat(accountInfo.actualEquity || '0').toFixed(2));
                const maintenanceMargin = Number(parseFloat(accountInfo.accountMaintMargin || '0').toFixed(2));
                const initialMargin = Number(parseFloat(accountInfo.accountInitialMargin || '0').toFixed(2));

                baseBalance = totalBalance;

                // Calculate margin ratio from maintenance margin and total balance
                marginRatio = maintenanceMargin > 0 && totalBalance > 0 ?
                    Number((maintenanceMargin / totalBalance * 100).toFixed(2)) : 0;

                // Calculate liquidation buffer
                let calculatedBuffer = maintenanceMargin > 0 ?
                    Number((((totalBalance - maintenanceMargin) / maintenanceMargin) * 100).toFixed(2)) : 0;
                liquidationBuffer = Math.min(calculatedBuffer, 100);

                // console.log('Portfolio Margin Balance Details:', {
                //     accountEquity: totalBalance,
                //     maintenanceMargin,
                //     initialMargin,
                //     currentBaseBalance: baseBalance,
                //     calculatedMarginRatio: marginRatio,
                //     calculatedLeverage: accountLeverage
                // });

            } catch (error) {
                console.error('Error processing portfolio margin metrics:', error);
                console.error('Account Info received:', accountInfo);
            }
        }

        const result = {
            exchange: 'binance',
            accountId: this.accountType,
            baseCurrency: 'USDT',
            baseBalance,
            totalNotionalValue,
            accountLeverage,
            openPositionsCount: positions.length,
            openOrdersCount: openOrders.length,
            accountMarginRatio: marginRatio,
            liquidationBuffer
        };

        // console.log('Final result from processAccountSummary:', result);
        return result;
    }
}